-- Per-agent and global IMAGE model, for the `generate_image` tool.
--
-- Deliberately separate columns from `Agent.model` / `AppSettings.defaultModel`:
-- those are what an agent REASONS with and must support tool calling, while
-- these are what it DRAWS with and usually cannot call tools at all. One column
-- serving both would make every image model an illegal reasoning model.
--
-- Both nullable/defaulted, so every existing row keeps working and falls through
-- to the AI service's env default.
ALTER TABLE "Agent" ADD COLUMN "imageModel" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "imageModel" TEXT NOT NULL DEFAULT '';
