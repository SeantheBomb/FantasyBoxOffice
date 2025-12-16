import { useEffect, useState } from "react";
import { apiMe } from "../api";
import { Link, useNavigate } from "react-router-dom";

export default function Me() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setErr("");
    setLoading(true);
    const r = await apiMe();
    setLoading(false);

    if (!r.ok) {
      setUser(null);
      // If not signed in, send them to login
      nav("/login");
      return;
    }
    setUser(r.data.user);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ maxWidth: 520 }}>
      <h2>My Account</h2>

      {err && <div style={{ color: "crimson" }}>{err}</div>}

      {!user ? (
        <div>
          Not signed in. <Link to="/login">Log in</Link>
        </div>
      ) : (
        <div style={{ lineHeight: 1.8 }}>
          <div><b>Email:</b> {user.email}</div>
          <div><b>Username:</b> {user.username}</div>
          <div><b>Real name:</b> {user.real_name}</div>
          <div><b>Created at:</b> {user.created_at}</div>
        </div>
      )}
    </div>
  );
}
