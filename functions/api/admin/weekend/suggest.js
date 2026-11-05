import { json, requireAdmin } from "../../_auth.js";
import { nextFriday, ownedMoviesOpening } from "../../_lineup.js";

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  // If today is Friday, nextFriday returns next week's.
  const weekendDate = new URL(request.url).searchParams.get("weekend_date") || nextFriday();

  // Only suggest owned movies — unowned movies aren't in the admin catalog
  // and players only care about predicting movies someone actually drafted.
  const movies = await ownedMoviesOpening(env.DB, weekendDate);

  return json({ weekend_date: weekendDate, movies });
}
