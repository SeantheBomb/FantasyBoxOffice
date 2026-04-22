import { Link } from "react-router-dom";
import { useUser } from "../useUser";

export default function Home() {
  const { user, loading } = useUser();
  if (loading) return <div>Loading...</div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 640 }}>
        <h1>Fantasy Box Office 2026</h1>
        <p>
          Own the most profitable collection of 2026 theatrical releases. Auction on movies,
          track domestic box office, compete for the top spot on the leaderboard.
        </p>
        <p>
          <Link to="/signup">Sign up</Link> or <Link to="/login">log in</Link> to play.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome back, {user.username}.</h1>
      <p>You have <b>{user.points_remaining}</b> points remaining.</p>
      <ul>
        <li><Link to="/standings">See standings</Link></li>
        <li><Link to="/auctions">Browse auctions</Link></li>
        <li><Link to="/my-movies">Review your movies</Link></li>
      </ul>
    </div>
  );
}
