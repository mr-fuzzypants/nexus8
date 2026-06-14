import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import { AnnotationDocumentStore } from '../annotations/store'
import type {
  AnnotationTool,
  CollaborationProfile,
  ParticipantState,
  Vec2,
} from '../annotations/types'

interface SyncRequestMessage {
  type: 'sync-request'
  sender: number
}

interface SyncResponseMessage {
  type: 'sync-response'
  sender: number
  update: Uint8Array
}

interface DocUpdateMessage {
  type: 'doc-update'
  sender: number
  update: Uint8Array
}

interface AwarenessMessage {
  type: 'awareness-update'
  sender: number
  update: Uint8Array
}

interface SocketSyncRequestMessage {
  type: 'sync-request'
  roomId: string
  sender: number
}

interface SocketSyncResponseMessage {
  type: 'sync-response'
  roomId: string
  sender: 'server'
  update: string
  awareness?: string
}

interface SocketDocUpdateMessage {
  type: 'doc-update'
  roomId: string
  sender: number | 'server'
  update: string
}

interface SocketAwarenessMessage {
  type: 'awareness-update'
  roomId: string
  sender: number | 'server'
  update: string
}

interface SocketPingMessage {
  type: 'ping'
  roomId: string
  sender: number
  timestamp: number
}

interface SocketPongMessage {
  type: 'pong'
  roomId: string
  sender: 'server'
  timestamp: number
}

export type CollaborationSocketState = 'disabled' | 'connecting' | 'connected' | 'reconnecting'

export type CollaborationHeartbeatState = 'disabled' | 'idle' | 'waiting' | 'healthy'

export interface CollaborationStatus {
  socketState: CollaborationSocketState
  endpoint?: string
  localFallback: boolean
  heartbeatState: CollaborationHeartbeatState
  heartbeatEnabled: boolean
  heartbeatIntervalMs: number
  heartbeatTimeoutMs: number
  lastHeartbeatSentAt?: number
  lastHeartbeatAckAt?: number
  reconnectAttemptCount: number
  nextReconnectAt?: number
}

type CollaborationMessage =
  | SyncRequestMessage
  | SyncResponseMessage
  | DocUpdateMessage
  | AwarenessMessage

type SocketCollaborationMessage =
  | SocketSyncRequestMessage
  | SocketSyncResponseMessage
  | SocketDocUpdateMessage
  | SocketAwarenessMessage
  | SocketPingMessage
  | SocketPongMessage

const BROADCAST_REMOTE_ORIGIN = 'broadcast-remote'
const STORAGE_REMOTE_ORIGIN = 'storage-remote'
const WEBSOCKET_REMOTE_ORIGIN = 'websocket-remote'
const DEFAULT_SOCKET_HEARTBEAT_MS = 20_000
const DEFAULT_SOCKET_PONG_TIMEOUT_MS = 10_000

function resolveWebSocketUrl() {
  const configured = import.meta.env.VITE_COLLAB_WS_URL?.trim()
  // Explicit opt-out: VITE_COLLAB_WS_URL=off disables the relay (local BroadcastChannel only).
  if (configured === 'off') {
    return undefined
  }
  if (configured) {
    return configured
  }

  if (typeof window === 'undefined') {
    return undefined
  }

  // Default to a same-origin path proxied by Vite (dev) / the reverse proxy (prod)
  // to the Yjs relay, so the SPA and relay share an origin.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/collab-ws`
}

function resolveHeartbeatIntervalMs() {
  const configured = Number(import.meta.env.VITE_COLLAB_HEARTBEAT_MS)
  if (Number.isFinite(configured) && configured >= 0) {
    return configured
  }
  return DEFAULT_SOCKET_HEARTBEAT_MS
}

function resolveHeartbeatTimeoutMs(intervalMs: number) {
  const configured = Number(import.meta.env.VITE_COLLAB_HEARTBEAT_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured > 0) {
    return configured
  }
  return Math.max(DEFAULT_SOCKET_PONG_TIMEOUT_MS, Math.floor(intervalMs * 0.5))
}

function toBase64(data: Uint8Array) {
  let binary = ''
  data.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function fromBase64(serialized: string) {
  const binary = atob(serialized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export class BroadcastCollaborationRoom {
  readonly doc = new Y.Doc()
  readonly store = new AnnotationDocumentStore(this.doc)
  readonly awareness = new Awareness(this.doc)

  private readonly roomId: string
  private readonly storageKey: string
  private readonly channelName: string
  private readonly participants = new Set<() => void>()
  private readonly statusListeners = new Set<() => void>()
  private readonly webSocketUrl = resolveWebSocketUrl()
  private readonly heartbeatIntervalMs = resolveHeartbeatIntervalMs()
  private readonly heartbeatTimeoutMs = resolveHeartbeatTimeoutMs(this.heartbeatIntervalMs)
  private readonly heartbeatEnabled = Boolean(this.webSocketUrl) && this.heartbeatIntervalMs > 0
  private channel: BroadcastChannel | null = null
  private profile: CollaborationProfile
  private lastPersistedSnapshot: string | null = null
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private heartbeatTimeoutTimer: number | null = null
  private lastHeartbeatSentAt: number | undefined
  private lastHeartbeatAckAt: number | undefined
  private reconnectAttemptCount = 0
  private nextReconnectAt: number | undefined
  private destroyed = false
  private socketState: CollaborationSocketState
  private heartbeatState: CollaborationHeartbeatState

  constructor(roomId: string, profile: CollaborationProfile) {
    this.roomId = roomId
    this.storageKey = `annotation-room:${roomId}:snapshot`
    this.channelName = `annotation-room:${roomId}`
    this.profile = profile
    this.socketState = this.webSocketUrl ? 'connecting' : 'disabled'
    this.heartbeatState = this.heartbeatEnabled ? 'idle' : 'disabled'

    this.restoreSnapshot()
    this.channel = new BroadcastChannel(this.channelName)
    this.channel.onmessage = this.handleChannelMessage
    window.addEventListener('storage', this.handleStorageEvent)
    this.connectWebSocket()

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessChange)
    this.setLocalProfile(profile)

    queueMicrotask(() => {
      this.postMessage({ type: 'sync-request', sender: this.doc.clientID })
    })
  }

  private restoreSnapshot() {
    const saved = localStorage.getItem(this.storageKey)
    if (!saved) {
      return
    }

    this.lastPersistedSnapshot = saved

    try {
      Y.applyUpdate(this.doc, fromBase64(saved), 'restore')
    } catch (error) {
      console.warn('Failed to restore collaboration snapshot', error)
    }
  }

  private persistSnapshot() {
    const update = Y.encodeStateAsUpdate(this.doc)
    const serialized = toBase64(update)
    if (serialized === this.lastPersistedSnapshot) {
      return
    }

    this.lastPersistedSnapshot = serialized
    localStorage.setItem(this.storageKey, serialized)
  }

  private postMessage(message: CollaborationMessage) {
    this.channel?.postMessage(message)
  }

  private postSocketMessage(message: SocketCollaborationMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return
    }

    this.socket.send(JSON.stringify(message))
  }

  private connectWebSocket() {
    if (!this.webSocketUrl || this.destroyed) {
      this.heartbeatState = 'disabled'
      this.setSocketState('disabled')
      return
    }

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.setSocketState(this.reconnectTimer === null ? 'connecting' : 'reconnecting')

    const separator = this.webSocketUrl.includes('?') ? '&' : '?'
    const socket = new WebSocket(
      `${this.webSocketUrl}${separator}room=${encodeURIComponent(this.roomId)}&clientId=${encodeURIComponent(String(this.doc.clientID))}`,
    )
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return
      }

      this.reconnectAttemptCount = 0
      this.nextReconnectAt = undefined
      this.heartbeatState = this.heartbeatEnabled ? 'idle' : 'disabled'
      this.setSocketState('connected')
      this.stopHeartbeatDeadline()
      this.startHeartbeat(socket)

      this.postSocketMessage({
        type: 'sync-request',
        roomId: this.roomId,
        sender: this.doc.clientID,
      })
      this.pushLocalDocumentToSocket()
      this.pushLocalAwarenessToSocket()
    })

    socket.addEventListener('message', (event) => {
      this.handleSocketMessage(event, socket)
    })

    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null
      }
      this.stopHeartbeat()
      if (!this.destroyed && this.webSocketUrl) {
        this.heartbeatState = this.heartbeatEnabled ? 'idle' : 'disabled'
        this.setSocketState('reconnecting')
      } else {
        this.heartbeatState = 'disabled'
      }
      this.scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      socket.close()
    })
  }

  private scheduleReconnect() {
    if (this.destroyed || !this.webSocketUrl || this.reconnectTimer !== null) {
      return
    }

    this.reconnectAttemptCount += 1
    this.nextReconnectAt = Date.now() + 1500
    this.emitStatus()

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.nextReconnectAt = undefined
      this.emitStatus()
      this.connectWebSocket()
    }, 1500)
  }

  private startHeartbeat(socket: WebSocket) {
    this.stopHeartbeat()

    if (this.heartbeatIntervalMs <= 0) {
      return
    }

    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat()
        return
      }

      this.lastHeartbeatSentAt = Date.now()
      this.heartbeatState = 'waiting'
      socket.send(
        JSON.stringify({
          type: 'ping',
          roomId: this.roomId,
          sender: this.doc.clientID,
          timestamp: this.lastHeartbeatSentAt,
        } satisfies SocketPingMessage),
      )
      this.emitStatus()
      this.scheduleHeartbeatDeadline(socket)
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.stopHeartbeatDeadline()
  }

  private scheduleHeartbeatDeadline(socket: WebSocket) {
    this.stopHeartbeatDeadline()

    this.heartbeatTimeoutTimer = window.setTimeout(() => {
      if (this.socket === socket && socket.readyState === WebSocket.OPEN) {
        socket.close()
      }
    }, this.heartbeatTimeoutMs)
  }

  private stopHeartbeatDeadline() {
    if (this.heartbeatTimeoutTimer !== null) {
      window.clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = null
    }
  }

  private setSocketState(next: CollaborationSocketState) {
    if (this.socketState === next) {
      this.emitStatus()
      return
    }

    this.socketState = next
    this.emitStatus()
  }

  private emitStatus() {
    this.statusListeners.forEach((listener) => listener())
  }

  private pushLocalAwarenessToSocket() {
    if (!this.awareness.getLocalState()) {
      return
    }

    const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
    this.postSocketMessage({
      type: 'awareness-update',
      roomId: this.roomId,
      sender: this.doc.clientID,
      update: toBase64(update),
    })
  }

  private pushLocalDocumentToSocket() {
    this.postSocketMessage({
      type: 'doc-update',
      roomId: this.roomId,
      sender: this.doc.clientID,
      update: toBase64(Y.encodeStateAsUpdate(this.doc)),
    })
  }

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    this.persistSnapshot()
    if (origin === BROADCAST_REMOTE_ORIGIN || origin === STORAGE_REMOTE_ORIGIN || origin === WEBSOCKET_REMOTE_ORIGIN) {
      return
    }

    this.postMessage({
      type: 'doc-update',
      sender: this.doc.clientID,
      update,
    })

    this.postSocketMessage({
      type: 'doc-update',
      roomId: this.roomId,
      sender: this.doc.clientID,
      update: toBase64(update),
    })
  }

  private readonly handleAwarenessChange = (
    payload: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    this.emitParticipants()
    if (origin === BROADCAST_REMOTE_ORIGIN || origin === WEBSOCKET_REMOTE_ORIGIN) {
      return
    }

    const changedClients = payload.added.concat(payload.updated, payload.removed)
    const update = encodeAwarenessUpdate(this.awareness, changedClients)
    this.postMessage({
      type: 'awareness-update',
      sender: this.doc.clientID,
      update,
    })

    this.postSocketMessage({
      type: 'awareness-update',
      roomId: this.roomId,
      sender: this.doc.clientID,
      update: toBase64(update),
    })
  }

  private readonly handleChannelMessage = (event: MessageEvent<CollaborationMessage>) => {
    const message = event.data
    if (!message || message.sender === this.doc.clientID) {
      return
    }

    switch (message.type) {
      case 'sync-request':
        this.postMessage({
          type: 'sync-response',
          sender: this.doc.clientID,
          update: Y.encodeStateAsUpdate(this.doc),
        })
        break
      case 'sync-response':
      case 'doc-update':
        Y.applyUpdate(this.doc, message.update, BROADCAST_REMOTE_ORIGIN)
        break
      case 'awareness-update':
        applyAwarenessUpdate(this.awareness, message.update, BROADCAST_REMOTE_ORIGIN)
        break
    }
  }

  private readonly handleSocketMessage = (event: MessageEvent<string>, socket: WebSocket) => {
    if (this.socket !== socket || typeof event.data !== 'string') {
      return
    }

    this.stopHeartbeatDeadline()

    let message: SocketCollaborationMessage | null = null

    try {
      message = JSON.parse(event.data) as SocketCollaborationMessage
    } catch (error) {
      console.warn('Failed to parse collaboration socket message', error)
      return
    }

    if (!message || message.roomId !== this.roomId) {
      return
    }

    switch (message.type) {
      case 'sync-request':
        return
      case 'ping':
        return
      case 'pong':
        this.lastHeartbeatAckAt = Date.now()
        this.heartbeatState = this.heartbeatEnabled ? 'healthy' : 'disabled'
        this.emitStatus()
        return
      case 'sync-response':
      case 'doc-update':
        Y.applyUpdate(this.doc, fromBase64(message.update), WEBSOCKET_REMOTE_ORIGIN)
        if (message.type === 'sync-response' && message.awareness) {
          applyAwarenessUpdate(this.awareness, fromBase64(message.awareness), WEBSOCKET_REMOTE_ORIGIN)
        }
        break
      case 'awareness-update':
        applyAwarenessUpdate(this.awareness, fromBase64(message.update), WEBSOCKET_REMOTE_ORIGIN)
        break
    }
  }

  private readonly handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== this.storageKey || !event.newValue || event.newValue === this.lastPersistedSnapshot) {
      return
    }

    this.lastPersistedSnapshot = event.newValue

    try {
      Y.applyUpdate(this.doc, fromBase64(event.newValue), STORAGE_REMOTE_ORIGIN)
    } catch (error) {
      console.warn('Failed to apply collaboration snapshot from storage', error)
    }
  }

  private emitParticipants() {
    this.participants.forEach((listener) => listener())
  }

  subscribeParticipants(listener: () => void) {
    this.participants.add(listener)
    return () => {
      this.participants.delete(listener)
    }
  }

  subscribeStatus(listener: () => void) {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  getStatus(): CollaborationStatus {
    return {
      socketState: this.socketState,
      endpoint: this.webSocketUrl,
      localFallback: true,
      heartbeatState: this.heartbeatState,
      heartbeatEnabled: this.heartbeatEnabled,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      heartbeatTimeoutMs: this.heartbeatTimeoutMs,
      lastHeartbeatSentAt: this.lastHeartbeatSentAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt,
      reconnectAttemptCount: this.reconnectAttemptCount,
      nextReconnectAt: this.nextReconnectAt,
    }
  }

  getParticipants(): ParticipantState[] {
    return Array.from(this.awareness.getStates().entries())
      .map(([clientId, value]) => {
        const state = value.user as ParticipantState | undefined
        if (!state) {
          return null
        }
        return {
          ...state,
          id: state.id || String(clientId),
          lastSeen: Date.now(),
        }
      })
      .filter((participant): participant is ParticipantState => participant !== null)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  setLocalProfile(profile: CollaborationProfile) {
    this.profile = profile
    this.updateLocalUserState({
      id: profile.id,
      name: profile.name,
      color: profile.color,
    })
  }

  setLocalCursor(viewerId: string, cursor: Vec2 | undefined, activeTool: AnnotationTool) {
    this.updateLocalUserState({
      viewerId,
      cursor,
      activeTool,
    })
  }

  clearLocalCursor() {
    this.updateLocalUserState({
      cursor: undefined,
      viewerId: undefined,
    })
  }

  private updateLocalUserState(partial: Partial<ParticipantState>) {
    const current = (this.awareness.getLocalState()?.user as ParticipantState | undefined) ?? {
      id: this.profile.id,
      name: this.profile.name,
      color: this.profile.color,
      lastSeen: Date.now(),
    }

    this.awareness.setLocalStateField('user', {
      ...current,
      ...partial,
      lastSeen: Date.now(),
    })
  }

  destroy() {
    this.destroyed = true
    this.heartbeatState = 'disabled'
    this.nextReconnectAt = undefined
    this.setSocketState('disabled')
    this.stopHeartbeat()
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'dispose')
    this.store.destroy()
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessChange)
    window.removeEventListener('storage', this.handleStorageEvent)
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
    this.socket = null
    this.channel?.close()
    this.channel = null
    this.doc.destroy()
  }
}
