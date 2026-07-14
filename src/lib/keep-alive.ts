// ============================================================
// Self-ping keep-alive for Render free tier.
//
// Render free tier spins down the service after ~15 minutes of
// inactivity. Meta's webhook timeout is ~20 seconds, so a cold
// start (30–60s) can cause webhook delivery failures. This module
// starts a background self-ping that hits the /api/health endpoint
// every 10 minutes to keep the Node process warm.
//
// IMPORTANT: This is a fallback. A more reliable approach is an
// external pinger (UptimeRobot, cron-job.org, etc.) that hits
// /api/health every 5–10 minutes. The self-ping only works if
// the process hasn't been frozen/suspended by the platform.
//
// This module is imported in the root layout (server component)
// so it runs once per Next.js server process, not per-request.
// The import has no side effects in the browser (typeof window
// guard).
// ============================================================

const PING_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const HEALTH_ENDPOINT = '/api/health'

function getBaseUrl(): string {
  // Render injects a public URL via env var
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL
  }
  // Fallback: try to construct from host/port
  const host = process.env.HOST || process.env.HOSTNAME || 'localhost'
  const port = process.env.PORT || '3000'
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const protocol = isLocal ? 'http' : 'https'
  return `${protocol}://${host}${isLocal ? ':' + port : ''}`
}

let pingTimer: ReturnType<typeof setInterval> | null = null

function startSelfPing() {
  if (pingTimer) return // already running

  const baseUrl = getBaseUrl()
  const url = `${baseUrl}${HEALTH_ENDPOINT}`

  console.log(`[keep-alive] Starting self-ping every ${PING_INTERVAL_MS / 1000}s → ${url}`)

  pingTimer = setInterval(async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        // Short timeout — if the server can't respond to itself in 5s,
        // something is wrong, but we don't want to hang.
        signal: AbortSignal.timeout(5_000),
      })
      if (res.ok) {
        console.log('[keep-alive] Self-ping OK')
      } else {
        console.warn('[keep-alive] Self-ping returned', res.status)
      }
    } catch (err) {
      console.warn('[keep-alive] Self-ping failed:', err instanceof Error ? err.message : err)
    }
  }, PING_INTERVAL_MS)

  // Also ping immediately on startup so the first one isn't delayed
  // by 10 minutes (helps with quick cold-start detection).
  setTimeout(() => {
    fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => {
      // ignore — the interval will retry
    })
  }, 5_000)
}

function stopSelfPing() {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
    console.log('[keep-alive] Self-ping stopped')
  }
}

// Only run in Node.js (server), never in the browser.
if (typeof window === 'undefined') {
  // Start immediately when this module is first imported.
  // In Next.js, this happens once per server process.
  startSelfPing()

  // Graceful shutdown — clean up timer so the process can exit
  // cleanly (helps with Render's deploy restart).
  process.on('SIGTERM', stopSelfPing)
  process.on('SIGINT', stopSelfPing)
}
