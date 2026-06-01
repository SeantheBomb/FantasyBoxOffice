async function readJson(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, data, raw: text };
}

function jsonFetch(path, { method = "GET", body } = {}) {
  return fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  }).then(readJson);
}

export const apiSignup = ({ email, username, realName, password }) =>
  jsonFetch("/api/signup", { method: "POST", body: { email, username, realName, password } });

export const apiLogin = ({ emailOrUsername, password }) =>
  jsonFetch("/api/login", { method: "POST", body: { emailOrUsername, password } });

export const apiMe = () => jsonFetch("/api/me");

// Game
export const apiGameStandings = () => jsonFetch("/api/game/standings");
export const apiGameHistory = () => jsonFetch("/api/game/history");
export const apiGameCatalog = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return jsonFetch("/api/game/catalog" + (q ? "?" + q : ""));
};
export const apiGameMe = () => jsonFetch("/api/game/me");

// Movies
export const apiMovie = (tmdbId) => jsonFetch(`/api/movies/${tmdbId}`);
export const apiVoidMovie = (tmdbId) => jsonFetch(`/api/movies/${tmdbId}/void`, { method: "POST", body: {} });

// Auctions
export const apiAuctions = (status = "open") =>
  jsonFetch("/api/auctions?status=" + encodeURIComponent(status));
export const apiAuction = (id) => jsonFetch(`/api/auctions/${id}`);
export const apiCreateAuction = ({ tmdbId, startingBid }) =>
  jsonFetch("/api/auctions", { method: "POST", body: { tmdbId, startingBid } });
export const apiBid = (id, amount) =>
  jsonFetch(`/api/auctions/${id}/bid`, { method: "POST", body: { amount } });
export const apiSettleAuction = (id) =>
  jsonFetch(`/api/auctions/${id}/settle`, { method: "POST", body: {} });
export const apiPassAuction = (id) =>
  jsonFetch(`/api/auctions/${id}/pass`, { method: "POST", body: {} });

// TMDB releases (already public)
export const apiReleases = (params = {}) => {
  const q = new URLSearchParams({ from: "2026-01-01", to: "2026-12-31", minPopularity: "5", ...params }).toString();
  return jsonFetch("/api/releases?" + q);
};

// Admin
export const apiAdminUsers = () => jsonFetch("/api/admin/users");
export const apiAdminGrantPoints = (userId, delta) =>
  jsonFetch(`/api/admin/users/${userId}/points`, { method: "POST", body: { delta } });
export const apiAdminSetAdmin = (userId, isAdmin) =>
  jsonFetch(`/api/admin/users/${userId}/admin`, { method: "POST", body: { is_admin: isAdmin } });
export const apiAdminEditAuction = (id, patch) =>
  jsonFetch(`/api/admin/auctions/${id}`, { method: "POST", body: patch });
export const apiAdminDeleteAuction = (id) =>
  jsonFetch(`/api/admin/auctions/${id}`, { method: "DELETE" });
export const apiAdminAuditAuction = (id) =>
  jsonFetch(`/api/admin/auctions/${id}`);
export const apiAdminDeleteBid = (auctionId, bidId) =>
  jsonFetch(`/api/admin/auctions/${auctionId}/bids/${bidId}`, { method: "DELETE" });
export const apiAdminRefreshMovies = (body = {}) =>
  jsonFetch("/api/admin/movies/refresh", { method: "POST", body });
export const apiAdminAddMovie = (tmdbId) =>
  jsonFetch("/api/admin/movies/add", { method: "POST", body: { tmdb_id: tmdbId } });
export const apiAdminRecordAuction = ({ tmdbId, winnerUserId, purchasePrice }) =>
  jsonFetch("/api/admin/auction-results", {
    method: "POST",
    body: { tmdb_id: tmdbId, winner_user_id: winnerUserId, purchase_price: purchasePrice },
  });
export const apiAdminRevokeMovie = (tmdbId) =>
  jsonFetch(`/api/admin/owned-movies/${tmdbId}`, { method: "DELETE" });
export const apiAdminVoidMovie = (tmdbId) =>
  jsonFetch(`/api/admin/movies/${tmdbId}/void`, { method: "POST", body: {} });
export const apiAdminSetBudget = (tmdbId, budget) =>
  jsonFetch(`/api/admin/movies/${tmdbId}/budget`, { method: "POST", body: { budget } });
export const apiAdminRefreshDailies = () =>
  jsonFetch("/api/admin/dailies/refresh", { method: "POST", body: {} });
export const apiAdminBackfillDailies = () =>
  jsonFetch("/api/admin/dailies/backfill", { method: "POST", body: {} });
export const apiAdminAddDaily = ({ tmdbId, date, domesticRevenue }) =>
  jsonFetch("/api/admin/dailies", {
    method: "POST",
    body: { tmdb_id: tmdbId, date, domestic_revenue: domesticRevenue },
  });
export const apiAdminBackfillBudgets = (body = {}) =>
  jsonFetch("/api/admin/movies/backfill-budgets", { method: "POST", body });
export const apiAdminImportTsv = (tsv) =>
  jsonFetch("/api/admin/import/tsv", { method: "POST", body: { tsv } });
export const apiAdminPostStandingsToDiscord = () =>
  jsonFetch("/api/admin/discord/test-post", { method: "POST", body: {} });
export const apiAdminUpdateProfile = (userId, patch) =>
  jsonFetch(`/api/admin/users/${userId}/profile`, { method: "POST", body: patch });
export const apiAdminResetPassword = (userId) =>
  jsonFetch(`/api/admin/users/${userId}/reset-password`, { method: "POST", body: {} });
export const apiAdminSetInLeague = (userId, inLeague) =>
  jsonFetch(`/api/admin/users/${userId}/league`, { method: "POST", body: { in_league: inLeague } });

// Weekend predictions
export const apiAdminWeekendScore = (weekendDate) =>
  jsonFetch("/api/admin/weekend/score" + (weekendDate ? `?weekend_date=${weekendDate}` : ""));
export const apiAdminScoreMovie = (weekendDate, tmdbId, actualGross, notify = true, correction = false) =>
  jsonFetch("/api/admin/weekend/score", {
    method: "POST",
    body: { weekend_date: weekendDate, tmdb_id: tmdbId, actual_gross: actualGross, notify, correction },
  });
export const apiAdminWeekendMovies = (weekendDate) =>
  jsonFetch("/api/admin/weekend/movies" + (weekendDate ? `?weekend_date=${weekendDate}` : ""));
export const apiAdminSuggestLineup = (weekendDate) =>
  jsonFetch("/api/admin/weekend/suggest" + (weekendDate ? `?weekend_date=${weekendDate}` : ""));
export const apiAdminSetWeekendMovies = (weekendDate, tmdbIds) =>
  jsonFetch("/api/admin/weekend/movies", {
    method: "POST",
    body: { weekend_date: weekendDate, tmdb_ids: tmdbIds },
  });
export const apiAdminPostWeekendAnnouncement = () =>
  jsonFetch("/api/admin/weekend/announce", { method: "POST", body: {} });
export const apiAdminPostLastCall = () =>
  jsonFetch("/api/admin/weekend/last-call", { method: "POST", body: {} });
export const apiAdminUpdatePick = (id, estimate) =>
  jsonFetch("/api/admin/weekend/picks", { method: "PATCH", body: { id, estimate } });
export const apiAdminDeletePick = (id) =>
  jsonFetch("/api/admin/weekend/picks", { method: "DELETE", body: { id } });
export const apiAdminCreatePick = (pick) =>
  jsonFetch("/api/admin/weekend/picks", { method: "POST", body: pick });

// Betting / weekend predictions (public)
export const apiBettingCurrent = () => jsonFetch("/api/betting/current");
export const apiBettingHistory = () => jsonFetch("/api/betting/history");
export const apiBet = (tmdbId, estimate) =>
  jsonFetch("/api/betting", { method: "POST", body: { tmdb_id: tmdbId, estimate } });

// Self-service
export const apiUpdateMyProfile = (username) =>
  jsonFetch("/api/me/profile", { method: "POST", body: { username } });
export const apiChangeMyPassword = (oldPassword, newPassword) =>
  jsonFetch("/api/me/password", { method: "POST", body: { oldPassword, newPassword } });
export const apiLinkDiscord = (discordUserId) =>
  jsonFetch("/api/me/discord", { method: "POST", body: { discord_user_id: discordUserId } });
