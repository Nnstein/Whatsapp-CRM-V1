#!/usr/bin/env node
// ============================================================
// Render Cron Job runner for wacrm.
//
// This script is called by Render's cron scheduler every 5 minutes.
// It hits the internal cron endpoints (automations + flows) with the
// shared secret, logging the result for Render's job output.
//
// Usage (set in Render Cron Job "Command" field):
//   node scripts/cron-runner.js automations
//   node scripts/cron-runner.js flows
//
// Required env vars (set in Render dashboard):
//   - AUTOMATION_CRON_SECRET
//   - RENDER_EXTERNAL_URL (auto-injected by Render)
// ============================================================

const JOB = process.argv[2]

const VALID_JOBS = ['automations', 'flows']
if (!VALID_JOBS.includes(JOB)) {
  console.error(`Usage: node cron-runner.js <${VALID_JOBS.join('|')}>`)
  process.exit(1)
}

const SECRET = process.env.AUTOMATION_CRON_SECRET
if (!SECRET) {
  console.error('Missing AUTOMATION_CRON_SECRET env var')
  process.exit(1)
}

// Fallback: if RENDER_EXTERNAL_URL is not set, try to construct from
// known Render patterns or a manually-set CRON_BASE_URL.
const BASE_URL =
  process.env.RENDER_EXTERNAL_URL ??
  process.env.CRON_BASE_URL ??
  (process.env.RENDER_SERVICE_NAME
    ? `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`
    : null)

if (!BASE_URL) {
  console.error(
    'Missing base URL. Set one of: RENDER_EXTERNAL_URL (auto), CRON_BASE_URL (manual), or RENDER_SERVICE_NAME (auto)'
  )
  process.exit(1)
}

const URL = `${BASE_URL}/api/${JOB}/cron`

async function run() {
  try {
    const res = await fetch(URL, {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
      signal: AbortSignal.timeout(30_000),
    })
    const data = await res.json().catch(() => ({ status: res.status }))
    console.log(`[${JOB}-cron] ${res.status}`, JSON.stringify(data))
    if (!res.ok) {
      process.exit(1)
    }
  } catch (err) {
    console.error(`[${JOB}-cron] FAILED:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

run()
