import { json, badRequest, requireAdmin, notFound } from "../../_auth";

// Admin edit/cancel of an auction. Body fields (all optional):
//   status: "open" | "sold" | "cancelled"
//   current_bid: integer
//   current_bidder_id: user id
//   ends_at: ISO date
export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid JSON");

  const existing = await env.DB.prepare(`SELECT id FROM auctions WHERE id = ?`)
    .bind(params.id).first();
  if (!existing) return notFound();

  const fields = [];
  const values = [];
  if (body.status !== undefined) {
    if (!["open", "sold", "cancelled"].includes(body.status)) return badRequest("bad status");
    fields.push("status = ?"); values.push(body.status);
  }
  if (body.current_bid !== undefined) {
    const n = Number(body.current_bid);
    if (!Number.isInteger(n) || n < 1) return badRequest("bad current_bid");
    fields.push("current_bid = ?"); values.push(n);
  }
  if (body.current_bidder_id !== undefined) {
    fields.push("current_bidder_id = ?"); values.push(body.current_bidder_id);
  }
  if (body.ends_at !== undefined) {
    fields.push("ends_at = ?"); values.push(body.ends_at);
  }
  if (!fields.length) return badRequest("No editable fields supplied");

  await env.DB.prepare(
    `UPDATE auctions SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...values, params.id).run();

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireAdmin(request, env);
  if (!user) return response;

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM auction_bids WHERE auction_id = ?`).bind(params.id),
    env.DB.prepare(`DELETE FROM auctions WHERE id = ?`).bind(params.id),
  ]);
  return json({ ok: true });
}
