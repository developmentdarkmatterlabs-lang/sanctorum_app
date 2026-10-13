-- An agent's own step limit; replaces the global setting. NULL = inherit.
ALTER TABLE "Agent" ADD COLUMN "maxSteps" INTEGER;
