import { NextResponse } from 'next/server';

/**
 * GET /api/stores/zid/callback
 *
 * Zid OAuth 2.0 / private-app activation callback.
 *
 * Zid redirects the merchant here after they click "Activate" on the app.
 * For public apps this arrives with ?code=... For private apps the params
 * may differ — this handler logs ALL parameters so you can see exactly
 * what Zid sends, then attempts the standard code exchange if a code exists.
 *
 * Env vars required:
 *   ZID_CLIENT_ID      — App Client ID from the Zid Partner Dashboard
 *   ZID_CLIENT_SECRET  — App Client Secret / App Secret from Zid Partner Dashboard
 *   APP_URL            — Public base URL of this deployment (e.g. https://whatsapp-crm-v1.onrender.com)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  // ── Log ALL incoming parameters (visible in Render logs) ─────────────
  const allParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  console.log('=== ZID CALLBACK RECEIVED ===');
  console.log('Full URL:', url.toString());
  console.log('All query parameters:', JSON.stringify(allParams, null, 2));
  console.log('=============================');

  const code = url.searchParams.get('code');
  const storeId = url.searchParams.get('store_id')
    ?? url.searchParams.get('storeId')
    ?? url.searchParams.get('store')
    ?? 'unknown';

  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Use APP_URL env var; fall back to the Host header to avoid localhost:port
  const publicOrigin =
    process.env.APP_URL?.replace(/\/$/, '') ??
    (request.headers.get('x-forwarded-host')
      ? `https://${request.headers.get('x-forwarded-host')}`
      : url.origin);

  // ── Show all params on the page so you can see what Zid sent ─────────
  if (!code && !error) {
    console.warn('[zid/callback] No ?code param received. All params:', allParams);

    // Check if Zid sent a token directly (some private app flows do this)
    const directToken =
      url.searchParams.get('access_token') ??
      url.searchParams.get('token') ??
      url.searchParams.get('authorization_token');

    if (directToken) {
      console.log('[zid/callback] Zid sent a direct token (not a code):', directToken);
      return makeSuccessPage(directToken, storeId, allParams);
    }

    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Zid Callback — Debug</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:720px;margin:auto}
pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow-x:auto;font-size:13px}
.warn{background:#fff8dc;border-left:4px solid #e6ac00;padding:.75rem 1rem;margin:1rem 0}
.info{background:#e8f4fd;border-left:4px solid #3498db;padding:.75rem 1rem;margin:1rem 0}
</style></head>
<body>
  <h2>⚠️ Zid callback reached — but no code or token received</h2>
  <p>The callback URL is working correctly, but Zid did not include a
  <code>?code</code> or <code>?access_token</code> parameter.</p>

  <div class="info">
    <strong>Parameters Zid actually sent:</strong>
    <pre>${JSON.stringify(allParams, null, 2)}</pre>
  </div>

  <div class="warn">
    <strong>What this means for private apps:</strong><br/>
    Some Zid private app setups don't use the full OAuth code flow. Instead,
    the Authorization Token (Bearer JWT) is available directly in the
    <a href="https://partner.zid.sa" target="_blank">Zid Partner Dashboard</a>
    under your app's <strong>General Settings</strong> — look for
    <strong>"App Secret"</strong>, <strong>"Authorization Token"</strong>,
    or <strong>"API Key"</strong>.
  </div>

  <h3>Next steps</h3>
  <ol>
    <li>Check Render logs for this request — the full URL and all parameters are logged there.</li>
    <li>In the Zid Partner Dashboard → Your App → General Settings, look for a static token/secret labelled "Authorization Token", "App Secret", or "API Key".</li>
    <li>If you find one, paste it into <strong>Settings → Store Connectors → Zid → Authorization Token</strong> in the CRM.</li>
    <li>Contact Zid support and ask: <em>"For a private app, how do I obtain the OAuth access_token? Does the activation redirect include it?"</em></li>
  </ol>

  <p style="color:#888;font-size:12px">
    Expected redirect URL: <code>${publicOrigin}/api/stores/zid/callback</code><br/>
    Actual origin detected: <code>${url.origin}</code>
  </p>
</body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // ── OAuth denied ────────────────────────────────────────────────────────
  if (error) {
    console.error('[zid/callback] OAuth denied:', error, errorDescription);
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:#c00">❌ Zid OAuth denied</h2>
        <p><strong>Error:</strong> ${error}</p>
        <p><strong>Details:</strong> ${errorDescription ?? 'none'}</p>
      </body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // ── Standard OAuth code exchange ─────────────────────────────────────
  const clientId = process.env.ZID_CLIENT_ID;
  const clientSecret = process.env.ZID_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[zid/callback] ZID_CLIENT_ID or ZID_CLIENT_SECRET missing');
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:#c00">⚙️ Server misconfiguration</h2>
        <p><code>ZID_CLIENT_ID</code> and/or <code>ZID_CLIENT_SECRET</code> env vars not set on Render.</p>
        <p>Your authorization code (copy it, it expires in ~60s):</p>
        <code style="word-break:break-all">${code}</code>
        <p>Store ID: <code>${storeId}</code></p>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }

  let tokenData: Record<string, unknown>;
  try {
    const redirectUri = `${publicOrigin}/api/stores/zid/callback`;
    console.log('[zid/callback] Exchanging code. redirect_uri:', redirectUri);

    const tokenRes = await fetch('https://api.zid.sa/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    tokenData = (await tokenRes.json()) as Record<string, unknown>;
    console.log('[zid/callback] Token exchange response:', tokenRes.status, JSON.stringify(tokenData));

    if (!tokenRes.ok) {
      return new NextResponse(
        `<html><body style="font-family:sans-serif;padding:2rem">
          <h2 style="color:#c00">❌ Token exchange failed (HTTP ${tokenRes.status})</h2>
          <pre>${JSON.stringify(tokenData, null, 2)}</pre>
          <p>Common causes: code expired (60s limit), redirect_uri mismatch, wrong client secret.</p>
        </body></html>`,
        { status: 502, headers: { 'Content-Type': 'text/html' } }
      );
    }
  } catch (err) {
    console.error('[zid/callback] Fetch error:', err);
    return new NextResponse('Token exchange network error', { status: 502 });
  }

  const accessToken = String(
    tokenData.access_token ??
    tokenData.token ??
    tokenData.authorization_token ??
    ''
  );

  console.log('=== ZID OAUTH SUCCESS ===');
  console.log('Store ID:', storeId);
  console.log('Access Token:', accessToken);
  console.log('Full response:', JSON.stringify(tokenData, null, 2));
  console.log('=========================');

  return makeSuccessPage(accessToken, storeId, tokenData);
}

function makeSuccessPage(token: string, storeId: string, extra: Record<string, unknown>) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Zid Connected ✅</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:2rem;max-width:680px;margin:auto}
    h2{color:#0a6e3f}
    .token-box{background:#f4f4f4;border:1px solid #ccc;border-radius:6px;
      padding:1rem;word-break:break-all;font-family:monospace;font-size:13px}
    .copy-btn{margin-top:.5rem;padding:.4rem 1rem;cursor:pointer;
      background:#0a6e3f;color:white;border:none;border-radius:4px;font-size:14px}
    .note{background:#fff8dc;border-left:4px solid #e6ac00;padding:.75rem 1rem;margin-top:1.5rem}
    pre{font-size:12px;overflow-x:auto}
  </style>
</head>
<body>
  <h2>✅ Zid Authorization Token Received</h2>
  <p><strong>Store ID:</strong> <code>${storeId}</code></p>
  <p><strong>Authorization Token</strong> — paste this into
  Settings → Store Connectors → Zid → Authorization Token:</p>
  <div class="token-box" id="token">${token}</div>
  <button class="copy-btn"
    onclick="navigator.clipboard.writeText(document.getElementById('token').textContent)
      .then(()=>this.textContent='Copied ✓')">
    Copy token
  </button>
  <div class="note">
    You also need the <strong>Manager Token</strong> (separate) — get it from
    the merchant's Zid dashboard → Settings → API Integrations → Generate Manager Token.
  </div>
  <details style="margin-top:1.5rem">
    <summary style="cursor:pointer;color:#555;font-size:13px">Full response (debug)</summary>
    <pre>${JSON.stringify(extra, null, 2)}</pre>
  </details>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
