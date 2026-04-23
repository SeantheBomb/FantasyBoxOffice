// Parser for the legacy spreadsheet export used to seed an in-progress league.
//
// The TSV layout looks like:
//   - meta rows (info, url)
//   - "Players" header, then column-header row, then 1 row per player
//   - blank row
//   - "Movies" / "Points" mega-header, then the movies column-header row
//     listing player names under "Points" (5 cols), "Budget" (5), "Revenue" (5),
//     "Profit" (5), etc.
//   - movie rows: col 0 is blank or "X" (void), col 1 is title, col 2 is
//     release date (MM-dd format, year assumed current season), col 3 budget,
//     col 4 revenue, col 5 profit, then 5 point-bid cols per player.
//   - totals row at bottom (ignored).

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseMoney(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[$,\s]/g, "").replace(/[()]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseInteger(s) {
  if (!s) return null;
  const cleaned = String(s).replace(/[,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// "Jan 16", "March 27", "April 3", "Jun 05" → "2026-01-16" style ISO string.
export function parseReleaseDate(s, defaultYear) {
  if (!s) return null;
  const m = String(s).trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (!mon) return null;
  const day = Number(m[2]);
  const year = m[3] ? Number(m[3]) : defaultYear;
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Normalize titles for matching. Strips punctuation, quotes, collapses whitespace.
export function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/["“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseTsv(text, { defaultYear = 2026 } = {}) {
  const lines = text.split(/\r?\n/).map((l) => l.split("\t"));

  // Find "Players" section.
  let playersIdx = lines.findIndex((cols) => cols.some((c) => c.trim() === "Players"));
  if (playersIdx === -1) throw new Error("Could not find 'Players' section header");

  // Player header row (Name, Starting Points, Spent Points, Remaining Points, ...).
  let playerHeaderIdx = -1;
  for (let i = playersIdx + 1; i < lines.length; i++) {
    const row = lines[i];
    const text = row.map((c) => c.trim()).join("|").toLowerCase();
    if (text.includes("name") && text.includes("starting points") && text.includes("remaining")) {
      playerHeaderIdx = i;
      break;
    }
  }
  if (playerHeaderIdx === -1) throw new Error("Could not find player-column header");

  const playerHeader = lines[playerHeaderIdx].map((c) => c.trim().toLowerCase());
  const nameCol = playerHeader.indexOf("name");
  const startCol = playerHeader.indexOf("starting points");
  const spentCol = playerHeader.indexOf("spent points");
  const remainCol = playerHeader.indexOf("remaining points");

  const players = [];
  for (let i = playerHeaderIdx + 1; i < lines.length; i++) {
    const row = lines[i];
    const name = (row[nameCol] || "").trim();
    if (!name) break;
    const start = parseInteger(row[startCol]);
    const spent = parseInteger(row[spentCol]);
    const remain = parseInteger(row[remainCol]);
    if (start == null) break;
    players.push({ name, startingPoints: start, spentPoints: spent || 0, remainingPoints: remain ?? start });
  }

  // Find the movie column-header row. It has "Title" in one of the first 3 cols
  // and "Release" and "Budget" and "Revenue".
  let movieHeaderIdx = -1;
  for (let i = playerHeaderIdx + 1; i < lines.length; i++) {
    const row = lines[i].map((c) => c.trim().toLowerCase());
    if (row.includes("title") && row.includes("release") && row.includes("budget") && row.includes("revenue")) {
      movieHeaderIdx = i;
      break;
    }
  }
  if (movieHeaderIdx === -1) throw new Error("Could not find movie-column header");

  const movieHeader = lines[movieHeaderIdx].map((c) => c.trim());
  const movieHeaderLower = movieHeader.map((c) => c.toLowerCase());
  const titleCol = movieHeaderLower.indexOf("title");
  const releaseCol = movieHeaderLower.indexOf("release");
  const budgetCol = movieHeaderLower.indexOf("budget");
  const revenueCol = movieHeaderLower.indexOf("revenue");
  const profitCol = movieHeaderLower.indexOf("profit");

  // Points-per-player columns start at profitCol+1 and should equal the player
  // order. Map each player to a column index by matching the header text.
  const pointsStart = profitCol + 1;
  const playerNameToCol = {};
  for (const p of players) {
    const idx = movieHeaderLower.indexOf(p.name.toLowerCase(), pointsStart);
    if (idx === -1) throw new Error(`Could not find points column for player ${p.name}`);
    playerNameToCol[p.name] = idx;
  }

  const movies = [];
  for (let i = movieHeaderIdx + 1; i < lines.length; i++) {
    const row = lines[i];
    const title = (row[titleCol] || "").trim().replace(/^"(.*)"$/, "$1");
    if (!title) continue;
    if (title.toLowerCase().startsWith("total")) break;

    // 'X' in the col before the title = "out of theaters" (informational).
    const outOfTheaters = ((row[titleCol - 1] || "").trim().toUpperCase() === "X");
    const releaseDate = parseReleaseDate(row[releaseCol], defaultYear);
    const budget = parseMoney(row[budgetCol]);
    const revenue = parseMoney(row[revenueCol]);
    const profitStr = (row[profitCol] || "").trim();
    // Voided in the spreadsheet: profit cell is blank even though budget AND
    // revenue are populated. This marks movies the owner voided out of.
    const isVoid = !!(budget && revenue && !profitStr);

    const bids = [];
    for (const p of players) {
      const col = playerNameToCol[p.name];
      const cell = (row[col] || "").trim();
      const amount = parseInteger(cell);
      if (amount != null && amount > 0) bids.push({ player: p.name, amount });
    }

    movies.push({ title, releaseDate, budget, revenue, isVoid, outOfTheaters, bids });
  }

  return { players, movies };
}
