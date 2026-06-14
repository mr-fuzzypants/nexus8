import { createServer } from 'node:http'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { createCollaborationStorageFromEnv } from './collab-storage.mjs'

const port = Number(process.env.COLLAB_PORT || process.env.PORT || 1234)
const host = process.env.COLLAB_HOST || '0.0.0.0'
const SOCKET_OPEN = 1
const startedAt = Date.now()
const ROOM_SAVE_DEBOUNCE_MS = Number(process.env.COLLAB_SAVE_DEBOUNCE_MS || 250)
const SOCKET_HEARTBEAT_MS = Number(process.env.COLLAB_SOCKET_HEARTBEAT_MS || 25_000)
const SOCKET_HEARTBEAT_TIMEOUT_MS = Number(process.env.COLLAB_SOCKET_TIMEOUT_MS || 60_000)
const storage = await createCollaborationStorageFromEnv()

function toBase64(data) {
  let binary = ''
  data.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return Buffer.from(binary, 'binary').toString('base64')
}

function fromBase64(serialized) {
  const binary = Buffer.from(serialized, 'base64').toString('binary')
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function getRoomId(request) {
  const url = new URL(request.url || '/', 'ws://localhost')
  return url.searchParams.get('room') || 'default-room'
}

function getClientId(request) {
  const url = new URL(request.url || '/', 'ws://localhost')
  const value = Number(url.searchParams.get('clientId'))
  return Number.isFinite(value) ? value : null
}

async function createRoom(roomId) {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const sockets = new Map()
  const snapshot = await storage.loadRoomSnapshot(roomId)

  if (snapshot) {
    Y.applyUpdate(doc, snapshot, 'storage')
  }

  doc.on('update', (update, origin) => {
    const payload = JSON.stringify({
      type: 'doc-update',
      roomId,
      sender: 'server',
      update: toBase64(update),
    })

    sockets.forEach((_, socket) => {
      if (socket.readyState !== SOCKET_OPEN || socket === origin) {
        return
      }
      socket.send(payload)
    })

    queueRoomSave(roomId, room)
  })

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed)
    if (changedClients.length === 0) {
      return
    }

    const payload = JSON.stringify({
      type: 'awareness-update',
      roomId,
      sender: 'server',
      update: toBase64(encodeAwarenessUpdate(awareness, changedClients)),
    })

    sockets.forEach((_, socket) => {
      if (socket.readyState !== SOCKET_OPEN || socket === origin) {
        return
      }
      socket.send(payload)
    })
  })

  const room = {
    doc,
    awareness,
    sockets,
    pendingSnapshot: null,
    saveTimer: null,
    savePromise: Promise.resolve(),
  }

  return room
}

const rooms = new Map()
const roomInitializations = new Map()

function queueRoomSave(roomId, room) {
  if (storage.driver === 'memory') {
    return
  }

  room.pendingSnapshot = Y.encodeStateAsUpdate(room.doc)

  if (room.saveTimer !== null) {
    clearTimeout(room.saveTimer)
  }

  room.saveTimer = setTimeout(() => {
    room.saveTimer = null
    void flushRoomSave(roomId, room)
  }, ROOM_SAVE_DEBOUNCE_MS)
}

async function flushRoomSave(roomId, room) {
  if (storage.driver === 'memory') {
    return
  }

  const snapshot = room.pendingSnapshot ?? Y.encodeStateAsUpdate(room.doc)
  room.pendingSnapshot = null

  const saveOperation = async () => {
    await storage.saveRoomSnapshot(roomId, snapshot)
  }

  room.savePromise = room.savePromise.then(saveOperation, saveOperation).catch((error) => {
    console.error(`Failed to persist room ${roomId}`, error)
  })

  await room.savePromise
}

async function disposeRoom(roomId, room) {
  if (room.saveTimer !== null) {
    clearTimeout(room.saveTimer)
    room.saveTimer = null
  }

  if (room.pendingSnapshot) {
    await flushRoomSave(roomId, room)
  } else {
    await room.savePromise
  }

  room.doc.destroy()
}

async function getOrCreateRoom(roomId) {
  const existingRoom = rooms.get(roomId)
  if (existingRoom) {
    return existingRoom
  }

  const existingInitialization = roomInitializations.get(roomId)
  if (existingInitialization) {
    return existingInitialization
  }

  const initialization = createRoom(roomId)
    .then((room) => {
      rooms.set(roomId, room)
      roomInitializations.delete(roomId)
      return room
    })
    .catch((error) => {
      roomInitializations.delete(roomId)
      throw error
    })

  roomInitializations.set(roomId, initialization)
  return initialization
}

function getSocketCount() {
  let count = 0
  rooms.forEach((room) => {
    count += room.sockets.size
  })
  return count
}

function markSocketAlive(socket) {
  socket.isAlive = true
  socket.lastHeartbeatAt = Date.now()
}

const server = createServer((request, response) => {
  const method = request.method || 'GET'
  const url = new URL(request.url || '/', 'http://localhost')

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/healthz')) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({
      ok: true,
      service: 'collaboration-relay',
      storageDriver: storage.driver,
      uptimeMs: Date.now() - startedAt,
      activeRooms: rooms.size,
      activeSockets: getSocketCount(),
    }))
    return
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ ok: false, error: 'not-found' }))
})

const webSocketServer = new WebSocketServer({ noServer: true })

webSocketServer.on('connection', async (socket, request) => {
  const roomId = getRoomId(request)
  const clientId = getClientId(request)
  let room

  try {
    room = await getOrCreateRoom(roomId)
  } catch (error) {
    console.error(`Failed to initialize room ${roomId}`, error)
    socket.close(1011, 'room-initialization-failed')
    return
  }

  markSocketAlive(socket)
  room.sockets.set(socket, clientId)

  socket.on('pong', () => {
    markSocketAlive(socket)
  })

  socket.on('message', (raw) => {
    markSocketAlive(socket)
    let message = null

    try {
      message = JSON.parse(String(raw))
    } catch (error) {
      console.warn('Ignoring invalid collaboration message', error)
      return
    }

    if (!message || message.roomId !== roomId) {
      return
    }

    switch (message.type) {
      case 'sync-request': {
        const awarenessClients = Array.from(room.awareness.getStates().keys())
        socket.send(
          JSON.stringify({
            type: 'sync-response',
            roomId,
            sender: 'server',
            update: toBase64(Y.encodeStateAsUpdate(room.doc)),
            awareness:
              awarenessClients.length > 0 ? toBase64(encodeAwarenessUpdate(room.awareness, awarenessClients)) : undefined,
          }),
        )
        break
      }
      case 'ping':
        socket.send(
          JSON.stringify({
            type: 'pong',
            roomId,
            sender: 'server',
            timestamp: Date.now(),
          }),
        )
        break
      case 'doc-update':
        Y.applyUpdate(room.doc, fromBase64(message.update), socket)
        break
      case 'awareness-update':
        applyAwarenessUpdate(room.awareness, fromBase64(message.update), socket)
        break
      default:
        break
    }
  })

  socket.on('close', () => {
    room.sockets.delete(socket)
    if (clientId !== null) {
      removeAwarenessStates(room.awareness, [clientId], 'disconnect')
    }

    if (room.sockets.size === 0) {
      rooms.delete(roomId)
      void disposeRoom(roomId, room)
    }
  })
})

const heartbeatInterval =
  Number.isFinite(SOCKET_HEARTBEAT_MS) && SOCKET_HEARTBEAT_MS > 0
    ? setInterval(() => {
        const now = Date.now()
        webSocketServer.clients.forEach((socket) => {
          if (socket.readyState !== SOCKET_OPEN) {
            return
          }

          const lastHeartbeatAt = socket.lastHeartbeatAt || 0
          if (!socket.isAlive || now - lastHeartbeatAt > SOCKET_HEARTBEAT_TIMEOUT_MS) {
            socket.terminate()
            return
          }

          socket.isAlive = false
          socket.ping()
        })
      }, SOCKET_HEARTBEAT_MS)
    : null

heartbeatInterval?.unref?.()

server.on('upgrade', (request, socket, head) => {
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit('connection', webSocket, request)
  })
})

server.on('listening', () => {
  console.log(`Yjs collaboration relay listening on ws://${host}:${port}`)
  console.log(`Health check available at http://${host}:${port}/healthz`)
  console.log(`Persistence driver: ${storage.driver}`)
})

async function closeStorage() {
  try {
    await storage.close?.()
  } catch (error) {
    console.error('Failed to close collaboration storage cleanly', error)
  }
}

process.on('SIGINT', () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
  }
  void closeStorage().finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
  }
  void closeStorage().finally(() => process.exit(0))
})

server.listen(port, host)
