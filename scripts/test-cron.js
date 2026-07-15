#!/usr/bin/env node
// ============================================================
// Local test script for cron endpoints.
//
// Run this locally to verify your Render cron endpoints are
// reachable and authenticated correctly BEFORE setting up the
// Render Cron Jobs.
//
// Usage:
//   node scripts/test-cron.js https://your-render-url.com your-secret
//
// Example:
//   node scripts/test-cron.js https://wacrm-abc.onrender.com my-secret-123
// ============================================================

const BASE_URL = process.argv[2]
const SECRET = process.argv[3]

if (!BASE_URL || !SECRET) {
  console.error('Usage: node test-cron.js <base-url> <automation-cron-secret>')
  console.error('Example: node test-cron.js https://wacrm-abc.onrender.com my-secret')
  process.exit(1)
}

async function testEndpoint(name, path) {
  const url = `${BASE_URL}${path}`
  console.log(`\nTesting ${name}...`)
  console.log(`  URL: ${url}`)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-cron-secret': SECRET },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => ({}))
    console.log(`  Status: ${res.status}`)
    console.log(`  Response:`, JSON.stringify(data, null, 2))
    return res.ok
  } catch (err) {
    console.error(`  FAILED:`, err instanceof Error ? err.message : err)
    return false
  }
}

async function main() {
  console.log('========================================')
  console.log('wacrm Cron Endpoint Test')
  console.log('========================================')

  const automationsOk = await testEndpoint(
    'Automations Cron',
    '/api/automations/cron'
  )
  const flowsOk = await testEndpoint('Flows Cron', '/api/flows/cron')

  console.log('\n========================================')
  if (automationsOk && flowsOk) {
    console.log('All tests PASSED. Ready to deploy cron jobs.')
  } else {
    console.log('Some tests FAILED. Check the errors above.')
    process.exit(1)
  }
}

main()
