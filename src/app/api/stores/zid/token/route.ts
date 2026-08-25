import { NextResponse } from 'next/server';

/**
 * GET /api/stores/zid/token
 *
 * One-shot diagnostic endpoint to test client_credentials grant with Zid.
 * This exchanges ZID_CLIENT_ID + ZID_CLIENT_SECRET for an access token
 * without any user redirect (no merchant interaction needed).
 *
 * Visit this URL in your browser while logged into the Render deployment
 * to see what Zid returns.
 *
 * DELETE THIS ROUTE after you have the token — it exposes sensitive info.
 */
export async function GET() {
  const clientId = process.env.ZID_CLIENT_ID;
  const clientSecret = process.env.ZID_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json({
      error: 'ZID_CLIENT_ID or ZID_CLIENT_SECRET env var not set on Render',
    }, { status: 500 });
  }

  // Try 1: client_credentials grant
  console.log('[zid/token] Attempting client_credentials grant...');
  let result1: unknown;
  let status1: number;
  try {
    const res = await fetch('https://api.zid.sa/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    result1 = await res.json();
    status1 = res.status;
    console.log('[zid/token] client_credentials response:', status1, JSON.stringify(result1));
  } catch (err) {
    result1 = { network_error: String(err) };
    status1 = 0;
  }

  // Try 2: app_secret as Bearer — test with a harmless GET to /v1/managers/store
  console.log('[zid/token] Testing App Secret as Bearer token directly...');
  let result2: unknown;
  let status2: number;
  try {
    const res = await fetch('https://api.zid.sa/v1/managers/account/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    result2 = await res.json().catch(() => res.text());
    status2 = res.status;
    console.log('[zid/token] App Secret as Bearer response:', status2, JSON.stringify(result2));
  } catch (err) {
    result2 = { network_error: String(err) };
    status2 = 0;
  }

  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Zid Token Debug</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:2rem;max-width:800px;margin:auto}
    pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow-x:auto;font-size:13px}
    h3{margin-top:2rem}
    .ok{color:green} .fail{color:#c00}
  </style>
</head>
<body>
  <h2>🔍 Zid Token Exchange — Diagnostics</h2>
  <p>This page tests two ways to get an Authorization Token for your Zid private app.</p>

  <h3>Test 1: <code>client_credentials</code> grant</h3>
  <p>Status: <span class="${status1 === 200 ? 'ok' : 'fail'}">${status1}</span></p>
  <pre>${JSON.stringify(result1, null, 2)}</pre>

  <h3>Test 2: App Secret used directly as Bearer token</h3>
  <p>Status: <span class="${status2 === 200 ? 'ok' : 'fail'}">${status2}</span>
  ${status2 === 200 ? '— <strong class="ok">✅ App Secret works as Authorization Token!</strong>' : ''}</p>
  <pre>${JSON.stringify(result2, null, 2)}</pre>

  <p style="margin-top:2rem;color:#888;font-size:12px">
    ⚠️ Delete <code>src/app/api/stores/zid/token/route.ts</code> after you're done —
    this endpoint is for diagnostic use only.
  </p>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
