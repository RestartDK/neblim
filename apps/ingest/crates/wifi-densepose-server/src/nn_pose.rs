use std::collections::VecDeque;
use std::env;
use std::f32::consts::PI;
use std::sync::Mutex;

use anyhow::{anyhow, Context};
use wifi_densepose_mat::integration::{CsiReadings, SensorCsiReading};
use wifi_densepose_nn::inference::{InferenceOptions, WiFiDensePosePipeline};
use wifi_densepose_nn::{DensePoseConfig, OnnxBackend, Tensor, TranslatorConfig};

const DEFAULT_WINDOW_SIZE: usize = 32;
const DEFAULT_SUBCARRIERS: usize = 64;
const DEFAULT_INPUT_CHANNELS: usize = 2;
const DEFAULT_INFERENCE_STRIDE: u64 = 4;
const DEFAULT_MIN_CONFIDENCE: f64 = 0.55;

#[derive(Debug, Clone)]
pub struct NnPoseConfig {
    pub enabled: bool,
    pub translator_model_path: Option<String>,
    pub densepose_model_path: Option<String>,
    pub window_size: usize,
    pub subcarriers: usize,
    pub input_channels: usize,
    pub inference_stride: u64,
    pub min_confidence: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct NnPoseConfigSnapshot {
    pub window_size: usize,
    pub subcarriers: usize,
    pub input_channels: usize,
    pub inference_stride: u64,
    pub min_confidence: f64,
    pub translator_model_configured: bool,
    pub densepose_model_configured: bool,
}

impl NnPoseConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let translator_model_path = read_optional_env("WIFI_DENSEPOSE_TRANSLATOR_MODEL_PATH");
        let densepose_model_path = read_optional_env("WIFI_DENSEPOSE_DENSEPOSE_MODEL_PATH");
        let enable_flag = parse_env_bool("WIFI_DENSEPOSE_ENABLE_NN_POSE", false)?;

        let enabled =
            enable_flag || (translator_model_path.is_some() && densepose_model_path.is_some());

        Ok(Self {
            enabled,
            translator_model_path,
            densepose_model_path,
            window_size: parse_env_usize("WIFI_DENSEPOSE_NN_WINDOW_SIZE", DEFAULT_WINDOW_SIZE)?
                .max(4),
            subcarriers: parse_env_usize("WIFI_DENSEPOSE_NN_SUBCARRIERS", DEFAULT_SUBCARRIERS)?
                .max(8),
            input_channels: parse_env_usize(
                "WIFI_DENSEPOSE_NN_INPUT_CHANNELS",
                DEFAULT_INPUT_CHANNELS,
            )?
            .max(1),
            inference_stride: parse_env_u64(
                "WIFI_DENSEPOSE_NN_INFERENCE_STRIDE",
                DEFAULT_INFERENCE_STRIDE,
            )?
            .max(1),
            min_confidence: parse_env_f64(
                "WIFI_DENSEPOSE_NN_MIN_CONFIDENCE",
                DEFAULT_MIN_CONFIDENCE,
            )?
            .clamp(0.01, 0.99),
        })
    }

    pub fn snapshot(&self) -> NnPoseConfigSnapshot {
        NnPoseConfigSnapshot {
            window_size: self.window_size,
            subcarriers: self.subcarriers,
            input_channels: self.input_channels,
            inference_stride: self.inference_stride,
            min_confidence: self.min_confidence,
            translator_model_configured: self.translator_model_path.is_some(),
            densepose_model_configured: self.densepose_model_path.is_some(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct NnPoseMetrics {
    pub enabled: bool,
    pub model_loaded: bool,
    pub inference_count: u64,
    pub inference_errors: u64,
    pub last_confidence: Option<f64>,
}

impl NnPoseMetrics {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            model_loaded: false,
            inference_count: 0,
            inference_errors: 0,
            last_confidence: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NeuralPoseEstimate {
    pub timestamp_ms: u64,
    pub confidence: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub uncertainty_radius: f64,
}

#[derive(Debug, Clone)]
struct CsiFeatureFrame {
    amplitudes: Vec<f32>,
    phases: Vec<f32>,
    rssi: f32,
}

#[derive(Debug)]
struct NeuralPoseState {
    packet_count: u64,
    buffer: VecDeque<CsiFeatureFrame>,
    latest_estimate: Option<NeuralPoseEstimate>,
    inference_count: u64,
    inference_errors: u64,
    last_confidence: Option<f64>,
}

pub struct NeuralPoseEstimator {
    pipeline: WiFiDensePosePipeline<OnnxBackend>,
    config: NnPoseConfig,
    state: Mutex<NeuralPoseState>,
}

impl NeuralPoseEstimator {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let config = NnPoseConfig::from_env()?;
        Self::from_config(config)
    }

    pub fn from_config(config: NnPoseConfig) -> anyhow::Result<Option<Self>> {
        if !config.enabled {
            return Ok(None);
        }

        let translator_model_path = config
            .translator_model_path
            .clone()
            .ok_or_else(|| anyhow!("WIFI_DENSEPOSE_TRANSLATOR_MODEL_PATH is required"))?;
        let densepose_model_path = config
            .densepose_model_path
            .clone()
            .ok_or_else(|| anyhow!("WIFI_DENSEPOSE_DENSEPOSE_MODEL_PATH is required"))?;

        let translator_backend =
            OnnxBackend::from_file(&translator_model_path).with_context(|| {
                format!("failed to load translator ONNX model: {translator_model_path}")
            })?;
        let densepose_backend =
            OnnxBackend::from_file(&densepose_model_path).with_context(|| {
                format!("failed to load densepose ONNX model: {densepose_model_path}")
            })?;

        let translator_config = TranslatorConfig {
            input_channels: config.input_channels,
            ..Default::default()
        };
        let densepose_config = DensePoseConfig {
            input_channels: translator_config.output_channels,
            ..Default::default()
        };

        let pipeline = WiFiDensePosePipeline::new(
            translator_backend,
            densepose_backend,
            translator_config,
            densepose_config,
            InferenceOptions::cpu(),
        );

        Ok(Some(Self {
            pipeline,
            config,
            state: Mutex::new(NeuralPoseState {
                packet_count: 0,
                buffer: VecDeque::new(),
                latest_estimate: None,
                inference_count: 0,
                inference_errors: 0,
                last_confidence: None,
            }),
        }))
    }

    pub fn ingest_reading(&self, reading: &CsiReadings) {
        let Some(sensor) = reading.readings.first() else {
            return;
        };

        let frame = self.frame_from_sensor(sensor, reading.metadata.rssi);

        let window = {
            let mut state = lock_state(&self.state);
            state.packet_count = state.packet_count.saturating_add(1);
            state.buffer.push_back(frame);

            while state.buffer.len() > self.config.window_size {
                state.buffer.pop_front();
            }

            if state.buffer.len() < self.config.window_size {
                return;
            }

            if state.packet_count % self.config.inference_stride != 0 {
                return;
            }

            state.buffer.iter().cloned().collect::<Vec<_>>()
        };

        match self.run_inference(window) {
            Ok(Some(estimate)) => {
                let mut state = lock_state(&self.state);
                state.inference_count = state.inference_count.saturating_add(1);
                state.last_confidence = Some(estimate.confidence);
                state.latest_estimate = Some(estimate);
            }
            Ok(None) => {
                let mut state = lock_state(&self.state);
                state.inference_count = state.inference_count.saturating_add(1);
                state.last_confidence = None;
                state.latest_estimate = None;
            }
            Err(error) => {
                let mut state = lock_state(&self.state);
                state.inference_errors = state.inference_errors.saturating_add(1);
                if state.inference_errors == 1 || state.inference_errors % 50 == 0 {
                    tracing::warn!(%error, errors = state.inference_errors, "NN pose inference failed");
                }
            }
        }
    }

    pub fn latest_estimate(&self, ttl_ms: u64) -> Option<NeuralPoseEstimate> {
        let state = lock_state(&self.state);
        let estimate = state.latest_estimate.clone()?;
        let age_ms = current_time_millis().saturating_sub(estimate.timestamp_ms);
        if age_ms <= ttl_ms {
            Some(estimate)
        } else {
            None
        }
    }

    pub fn metrics(&self) -> NnPoseMetrics {
        let state = lock_state(&self.state);
        NnPoseMetrics {
            enabled: true,
            model_loaded: true,
            inference_count: state.inference_count,
            inference_errors: state.inference_errors,
            last_confidence: state.last_confidence,
        }
    }

    pub fn config_snapshot(&self) -> NnPoseConfigSnapshot {
        self.config.snapshot()
    }

    fn frame_from_sensor(
        &self,
        sensor: &SensorCsiReading,
        metadata_rssi: Option<f64>,
    ) -> CsiFeatureFrame {
        let mut amplitudes = vec![0.0f32; self.config.subcarriers];
        let mut phases = vec![0.0f32; self.config.subcarriers];

        for index in 0..self.config.subcarriers {
            if let Some(value) = sensor.amplitudes.get(index) {
                amplitudes[index] = ((*value as f32).abs() + 1.0).ln();
            }
            if let Some(value) = sensor.phases.get(index) {
                phases[index] = (*value as f32 / PI).clamp(-1.0, 1.0);
            }
        }

        let raw_rssi = metadata_rssi.unwrap_or(sensor.rssi);
        let rssi = ((raw_rssi as f32 + 100.0) / 50.0).clamp(0.0, 1.0);

        CsiFeatureFrame {
            amplitudes,
            phases,
            rssi,
        }
    }

    fn run_inference(
        &self,
        window: Vec<CsiFeatureFrame>,
    ) -> anyhow::Result<Option<NeuralPoseEstimate>> {
        let mut input = Tensor::zeros_4d([
            1,
            self.config.input_channels,
            self.config.window_size,
            self.config.subcarriers,
        ]);
        let input_arr = input
            .as_array4_mut()
            .map_err(|error| anyhow!("failed to build CSI tensor: {error}"))?;

        for t in 0..self.config.window_size {
            let frame = &window[t];
            for sc in 0..self.config.subcarriers {
                input_arr[[0, 0, t, sc]] = frame.amplitudes[sc];

                if self.config.input_channels > 1 {
                    input_arr[[0, 1, t, sc]] = frame.phases[sc];
                }

                if self.config.input_channels > 2 {
                    let previous = if t > 0 {
                        window[t - 1].amplitudes[sc]
                    } else {
                        frame.amplitudes[sc]
                    };
                    input_arr[[0, 2, t, sc]] = frame.amplitudes[sc] - previous;
                }

                if self.config.input_channels > 3 {
                    input_arr[[0, 3, t, sc]] = frame.rssi;
                }

                if self.config.input_channels > 4 {
                    for ch in 4..self.config.input_channels {
                        input_arr[[0, ch, t, sc]] = 0.0;
                    }
                }
            }
        }

        let output = self
            .pipeline
            .run(&input)
            .map_err(|error| anyhow!("pipeline inference failed: {error}"))?;

        Self::estimate_from_output(
            &output.segmentation,
            &output.uv_coordinates,
            self.config.min_confidence,
        )
    }

    fn estimate_from_output(
        segmentation: &Tensor,
        uv_coordinates: &Tensor,
        min_confidence: f64,
    ) -> anyhow::Result<Option<NeuralPoseEstimate>> {
        let (seg_shape, seg_values) = tensor_to_flat_f32(segmentation)?;
        if seg_shape.len() != 4 {
            return Err(anyhow!("segmentation output must be 4D, got {seg_shape:?}"));
        }

        let batch = seg_shape[0];
        let channels = seg_shape[1];
        let height = seg_shape[2];
        let width = seg_shape[3];

        if batch == 0 || channels < 2 || height == 0 || width == 0 {
            return Ok(None);
        }

        let mut weighted_sum = 0.0f64;
        let mut weighted_x = 0.0f64;
        let mut weighted_y = 0.0f64;
        let mut active_pixels = 0usize;

        for y in 0..height {
            for x in 0..width {
                let bg = seg_values[seg_index(height, width, 0, y, x)];
                let mut fg = f32::NEG_INFINITY;
                for c in 1..channels {
                    fg = fg.max(seg_values[seg_index(height, width, c, y, x)]);
                }

                let probability = (1.0f32 / (1.0 + (bg - fg).exp())) as f64;
                if probability >= 0.5 {
                    active_pixels += 1;
                }
                weighted_sum += probability;
                weighted_x += probability * x as f64;
                weighted_y += probability * y as f64;
            }
        }

        let pixel_count = (height * width) as f64;
        if pixel_count == 0.0 {
            return Ok(None);
        }

        let active_ratio = active_pixels as f64 / pixel_count;
        let confidence = (weighted_sum / pixel_count * 0.7 + active_ratio * 0.3).clamp(0.0, 1.0);

        if confidence < min_confidence || active_ratio < 0.01 {
            return Ok(None);
        }

        let center_x = if weighted_sum > 0.0 {
            weighted_x / weighted_sum
        } else {
            (width as f64 - 1.0) / 2.0
        };
        let center_y = if weighted_sum > 0.0 {
            weighted_y / weighted_sum
        } else {
            (height as f64 - 1.0) / 2.0
        };

        let center_u = center_x
            .round()
            .clamp(0.0, (width.saturating_sub(1)) as f64) as usize;
        let center_v = center_y
            .round()
            .clamp(0.0, (height.saturating_sub(1)) as f64) as usize;
        let depth_hint = extract_depth_hint(uv_coordinates, center_v, center_u).unwrap_or(0.5);

        let world_x = ((center_x / (width as f64 - 1.0).max(1.0)) - 0.5) * 6.0;
        let world_y = (1.9 - (center_y / (height as f64 - 1.0).max(1.0)) * 1.2).clamp(0.4, 2.1);
        let world_z = -(0.5 + depth_hint.clamp(0.0, 1.0) * 3.5);
        let uncertainty_radius = (1.3 - confidence * 0.9).clamp(0.2, 1.3);

        Ok(Some(NeuralPoseEstimate {
            timestamp_ms: current_time_millis(),
            confidence,
            x: world_x,
            y: world_y,
            z: world_z,
            uncertainty_radius,
        }))
    }
}

fn seg_index(height: usize, width: usize, channel: usize, y: usize, x: usize) -> usize {
    (((channel * height) + y) * width) + x
}

fn extract_depth_hint(uv_coordinates: &Tensor, y: usize, x: usize) -> Option<f64> {
    let (uv_shape, uv_values) = tensor_to_flat_f32(uv_coordinates).ok()?;
    if uv_shape.len() != 4
        || uv_shape[0] == 0
        || uv_shape[1] < 2
        || uv_shape[2] <= y
        || uv_shape[3] <= x
    {
        return None;
    }

    let height = uv_shape[2];
    let width = uv_shape[3];
    let value = uv_values[seg_index(height, width, 1, y, x)];
    Some(value as f64)
}

fn tensor_to_flat_f32(tensor: &Tensor) -> anyhow::Result<(Vec<usize>, Vec<f32>)> {
    match tensor {
        Tensor::Float4D(arr) => Ok((arr.shape().to_vec(), arr.iter().copied().collect())),
        Tensor::FloatND(arr) => Ok((arr.shape().to_vec(), arr.iter().copied().collect())),
        _ => Err(anyhow!("expected float tensor output")),
    }
}

fn read_optional_env(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_env_bool(key: &str, default: bool) -> anyhow::Result<bool> {
    let Some(raw) = env::var(key).ok() else {
        return Ok(default);
    };

    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        value => Err(anyhow!("invalid boolean for {key}: {value}")),
    }
}

fn parse_env_usize(key: &str, default: usize) -> anyhow::Result<usize> {
    match env::var(key) {
        Ok(raw) => raw
            .trim()
            .parse::<usize>()
            .with_context(|| format!("failed to parse {key}")),
        Err(_) => Ok(default),
    }
}

fn parse_env_u64(key: &str, default: u64) -> anyhow::Result<u64> {
    match env::var(key) {
        Ok(raw) => raw
            .trim()
            .parse::<u64>()
            .with_context(|| format!("failed to parse {key}")),
        Err(_) => Ok(default),
    }
}

fn parse_env_f64(key: &str, default: f64) -> anyhow::Result<f64> {
    match env::var(key) {
        Ok(raw) => raw
            .trim()
            .parse::<f64>()
            .with_context(|| format!("failed to parse {key}")),
        Err(_) => Ok(default),
    }
}

fn current_time_millis() -> u64 {
    chrono::Utc::now().timestamp_millis().max(0) as u64
}

fn lock_state(state: &Mutex<NeuralPoseState>) -> std::sync::MutexGuard<'_, NeuralPoseState> {
    match state.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}
