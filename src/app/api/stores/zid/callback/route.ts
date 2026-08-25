import { NextResponse } from 'next/server';

/**
 * GET /api/stores/zid/callback
 *
 * Zid OAuth 2.0 callback handler.
 *
 * When the merchant clicks "Activate" on your private app in the Zid store,
 * Zid redirects their browser here with:
 *   ?code=<authorization_code>&store_id=<store_id>
 *
 * This route exchanges the short-lived `code` for a long-lived
 * `access_token` (the "Authorization Token / Bearer JWT" the Zid connector
 * requires).
 *
 * The token is logged to the server console (visible in Vercel function logs)
 * and returned in the response body so you can copy it into Settings →
 * Store Connectors → Zid → Authorization Token.
 *
 * Environment variables required:
 *   ZID_CLIENT_ID     — App Client ID from the Zid Partner Dashboard
 *   ZID_CLIENT_SECRET — App Client Secret from the Zid Partner Dashboard
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const storeId = url.searchParams.get('store_id') ?? url.searchParams.get('storeId') ?? 'unknown';
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // ── Zid denied access ──────────────────────────────────────────────────
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

  if (!code) {
    console.error('[zid/callback] No authorization code in request');
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:#c00">❌ Missing authorization code</h2>
        <p>Zid did not send a <code>code</code> parameter.
           Make sure the Redirect URL in the Zid Partner Dashboard
           is set to exactly: <strong>${url.origin}/api/stores/zid/callback</strong></p>
      </body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  const clientId = process.env.ZID_CLIENT_ID;
  const clientSecret = process.env.ZID_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[zid/callback] ZID_CLIENT_ID or ZID_CLIENT_SECRET env var missing');
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:2rem">
        <h2 style="color:#c00">⚙️ Server misconfiguration</h2>
        <p>The environment variables <code>ZID_CLIENT_ID</code> and
           <code>ZID_CLIENT_SECRET</code> are not set on the server.</p>
        <p>Add them in your Vercel project settings → Environment Variables,
           then redeploy.</p>
        <hr/>
        <p><strong>Your authorization code (expires in ~60s):</strong><br/>
        <code>${code}</code></p>
        <p><strong>Store ID:</strong> <code>${storeId}</code></p>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }

  // ── Exchange the code for an access_token ─────────────────────────────
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch('https://api.zid.sa/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        // Redirect URI must match exactly what's registered in the Zid app.
        redirect_uri: `${url.origin}/api/stores/zid/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    tokenData = (await tokenRes.json()) as Record<string, unknown>;

    if (!tokenRes.ok) {
      console.error('[zid/callback] Token exchange failed:', tokenRes.status, tokenData);
      return new NextResponse(
        `<html><body style="font-family:sans-serif;padding:2rem">
          <h2 style="color:#c00">❌ Token exchange failed (HTTP ${tokenRes.status})</h2>
          <pre>${JSON.stringify(tokenData, null, 2)}</pre>
          <p>Common causes:</p>
          <ul>
            <li>The code already expired (codes are single-use and expire in ~60s)</li>
            <li>The <code>redirect_uri</code> doesn't exactly match the one in the Zid Partner Dashboard</li>
            <li>Wrong client secret</li>
          </ul>
        </body></html>`,
        { status: 502, headers: { 'Content-Type': 'text/html' } }
      );
    }
  } catch (err) {
    console.error('[zid/callback] Fetch error during token exchange:', err);
    return new NextResponse('Token exchange network error', { status: 502 });
  }

  const accessToken = String(
    tokenData.access_token ?? tokenData.token ?? tokenData.authorization_token ?? ''
  );

  // ── Log to server console (visible in Vercel function logs) ───────────
  console.log('=== ZID OAUTH SUCCESS ===');
  console.log('Store ID:', storeId);
  console.log('Access Token (Authorization Token):', accessToken);
  console.log('Full response:', JSON.stringify(tokenData, null, 2));
  console.log('=========================');

  // ── Return a clear, copyable HTML page ────────────────────────────────
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Zid Connected ✅</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 680px; margin: auto; }
    h2 { color: #0a6e3f; }
    .token-box {
      background: #f4f4f4; border: 1px solid #ccc; border-radius: 6px;
      padding: 1rem; word-break: break-all; font-family: monospace; font-size: 13px;
    }
    .copy-btn {
      margin-top: .5rem; padding: .4rem 1rem; cursor: pointer;
      background: #0a6e3f; color: white; border: none; border-radius: 4px;
    }
    .note { background: #fff8dc; border-left: 4px solid #e6ac00; padding: .75rem 1rem; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <h2>✅ Zid OAuth Successful</h2>
  <p><strong>Store ID:</strong> <code>${storeId}</code></p>

  <p><strong>Authorization Token</strong> (paste this as "Authorization Token" in Settings → Store Connectors → Zid):</p>
  <div class="token-box" id="token">${accessToken}</div>
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('token').textContent).then(()=>this.textContent='Copied!')">
    Copy token
  </button>

  <div class="note">
    <strong>Note:</strong> This token is also logged to the Vercel function logs for this request.
    You still need the <strong>Manager Token</strong> separately (from the merchant's
    Zid dashboard → Settings → API Integrations → Generate Manager Token).
  </div>

  <p style="margin-top:1.5rem; color:#555; font-size:13px">
    Full exchange response (for debugging):<br/>
    <pre style="font-size:12px; overflow-x:auto">${JSON.stringify(tokenData, null, 2)}</pre>
  </p>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html' } }
  );
}
