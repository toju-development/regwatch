import 'server-only';
import { PrismaClient } from './generated/client/index.js';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
