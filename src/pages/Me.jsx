import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUser } from "../useUser";

export default function Me() {
  const nav = useNavigate();
  const { user, loading } = useUser();

  useEffect(() => {
    if (!loading && !user) nav("/login");
  }, [loading, user, nav]);

  if (loading) return <div>Loading...</div>;
  if (!user) return <div>Not signed in. <Link to="/login">Log in</Link></div>;

  return (
    <div style={{ maxWidth: 520 }}>
      <h2>My Account</h2>
      <div style={{ lineHeight: 1.8 }}>
        <div><b>Email:</b> {user.email}</div>
        <div><b>Username:</b> {user.username}</div>
        <div><b>Real name:</b> {user.real_name}</div>
        <div><b>Points remaining:</b> {user.points_remaining}</div>
        <div><b>Admin:</b> {user.is_admin ? "yes" : "no"}</div>
        <div><b>Created at:</b> {user.created_at}</div>
      </div>
    </div>
  );
}
