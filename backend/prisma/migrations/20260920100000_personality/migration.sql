-- Personality: who an agent IS and how it speaks.
--
-- Assigned to the AGENT, not the seat — the one deliberate exception to
-- seat-derived capability. Move Ebon to another desk and its clearance, skills
-- and MCP servers all change; its voice should not.
CREATE TABLE "Personality" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "summary"   TEXT NOT NULL DEFAULT '',
  "body"      TEXT NOT NULL,
  -- How to answer "are you an AI?". Its own column rather than prose in `body`
  -- because it needs a sane default and is the field that most shapes replies.
  "stance"    TEXT NOT NULL DEFAULT '',
  "enabled"   INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- SetNull, not Cascade: deleting a personality must never delete an agent.
ALTER TABLE "Agent" ADD COLUMN "personalityId" TEXT REFERENCES "Personality"("id") ON DELETE SET NULL;

CREATE INDEX "Agent_personalityId_idx" ON "Agent"("personalityId");
