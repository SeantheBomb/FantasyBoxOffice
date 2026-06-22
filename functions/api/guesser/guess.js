import { json, badRequest } from "../_auth.js";
import { getOrCreateDailyMovie, compareMovies } from "../_guesser.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body?.tmdb_id) return badRequest("tmdb_id required");

  const today = new Date().toISOString().slice(0, 10);
  const token = env.TMDB_TOKEN;

  const answer = await getOrCreateDailyMovie(env.DB, token, today);
  if (!answer) return json({ error: "No puzzle today" }, { status: 404 });

  const guessedId = Number(body.tmdb_id);
  if (guessedId === answer.tmdb_id) {
    return json({
      correct: true,
      title: answer.title,
      poster_url: answer.poster_url,
      release_date: answer.release_date,
      revenue: answer.revenue,
      genres: JSON.parse(answer.genres),
    });
  }

  // Wrong guess — compare and return hints
  try {
    const hints = await compareMovies(answer, guessedId, token);
    return json({ correct: false, ...hints });
  } catch {
    return json({ error: "Could not fetch movie details" }, { status: 500 });
  }
}
