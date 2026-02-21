import {
  WS_HEARTBEAT_INTERVAL_MS,
  WS_RECONNECT_CONFIG,
} from "@/config/api"

export type WebSocketConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"

export type WebSocketMessage = Record<string, unknown>

type MessageSubscriber = (message: WebSocketMessage) => void
type StateSubscriber = (state: WebSocketConnectionState) => void
type ErrorSubscriber = (error: string) => void

export class WebSocketManager {
  private socket: WebSocket | null = null
  private readonly url: string
  private state: WebSocketConnectionState = "disconnected"
  private reconnectAttempt = 0
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private intentionalDisconnect = false

  private readonly messageSubscribers = new Set<MessageSubscriber>()
  private readonly stateSubscribers = new Set<StateSubscriber>()
  private readonly errorSubscribers = new Set<ErrorSubscriber>()

  constructor(url: string) {
    this.url = url
  }

  getState(): WebSocketConnectionState {
    return this.state
  }

  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    this.intentionalDisconnect = false
    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting")

    this.socket = new WebSocket(this.url)

    this.socket.onopen = () => {
      this.reconnectAttempt = 0
      this.setState("connected")
      this.startHeartbeat()
    }

    this.socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WebSocketMessage
        this.notifyMessage(payload)
      } catch {
        this.notifyError("Failed to parse WebSocket payload")
      }
    }

    this.socket.onerror = () => {
      this.notifyError("WebSocket connection error")
    }

    this.socket.onclose = () => {
      this.stopHeartbeat()
      this.socket = null

      if (this.intentionalDisconnect) {
        this.setState("disconnected")
        return
      }

      this.scheduleReconnect()
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true
    this.clearReconnectTimer()
    this.stopHeartbeat()

    if (this.socket) {
      this.socket.close(1000, "Client disconnected")
      this.socket = null
    }

    this.setState("disconnected")
  }

  send(message: WebSocketMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }

    this.socket.send(JSON.stringify(message))
    return true
  }

  subscribe(callback: MessageSubscriber): () => void {
    this.messageSubscribers.add(callback)
    return () => {
      this.messageSubscribers.delete(callback)
    }
  }

  subscribeConnectionState(callback: StateSubscriber): () => void {
    this.stateSubscribers.add(callback)
    callback(this.state)
    return () => {
      this.stateSubscribers.delete(callback)
    }
  }

  subscribeErrors(callback: ErrorSubscriber): () => void {
    this.errorSubscribers.add(callback)
    return () => {
      this.errorSubscribers.delete(callback)
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting")

    const delay = Math.min(
      WS_RECONNECT_CONFIG.initialDelayMs * 2 ** this.reconnectAttempt,
      WS_RECONNECT_CONFIG.maxDelayMs
    )
    this.reconnectAttempt += 1

    this.clearReconnectTimer()
    this.reconnectTimer = window.setTimeout(() => {
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      this.send({
        type: "ping",
        timestamp: new Date().toISOString(),
      })
    }, WS_HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setState(nextState: WebSocketConnectionState): void {
    this.state = nextState
    for (const callback of this.stateSubscribers) {
      callback(nextState)
    }
  }

  private notifyMessage(message: WebSocketMessage): void {
    for (const callback of this.messageSubscribers) {
      callback(message)
    }
  }

  private notifyError(error: string): void {
    for (const callback of this.errorSubscribers) {
      callback(error)
    }
  }
}
