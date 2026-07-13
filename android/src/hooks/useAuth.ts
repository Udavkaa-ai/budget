import { useState, useEffect, useCallback } from 'react';
import { initApi, isAuthenticated, clearAuth, parseJwt, getToken, type AuthUser } from '../api/client';

// Глобальное состояние: экраны и Root должны видеть одного и того же
// пользователя (logout из настроек обязан переключить корневой экран)
let _user: AuthUser | null = null;
let _loading = true;
const listeners = new Set<() => void>();

function notify() { listeners.forEach(l => l()); }

const initPromise = initApi().then(() => {
  if (isAuthenticated()) _user = parseJwt(getToken());
  _loading = false;
  notify();
});

export function useAuth() {
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    initPromise.then(l);
    return () => { listeners.delete(l); };
  }, []);

  const logout = useCallback(async () => {
    await clearAuth();
    _user = null;
    notify();
  }, []);

  const onLoginSuccess = useCallback((token: string) => {
    _user = parseJwt(token);
    notify();
  }, []);

  return { user: _user, loading: _loading, logout, onLoginSuccess };
}
