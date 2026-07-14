import { NextResponse } from 'next/server'

/**
 * Lightweight health check endpoint for keep-alive pings.
 *
 * Render free tier spins down the service after ~15 minutes of inactivity.
 * Meta's webhook timeout is ~20 seconds, so a cold start (30–60s) can
 * cause webhook delivery failures. This endpoint returns instantly with
 * no DB calls, making it safe to hit every 5–10 minutes from an external
 * pinger or from the built-in self-ping.
 *
 * Response:
 *   { "status": "ok", "timestamp": "2026-07-14T12:50:00.000Z" }
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
}
