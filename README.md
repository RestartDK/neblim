# Neblim

**An invisible, camera-free security system that knows who's in your home, what they're doing, and autonomously calls for help when something's wrong.**

---

## The Problem

AI is lowering the cost of identifying and targeting vulnerable people. Seniors living alone, people with predictable routines, households with no security infrastructure — they're easier to profile than ever. Physical intrusion and home invasion remain serious threats, and existing defenses all share the same blind spots:

- **Cameras** don't cover bathrooms, bedrooms, or anywhere people expect privacy
- **Motion sensors** know "something moved" — not what, not who, not how many
- **Smart locks and alarms** require the resident to respond to an alert themselves

Every one of these systems fails the people who need protection most: those who can't fight back, can't respond fast enough, or don't realize something is wrong until it's too late.

## The Solution

Neblim is a passive physical security system built on WiFi sensing. A single device uses existing WiFi signals to track human presence and body pose through walls — no cameras, no wearables, nothing to interact with.

### Occupancy Intelligence

The system knows how many bodies are in the home at all times, through every wall and door. An unexpected second person triggers an immediate graduated alert to family members or authorities. No camera footage needed, no line-of-sight required.

### Behavioral Baseline as Intrusion Detection

Neblim learns the resident's normal patterns — sleep at 10pm, kitchen at 7am, living room in the evening. Deviations from that baseline drive autonomous response:

- Movement at 3am in an entry hallway
- Sudden absence of the resident's signal
- Two bodies detected where there should be one

These aren't generic "motion detected" alerts. They're context-aware anomalies evaluated against a learned model of what normal looks like.

### Body Pose as Threat Context

Because WiFi DensePose provides skeletal tracking, the system can distinguish between "resident sat down on the couch" and "resident is on the ground while a second person is standing over them." That context is what gets sent to emergency services — not a blinking notification, but an autonomous assessment of what's actually happening.

### Autonomous Escalation

When the system detects a critical event, it doesn't wait for the resident to press a button. An AI voice agent initiates a check-in call directly to the resident via WebRTC. If the resident doesn't respond or the situation escalates, the system alerts family contacts and emergency services with full situational context.

---

## Defensive Acceleration

AI lowers the cost of identifying and targeting vulnerable people. Neblim raises the cost of successfully attacking them — passively, autonomously, without requiring the target to do anything. Defensive technology outpacing offensive capability.

---

## Architecture

```
ESP32 (WiFi CSI) ──serial──> Ingest Server (Rust/Axum :8787)
                                   │
                           ┌───────┴────────┐
                           │  Presence       │
                           │  Tracker        │
                           │  ─────────────  │
                           │  Occupancy      │
                           │  Motion score   │
                           │  3D coordinates │
                           │  CSI quality    │
                           └───────┬────────┘
                                   │
               REST + WebSocket    │
                                   ▼
                           Dashboard (React/Vite :5173)
                             │
                     ┌───────┴────────┐
                     │  3D Pose Mesh  │
                     │  (Three.js)    │
                     └───────┬────────┘
                             │  canvas capture every 4s
                             ▼
                     AI Server (Bun/Hono :8001)
                             │
                             │  /api/mesh-classify
                             ▼
                     Google Gemini 2.5 Flash
                             │
                             │  { severity, context, action }
                             ▼
                     Dashboard ──if critical──> ElevenLabs Voice Agent
                                                (WebRTC call to resident)
```

### How It Works

1. An ESP32 device captures WiFi Channel State Information (CSI) and streams it over serial at 921600 baud
2. The Rust ingest server processes CSI packets — computing RSSI, amplitude statistics, motion scores (EMA-smoothed), and 3D position estimates from phase/amplitude data
3. Pose frames broadcast to the dashboard every 250ms via WebSocket
4. The dashboard renders a real-time 3D body mesh and captures screenshots every 4 seconds
5. Screenshots are sent to the AI server, where Gemini classifies the scene with structured output (severity, description, recommended action, confidence)
6. On warning/critical classification, the system auto-initiates a voice check-in call via ElevenLabs WebRTC
7. If the resident is unresponsive or the threat is confirmed, escalation proceeds to designated contacts and emergency services

---

## Tech Stack

| Layer                 | Technology                                                |
| --------------------- | --------------------------------------------------------- |
| **Hardware**          | ESP32 (WiFi CSI capture)                                  |
| **Ingest Server**     | Rust, Axum, Tokio, serialport, rustfft, ndarray           |
| **ML/Inference**      | tch (PyTorch), ONNX Runtime, Candle                       |
| **Signal Processing** | FFT-based CSI analysis, EMA motion scoring                |
| **AI Server**         | Bun, Hono, Vercel AI SDK, Google Gemini 2.5 Flash         |
| **Voice Agent**       | ElevenLabs Conversational AI (WebRTC)                     |
| **Dashboard**         | React 19, Vite, Tailwind CSS, React Three Fiber, Three.js |
| **Monorepo**          | Turborepo, Bun workspaces                                 |

## Repository Structure

```
neblim-app/
  apps/
    ingest/       Rust workspace — WiFi CSI ingestion, presence tracking, pose server
    server/       Bun/Hono — AI classification, voice agent token proxy
    web/          React/Vite — real-time 3D monitoring dashboard
  packages/
    ui/           Shared React component library
    eslint-config/
    typescript-config/
```

### Ingest Server Crates

The Rust ingest server is a Cargo workspace with focused crates:

| Crate                     | Role                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `wifi-densepose-server`   | Main binary — Axum HTTP/WS, ESP32 serial, presence tracking        |
| `wifi-densepose-core`     | Shared domain types                                                |
| `wifi-densepose-signal`   | CSI signal processing (FFT, amplitude analysis)                    |
| `wifi-densepose-nn`       | Neural network inference (PyTorch, ONNX, Candle)                   |
| `wifi-densepose-hardware` | Hardware abstraction (serial, pcap)                                |
| `wifi-densepose-mat`      | Mass casualty assessment — survivor detection, triage, vital signs |
| `wifi-densepose-api`      | API route layer                                                    |
| `wifi-densepose-db`       | Persistence (Postgres, SQLite, Redis)                              |
| `wifi-densepose-config`   | Configuration management                                           |
| `wifi-densepose-wasm`     | WebAssembly bindings                                               |
| `wifi-densepose-cli`      | CLI tooling                                                        |

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- [Rust](https://rustup.rs) (stable)
- Node.js >= 18
- ESP32 with WiFi CSI firmware (for live data; demo mode available without hardware)

### Install and Run

```sh
# Install dependencies
bun install

# Start all services (ingest + server + web)
turbo dev

# Or start individually
turbo dev --filter=ingest
turbo dev --filter=server
turbo dev --filter=neblim-app
```

### Environment Variables

Key configuration (set in `.env` or via shell):

| Variable                          | Purpose                                               |
| --------------------------------- | ----------------------------------------------------- |
| `WIFI_DENSEPOSE_ESP32_PORT`       | Serial port for ESP32 (e.g., `/dev/ttyUSB0`)          |
| `WIFI_DENSEPOSE_BIND`             | Ingest server bind address (default `127.0.0.1:8787`) |
| `WIFI_DENSEPOSE_MOTION_THRESHOLD` | Motion detection sensitivity                          |
| `GOOGLE_GENERATIVE_AI_API_KEY`    | Gemini API key for mesh classification                |
| `ELEVENLABS_API_KEY`              | ElevenLabs key for voice agent                        |
| `ELEVENLABS_AGENT_ID`             | ElevenLabs conversational agent ID                    |

### Demo Mode

The system includes a demo mode that generates synthetic pose data when no ESP32 hardware is connected. The dashboard automatically falls back to demo mode if the ingest server backend is unavailable.

```sh
# Seed demo data
curl -X POST http://127.0.0.1:8787/api/v1/pose/demo/seed
```

---

## API Reference

### Ingest Server (`:8787`)

| Endpoint                 | Method | Description                 |
| ------------------------ | ------ | --------------------------- |
| `/healthz`               | GET    | Health check                |
| `/api/v1/pose/current`   | GET    | Current pose frame snapshot |
| `/ws/pose/stream`        | WS     | Real-time pose frame stream |
| `/api/v1/pose/demo/seed` | POST   | Seed synthetic demo data    |
| `/api/v1/mat/events`     | GET    | Assessment events           |
| `/ws/mat/stream`         | WS     | Assessment event stream     |

### AI Server (`:8001`)

| Endpoint                             | Method | Description                                      |
| ------------------------------------ | ------ | ------------------------------------------------ |
| `/health`                            | GET    | Health check                                     |
| `/api/mesh-classify`                 | POST   | Classify pose mesh screenshot (image + metadata) |
| `/api/elevenlabs/conversation-token` | GET    | Voice agent session token                        |

---

## License

Proprietary. All rights reserved.
