/**
 * useRunTrace — subscribe to a nodegraph run's Socket.IO trace stream.
 *
 * Connects to nodegraph's Socket.IO server (VITE_NODEGRAPH_WS_URL, default
 * http://localhost:3001), joins the per-run room `run:{engineRunId}`, and
 * streams `run_trace` events to the caller.
 *
 * Returns:
 *   phase       — last EXEC_STATUS.phase ("queued" | "running" | "done" | ...)
 *   nodesDone   — count of NODE_DONE events received
 *   nodesTotal  — count of NODE_PENDING events (planned node set)
 *   finished    — true when EXEC_DONE or EXEC_ERROR has arrived
 *   failed      — true when EXEC_ERROR arrived
 *
 * The hook disconnects automatically when engineRunId becomes null or the
 * component unmounts.
 */
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const NODEGRAPH_URL =
  (import.meta.env.VITE_NODEGRAPH_WS_URL as string | undefined) ?? 'http://localhost:3001';

export interface RunTraceState {
  phase: string;
  nodesDone: number;
  nodesTotal: number;
  finished: boolean;
  failed: boolean;
}

const IDLE: RunTraceState = {
  phase: '',
  nodesDone: 0,
  nodesTotal: 0,
  finished: false,
  failed: false,
};

export function useRunTrace(engineRunId: string | null): RunTraceState {
  const [state, setState] = useState<RunTraceState>(IDLE);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!engineRunId) {
      setState(IDLE);
      return;
    }

    setState(IDLE);

    const socket = io(NODEGRAPH_URL, {
      transports: ['websocket', 'polling'],
      reconnection: false,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe_run', { runId: engineRunId });
    });

    socket.on('run_trace', (event: Record<string, unknown>) => {
      const type = event.type as string;

      if (type === 'EXEC_STATUS') {
        const phase = (event.phase as string) ?? '';
        setState((prev) => ({ ...prev, phase }));
      } else if (type === 'NODE_PENDING') {
        setState((prev) => ({ ...prev, nodesTotal: prev.nodesTotal + 1 }));
      } else if (type === 'NODE_DONE') {
        setState((prev) => ({ ...prev, nodesDone: prev.nodesDone + 1 }));
      } else if (type === 'EXEC_DONE') {
        setState((prev) => ({ ...prev, finished: true, failed: false, phase: 'done' }));
      } else if (type === 'EXEC_ERROR') {
        setState((prev) => ({ ...prev, finished: true, failed: true, phase: 'error' }));
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [engineRunId]);

  return state;
}
