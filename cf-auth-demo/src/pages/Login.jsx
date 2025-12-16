import { useState } from "react";
import { apiLogin } from "../api";
import { useNavigate, Link } from "react-router-dom";

export default function Login() {
  const nav = useNavigate();
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const r = await apiLogin({ emailOrUsername, password });
    setBusy(false);

    if (!r.ok) return setErr(r.data?.error || `Login failed (${r.status})`);
    nav("/me");
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>Log in</h2>
      <form onSubmit={onSubmit}>
        <label>Email or Username<br />
          <input value={emailOrUsername} onChange={(e) => setEmailOrUsername(e.target.value)} style={{ width: "100%" }} />
        </label><br /><br />
        <label>Password<br />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </label><br /><br />

        {err && <div style={{ color: "crimson", marginBottom: 10 }}>{err}</div>}
        <button disabled={busy} type="submit">{busy ? "Signing in..." : "Sign in"}</button>
      </form>

      <p style={{ marginTop: 16 }}>
        Need an account? <Link to="/signup">Sign up</Link>
      </p>
    </div>
  );
}
