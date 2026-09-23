-- Which web tools an agent is OFFERED. Not a permission: clearance already
-- decides what is reachable, and mode can only ever remove from that.
--   'fetch'  -> fetch_url only (cheap, default)
--   'browse' -> the browser only (JS sites, watchable, stays logged in)
--   'both'   -> the model chooses
ALTER TABLE "Agent" ADD COLUMN "webMode" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "webMode" TEXT NOT NULL DEFAULT 'fetch';
