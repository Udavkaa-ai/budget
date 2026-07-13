import { useState, useEffect, useCallback } from 'react';
import { initApi, isAuthenticated, clearAuth, parseJwt, getToken, type AuthUser } from '../api/client';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initApi().then(() => {
      if (isAuthenticated()) {
        const decoded = parseJwt(getToken());
        setUser(decoded);
      }
      setLoading(false);
    });
  }, []);

  const logout = useCallback(async () => {
    await clearAuth();
    setUser(null);
  }, []);

  const onLoginSuccess = useCallback((token: string) => {
    const decoded = parseJwt(token);
    setUser(decoded);
  }, []);

  return { user, loading, logout, onLoginSuccess };
}
