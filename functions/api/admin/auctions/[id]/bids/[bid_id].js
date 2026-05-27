import { json, requireAdmin, notFound } from "../../../../_auth";

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const bid = await env.DB.prepare(
    `SELECT id FROM auction_bids WHERE id = ? AND auction_id = ? LIMIT 1`
  ).bind(params.bid_id, params.id).first();
  if (!bid) return notFound();

  await env.DB.prepare(`DELETE FROM auction_bids WHERE id = ?`).bind(params.bid_id).run();
  return json({ ok: true });
}
