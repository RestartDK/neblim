import {
  POSE3D_ENDPOINTS,
  buildPose3dApiUrl,
  buildPose3dWsUrl,
} from "@/config/api";
import {
  WebSocketManager,
  type WebSocketConnectionState,
  type WebSocketMessage,
} from "@/services/websocket";

export interface Pose3dLocation {
  x: number;
  y: number;
  z: number;
  uncertainty_radius: number;
  confidence: number;
}

export interface Pose3dPerson {
  id: string;
  confidence: number;
  location_3d: Pose3dLocation;
}

export interface Pose3dFrame {
  timestamp: string;
  frame_id: string | number;
  coordinate_frame: string;
  persons: Pose3dPerson[];
}

const POSE3D_REQUEST_TIMEOUT_MS = 3_000;

type Pose3dSubscriber = (frame: Pose3dFrame) => void;
type ConnectionSubscriber = (state: WebSocketConnectionState) => void;
type ErrorSubscriber = (error: string) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const toFrameId = (value: unknown): string | number | null => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
};

const toNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const parseLocation = (input: unknown): Pose3dLocation | null => {
  if (!isRecord(input)) {
    return null;
  }

  const x = toFiniteNumber(input.x);
  const y = toFiniteNumber(input.y);
  const z = toFiniteNumber(input.z);
  const uncertaintyRadius = toFiniteNumber(input.uncertainty_radius);
  const confidence = toFiniteNumber(input.confidence);

  if (
    x === null ||
    y === null ||
    z === null ||
    uncertaintyRadius === null ||
    confidence === null
  ) {
    return null;
  }

  return {
    x,
    y,
    z,
    uncertainty_radius: uncertaintyRadius,
    confidence,
  };
};

const parsePerson = (input: unknown, index: number): Pose3dPerson | null => {
  if (!isRecord(input)) {
    return null;
  }

  const location = parseLocation(input.location_3d);
  if (!location) {
    return null;
  }

  const confidence = toFiniteNumber(input.confidence) ?? location.confidence;
  const id = toNonEmptyString(input.id) ?? `person-${index + 1}`;

  return {
    id,
    confidence,
    location_3d: location,
  };
};

const parseFrame = (input: unknown): Pose3dFrame | null => {
  if (!isRecord(input)) {
    return null;
  }

  const frameId = toFrameId(input.frame_id);
  if (frameId === null) {
    return null;
  }

  const timestamp =
    toNonEmptyString(input.timestamp) ?? new Date().toISOString();
  const coordinateFrame =
    toNonEmptyString(input.coordinate_frame) ?? "world_meters";

  const rawPersons = Array.isArray(input.persons) ? input.persons : [];
  const persons = rawPersons
    .map((person, index) => parsePerson(person, index))
    .filter((person): person is Pose3dPerson => person !== null);

  return {
    timestamp,
    frame_id: frameId,
    coordinate_frame: coordinateFrame,
    persons,
  };
};

class Pose3dService {
  private readonly wsManager = new WebSocketManager(
    buildPose3dWsUrl(POSE3D_ENDPOINTS.stream),
  );
  private readonly poseSubscribers = new Set<Pose3dSubscriber>();
  private readonly connectionSubscribers = new Set<ConnectionSubscriber>();
  private readonly errorSubscribers = new Set<ErrorSubscriber>();

  private currentFrame: Pose3dFrame | null = null;

  constructor() {
    this.wsManager.subscribe((message) => {
      const frame = this.normalizeWsFrame(message);
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
      const snapshot = await this.getCurrentFrame();
      if (snapshot) {
        this.publishFrame(snapshot);
      }
    } catch {
      this.notifyError("Unable to fetch initial 3D pose snapshot");
    }
  }

  disconnect(): void {
    this.wsManager.disconnect();
  }

  getConnectionState(): WebSocketConnectionState {
    return this.wsManager.getState();
  }

  getLatestFrame(): Pose3dFrame | null {
    return this.currentFrame;
  }

  subscribe(callback: Pose3dSubscriber): () => void {
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

  async getCurrentFrame(): Promise<Pose3dFrame | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      POSE3D_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        buildPose3dApiUrl(POSE3D_ENDPOINTS.current),
        {
          method: "GET",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`Snapshot request failed: ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      return parseFrame(payload);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async seedDemo(survivors = 3): Promise<Pose3dFrame | null> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      POSE3D_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(buildPose3dApiUrl(POSE3D_ENDPOINTS.seed), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ survivors }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Seed request failed: ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const frame = isRecord(payload) ? parseFrame(payload.frame) : null;
      if (frame) {
        this.publishFrame(frame);
      }

      return frame;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  private publishFrame(frame: Pose3dFrame): void {
    this.currentFrame = frame;
    for (const callback of this.poseSubscribers) {
      callback(frame);
    }
  }

  private normalizeWsFrame(message: WebSocketMessage): Pose3dFrame | null {
    const type = toNonEmptyString(message.type);

    if (type === "heartbeat") {
      return null;
    }

    if (type && type !== "pose_frame") {
      return null;
    }

    const frame = parseFrame(message);
    if (frame) {
      return frame;
    }

    if (isRecord(message.frame)) {
      return parseFrame(message.frame);
    }

    return null;
  }

  private notifyError(error: string): void {
    for (const callback of this.errorSubscribers) {
      callback(error);
    }
  }
}

export const pose3dService = new Pose3dService();
