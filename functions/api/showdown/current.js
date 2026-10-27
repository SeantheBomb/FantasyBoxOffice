import { json, getSessionUser } from "../_auth.js";
import { getCurrentShowdown, getShowdownBoard, getAvailablePoints } from "../_showdown.js";
import { serializeShowdown } from "./_shape.js";

export async function onRequestGet({ request, env }) {
  const sd = await getCurrentShowdown(env.DB);
  if (!sd) return json({ showdown: null });

  const user = await getSessionUser(request, env);
  const board = await getShowdownBoard(env.DB, sd.weekend_date);
  const showdown = await serializeShowdown(env.DB, board, {
    closesAt: sd.closes_at,
    isOpen: sd.is_open,
    meId: user?.id,
  });

  let me = null;
  if (user) {
    const row = await env.DB.prepare(`SELECT in_league FROM users WHERE id = ?`).bind(user.id).first();
    me = { in_league: !!row?.in_league, ...(await getAvailablePoints(env.DB, user.id)) };
  }
  return json({ showdown, me });
}
