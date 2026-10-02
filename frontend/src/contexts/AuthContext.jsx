import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);
const ACCESS_KEY = 'aeronet.accessToken';
const REFRESH_KEY = 'aeronet.refreshToken';
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la solicitud.');
  return body;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const acceptSession = useCallback((session) => {
    if (session.accessToken) localStorage.setItem(ACCESS_KEY, session.accessToken);
    if (session.refreshToken) localStorage.setItem(REFRESH_KEY, session.refreshToken);
    setUser(session.user || null);
    setRoles(session.roles || []);
    setPermissions(session.permissions || []);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setUser(null);
    setRoles([]);
    setPermissions([]);
  }, []);

  const request = useCallback(async (path, options = {}) => {
    const send = (token) => fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    let response = await send(localStorage.getItem(ACCESS_KEY));
    if (response.status === 401) {
      const refreshToken = localStorage.getItem(REFRESH_KEY);
      if (refreshToken) {
        const refreshResponse = await fetch(`${apiUrl}/auth/refresh`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshResponse.ok) {
          const session = await refreshResponse.json();
          acceptSession(session);
          response = await send(session.accessToken);
        } else {
          clearSession();
        }
      }
    }
    return readResponse(response);
  }, [acceptSession, clearSession]);

  const login = useCallback(async (email, password) => {
    const response = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const session = await readResponse(response);
    acceptSession(session);
    return session;
  }, [acceptSession]);

  const register = useCallback(async ({ email, password, firstName, lastName, phone }) => {
    const response = await fetch(`${apiUrl}/auth/register`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName, phone }),
    });
    const session = await readResponse(response);
    if (session.accessToken) acceptSession(session);
    return session;
  }, [acceptSession]);

  const logout = useCallback(async () => {
    try {
      if (localStorage.getItem(ACCESS_KEY)) await request('/auth/logout', { method: 'POST' });
    } finally {
      clearSession();
    }
  }, [clearSession, request]);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      try {
        let token = localStorage.getItem(ACCESS_KEY);
        if (!token) return;
        let response = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 401) {
          const refreshToken = localStorage.getItem(REFRESH_KEY);
          if (!refreshToken) throw new Error('Sesión vencida');
          const refreshResponse = await fetch(`${apiUrl}/auth/refresh`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
          const refreshed = await readResponse(refreshResponse);
          if (cancelled) return;
          acceptSession(refreshed);
          token = refreshed.accessToken;
          response = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        }
        const session = await readResponse(response);
        if (!cancelled) acceptSession(session);
      } catch {
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    restoreSession();
    return () => { cancelled = true; };
  }, [acceptSession, clearSession]);

  const value = useMemo(() => ({
    user,
    roles,
    permissions,
    loading,
    isAuthenticated: Boolean(user),
    login,
    register,
    logout,
    request,
    hasRole: (roleName) => roles.some((role) => role.name === roleName),
    hasPermission: (permission) => permissions.includes(permission),
  }), [user, roles, permissions, loading, login, register, logout, request]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
