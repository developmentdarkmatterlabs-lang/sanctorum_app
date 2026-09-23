-- Model selection: a per-agent LLM override and a global default. Both are
-- simple additive columns (nullable / defaulted), so a plain ADD COLUMN works —
-- no table rebuild needed.

ALTER TABLE "Agent" ADD COLUMN "model" TEXT;

ALTER TABLE "AppSettings" ADD COLUMN "defaultModel" TEXT NOT NULL DEFAULT '';
