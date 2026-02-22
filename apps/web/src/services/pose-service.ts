import { API_ENDPOINTS, buildWsUrl } from "@/config/api";
import {
  apiClient,
  type ApiInfoResponse,
  type PoseCurrentResponse,
  type PosePersonRecord,
  type PoseStatsResponse,
  type ZonesSummaryResponse,
} from "@/services/api";
import {
  WebSocketManager,
  type WebSocketConnectionState,
  type WebSocketMessage,
} from "@/services/websocket";

export type GaitPattern = "normal" | "unsteady" | "stationary";

export interface PoseKeypoint {
  index: number;
  name: string;
  x: number;
  y: number;
  confidence: number;
}

export interface PosePerson {
  id: string;
  name?: string;
  confidence: number;
  keypoints: PoseKeypoint[];
  movementDelta: number;
  gaitPattern: GaitPattern;
  activity?: string;
}

export interface PoseFrameStats {
  signalStrength: number;
  trackingPoints: number;
  latency: number;
  roomDuration: number;
  stepsToday: number;
  posture: string;
  gait: string;
  movement: string;
}

export interface PoseFrame {
  timestamp: string;
  frameId: string;
  persons: PosePerson[];
  stats: PoseFrameStats;
  source: "realtime" | "demo";
}

interface ParsedKeypoint {
  index: number;
  x: number;
  y: number;
  confidence: number;
}

interface ParsedPerson {
  id: string;
  name?: string;
  confidence: number;
  activity?: string;
  keypoints: ParsedKeypoint[];
  location3d?: ParsedLocation3d;
}

interface ParsedLocation3d {
  x: number;
  y: number;
  z: number;
  uncertaintyRadius: number;
  confidence: number;
}

interface ExtractedPosePayload {
  timestamp: string;
  frameId: string;
  processingTimeMs: number;
  persons: PosePersonRecord[];
  metadata: Record<string, unknown>;
  activity?: string;
}

type PoseSubscriber = (frame: PoseFrame) => void;
type ConnectionSubscriber = (state: WebSocketConnectionState) => void;
type ErrorSubscriber = (error: string) => void;

const COCO_KEYPOINT_NAMES = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toStringValue = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);

class PoseService {
  private readonly wsManager = new WebSocketManager(
    buildWsUrl(API_ENDPOINTS.wsPoseStream),
  );
  private readonly poseSubscribers = new Set<PoseSubscriber>();
  private readonly connectionSubscribers = new Set<ConnectionSubscriber>();
  private readonly errorSubscribers = new Set<ErrorSubscriber>();

  private currentFrame: PoseFrame | null = null;
  private readonly previousCentroids = new Map<
    string,
    { x: number; y: number }
  >();
  private readonly startedAt = Date.now();
  private totalSteps = 2847;
  private demoTicks = 0;

  constructor() {
    this.wsManager.subscribe((message) => {
      const frame = this.normalizeRealtimeFrame(message);
      if (frame) {
        this.publishFrame(frame);
      }
    });

    this.wsManager.subscribeConnectionState((state) => {
      for (const callback of this.connectionSubscribers) {
        callback(state);
      }
    });

    this.wsManager.subscribeErrors((error) => {
      for (const callback of this.errorSubscribers) {
        callback(error);
      }
    });
  }

  async connect(): Promise<void> {
    this.wsManager.connect();

    try {
      const snapshot = await apiClient.getCurrentPose();
      const frame = this.normalizeRestFrame(snapshot);
      if (frame) {
        this.publishFrame(frame);
      }
    } catch {
      for (const callback of this.errorSubscribers) {
        callback("Unable to fetch initial pose snapshot");
      }
    }
  }

  disconnect(): void {
    this.wsManager.disconnect();
  }

  getConnectionState(): WebSocketConnectionState {
    return this.wsManager.getState();
  }

  getCurrentFrame(): PoseFrame | null {
    return this.currentFrame;
  }

  subscribe(callback: PoseSubscriber): () => void {
    this.poseSubscribers.add(callback);

    if (this.currentFrame) {
      callback(this.currentFrame);
    }

    return () => {
      this.poseSubscribers.delete(callback);
    };
  }

  subscribeConnectionState(callback: ConnectionSubscriber): () => void {
    this.connectionSubscribers.add(callback);
    callback(this.wsManager.getState());
    return () => {
      this.connectionSubscribers.delete(callback);
    };
  }

  subscribeErrors(callback: ErrorSubscriber): () => void {
    this.errorSubscribers.add(callback);
    return () => {
      this.errorSubscribers.delete(callback);
    };
  }

  buildDemoFrame(time: number): PoseFrame {
    const breathe = Math.sin(time * 0.002) * 0.01;
    const sway = Math.sin(time * 0.0012) * 0.012;
    const stride = Math.sin(time * 0.005) * 0.02;
    const microTremor = Math.sin(time * 0.009) * 0.004;
    const cycleSecond = (time * 0.001) % 28;

    const cx = 0.44 + sway;
    const cy = 0.44;

    const standingKeypoints: PoseKeypoint[] = [
      {
        index: 0,
        name: "nose",
        x: cx,
        y: cy - 0.17 + breathe,
        confidence: 0.98,
      },
      {
        index: 1,
        name: "left_eye",
        x: cx - 0.018,
        y: cy - 0.183 + breathe,
        confidence: 0.96,
      },
      {
        index: 2,
        name: "right_eye",
        x: cx + 0.018,
        y: cy - 0.183 + breathe,
        confidence: 0.96,
      },
      {
        index: 3,
        name: "left_ear",
        x: cx - 0.036,
        y: cy - 0.175 + breathe,
        confidence: 0.89,
      },
      {
        index: 4,
        name: "right_ear",
        x: cx + 0.036,
        y: cy - 0.175 + breathe,
        confidence: 0.89,
      },
      {
        index: 5,
        name: "left_shoulder",
        x: cx - 0.065,
        y: cy - 0.105 + breathe,
        confidence: 0.95,
      },
      {
        index: 6,
        name: "right_shoulder",
        x: cx + 0.065,
        y: cy - 0.105 + breathe,
        confidence: 0.95,
      },
      {
        index: 7,
        name: "left_elbow",
        x: cx - 0.088,
        y: cy - 0.02 + breathe,
        confidence: 0.92,
      },
      {
        index: 8,
        name: "right_elbow",
        x: cx + 0.088,
        y: cy - 0.02 + breathe,
        confidence: 0.92,
      },
      {
        index: 9,
        name: "left_wrist",
        x: cx - 0.078,
        y: cy + 0.06 + breathe,
        confidence: 0.89,
      },
      {
        index: 10,
        name: "right_wrist",
        x: cx + 0.078,
        y: cy + 0.06 + breathe,
        confidence: 0.89,
      },
      {
        index: 11,
        name: "left_hip",
        x: cx - 0.04,
        y: cy + 0.1 + breathe,
        confidence: 0.94,
      },
      {
        index: 12,
        name: "right_hip",
        x: cx + 0.04,
        y: cy + 0.1 + breathe,
        confidence: 0.94,
      },
      {
        index: 13,
        name: "left_knee",
        x: cx - 0.045,
        y: cy + 0.235 + stride * 0.25,
        confidence: 0.91,
      },
      {
        index: 14,
        name: "right_knee",
        x: cx + 0.045,
        y: cy + 0.235 - stride * 0.25,
        confidence: 0.91,
      },
      {
        index: 15,
        name: "left_ankle",
        x: cx - 0.05,
        y: cy + 0.37 + stride,
        confidence: 0.88,
      },
      {
        index: 16,
        name: "right_ankle",
        x: cx + 0.05,
        y: cy + 0.37 - stride,
        confidence: 0.88,
      },
    ];

    const fallenAnchorX = 0.56 + sway * 0.4;
    const fallenAnchorY = 0.74;

    const fallenKeypoints: PoseKeypoint[] = [
      {
        index: 0,
        name: "nose",
        x: fallenAnchorX + 0.17,
        y: fallenAnchorY - 0.06 + microTremor,
        confidence: 0.95,
      },
      {
        index: 1,
        name: "left_eye",
        x: fallenAnchorX + 0.184,
        y: fallenAnchorY - 0.065 + microTremor,
        confidence: 0.93,
      },
      {
        index: 2,
        name: "right_eye",
        x: fallenAnchorX + 0.156,
        y: fallenAnchorY - 0.064 + microTremor,
        confidence: 0.93,
      },
      {
        index: 3,
        name: "left_ear",
        x: fallenAnchorX + 0.194,
        y: fallenAnchorY - 0.048 + microTremor,
        confidence: 0.9,
      },
      {
        index: 4,
        name: "right_ear",
        x: fallenAnchorX + 0.146,
        y: fallenAnchorY - 0.047 + microTremor,
        confidence: 0.9,
      },
      {
        index: 5,
        name: "left_shoulder",
        x: fallenAnchorX + 0.08,
        y: fallenAnchorY - 0.03 + microTremor,
        confidence: 0.93,
      },
      {
        index: 6,
        name: "right_shoulder",
        x: fallenAnchorX + 0.018,
        y: fallenAnchorY - 0.032 + microTremor,
        confidence: 0.93,
      },
      {
        index: 7,
        name: "left_elbow",
        x: fallenAnchorX + 0.04,
        y: fallenAnchorY + 0.04 + microTremor,
        confidence: 0.9,
      },
      {
        index: 8,
        name: "right_elbow",
        x: fallenAnchorX - 0.055,
        y: fallenAnchorY + 0.015 + microTremor,
        confidence: 0.9,
      },
      {
        index: 9,
        name: "left_wrist",
        x: fallenAnchorX + 0.098,
        y: fallenAnchorY + 0.08 + microTremor,
        confidence: 0.86,
      },
      {
        index: 10,
        name: "right_wrist",
        x: fallenAnchorX - 0.12,
        y: fallenAnchorY + 0.04 + microTremor,
        confidence: 0.86,
      },
      {
        index: 11,
        name: "left_hip",
        x: fallenAnchorX - 0.03,
        y: fallenAnchorY - 0.01 + microTremor,
        confidence: 0.91,
      },
      {
        index: 12,
        name: "right_hip",
        x: fallenAnchorX - 0.09,
        y: fallenAnchorY - 0.004 + microTremor,
        confidence: 0.91,
      },
      {
        index: 13,
        name: "left_knee",
        x: fallenAnchorX - 0.17,
        y: fallenAnchorY + 0.022 + microTremor,
        confidence: 0.88,
      },
      {
        index: 14,
        name: "right_knee",
        x: fallenAnchorX - 0.23,
        y: fallenAnchorY + 0.03 + microTremor,
        confidence: 0.88,
      },
      {
        index: 15,
        name: "left_ankle",
        x: fallenAnchorX - 0.29,
        y: fallenAnchorY + 0.03 + microTremor,
        confidence: 0.85,
      },
      {
        index: 16,
        name: "right_ankle",
        x: fallenAnchorX - 0.35,
        y: fallenAnchorY + 0.034 + microTremor,
        confidence: 0.85,
      },
    ];

    const lerp = (from: number, to: number, amount: number): number =>
      from + (to - from) * amount;

    const blendPose = (
      from: PoseKeypoint[],
      to: PoseKeypoint[],
      amount: number,
    ): PoseKeypoint[] =>
      from.map((point, index) => {
        const target = to[index];
        return {
          ...point,
          x: lerp(point.x, target.x, amount),
          y: lerp(point.y, target.y, amount),
          confidence: lerp(point.confidence, target.confidence, amount),
        };
      });

    let keypoints = standingKeypoints;
    let activity = "walking";

    if (cycleSecond >= 18 && cycleSecond < 19.2) {
      const progress = (cycleSecond - 18) / 1.2;
      keypoints = blendPose(standingKeypoints, fallenKeypoints, progress);
      activity = "falling";
    } else if (cycleSecond >= 19.2 && cycleSecond < 24.2) {
      keypoints = fallenKeypoints;
      activity = "on_floor";
    } else if (cycleSecond >= 24.2 && cycleSecond < 26) {
      const progress = (cycleSecond - 24.2) / 1.8;
      keypoints = blendPose(fallenKeypoints, standingKeypoints, progress);
      activity = "recovering";
    }

    const person = this.enrichPerson({
      id: "demo-person-1",
      name: "Margaret",
      confidence:
        activity === "on_floor" ? 0.91 : activity === "falling" ? 0.94 : 0.97,
      keypoints,
      activity,
    });

    if (person.movementDelta > 0.006 && this.demoTicks % 8 === 0) {
      this.totalSteps += 1;
    }
    this.demoTicks += 1;

    const frame: PoseFrame = {
      timestamp: new Date().toISOString(),
      frameId: `demo-${Date.now()}`,
      persons: [person],
      stats: this.buildStats([person], {
        processingTimeMs: 12,
        metadata: {},
      }),
      source: "demo",
    };

    this.currentFrame = frame;
    return frame;
  }

  getCurrentPose(): Promise<PoseCurrentResponse> {
    return apiClient.getCurrentPose();
  }

  getZonesSummary(): Promise<ZonesSummaryResponse> {
    return apiClient.getZonesSummary();
  }

  getStats(hours = 24): Promise<PoseStatsResponse> {
    return apiClient.getStats(hours);
  }

  getApiInfo(): Promise<ApiInfoResponse> {
    return apiClient.getApiInfo();
  }

  private publishFrame(frame: PoseFrame): void {
    this.currentFrame = frame;
    for (const callback of this.poseSubscribers) {
      callback(frame);
    }
  }

  private normalizeRestFrame(response: PoseCurrentResponse): PoseFrame | null {
    const payload: ExtractedPosePayload = {
      timestamp: response.timestamp ?? new Date().toISOString(),
      frameId: response.frame_id ?? `rest-${Date.now()}`,
      processingTimeMs: response.processing_time_ms ?? 0,
      persons: response.persons ?? [],
      metadata: response.metadata ?? {},
    };

    return this.normalizePayload(payload);
  }

  private normalizeRealtimeFrame(message: WebSocketMessage): PoseFrame | null {
    const payload = this.extractPosePayload(message);
    if (!payload) {
      return null;
    }

    return this.normalizePayload(payload);
  }

  private normalizePayload(payload: ExtractedPosePayload): PoseFrame | null {
    const metadataMotionScore = clamp(
      toNumber(payload.metadata.motion_score) ?? 0,
      0,
      1,
    );
    const motionHint = metadataMotionScore * 0.08;

    const parsedPersons = payload.persons
      .map((person, index) => this.parsePerson(person, index, payload.activity))
      .filter((person): person is ParsedPerson => person !== null);

    const bounds = this.resolveBounds(parsedPersons);
    const normalizedPersons = parsedPersons.map((person) => {
      const keypoints =
        person.keypoints.length > 0
          ? this.normalizeKeypoints(person.keypoints, bounds)
          : person.location3d
            ? this.buildSyntheticKeypointsFromLocation(person.location3d)
            : [];

      return this.enrichPerson(
        {
          id: person.id,
          name: person.name,
          confidence: person.confidence,
          keypoints,
          activity: person.activity,
        },
        motionHint,
      );
    });

    if (normalizedPersons.length === 0) {
      return null;
    }

    return {
      timestamp: payload.timestamp,
      frameId: payload.frameId,
      persons: normalizedPersons,
      stats: this.buildStats(normalizedPersons, {
        processingTimeMs: payload.processingTimeMs,
        metadata: payload.metadata,
      }),
      source: "realtime",
    };
  }

  private extractPosePayload(
    message: WebSocketMessage,
  ): ExtractedPosePayload | null {
    const type = toStringValue(message.type);
    const root = isRecord(message.data)
      ? message.data
      : isRecord(message.payload)
        ? message.payload
        : message;

    if (!isRecord(root)) {
      return null;
    }

    const hasPersons =
      Array.isArray(root.persons) ||
      (isRecord(root.pose) && Array.isArray(root.pose.persons));

    if (!hasPersons && type && type !== "pose_data") {
      return null;
    }

    const poseObject = isRecord(root.pose) ? root.pose : null;
    const persons = Array.isArray(root.persons)
      ? root.persons
      : Array.isArray(poseObject?.persons)
        ? poseObject.persons
        : [];

    const metadata = {
      ...(isRecord(root.metadata) ? root.metadata : {}),
      ...(isRecord(message.metadata) ? message.metadata : {}),
    };

    return {
      timestamp:
        toStringValue(message.timestamp) ??
        toStringValue(root.timestamp) ??
        new Date().toISOString(),
      frameId:
        toStringValue(root.frame_id) ??
        toStringValue(message.frame_id) ??
        `ws-${Date.now()}`,
      processingTimeMs:
        toNumber(root.processing_time_ms) ??
        toNumber(message.processing_time_ms) ??
        0,
      persons: persons as PosePersonRecord[],
      metadata,
      activity: toStringValue(root.activity) ?? undefined,
    };
  }

  private parsePerson(
    rawPerson: PosePersonRecord,
    index: number,
    fallbackActivity?: string,
  ): ParsedPerson | null {
    if (!isRecord(rawPerson)) {
      return null;
    }

    const parsedKeypoints = this.parseKeypoints(rawPerson.keypoints);
    const parsedLocation3d = this.parseLocation3d(rawPerson.location_3d);

    if (parsedKeypoints.length === 0 && !parsedLocation3d) {
      return null;
    }

    const id =
      toStringValue(rawPerson.track_id) ??
      toStringValue(rawPerson.person_id) ??
      `person-${index + 1}`;

    return {
      id,
      name: toStringValue(rawPerson.name) ?? undefined,
      confidence: clamp(toNumber(rawPerson.confidence) ?? 0.8, 0, 1),
      activity: toStringValue(rawPerson.activity) ?? fallbackActivity,
      keypoints: parsedKeypoints,
      location3d: parsedLocation3d,
    };
  }

  private parseLocation3d(input: unknown): ParsedLocation3d | undefined {
    if (!input || !isRecord(input)) {
      return undefined;
    }

    const x = toNumber(input.x);
    const y = toNumber(input.y);
    const z = toNumber(input.z);

    if (x === null || y === null || z === null) {
      return undefined;
    }

    return {
      x,
      y,
      z,
      uncertaintyRadius: clamp(
        toNumber(input.uncertainty_radius) ?? 0.8,
        0.2,
        2,
      ),
      confidence: clamp(toNumber(input.confidence) ?? 0.72, 0.2, 1),
    };
  }

  private buildSyntheticKeypointsFromLocation(
    location: ParsedLocation3d,
  ): PoseKeypoint[] {
    const centerX = clamp(0.5 + location.x * 0.085, 0.12, 0.88);
    const centerY = clamp(0.54 - location.z * 0.05, 0.2, 0.88);
    const torsoHeight = clamp(0.24 + location.y * 0.035, 0.2, 0.34);
    const shoulderWidth = clamp(
      0.1 + location.uncertaintyRadius * 0.02,
      0.1,
      0.16,
    );
    const confidence = clamp(location.confidence, 0.35, 0.98);

    return [
      {
        index: 0,
        name: "nose",
        x: centerX,
        y: centerY - torsoHeight * 0.65,
        confidence,
      },
      {
        index: 1,
        name: "left_eye",
        x: centerX - 0.018,
        y: centerY - torsoHeight * 0.69,
        confidence: confidence * 0.95,
      },
      {
        index: 2,
        name: "right_eye",
        x: centerX + 0.018,
        y: centerY - torsoHeight * 0.69,
        confidence: confidence * 0.95,
      },
      {
        index: 3,
        name: "left_ear",
        x: centerX - 0.036,
        y: centerY - torsoHeight * 0.64,
        confidence: confidence * 0.88,
      },
      {
        index: 4,
        name: "right_ear",
        x: centerX + 0.036,
        y: centerY - torsoHeight * 0.64,
        confidence: confidence * 0.88,
      },
      {
        index: 5,
        name: "left_shoulder",
        x: centerX - shoulderWidth,
        y: centerY - torsoHeight * 0.32,
        confidence: confidence * 0.96,
      },
      {
        index: 6,
        name: "right_shoulder",
        x: centerX + shoulderWidth,
        y: centerY - torsoHeight * 0.32,
        confidence: confidence * 0.96,
      },
      {
        index: 7,
        name: "left_elbow",
        x: centerX - shoulderWidth * 1.22,
        y: centerY + torsoHeight * 0.04,
        confidence: confidence * 0.9,
      },
      {
        index: 8,
        name: "right_elbow",
        x: centerX + shoulderWidth * 1.22,
        y: centerY + torsoHeight * 0.04,
        confidence: confidence * 0.9,
      },
      {
        index: 9,
        name: "left_wrist",
        x: centerX - shoulderWidth * 1.4,
        y: centerY + torsoHeight * 0.32,
        confidence: confidence * 0.84,
      },
      {
        index: 10,
        name: "right_wrist",
        x: centerX + shoulderWidth * 1.4,
        y: centerY + torsoHeight * 0.32,
        confidence: confidence * 0.84,
      },
      {
        index: 11,
        name: "left_hip",
        x: centerX - shoulderWidth * 0.55,
        y: centerY + torsoHeight * 0.33,
        confidence: confidence * 0.95,
      },
      {
        index: 12,
        name: "right_hip",
        x: centerX + shoulderWidth * 0.55,
        y: centerY + torsoHeight * 0.33,
        confidence: confidence * 0.95,
      },
      {
        index: 13,
        name: "left_knee",
        x: centerX - shoulderWidth * 0.62,
        y: centerY + torsoHeight * 0.92,
        confidence: confidence * 0.88,
      },
      {
        index: 14,
        name: "right_knee",
        x: centerX + shoulderWidth * 0.62,
        y: centerY + torsoHeight * 0.92,
        confidence: confidence * 0.88,
      },
      {
        index: 15,
        name: "left_ankle",
        x: centerX - shoulderWidth * 0.68,
        y: centerY + torsoHeight * 1.55,
        confidence: confidence * 0.82,
      },
      {
        index: 16,
        name: "right_ankle",
        x: centerX + shoulderWidth * 0.68,
        y: centerY + torsoHeight * 1.55,
        confidence: confidence * 0.82,
      },
    ].map((keypoint) => ({
      ...keypoint,
      x: clamp(keypoint.x, 0, 1),
      y: clamp(keypoint.y, 0, 1),
      confidence: clamp(keypoint.confidence, 0, 1),
    }));
  }

  private parseKeypoints(input: unknown): ParsedKeypoint[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const parsed: ParsedKeypoint[] = [];

    for (const item of input) {
      if (Array.isArray(item) && item.length >= 2) {
        const x = toNumber(item[0]);
        const y = toNumber(item[1]);
        const confidence = toNumber(item[2]) ?? 0.6;
        if (x !== null && y !== null) {
          parsed.push({
            index: parsed.length,
            x,
            y,
            confidence: clamp(confidence, 0, 1),
          });
        }
        continue;
      }

      if (!isRecord(item)) {
        continue;
      }

      const x = toNumber(item.x);
      const y = toNumber(item.y);
      if (x === null || y === null) {
        continue;
      }

      const indexFromName = toStringValue(item.name);
      const resolvedIndexByName = indexFromName
        ? COCO_KEYPOINT_NAMES.indexOf(
            indexFromName as (typeof COCO_KEYPOINT_NAMES)[number],
          )
        : -1;
      const resolvedIndexByValue = toNumber(item.index);

      parsed.push({
        index:
          resolvedIndexByName >= 0
            ? resolvedIndexByName
            : (resolvedIndexByValue ?? parsed.length),
        x,
        y,
        confidence: clamp(toNumber(item.confidence) ?? 0.6, 0, 1),
      });
    }

    return parsed;
  }

  private resolveBounds(persons: ParsedPerson[]): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    alreadyNormalized: boolean;
  } {
    const points = persons.flatMap((person) =>
      person.keypoints
        .filter((keypoint) => keypoint.confidence > 0)
        .map((keypoint) => ({ x: keypoint.x, y: keypoint.y })),
    );

    if (points.length === 0) {
      return {
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
        alreadyNormalized: true,
      };
    }

    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));

    const alreadyNormalized =
      minX >= -0.2 && minY >= -0.2 && maxX <= 1.2 && maxY <= 1.2;

    return {
      minX,
      minY,
      maxX,
      maxY,
      alreadyNormalized,
    };
  }

  private normalizeKeypoints(
    keypoints: ParsedKeypoint[],
    bounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      alreadyNormalized: boolean;
    },
  ): PoseKeypoint[] {
    const rangeX = Math.max(bounds.maxX - bounds.minX, 1e-4);
    const rangeY = Math.max(bounds.maxY - bounds.minY, 1e-4);

    const slots = Array.from(
      { length: COCO_KEYPOINT_NAMES.length },
      (_, index) => ({
        index,
        name: COCO_KEYPOINT_NAMES[index],
        x: 0.5,
        y: 0.5,
        confidence: 0,
      }),
    );

    for (const keypoint of keypoints) {
      if (keypoint.index < 0 || keypoint.index >= slots.length) {
        continue;
      }

      const normalizedX = bounds.alreadyNormalized
        ? clamp(keypoint.x, 0, 1)
        : clamp(0.15 + ((keypoint.x - bounds.minX) / rangeX) * 0.7, 0, 1);
      const normalizedY = bounds.alreadyNormalized
        ? clamp(keypoint.y, 0, 1)
        : clamp(0.1 + ((keypoint.y - bounds.minY) / rangeY) * 0.8, 0, 1);

      slots[keypoint.index] = {
        index: keypoint.index,
        name: COCO_KEYPOINT_NAMES[keypoint.index],
        x: normalizedX,
        y: normalizedY,
        confidence: keypoint.confidence,
      };
    }

    return slots;
  }

  private enrichPerson(
    input: {
      id: string;
      name?: string;
      confidence: number;
      keypoints: PoseKeypoint[];
      activity?: string;
    },
    motionHint = 0,
  ): PosePerson {
    const centroid = this.calculateCentroid(input.keypoints);
    const previous = this.previousCentroids.get(input.id);
    const movementDelta = previous
      ? Math.max(distance(centroid, previous), motionHint)
      : motionHint;
    this.previousCentroids.set(input.id, centroid);

    if (movementDelta > 0.008) {
      this.totalSteps += 1;
    }

    return {
      id: input.id,
      name: input.name,
      confidence: input.confidence,
      keypoints: input.keypoints,
      movementDelta,
      gaitPattern: this.detectGaitPattern(input.keypoints, movementDelta),
      activity: input.activity,
    };
  }

  private calculateCentroid(keypoints: PoseKeypoint[]): {
    x: number;
    y: number;
  } {
    const important = [11, 12, 5, 6]
      .map((index) => keypoints[index])
      .filter((keypoint) => keypoint && keypoint.confidence > 0.2);

    if (important.length === 0) {
      return { x: 0.5, y: 0.5 };
    }

    const total = important.reduce(
      (acc, point) => ({
        x: acc.x + point.x,
        y: acc.y + point.y,
      }),
      { x: 0, y: 0 },
    );

    return {
      x: total.x / important.length,
      y: total.y / important.length,
    };
  }

  private detectGaitPattern(
    keypoints: PoseKeypoint[],
    movementDelta: number,
  ): GaitPattern {
    const leftAnkle = keypoints[15];
    const rightAnkle = keypoints[16];
    const ankleYGap = Math.abs(leftAnkle.y - rightAnkle.y);

    if (movementDelta < 0.003) {
      return "stationary";
    }

    if (movementDelta > 0.03 || ankleYGap > 0.06) {
      return "unsteady";
    }

    return "normal";
  }

  private resolvePostureLabel(primary: PosePerson | undefined): string {
    if (!primary) {
      return "Unknown";
    }

    if (primary.activity === "falling" || primary.activity === "on_floor") {
      return "Fallen";
    }

    const leftShoulder = primary.keypoints[5];
    const rightShoulder = primary.keypoints[6];
    const leftHip = primary.keypoints[11];
    const rightHip = primary.keypoints[12];

    const torsoPoints = [leftShoulder, rightShoulder, leftHip, rightHip];
    if (torsoPoints.some((point) => point.confidence < 0.25)) {
      return "Standing";
    }

    const shoulderCenter = {
      x: (leftShoulder.x + rightShoulder.x) / 2,
      y: (leftShoulder.y + rightShoulder.y) / 2,
    };
    const hipCenter = {
      x: (leftHip.x + rightHip.x) / 2,
      y: (leftHip.y + rightHip.y) / 2,
    };

    const verticalSpan = Math.abs(hipCenter.y - shoulderCenter.y);
    const horizontalSpan = Math.abs(hipCenter.x - shoulderCenter.x);

    if (verticalSpan < 0.08 && horizontalSpan > 0.12) {
      return "Low posture";
    }

    return "Standing";
  }

  private buildStats(
    persons: PosePerson[],
    context: { processingTimeMs: number; metadata: Record<string, unknown> },
  ): PoseFrameStats {
    const quality = toNumber(context.metadata.csi_quality);
    const motionScore = clamp(
      toNumber(context.metadata.motion_score) ?? 0,
      0,
      1,
    );
    const motionActiveThreshold = clamp(
      toNumber(context.metadata.motion_active_threshold) ?? 0.24,
      0.05,
      0.95,
    );
    const motionHighThreshold = clamp(
      toNumber(context.metadata.motion_high_threshold) ?? 0.52,
      Math.min(motionActiveThreshold + 0.02, 0.97),
      0.99,
    );

    const signalStrengthFromMetadata = toNumber(
      context.metadata.signal_strength,
    );

    const signalStrength = signalStrengthFromMetadata
      ? Math.round(signalStrengthFromMetadata)
      : quality !== null
        ? Math.round(-90 + quality * 50)
        : -42;

    const trackingPoints = persons.reduce(
      (count, person) =>
        count +
        person.keypoints.filter((keypoint) => keypoint.confidence > 0.3).length,
      0,
    );

    const primary = persons[0];
    const inferredMovementDelta = Math.max(
      primary?.movementDelta ?? 0,
      motionScore * 0.08,
    );
    const gaitLabel =
      primary?.gaitPattern === "unsteady"
        ? "Unsteady"
        : primary?.gaitPattern === "stationary"
          ? "Normal"
          : primary
            ? "Normal"
            : "No signal";

    const movementLabel =
      motionScore >= motionHighThreshold
        ? "High"
        : motionScore >= motionActiveThreshold || inferredMovementDelta > 0.009
          ? "Active"
          : "Minimal";

    const postureLabel = this.resolvePostureLabel(primary);

    return {
      signalStrength,
      trackingPoints,
      latency: Math.max(Math.round(context.processingTimeMs || 0), 8),
      roomDuration: Math.max(
        1,
        Math.floor((Date.now() - this.startedAt) / 60000),
      ),
      stepsToday: this.totalSteps,
      posture: postureLabel,
      gait: gaitLabel,
      movement: movementLabel,
    };
  }
}

export const poseService = new PoseService();
