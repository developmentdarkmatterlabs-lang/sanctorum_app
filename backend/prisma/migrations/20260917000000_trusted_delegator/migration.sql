-- Phase 4 — trusted delegator.
--
-- A leader with this set does not pause for approval on `delegate` calls; every
-- other consequential tool still obeys `Agent.supervised`. Kept separate from
-- `supervised` on purpose: otherwise the only way to stop approving every
-- fan-out would be to make the leader unattended for file writes and shell too.
--
-- Defaults to false, so existing agents are unchanged — delegation keeps pausing
-- until you deliberately trust a specific leader.
ALTER TABLE "Agent" ADD COLUMN "trustedDelegator" BOOLEAN NOT NULL DEFAULT false;
