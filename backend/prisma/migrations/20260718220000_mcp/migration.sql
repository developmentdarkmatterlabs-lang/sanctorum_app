-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "transport" TEXT NOT NULL DEFAULT 'http',
    "url" TEXT NOT NULL DEFAULT '',
    "authToken" TEXT NOT NULL DEFAULT '',
    "headers" TEXT NOT NULL DEFAULT '',
    "command" TEXT NOT NULL DEFAULT '',
    "args" TEXT NOT NULL DEFAULT '',
    "minClearance" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PositionMcp" (
    "positionId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,

    PRIMARY KEY ("positionId", "mcpServerId"),
    CONSTRAINT "PositionMcp_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PositionMcp_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "McpServer_name_key" ON "McpServer"("name");

-- CreateIndex
CREATE INDEX "PositionMcp_mcpServerId_idx" ON "PositionMcp"("mcpServerId");
