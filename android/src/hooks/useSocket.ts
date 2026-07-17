import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { getServerUrl, getToken } from '../api/client';
import { isE2E } from '../e2e';
import { syncNow } from '../e2e/sync';

type SocketEvent = 'expense:added' | 'expense:updated' | 'expense:deleted';

export function useSocket(onEvent: (event: SocketEvent, data: unknown) => void) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const url = getServerUrl();
    if (!url) return;

    const socket = io(url, {
      auth: { token: getToken() },
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });

    const events: SocketEvent[] = ['expense:added', 'expense:updated', 'expense:deleted'];
    events.forEach(ev => socket.on(ev, (data: unknown) => onEvent(ev, data)));
    // E2E: чужое устройство внесло изменения — подтягиваем шифроблобы, затем обновляем экран
    socket.on('sync:changed', () => {
      if (isE2E()) syncNow().then(() => onEvent('expense:added', {})).catch(() => {});
    });

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [onEvent]);

  return socketRef;
}
