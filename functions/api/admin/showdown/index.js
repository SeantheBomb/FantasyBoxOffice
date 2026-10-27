import { json, badRequest, requireAdmin } from "../../_auth.js";
import { getShowdownBoard, getShowdownGrosses } from "../../_showdown.js";

// GET ?weekend_date=YYYY-MM-DD — bets, result, and the BOM grosses a
// settlement would use (prefill for a manual settle).
export async function onRequestGet({ request, env }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const weekendDate = new URL(request.url).searchParams.get("weekend_date");
  if (!weekendDate) return badRequest("weekend_date required");

  const board = await getShowdownBoard(env.DB, weekendDate);
  const bom = await getShowdownGrosses(env.DB, weekendDate, board.movies);
  return json({ ...board, bom_grosses: bom.grosses });
}
