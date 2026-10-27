import { getShowdownGrosses } from "../_showdown.js";

// Board → JSON for the web. Before settlement, grosses are the latest BOM
// snapshot (partial, flagged `live`) so the page can show the race.
export async function serializeShowdown(db, board, { closesAt, isOpen, meId }) {
  let grosses = board.result?.grosses ?? null;
  let live = false;
  if (!grosses && !isOpen) {
    const found = await getShowdownGrosses(db, board.weekend_date, board.movies);
    if (Object.keys(found.grosses).length) {
      grosses = found.grosses;
      live = true;
    }
  }

  const status = board.result ? board.result.status : isOpen ? "open" : "closed";
  return {
    weekend_date: board.weekend_date,
    closes_at: closesAt,
    is_open: isOpen,
    status,
    live,
    winner_tmdb_id: board.result?.winner_tmdb_id ?? null,
    movies: board.movies.map((m) => ({
      tmdb_id: m.tmdb_id,
      title: m.title,
      poster_url: m.poster_url,
      owner: m.owner,
      backers: m.backers,
      points: m.points,
      gross: grosses?.[m.tmdb_id] ?? null,
    })),
    bets: board.bets.map((b) => ({
      id: b.id,
      username: b.username,
      tmdb_id: b.tmdb_id,
      stake: b.stake,
      outcome: b.outcome,
      payout: b.payout,
      is_me: b.user_id === meId,
    })),
  };
}
