import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// pg and sqlite3 are imported lazily inside their driver factories so only the
// dependency for the configured COLLAB_STORAGE_DRIVER needs to be installed.

const DEFAULT_SQLITE_PATH = './data/collaboration-relay.sqlite'

function normalizeDriver(value) {
  switch ((value || '').trim().toLowerCase()) {
    case 'sqlite':
    case 'sqlite3':
      return 'sqlite'
    case 'postgres':
    case 'postgresql':
    case 'pg':
      return 'postgres'
    default:
      return 'memory'
  }
}

function normalizeBinary(value) {
  if (!value) {
    return null
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }
  if (Buffer.isBuffer(value)) {
    return Uint8Array.from(value)
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  return Uint8Array.from(value)
}

function openSqliteDatabase(sqlite3, filePath) {
  return new Promise((resolveDatabase, reject) => {
    const database = new sqlite3.Database(filePath, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolveDatabase(database)
    })
  })
}

function runSql(database, sql, params = []) {
  return new Promise((resolveRun, reject) => {
    database.run(sql, params, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolveRun()
    })
  })
}

function getSql(database, sql, params = []) {
  return new Promise((resolveGet, reject) => {
    database.get(sql, params, (error, row) => {
      if (error) {
        reject(error)
        return
      }
      resolveGet(row)
    })
  })
}

function closeSqliteDatabase(database) {
  return new Promise((resolveClose, reject) => {
    database.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolveClose()
    })
  })
}

function createMemoryStorage() {
  return {
    driver: 'memory',
    async loadRoomSnapshot() {
      return null
    },
    async saveRoomSnapshot() {
    },
    async close() {
    },
  }
}

async function createSqliteStorage() {
  const { default: sqlite3 } = await import('sqlite3')
  const configuredPath = process.env.COLLAB_SQLITE_PATH?.trim() || DEFAULT_SQLITE_PATH
  const filePath = resolve(configuredPath)
  await mkdir(dirname(filePath), { recursive: true })
  const database = await openSqliteDatabase(sqlite3, filePath)

  await runSql(
    database,
    `CREATE TABLE IF NOT EXISTS room_snapshots (
      room_id TEXT PRIMARY KEY,
      snapshot BLOB NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  )

  return {
    driver: 'sqlite',
    filePath,
    async loadRoomSnapshot(roomId) {
      const row = await getSql(database, 'SELECT snapshot FROM room_snapshots WHERE room_id = ?', [roomId])
      return normalizeBinary(row?.snapshot)
    },
    async saveRoomSnapshot(roomId, snapshot) {
      await runSql(
        database,
        `INSERT INTO room_snapshots (room_id, snapshot, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(room_id) DO UPDATE SET
           snapshot = excluded.snapshot,
           updated_at = excluded.updated_at`,
        [roomId, Buffer.from(snapshot), new Date().toISOString()],
      )
    },
    async close() {
      await closeSqliteDatabase(database)
    },
  }
}

async function createPostgresStorage() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when COLLAB_STORAGE_DRIVER=postgres')
  }

  const { default: pg } = await import('pg')
  const { Pool } = pg
  const sslMode = (process.env.COLLAB_POSTGRES_SSL || 'disable').trim().toLowerCase()
  const pool = new Pool({
    connectionString,
    ssl: sslMode === 'require' ? { rejectUnauthorized: false } : undefined,
  })

  await pool.query(
    `CREATE TABLE IF NOT EXISTS room_snapshots (
      room_id TEXT PRIMARY KEY,
      snapshot BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  )

  return {
    driver: 'postgres',
    async loadRoomSnapshot(roomId) {
      const result = await pool.query('SELECT snapshot FROM room_snapshots WHERE room_id = $1', [roomId])
      return normalizeBinary(result.rows[0]?.snapshot)
    },
    async saveRoomSnapshot(roomId, snapshot) {
      await pool.query(
        `INSERT INTO room_snapshots (room_id, snapshot, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (room_id) DO UPDATE SET
           snapshot = EXCLUDED.snapshot,
           updated_at = NOW()`,
        [roomId, Buffer.from(snapshot)],
      )
    },
    async close() {
      await pool.end()
    },
  }
}

export async function createCollaborationStorageFromEnv() {
  const driver = normalizeDriver(process.env.COLLAB_STORAGE_DRIVER)

  switch (driver) {
    case 'sqlite':
      return createSqliteStorage()
    case 'postgres':
      return createPostgresStorage()
    default:
      return createMemoryStorage()
  }
}