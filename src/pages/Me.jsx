import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "../useUser";
import { apiUpdateMyProfile, apiChangeMyPassword } from "../api";

export default function Me() {
  const nav = useNavigate();
  const { user, loading, refresh } = useUser();

  useEffect(() => {
    if (!loading && !user) nav("/login");
  }, [loading, user, nav]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Not signed in. <Link to="/login">Log in</Link></div>;

  return (
    <div style={{ maxWidth: 560 }}>
      <h2>My Account</h2>
      <div style={{ lineHeight: 1.8, marginBottom: 24 }}>
        <div><b>Email:</b> {user.email}</div>
        <div><b>Username:</b> {user.username}</div>
        <div><b>Real name:</b> {user.real_name}</div>
        <div><b>Points remaining:</b> {user.points_remaining}</div>
        <div><b>Admin:</b> {user.is_admin ? "yes" : "no"}</div>
        <div><b>Created at:</b> {user.created_at}</div>
      </div>
      <UsernameForm current={user.username} onSaved={refresh} />
      <PasswordForm />
    </div>
  );
}

function UsernameForm({ current, onSaved }) {
  const [value, setValue] = useState(current);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const r = await apiUpdateMyProfile(value);
    setBusy(false);
    if (r.ok) {
      setStatus({ kind: "ok", msg: "Username updated." });
      onSaved?.();
    } else {
      setStatus({ kind: "err", msg: r.data?.error || "Failed to update" });
    }
  }

  return (
    <section style={card}>
      <h3>Change username</h3>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || value === current} type="submit">Save</button>
      </form>
      {status && (
        <div style={{ marginTop: 8, color: status.kind === "ok" ? "#1b8a3d" : "crimson" }}>
          {status.msg}
        </div>
      )}
    </section>
  );
}

function PasswordForm() {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [newPassword2, setNew2] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (newPassword !== newPassword2) {
      setStatus({ kind: "err", msg: "New passwords don't match" });
      return;
    }
    setBusy(true);
    const r = await apiChangeMyPassword(oldPassword, newPassword);
    setBusy(false);
    if (r.ok) {
      setStatus({ kind: "ok", msg: "Password changed." });
      setOld(""); setNew(""); setNew2("");
    } else {
      setStatus({ kind: "err", msg: r.data?.error || "Failed to change password" });
    }
  }

  return (
    <section style={card}>
      <h3>Change password</h3>
      <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
        <input type="password" placeholder="Current password" value={oldPassword} onChange={(e) => setOld(e.target.value)} />
        <input type="password" placeholder="New password (min 8 chars)" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        <input type="password" placeholder="Confirm new password" value={newPassword2} onChange={(e) => setNew2(e.target.value)} />
        <button disabled={busy || !oldPassword || !newPassword} type="submit">Save</button>
      </form>
      {status && (
        <div style={{ marginTop: 8, color: status.kind === "ok" ? "#1b8a3d" : "crimson" }}>
          {status.msg}
        </div>
      )}
    </section>
  );
}

const card = {
  background: "white",
  border: "1px solid #eee",
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};
