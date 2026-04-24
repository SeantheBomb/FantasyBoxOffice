// Self-healing schema bootstrap. Pages Functions and the worker call this
// before any query that depends on a recent schema change. The ALTER is
// idempotent: SQLite errors with "duplicate column" if the column already
// exists, which we swallow.
//
// The module-level flag ensures we only attempt the ALTER once per isolate.
// On cold start the ALTER runs again and errors harmlessly.

let bootstrapped = false;

export async function bootstrapSchema(db) {
  if (bootstrapped) return;
  await db.prepare(
    `ALTER TABLE users ADD COLUMN in_league INTEGER NOT NULL DEFAULT 1`
  ).run().catch(() => {}); // duplicate column = already applied
  bootstrapped = true;
}
