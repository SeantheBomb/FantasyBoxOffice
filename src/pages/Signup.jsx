import { useState } from "react";
import { apiSignup } from "../api";
import { useNavigate, Link } from "react-router-dom";

export default function Signup() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [realName, setRealName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const r = await apiSignup({ email, username, realName, password });
    setBusy(false);

    if (!r.ok) return setErr(r.data?.error || `Signup failed (${r.status})`);
    nav("/me");
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>Sign up</h2>
      <form onSubmit={onSubmit}>
        <label>Email<br />
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
        </label><br /><br />
        <label>Username<br />
          <input value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: "100%" }} />
        </label><br /><br />
        <label>Real name<br />
          <input value={realName} onChange={(e) => setRealName(e.target.value)} style={{ width: "100%" }} />
        </label><br /><br />
        <label>Password<br />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: "100%" }} />
        </label><br /><br />

        {err && <div style={{ color: "crimson", marginBottom: 10 }}>{err}</div>}
        <button disabled={busy} type="submit">{busy ? "Creating..." : "Create account"}</button>
      </form>

      <p style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
