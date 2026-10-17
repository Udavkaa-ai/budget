import { useState, useEffect, useCallback } from 'react';
import { initApi, isAuthenticated, clearAuth, parseJwt, getToken, type AuthUser } from '../api/client';
import { isLocal, localMe, enterLocal, leaveLocal } from '../local/mode';

const localUser = (): AuthUser => ({ name: localMe(), login: 'local', family: 'local', isAdmin: false });

// Глобальное состояние: экраны и Root должны видеть одного и того же
// пользователя (logout из настроек обязан переключить корневой экран)
let _user: AuthUser | null = null;
let _loading = true;
const listeners = new Set<() => void>();

function notify() { listeners.forEach(l => l()); }

const initPromise = initApi().then(() => {
  if (isLocal()) _user = localUser();
  else if (isAuthenticated()) _user = parseJwt(getToken());
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

  // Выход: данные на телефоне остаются (локальная база не стирается)
  const logout = useCallback(async () => {
    await clearAuth();
    await leaveLocal();
    _user = null;
    notify();
  }, []);

  const onLoginSuccess = useCallback((token: string) => {
    _user = parseJwt(token);
    notify();
  }, []);

  return { user: _user, loading: _loading, logout, onLoginSuccess };
}

// Перейти на работу без сервера под именем name (данные — на телефоне)
export async function loginLocal(name: string) {
  await enterLocal(name);
  _user = localUser();
  notify();
}
