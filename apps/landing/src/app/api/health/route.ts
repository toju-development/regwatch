import { NextResponse } from 'next/server';
import type { HealthStatus } from '@regwatch/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVICE_VERSION = '0.0.0';

export function GET(): NextResponse<HealthStatus> {
  return NextResponse.json({
    status: 'ok',
    service: 'landing',
    uptime: process.uptime(),
    version: SERVICE_VERSION,
  });
}
