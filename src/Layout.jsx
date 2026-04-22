import { Link, NavLink } from "react-router-dom";
import { useUser } from "./useUser";

const linkStyle = ({ isActive }) => ({
  padding: "6px 10px",
  borderRadius: 6,
  textDecoration: "none",
  color: isActive ? "white" : "#2a2a2a",
  background: isActive ? "#2a2a2a" : "transparent",
  fontWeight: isActive ? 600 : 400,
});

export default function Layout({ children }) {
  const { user, loading } = useUser();
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#fafafa", color: "#111" }}>
      <header style={{ background: "white", borderBottom: "1px solid #eee", padding: "12px 24px", display: "flex", alignItems: "center", gap: 8 }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: 18, textDecoration: "none", color: "#111", marginRight: 16 }}>
          Fantasy Box Office
        </Link>
        {user && (
          <>
            <NavLink to="/standings" style={linkStyle}>Standings</NavLink>
            <NavLink to="/catalog" style={linkStyle}>Catalog</NavLink>
            <NavLink to="/auctions" style={linkStyle}>Auctions</NavLink>
            <NavLink to="/my-movies" style={linkStyle}>My Movies</NavLink>
            {user.is_admin && <NavLink to="/admin" style={linkStyle}>Admin</NavLink>}
          </>
        )}
        <div style={{ marginLeft: "auto", fontSize: 14 }}>
          {loading ? null : user ? (
            <>
              <span style={{ marginRight: 8 }}>
                <b>{user.username}</b> · {user.points_remaining} pts
              </span>
              <NavLink to="/me" style={linkStyle}>Account</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/login" style={linkStyle}>Login</NavLink>
              <NavLink to="/signup" style={linkStyle}>Signup</NavLink>
            </>
          )}
        </div>
      </header>
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>{children}</main>
    </div>
  );
}
