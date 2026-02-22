#!/usr/bin/env bash

set -euo pipefail

API_BASE="${1:-http://127.0.0.1:8787}"
STILL_SECONDS="${WIFI_DENSEPOSE_CALIBRATE_STILL_SECONDS:-20}"
MOVE_SECONDS="${WIFI_DENSEPOSE_CALIBRATE_MOVE_SECONDS:-20}"
INTERVAL_MS="${WIFI_DENSEPOSE_CALIBRATE_INTERVAL_MS:-250}"
ASSUME_YES="${WIFI_DENSEPOSE_CALIBRATE_ASSUME_YES:-0}"
STILL_DELAY_SECONDS="${WIFI_DENSEPOSE_CALIBRATE_STILL_DELAY_SECONDS:-10}"
MOVE_DELAY_SECONDS="${WIFI_DENSEPOSE_CALIBRATE_MOVE_DELAY_SECONDS:-10}"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
STILL_FILE="/tmp/wifi-densepose-calibration-still-${TIMESTAMP}.jsonl"
MOVE_FILE="/tmp/wifi-densepose-calibration-move-${TIMESTAMP}.jsonl"

sample_phase() {
  local phase="$1"
  local seconds="$2"
  local output="$3"

  python3 - "$API_BASE" "$seconds" "$INTERVAL_MS" "$output" "$phase" <<'PY'
import json
import sys
import time
import urllib.request

api_base, seconds, interval_ms, output_path, phase = sys.argv[1:6]
seconds = int(seconds)
interval = max(int(interval_ms), 100) / 1000.0

end_time = time.time() + seconds

with open(output_path, "w") as handle:
    while time.time() < end_time:
        row = {
            "phase": phase,
            "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }

        try:
            with urllib.request.urlopen(f"{api_base}/api/v1/pose/current", timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))

            metadata = payload.get("metadata") or {}
            row["motion_score"] = metadata.get("motion_score")
            row["csi_quality"] = metadata.get("csi_quality")
            row["signal_strength"] = metadata.get("signal_strength")
            row["packet_rate_hz"] = metadata.get("packet_rate_hz")
            row["person_count"] = len(payload.get("persons") or [])
        except Exception as exc:
            row["error"] = str(exc)

        handle.write(json.dumps(row) + "\n")
        time.sleep(interval)
PY
}

echo "Calibration target: ${API_BASE}"
echo "Sampling interval: ${INTERVAL_MS}ms"
echo "Still capture: ${STILL_SECONDS}s"
echo "Movement capture: ${MOVE_SECONDS}s"
echo "Still delay: ${STILL_DELAY_SECONDS}s"
echo "Move delay: ${MOVE_DELAY_SECONDS}s"

if [[ "$ASSUME_YES" != "1" && ! -t 0 ]]; then
  echo "No interactive stdin detected; switching to timed mode."
  echo "Set WIFI_DENSEPOSE_CALIBRATE_STILL_DELAY_SECONDS / WIFI_DENSEPOSE_CALIBRATE_MOVE_DELAY_SECONDS to control prep time."
  ASSUME_YES="1"
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  read -r -p "Stay still in the sensing area, then press Enter to start still capture..." _
elif [[ "$STILL_DELAY_SECONDS" -gt 0 ]]; then
  echo "Starting still capture in ${STILL_DELAY_SECONDS}s..."
  sleep "$STILL_DELAY_SECONDS"
fi

echo "Collecting STILL samples..."
sample_phase "still" "$STILL_SECONDS" "$STILL_FILE"

if [[ "$ASSUME_YES" != "1" ]]; then
  read -r -p "Move naturally in the sensing area, then press Enter to start movement capture..." _
elif [[ "$MOVE_DELAY_SECONDS" -gt 0 ]]; then
  echo "Starting movement capture in ${MOVE_DELAY_SECONDS}s..."
  sleep "$MOVE_DELAY_SECONDS"
fi

echo "Collecting MOVEMENT samples..."
sample_phase "move" "$MOVE_SECONDS" "$MOVE_FILE"

python3 - "$STILL_FILE" "$MOVE_FILE" <<'PY'
import json
import math
import statistics
import sys

still_file, move_file = sys.argv[1:3]


def load_metric(path, metric):
    values = []
    with open(path, "r") as handle:
        for line in handle:
            row = json.loads(line)
            value = row.get(metric)
            if isinstance(value, (int, float)) and math.isfinite(value):
                values.append(float(value))
    return values


def percentile(values, p):
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    idx = (len(ordered) - 1) * p
    low = int(math.floor(idx))
    high = int(math.ceil(idx))
    if low == high:
        return ordered[low]
    fraction = idx - low
    return ordered[low] * (1 - fraction) + ordered[high] * fraction


still_motion = load_metric(still_file, "motion_score")
move_motion = load_metric(move_file, "motion_score")
all_rates = load_metric(still_file, "packet_rate_hz") + load_metric(move_file, "packet_rate_hz")

if not still_motion or not move_motion:
    print("Not enough motion_score data to calibrate thresholds.")
    print(f"Raw still samples: {still_file}")
    print(f"Raw move samples: {move_file}")
    raise SystemExit(1)

still_p90 = percentile(still_motion, 0.90)
move_p50 = percentile(move_motion, 0.50)
move_p90 = percentile(move_motion, 0.90)

if move_p50 <= still_p90 + 0.02:
    active_threshold = min(0.95, max(0.10, still_p90 + 0.08))
    high_threshold = min(0.99, max(active_threshold + 0.10, move_p90 + 0.05))
    quality_note = "warning: movement capture was not clearly separated from stillness"
else:
    active_threshold = min(0.95, max(0.06, (still_p90 + move_p50) / 2))
    high_threshold = min(0.99, max(active_threshold + 0.08, (move_p50 + move_p90) / 2))
    quality_note = "ok"

if all_rates:
    median_rate = statistics.median(all_rates)
    ttl_ms = int(max(3000, min(8000, round((1000.0 / max(median_rate, 0.1)) * 30))))
else:
    median_rate = 0.0
    ttl_ms = 4000

print("\nCalibration complete. Suggested .env values:\n")
print(f"WIFI_DENSEPOSE_PRESENCE_TTL_MS={ttl_ms}")
print(f"WIFI_DENSEPOSE_MOTION_ACTIVE_THRESHOLD={active_threshold:.3f}")
print(f"WIFI_DENSEPOSE_MOTION_HIGH_THRESHOLD={high_threshold:.3f}")

print("\nDiagnostic summary:")
print(f"- still samples: {len(still_motion)}, move samples: {len(move_motion)}")
print(f"- still motion p90: {still_p90:.3f}")
print(f"- move motion p50/p90: {move_p50:.3f}/{move_p90:.3f}")
print(f"- median packet_rate_hz: {median_rate:.2f}")
print(f"- calibration quality: {quality_note}")
print(f"\nRaw captures:\n- {still_file}\n- {move_file}")
PY
