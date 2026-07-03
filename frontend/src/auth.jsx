import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  function onAuthed({ user }) {
    setUser(user);
  }

  function logout() {
    setUser(null);
    api.logout().catch(() => {});
  }
  
  function updateUser(next) {
    setUser((prev) => ({ ...prev, ...next }));
  }

  return (
    <AuthContext.Provider value={{ user, loading, onAuthed, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
