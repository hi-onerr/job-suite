import { PrismaClient } from '@prisma/client'

// Cache a single PrismaClient across hot-reloads / serverless invocations to
// avoid exhausting database connections (see PHASE0-PLAN.md §7).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
