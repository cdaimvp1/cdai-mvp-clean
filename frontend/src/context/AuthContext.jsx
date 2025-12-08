import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext({
  status: "loading",
  user: null,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const error = new Error("request_failed");
    error.status = response.status;
    error.body = await response.json().catch(() => ({}));
    throw error;
  }
  return response.json();
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);

  const checkStatus = useCallback(async () => {
    try {
      const data = await fetchJson("/api/auth/status", { method: "GET", headers: { "Content-Type": "application/json" } });
      setUser(data.user || null);
      setStatus("authenticated");
    } catch (error) {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const login = useCallback(
    async ({ username, password }) => {
      await fetchJson("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await checkStatus();
    },
    [checkStatus]
  );

  const logout = useCallback(async () => {
    try {
      await fetchJson("/api/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      login,
      logout,
      refresh: checkStatus,
    }),
    [status, user, login, logout, checkStatus]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
