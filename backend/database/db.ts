import { PrismaClient } from '@prisma/client';

// Prevent multiple PrismaClient instances during hot-reload (ts-node-dev)
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // `query` logs EVERY statement, which buries application logs (the Phase 4
    // delegation traces in particular) under hundreds of lines per second. Set
    // PRISMA_LOG_QUERIES=1 when you actually need to see the SQL.
    log:
      process.env.PRISMA_LOG_QUERIES === '1'
        ? ['query', 'error', 'warn']
        : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
// Import this singleton in all database service files.
// Never create new PrismaClient() instances elsewhere.
