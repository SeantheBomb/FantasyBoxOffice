import { Link, NavLink } from "react-router-dom";
import { useUser } from "./useUser";
import "./theater.css";

const linkStyle = ({ isActive }) => ({
  padding: "6px 12px",
  borderRadius: 4,
  textDecoration: "none",
  color: isActive ? "#1a0000" : "#f5d27a",
  background: isActive ? "#f5d27a" : "transparent",
  fontWeight: isActive ? 700 : 500,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  fontSize: 13,
});

export default function Layout({ children }) {
  const { user, loading } = useUser();
  return (
    <div className="fbo-app">
      <header className="fbo-header">
        <Link to="/" className="fbo-brand">
          <span className="fbo-brand-icon" aria-hidden="true">🎬</span>
          <span className="fbo-brand-text">
            <span className="fbo-brand-line1">Fantasy</span>
            <span className="fbo-brand-line2">Box Office</span>
          </span>
        </Link>
        <nav className="fbo-nav">
          {user && (
            <>
              <NavLink to="/standings" style={linkStyle}>Standings</NavLink>
              <NavLink to="/catalog" style={linkStyle}>Catalog</NavLink>
              <NavLink to="/auctions" style={linkStyle}>Auctions</NavLink>
              <NavLink to="/my-movies" style={linkStyle}>My Movies</NavLink>
              {user.is_admin && <NavLink to="/admin" style={linkStyle}>Admin</NavLink>}
            </>
          )}
        </nav>
        <div className="fbo-usermenu">
          {loading ? null : user ? (
            <>
              <span className="fbo-userbadge">
                <b>{user.username}</b>
                <span className="fbo-ticket">🎟 {user.points_remaining} pts</span>
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
      <main className="fbo-main">{children}</main>
      <footer className="fbo-footer">
        <span>🎭 Fantasy Box Office · 2026 Season</span>
      </footer>
    </div>
  );
}
