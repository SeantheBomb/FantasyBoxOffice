// Thin D1-compatible adapter over better-sqlite3.
// All methods return promises to match D1's async API.

export function createD1Shim(sqlite) {
  function makeBound(sql, args) {
    return {
      async all() {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...args);
        return { results, success: true, meta: { changes: 0 } };
      },
      async first(col) {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...args);
        if (!row) return null;
        if (col) return row[col] ?? null;
        return row;
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...args);
        return { success: true, meta: { changes: info.changes } };
      },
      _sql: sql,
      _args: args,
    };
  }

  return {
    prepare(sql) {
      return {
        bind(...args) {
          return makeBound(sql, args);
        },
        all() { return makeBound(sql, []).all(); },
        first(col) { return makeBound(sql, []).first(col); },
        run() { return makeBound(sql, []).run(); },
      };
    },
    async batch(stmts) {
      // Run inside a transaction, synchronously (matching D1 batch semantics)
      const results = [];
      sqlite.exec("BEGIN");
      try {
        for (const s of stmts) {
          if (s._sql) {
            const stmt = sqlite.prepare(s._sql);
            const info = stmt.run(...(s._args || []));
            results.push({ success: true, meta: { changes: info.changes } });
          } else if (typeof s.run === "function") {
            results.push(await s.run());
          }
        }
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
      return results;
    },
  };
}
