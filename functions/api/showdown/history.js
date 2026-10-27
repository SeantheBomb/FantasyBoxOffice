import { json, getSessionUser } from "../_auth.js";
import { getCurrentShowdown, getShowdownBoard } from "../_showdown.js";
import { getBettingWindow } from "../_betting.js";
import { bootstrapSchema } from "../_schema.js";
import { serializeShowdown } from "./_shape.js";

export async function onRequestGet({ request, env }) {
  await bootstrapSchema(env.DB);
  const [current, user] = await Promise.all([getCurrentShowdown(env.DB), getSessionUser(request, env)]);
  const { results } = await env.DB.prepare(
    `SELECT weekend_date FROM showdown_results WHERE weekend_date != ? ORDER BY weekend_date DESC LIMIT 20`
  ).bind(current?.weekend_date ?? "").all();

  const showdowns = [];
  for (const { weekend_date } of results) {
    const board = await getShowdownBoard(env.DB, weekend_date);
    const { closes_at } = await getBettingWindow(env.DB, weekend_date);
    showdowns.push(await serializeShowdown(env.DB, board, { closesAt: closes_at, isOpen: false, meId: user?.id }));
  }
  return json({ showdowns });
}
