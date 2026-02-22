use std::{
    env,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::Duration,
};

use anyhow::{anyhow, Context};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{HeaderValue, Method, StatusCode},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use geo::Point;
use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, sync::broadcast};
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use uuid::Uuid;
use wifi_densepose_mat::{
    api::AppState as MatAppState,
    api::WebSocketMessage,
    domain::{SensorPosition, SensorType, SignalStrength},
    integration::{DeviceSettings, HardwareAdapter, HardwareConfig},
    BreathingPattern, BreathingType, Coordinates3D, DisasterEvent, DisasterType,
    LocationUncertainty, MovementProfile, MovementType, ScanZone, VitalSignsReading,
};

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:8787";
const DEFAULT_ALLOWED_ORIGINS: &str = "http://localhost:5173,http://127.0.0.1:5173";
const DEFAULT_POSE_HEARTBEAT_SECS: u64 = 2;
const DEFAULT_PRESENCE_TTL_MS: u64 = 4_000;
const DEFAULT_POSE_FRAME_TICK_MS: u64 = 250;
const DEFAULT_ESP32_BAUD_RATE: u32 = 921_600;
const DEFAULT_ESP32_READ_TIMEOUT_MS: u64 = 25;
const DEFAULT_MOTION_ACTIVE_THRESHOLD: f64 = 0.24;
const DEFAULT_MOTION_HIGH_THRESHOLD: f64 = 0.52;
static PRESENCE_PERSON_ID: LazyLock<Uuid> =
    LazyLock::new(|| Uuid::parse_str("00000000-0000-0000-0000-000000000001").expect("valid UUID"));

#[derive(Debug)]
struct PresenceTracker {
    state: Mutex<PresenceState>,
}

#[derive(Debug, Clone)]
struct PresenceSnapshot {
    last_seen_ms: u64,
    last_sequence_num: Option<u32>,
    last_rssi: Option<f64>,
    packet_count: u64,
    subcarriers: usize,
    packet_interval_ema_ms: Option<f64>,
    motion_score: f64,
    csi_quality: f64,
    x: f64,
    y: f64,
    z: f64,
}

#[derive(Debug, Clone)]
struct PresenceState {
    last_seen_ms: u64,
    last_sequence_num: Option<u32>,
    last_rssi: Option<f64>,
    packet_count: u64,
    subcarriers: usize,
    packet_interval_ema_ms: Option<f64>,
    last_amplitude_mean: Option<f64>,
    last_amplitude_std: Option<f64>,
    motion_score: f64,
    csi_quality: f64,
    x: f64,
    y: f64,
    z: f64,
}

impl Default for PresenceState {
    fn default() -> Self {
        Self {
            last_seen_ms: 0,
            last_sequence_num: None,
            last_rssi: None,
            packet_count: 0,
            subcarriers: 0,
            packet_interval_ema_ms: None,
            last_amplitude_mean: None,
            last_amplitude_std: None,
            motion_score: 0.0,
            csi_quality: 0.45,
            x: 0.0,
            y: 1.2,
            z: -2.0,
        }
    }
}

impl PresenceTracker {
    fn new() -> Self {
        Self {
            state: Mutex::new(PresenceState::default()),
        }
    }

    fn mark_seen(&self, sequence_num: Option<u32>, rssi: Option<f64>, amplitudes: &[f64]) {
        let now_ms = current_time_millis();
        let mut state = self.lock_state();

        let prev_seen_ms = state.last_seen_ms;
        state.last_seen_ms = now_ms;
        state.packet_count = state.packet_count.saturating_add(1);
        state.subcarriers = amplitudes.len();

        if let Some(sequence_num) = sequence_num {
            state.last_sequence_num = Some(sequence_num);
        }

        if let Some(rssi) = rssi {
            state.last_rssi = Some(rssi);
        }

        if prev_seen_ms > 0 {
            let interval_ms = now_ms.saturating_sub(prev_seen_ms) as f64;
            state.packet_interval_ema_ms = Some(match state.packet_interval_ema_ms {
                Some(previous) => previous * 0.90 + interval_ms * 0.10,
                None => interval_ms,
            });
        }

        let amplitude_mean = if amplitudes.is_empty() {
            None
        } else {
            Some(amplitudes.iter().sum::<f64>() / amplitudes.len() as f64)
        };

        let amplitude_std = amplitude_mean.map(|mean| {
            let variance = amplitudes
                .iter()
                .map(|value| (value - mean).powi(2))
                .sum::<f64>()
                / amplitudes.len() as f64;
            variance.sqrt()
        });

        let mut motion_total = 0.0;
        let mut motion_components = 0u64;

        if let (Some(current), Some(previous)) = (amplitude_mean, state.last_amplitude_mean) {
            motion_total += ((current - previous).abs() / 10.0).clamp(0.0, 1.0);
            motion_components += 1;
        }

        if let (Some(current), Some(previous)) = (amplitude_std, state.last_amplitude_std) {
            motion_total += ((current - previous).abs() / 8.0).clamp(0.0, 1.0);
            motion_components += 1;
        }

        if let (Some(current), Some(previous)) = (rssi, state.last_rssi) {
            motion_total += ((current - previous).abs() / 10.0).clamp(0.0, 1.0);
            motion_components += 1;
        }

        let instantaneous_motion = if motion_components == 0 {
            state.motion_score * 0.92
        } else {
            (motion_total / motion_components as f64).clamp(0.0, 1.0)
        };

        state.motion_score = (state.motion_score * 0.88 + instantaneous_motion * 0.12).clamp(0.0, 1.0);

        let rssi_quality = state
            .last_rssi
            .map(|value| ((value + 90.0) / 40.0).clamp(0.0, 1.0))
            .unwrap_or(0.45);
        let subcarrier_quality = (amplitudes.len() as f64 / 192.0).clamp(0.0, 1.0);
        let stability_quality = amplitude_std
            .map(|value| (1.0 - (value / 24.0)).clamp(0.0, 1.0))
            .unwrap_or(0.5);

        state.csi_quality =
            (0.45 * rssi_quality + 0.35 * subcarrier_quality + 0.20 * stability_quality).clamp(0.0, 1.0);

        if let Some(value) = amplitude_mean {
            state.last_amplitude_mean = Some(value);
        }
        if let Some(value) = amplitude_std {
            state.last_amplitude_std = Some(value);
        }

        let phase_seed = sequence_num
            .or(state.last_sequence_num)
            .unwrap_or((now_ms % u32::MAX as u64) as u32) as f64;
        let phase = phase_seed * 0.035;
        let sway = (phase.sin() * 0.6 + (phase * 0.31).cos() * 0.4) * (0.08 + state.motion_score * 0.85);
        let amplitude_bias = amplitude_mean.map(|value| value.sin() * 0.02).unwrap_or(0.0);

        state.x = sway + amplitude_bias;
        state.y = 1.15 + (phase * 0.12).cos() * 0.05;
        state.z = -2.0 + (phase * 0.27).sin() * (0.1 + state.motion_score * 0.70);
    }

    fn snapshot(&self) -> PresenceSnapshot {
        let state = self.lock_state();
        PresenceSnapshot {
            last_seen_ms: state.last_seen_ms,
            last_sequence_num: state.last_sequence_num,
            last_rssi: state.last_rssi,
            packet_count: state.packet_count,
            subcarriers: state.subcarriers,
            packet_interval_ema_ms: state.packet_interval_ema_ms,
            motion_score: state.motion_score,
            csi_quality: state.csi_quality,
            x: state.x,
            y: state.y,
            z: state.z,
        }
    }

    fn is_recent(&self, ttl_ms: u64) -> bool {
        let last_seen_ms = self.snapshot().last_seen_ms;
        if last_seen_ms == 0 {
            return false;
        }

        current_time_millis().saturating_sub(last_seen_ms) <= ttl_ms
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, PresenceState> {
        match self.state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

fn current_time_millis() -> u64 {
    Utc::now().timestamp_millis().max(0) as u64
}

#[derive(Debug, Clone)]
struct ServerConfig {
    bind_addr: SocketAddr,
    allowed_origins: Vec<String>,
    pose_heartbeat_secs: u64,
    presence_ttl_ms: u64,
    pose_frame_tick_ms: u64,
    esp32_port: Option<String>,
    esp32_baud_rate: u32,
    esp32_read_timeout_ms: u64,
    motion_active_threshold: f64,
    motion_high_threshold: f64,
}

impl ServerConfig {
    fn from_env() -> anyhow::Result<Self> {
        let bind_addr = env::var("WIFI_DENSEPOSE_BIND_ADDR")
            .unwrap_or_else(|_| DEFAULT_BIND_ADDR.to_string())
            .parse::<SocketAddr>()
            .context("failed to parse WIFI_DENSEPOSE_BIND_ADDR")?;

        let allowed_origins = env::var("WIFI_DENSEPOSE_ALLOWED_ORIGINS")
            .unwrap_or_else(|_| DEFAULT_ALLOWED_ORIGINS.to_string())
            .split(',')
            .map(str::trim)
            .filter(|origin| !origin.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();

        let pose_heartbeat_secs = env::var("WIFI_DENSEPOSE_POSE_HEARTBEAT_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_POSE_HEARTBEAT_SECS)
            .max(1);

        let presence_ttl_ms = match env::var("WIFI_DENSEPOSE_PRESENCE_TTL_MS") {
            Ok(value) => value
                .parse::<u64>()
                .context("failed to parse WIFI_DENSEPOSE_PRESENCE_TTL_MS")?,
            Err(_) => DEFAULT_PRESENCE_TTL_MS,
        }
        .max(1);

        let pose_frame_tick_ms = match env::var("WIFI_DENSEPOSE_POSE_FRAME_TICK_MS") {
            Ok(value) => value
                .parse::<u64>()
                .context("failed to parse WIFI_DENSEPOSE_POSE_FRAME_TICK_MS")?,
            Err(_) => DEFAULT_POSE_FRAME_TICK_MS,
        }
        .max(1);

        let esp32_port = env::var("WIFI_DENSEPOSE_ESP32_PORT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let esp32_baud_rate = match env::var("WIFI_DENSEPOSE_ESP32_BAUD_RATE") {
            Ok(value) => value
                .parse::<u32>()
                .context("failed to parse WIFI_DENSEPOSE_ESP32_BAUD_RATE")?,
            Err(_) => DEFAULT_ESP32_BAUD_RATE,
        };

        let esp32_read_timeout_ms = match env::var("WIFI_DENSEPOSE_ESP32_READ_TIMEOUT_MS") {
            Ok(value) => value
                .parse::<u64>()
                .context("failed to parse WIFI_DENSEPOSE_ESP32_READ_TIMEOUT_MS")?,
            Err(_) => DEFAULT_ESP32_READ_TIMEOUT_MS,
        }
        .max(1);

        let motion_active_threshold = match env::var("WIFI_DENSEPOSE_MOTION_ACTIVE_THRESHOLD") {
            Ok(value) => value
                .parse::<f64>()
                .context("failed to parse WIFI_DENSEPOSE_MOTION_ACTIVE_THRESHOLD")?,
            Err(_) => DEFAULT_MOTION_ACTIVE_THRESHOLD,
        }
        .clamp(0.01, 0.95);

        let motion_high_threshold = match env::var("WIFI_DENSEPOSE_MOTION_HIGH_THRESHOLD") {
            Ok(value) => value
                .parse::<f64>()
                .context("failed to parse WIFI_DENSEPOSE_MOTION_HIGH_THRESHOLD")?,
            Err(_) => DEFAULT_MOTION_HIGH_THRESHOLD,
        }
        .clamp((motion_active_threshold + 0.05).min(0.99), 0.99);

        Ok(Self {
            bind_addr,
            allowed_origins,
            pose_heartbeat_secs,
            presence_ttl_ms,
            pose_frame_tick_ms,
            esp32_port,
            esp32_baud_rate,
            esp32_read_timeout_ms,
            motion_active_threshold,
            motion_high_threshold,
        })
    }
}

#[derive(Clone)]
struct ServerState {
    mat_state: MatAppState,
    pose_provider: PoseLocationProvider,
    demo_step: Arc<AtomicU64>,
    _presence: Arc<PresenceTracker>,
}

#[derive(Clone)]
struct PoseLocationProvider {
    mat_state: MatAppState,
    presence: Arc<PresenceTracker>,
    presence_ttl_ms: u64,
    motion_active_threshold: f64,
    motion_high_threshold: f64,
    tx: broadcast::Sender<PoseBroadcast>,
    frame_counter: Arc<AtomicU64>,
}

#[derive(Clone)]
enum PoseBroadcast {
    Frame(PoseFrame),
    Heartbeat(DateTime<Utc>),
}

#[derive(Debug, Clone, Serialize)]
struct PoseFrame {
    timestamp: DateTime<Utc>,
    frame_id: u64,
    coordinate_frame: String,
    persons: Vec<PosePerson>,
    metadata: PoseFrameMetadata,
}

#[derive(Debug, Clone, Serialize)]
struct PoseFrameMetadata {
    csi_quality: f64,
    motion_score: f64,
    signal_strength: Option<f64>,
    packet_count: u64,
    sequence_num: Option<u32>,
    subcarriers: usize,
    packet_rate_hz: Option<f64>,
    motion_active_threshold: f64,
    motion_high_threshold: f64,
}

#[derive(Debug, Clone, Serialize)]
struct PosePerson {
    id: Uuid,
    confidence: f64,
    location_3d: PoseLocation3d,
}

#[derive(Debug, Clone, Serialize)]
struct PoseLocation3d {
    x: f64,
    y: f64,
    z: f64,
    uncertainty_radius: f64,
    confidence: f64,
}

#[derive(Debug, Serialize)]
struct PoseFrameWsEnvelope {
    #[serde(rename = "type")]
    message_type: &'static str,
    #[serde(flatten)]
    frame: PoseFrame,
}

#[derive(Debug, Serialize)]
struct PoseHeartbeatWsEnvelope {
    #[serde(rename = "type")]
    message_type: &'static str,
    timestamp: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct DemoSeedResponse {
    event_id: Uuid,
    step: u64,
    frame: PoseFrame,
}

#[derive(Debug, Deserialize)]
struct DemoSeedRequest {
    survivors: Option<usize>,
}

impl PoseLocationProvider {
    fn new(
        mat_state: MatAppState,
        presence: Arc<PresenceTracker>,
        presence_ttl_ms: u64,
        motion_active_threshold: f64,
        motion_high_threshold: f64,
    ) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            mat_state,
            presence,
            presence_ttl_ms,
            motion_active_threshold,
            motion_high_threshold,
            tx,
            frame_counter: Arc::new(AtomicU64::new(0)),
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<PoseBroadcast> {
        self.tx.subscribe()
    }

    fn current_frame(&self) -> PoseFrame {
        let presence_snapshot = self.presence.snapshot();
        let mut persons = self
            .mat_state
            .list_events()
            .into_iter()
            .flat_map(|event| {
                event
                    .survivors()
                    .into_iter()
                    .filter_map(|survivor| {
                        let location = survivor.location()?;
                        Some(PosePerson {
                            id: *survivor.id().as_uuid(),
                            confidence: survivor.confidence(),
                            location_3d: PoseLocation3d {
                                x: location.x,
                                y: location.y,
                                z: location.z,
                                uncertainty_radius: location.uncertainty.horizontal_error,
                                confidence: location.uncertainty.confidence,
                            },
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();

        if self.presence.is_recent(self.presence_ttl_ms) {
            let confidence =
                (0.45 + presence_snapshot.csi_quality * 0.35 + presence_snapshot.motion_score * 0.20)
                    .clamp(0.45, 0.98);

            persons.push(PosePerson {
                id: *PRESENCE_PERSON_ID,
                confidence,
                location_3d: PoseLocation3d {
                    x: presence_snapshot.x,
                    y: presence_snapshot.y,
                    z: presence_snapshot.z,
                    uncertainty_radius: (1.25 - presence_snapshot.csi_quality * 0.75).clamp(0.3, 1.5),
                    confidence,
                },
            });
        }

        let packet_rate_hz = presence_snapshot
            .packet_interval_ema_ms
            .and_then(|value| if value > 0.0 { Some(1000.0 / value) } else { None });

        let metadata = PoseFrameMetadata {
            csi_quality: presence_snapshot.csi_quality,
            motion_score: presence_snapshot.motion_score,
            signal_strength: presence_snapshot.last_rssi,
            packet_count: presence_snapshot.packet_count,
            sequence_num: presence_snapshot.last_sequence_num,
            subcarriers: presence_snapshot.subcarriers,
            packet_rate_hz,
            motion_active_threshold: self.motion_active_threshold,
            motion_high_threshold: self.motion_high_threshold,
        };

        PoseFrame {
            timestamp: Utc::now(),
            frame_id: self.frame_counter.fetch_add(1, Ordering::Relaxed) + 1,
            coordinate_frame: "world_meters".to_string(),
            persons,
            metadata,
        }
    }

    fn broadcast_current_frame(&self) -> PoseFrame {
        let frame = self.current_frame();
        let _ = self.tx.send(PoseBroadcast::Frame(frame.clone()));
        frame
    }

    fn start_event_bridge(&self) {
        let provider = self.clone();
        let mut mat_rx = self.mat_state.subscribe();

        tokio::spawn(async move {
            loop {
                match mat_rx.recv().await {
                    Ok(message) => {
                        if should_emit_pose_frame(&message) {
                            provider.broadcast_current_frame();
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "Pose provider lagged behind MAT broadcast");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    fn start_heartbeat(&self, period: Duration) {
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(period);
            loop {
                interval.tick().await;
                let _ = tx.send(PoseBroadcast::Heartbeat(Utc::now()));
            }
        });
    }

    fn start_frame_ticker(&self, period: Duration) {
        let provider = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(period);
            loop {
                interval.tick().await;
                provider.broadcast_current_frame();
            }
        });
    }
}

fn should_emit_pose_frame(message: &WebSocketMessage) -> bool {
    matches!(
        message,
        WebSocketMessage::SurvivorDetected { .. }
            | WebSocketMessage::SurvivorUpdated { .. }
            | WebSocketMessage::SurvivorLost { .. }
            | WebSocketMessage::ZoneScanComplete { .. }
            | WebSocketMessage::EventStatusChanged { .. }
            | WebSocketMessage::Heartbeat { .. }
    )
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = ServerConfig::from_env()?;
    let mat_state = MatAppState::new();
    let presence = Arc::new(PresenceTracker::new());
    let pose_provider = PoseLocationProvider::new(
        mat_state.clone(),
        Arc::clone(&presence),
        config.presence_ttl_ms,
        config.motion_active_threshold,
        config.motion_high_threshold,
    );

    pose_provider.start_event_bridge();
    pose_provider.start_heartbeat(Duration::from_secs(config.pose_heartbeat_secs));
    pose_provider.start_frame_ticker(Duration::from_millis(config.pose_frame_tick_ms));

    let _esp32_ingestion =
        start_esp32_ingestion_if_configured(&config, Arc::clone(&presence)).await?;

    let state = ServerState {
        mat_state: mat_state.clone(),
        pose_provider,
        demo_step: Arc::new(AtomicU64::new(0)),
        _presence: presence,
    };

    let pose_router = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/pose/current", get(get_pose_current))
        .route("/ws/pose/stream", get(ws_pose_stream))
        .route("/api/v1/pose/demo/seed", post(seed_demo_data))
        .with_state(state);

    let app = Router::new()
        .merge(pose_router)
        .merge(wifi_densepose_mat::api::create_router(mat_state))
        .layer(TraceLayer::new_for_http())
        .layer(build_cors_layer(&config.allowed_origins)?);

    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", config.bind_addr))?;

    info!(
        bind_addr = %config.bind_addr,
        allowed_origins = ?config.allowed_origins,
        "wifi-densepose-server listening"
    );

    axum::serve(listener, app)
        .await
        .context("server exited with error")?;

    Ok(())
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();
}

fn build_cors_layer(origins: &[String]) -> anyhow::Result<CorsLayer> {
    let parsed = origins
        .iter()
        .map(|origin| {
            origin
                .parse::<HeaderValue>()
                .with_context(|| format!("invalid CORS origin: {origin}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if parsed.is_empty() {
        return Err(anyhow!("at least one CORS origin must be configured"));
    }

    Ok(CorsLayer::new()
        .allow_origin(AllowOrigin::list(parsed))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any))
}

async fn start_esp32_ingestion_if_configured(
    config: &ServerConfig,
    presence: Arc<PresenceTracker>,
) -> anyhow::Result<Option<(HardwareAdapter, tokio::task::JoinHandle<()>)>> {
    let Some(port) = config.esp32_port.clone() else {
        return Ok(None);
    };

    let mut hardware_config = HardwareConfig::esp32(&port, config.esp32_baud_rate);
    if let DeviceSettings::Serial(serial) = &mut hardware_config.device_settings {
        serial.read_timeout_ms = config.esp32_read_timeout_ms;
    }

    let mut adapter = HardwareAdapter::with_config(hardware_config);
    adapter
        .initialize()
        .await
        .with_context(|| format!("failed to initialize ESP32 adapter on {}", port))?;

    let mut stream = adapter
        .start_csi_stream()
        .await
        .with_context(|| format!("failed to start ESP32 CSI stream on {}", port))?;

    let stream_port = port.clone();
    let stream_task = tokio::spawn(async move {
        let mut packet_count = 0u64;
        while let Some(reading) = stream.next().await {
            packet_count += 1;

            let first_sensor = reading.readings.first();
            let sequence_num = first_sensor.and_then(|sensor| sensor.sequence_num);
            let amplitudes = first_sensor
                .map(|sensor| sensor.amplitudes.as_slice())
                .unwrap_or(&[]);

            presence.mark_seen(sequence_num, reading.metadata.rssi, amplitudes);

            if packet_count == 1 || packet_count % 100 == 0 {
                let snapshot = presence.snapshot();
                let subcarriers = first_sensor
                    .map(|sensor| sensor.amplitudes.len())
                    .unwrap_or(0);

                tracing::info!(
                    port = %stream_port,
                    packet_count,
                    subcarriers,
                    sequence_num = ?sequence_num,
                    presence_last_seen_ms = snapshot.last_seen_ms,
                    presence_sequence_num = ?snapshot.last_sequence_num,
                    rssi = ?reading.metadata.rssi,
                    motion_score = snapshot.motion_score,
                    csi_quality = snapshot.csi_quality,
                    "ESP32 CSI packet received"
                );
            }
        }

        tracing::warn!(port = %stream_port, "ESP32 CSI stream ended");
    });

    info!(
        port = %port,
        baud_rate = config.esp32_baud_rate,
        read_timeout_ms = config.esp32_read_timeout_ms,
        "ESP32 CSI ingestion enabled"
    );

    Ok(Some((adapter, stream_task)))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn get_pose_current(State(state): State<ServerState>) -> Json<PoseFrame> {
    Json(state.pose_provider.current_frame())
}

async fn ws_pose_stream(State(state): State<ServerState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_pose_socket(socket, state.pose_provider))
}

async fn handle_pose_socket(socket: WebSocket, pose_provider: PoseLocationProvider) {
    let (mut sender, mut receiver) = socket.split();
    let mut pose_rx = pose_provider.subscribe();

    let send_task = tokio::spawn(async move {
        loop {
            let payload = match pose_rx.recv().await {
                Ok(PoseBroadcast::Frame(frame)) => serde_json::to_string(&PoseFrameWsEnvelope {
                    message_type: "pose_frame",
                    frame,
                }),
                Ok(PoseBroadcast::Heartbeat(timestamp)) => {
                    serde_json::to_string(&PoseHeartbeatWsEnvelope {
                        message_type: "heartbeat",
                        timestamp,
                    })
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "Pose WebSocket client lagged behind");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            };

            let payload = match payload {
                Ok(payload) => payload,
                Err(error) => {
                    tracing::warn!(%error, "failed to serialize pose websocket message");
                    continue;
                }
            };

            if sender.send(Message::Text(payload.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = receiver.next().await {
        if matches!(message, Message::Close(_)) {
            break;
        }
    }

    send_task.abort();
}

async fn seed_demo_data(
    State(state): State<ServerState>,
    payload: Option<Json<DemoSeedRequest>>,
) -> Result<Json<DemoSeedResponse>, (StatusCode, String)> {
    let requested_survivors = payload
        .map(|body| body.survivors.unwrap_or(2))
        .unwrap_or(2)
        .clamp(1, 8);

    let event_id = ensure_demo_event(&state.mat_state);
    let step = state.demo_step.fetch_add(1, Ordering::Relaxed) + 1;

    let update_result = state.mat_state.update_event(event_id, |event| {
        let zone_id = ensure_demo_zone(event);
        inject_demo_survivors(event, &zone_id, step, requested_survivors)
    });

    match update_result {
        Some(Ok(())) => {
            state.mat_state.broadcast(WebSocketMessage::Heartbeat {
                timestamp: Utc::now(),
            });
            let frame = state.pose_provider.broadcast_current_frame();
            Ok(Json(DemoSeedResponse {
                event_id,
                step,
                frame,
            }))
        }
        Some(Err(error)) => Err((StatusCode::INTERNAL_SERVER_ERROR, error)),
        None => Err((
            StatusCode::NOT_FOUND,
            "Demo event was not found".to_string(),
        )),
    }
}

fn ensure_demo_event(mat_state: &MatAppState) -> Uuid {
    if let Some(existing_id) = mat_state
        .list_events()
        .into_iter()
        .map(|event| *event.id().as_uuid())
        .next()
    {
        return existing_id;
    }

    let event = DisasterEvent::new(
        DisasterType::BuildingCollapse,
        Point::new(-122.4194, 37.7749),
        "Demo MAT event",
    );

    mat_state.store_event(event)
}

fn ensure_demo_zone(event: &mut DisasterEvent) -> wifi_densepose_mat::ScanZoneId {
    if let Some(zone) = event.zones().first() {
        return zone.id().clone();
    }

    let mut zone = ScanZone::new(
        "Demo Zone",
        wifi_densepose_mat::ZoneBounds::rectangle(0.0, 0.0, 25.0, 25.0),
    );

    zone.add_sensor(SensorPosition {
        id: "sensor-a".to_string(),
        x: 0.0,
        y: 0.0,
        z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    });
    zone.add_sensor(SensorPosition {
        id: "sensor-b".to_string(),
        x: 25.0,
        y: 0.0,
        z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    });
    zone.add_sensor(SensorPosition {
        id: "sensor-c".to_string(),
        x: 12.5,
        y: 20.0,
        z: 2.0,
        sensor_type: SensorType::Transceiver,
        is_operational: true,
    });

    let zone_id = zone.id().clone();
    event.add_zone(zone);
    zone_id
}

fn inject_demo_survivors(
    event: &mut DisasterEvent,
    zone_id: &wifi_densepose_mat::ScanZoneId,
    step: u64,
    survivors: usize,
) -> Result<(), String> {
    let t = step as f64 * 0.25;

    for idx in 0..survivors {
        let idxf = idx as f64;
        let x = 6.0 + idxf * 4.0 + (t + idxf).sin() * 1.8;
        let y = 6.0 + idxf * 3.0 + (t * 0.8 + idxf).cos() * 1.4;
        let z = -1.0 - ((t + idxf * 0.7).sin().abs() * 2.0);

        let location = Coordinates3D::new(x, y, z, LocationUncertainty::new(0.7, 0.5));
        let vitals = demo_vitals(idxf, t);

        event
            .record_detection(zone_id.clone(), vitals, Some(location))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn demo_vitals(seed: f64, t: f64) -> VitalSignsReading {
    let breathing = BreathingPattern {
        rate_bpm: (14.0 + (seed + t).sin() * 4.0) as f32,
        amplitude: 0.8,
        regularity: 0.75,
        pattern_type: BreathingType::Normal,
    };

    let heartbeat = wifi_densepose_mat::HeartbeatSignature {
        rate_bpm: (72.0 + (seed + t).cos() * 9.0) as f32,
        variability: 0.12,
        strength: SignalStrength::Moderate,
    };

    let movement = MovementProfile {
        movement_type: if (t + seed).sin().abs() > 0.6 {
            MovementType::Fine
        } else {
            MovementType::None
        },
        intensity: 0.3,
        frequency: 0.2,
        is_voluntary: false,
    };

    VitalSignsReading::new(Some(breathing), Some(heartbeat), movement)
}
