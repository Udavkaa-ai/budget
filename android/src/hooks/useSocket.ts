import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { getServerUrl, getToken } from '../api/client';

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

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, [onEvent]);

  return socketRef;
}
