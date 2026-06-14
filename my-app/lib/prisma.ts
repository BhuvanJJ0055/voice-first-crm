import { PrismaClient } from '@prisma/client';
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
  adapter: PrismaPg | undefined;
};

const pool = globalForPrisma.pool ?? new Pool({ connectionString });
const adapter = globalForPrisma.adapter ?? new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: ['query', 'error', 'warn'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.pool = pool;
  globalForPrisma.adapter = adapter;
  globalForPrisma.prisma = prisma;
}
