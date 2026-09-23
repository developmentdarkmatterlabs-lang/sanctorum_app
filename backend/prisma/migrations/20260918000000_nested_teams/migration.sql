-- Nested teams — the org becomes a TREE.
--
-- A team may report into another. That single link is what lets delegation cross
-- a team boundary at all: a leader may delegate to the LEADER of a team whose
-- parent is its own — downward, one level, never up and never sideways.
--
-- Nullable and additive: every existing team gets NULL (top level) and behaves
-- exactly as before, so nothing in Phases 1-4 changes until a parent is set.
--
-- No FK constraint is added here. SQLite cannot ADD a column with a REFERENCES
-- clause without rebuilding the table, and Prisma's relation is declarative
-- anyway; `onDelete: SetNull` is enforced by the client. The cycle guard that
-- actually matters (a team becoming its own ancestor) lives in teamService,
-- because a FK cannot express it.
ALTER TABLE "Team" ADD COLUMN "parentTeamId" TEXT;

-- CreateIndex
CREATE INDEX "Team_parentTeamId_idx" ON "Team"("parentTeamId");
