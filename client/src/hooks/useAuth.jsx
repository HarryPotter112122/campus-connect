import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    api.me()
      .then(({ user }) => {
        setUser(user);
        socket.connect();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const { user } = await api.login(email, password);
    setUser(user);
    socket.connect();
    return user;
  }, []);

  const register = useCallback(async (name, username, email, password) => {
    const { user } = await api.register(name, username, email, password);
    setUser(user);
    socket.connect();
    return user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    socket.disconnect();
    setUser(null);
  }, []);

  const updateUser = useCallback((updatedUser) => {
    setUser(prev => prev ? { ...prev, ...updatedUser } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
