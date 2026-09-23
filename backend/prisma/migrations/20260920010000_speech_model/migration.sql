-- Per-agent and global SPEECH model, for the `generate_speech` tool.
--
-- A third cascade beside `model` and `imageModel`, separate for the same reason
-- those two are separate: they answer different questions. `model` is what an
-- agent REASONS with (and must support tool calling), `imageModel` is what it
-- DRAWS with, and this is what it SPEAKS with. A model that does one of the
-- three is rarely good at — or even capable of — the others, so one column
-- serving several would make every speech model an illegal reasoning model.
--
-- Both nullable/defaulted, so every existing row keeps working and falls through
-- to the AI service's env default.
ALTER TABLE "Agent" ADD COLUMN "speechModel" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "speechModel" TEXT NOT NULL DEFAULT '';
