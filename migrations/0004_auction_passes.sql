-- Tracks users who've explicitly opted out of an open auction. When every
-- eligible user except the current bidder has a pass row, the auction settles
-- immediately (see functions/api/_settlement.js#settleIfAllPassed).
CREATE TABLE IF NOT EXISTS auction_passes (
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  passed_at  TEXT NOT NULL,
  PRIMARY KEY (auction_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_auction_passes_user ON auction_passes(user_id);
