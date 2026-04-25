import { useEffect, useState, useCallback } from "react";
import { apiMe } from "./api";
import { UserCtx } from "./userContext";

export function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    apiMe().then((r) => {
      if (cancelled) return;
      setUser(r.ok ? r.data.user : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [version]);

  return (
    <UserCtx.Provider value={{ user, loading, refresh }}>
      {children}
    </UserCtx.Provider>
  );
}
