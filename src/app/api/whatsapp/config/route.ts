import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Resolve the caller's account_id from their profile.
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

/**
 * GET /api/whatsapp/config
 *
 * Returns list of configs for account, and checks health of default/target config.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          configs: [],
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    const url = new URL(request.url)
    const reqId = url.searchParams.get('id')

    const { data: configs, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .order('sort_order', { ascending: true })

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, configs: [], reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!configs || configs.length === 0) {
      return NextResponse.json(
        {
          connected: false,
          configs: [],
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    const targetConfig = reqId
      ? configs.find((c) => c.id === reqId)
      : configs.find((c) => c.is_default) || configs[0]

    if (!targetConfig) {
      return NextResponse.json({
        connected: false,
        configs,
        reason: 'not_found',
        message: 'Requested WhatsApp configuration not found',
      }, { status: 200 })
    }

    let accessToken: string
    try {
      accessToken = decrypt(targetConfig.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          configs,
          target_id: targetConfig.id,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY.',
        },
        { status: 200 }
      )
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: targetConfig.phone_number_id,
        accessToken,
      })
      return NextResponse.json({
        connected: true,
        configs,
        target_id: targetConfig.id,
        phone_info: phoneInfo,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[whatsapp/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        {
          connected: false,
          configs,
          target_id: targetConfig.id,
          reason: 'meta_api_error',
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, configs: [], reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates a WhatsApp number configuration for the account.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { id, label, is_default, sort_order, phone_number_id, waba_id, access_token, verify_token, pin } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: 'PIN must be exactly 6 digits.' },
          { status: 400 }
        )
      }
    }

    // Look up pre-existing row for this specific config or phone number
    let existing: any = null
    if (id) {
      const { data } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('id', id)
        .eq('account_id', accountId)
        .maybeSingle()
      existing = data
    } else {
      const { data } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('phone_number_id', phone_number_id)
        .eq('account_id', accountId)
        .maybeSingle()
      existing = data
    }

    // Enforce 5 numbers limit on creation
    if (!existing) {
      const { count, error: countErr } = await supabase
        .from('whatsapp_config')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)

      if (countErr) {
        return NextResponse.json({ error: 'Failed to check number limit' }, { status: 500 })
      }
      if ((count ?? 0) >= 5) {
        return NextResponse.json(
          { error: 'An account can have at most 5 WhatsApp numbers' },
          { status: 400 }
        )
      }
    }

    // Reject if another account claimed this phone_number_id
    let claimedQuery = supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id, id')
      .eq('phone_number_id', phone_number_id)
      .neq('account_id', accountId)

    if (existing?.id) {
      claimedQuery = claimedQuery.neq('id', existing.id)
    }

    const { data: claimed, error: claimedError } = await claimedQuery.maybeSingle()

    if (claimedError) {
      console.error('Error checking phone_number_id ownership:', claimedError)
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 }
      )
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This WhatsApp phone number is already linked to another account on this instance.',
        },
        { status: 409 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    const sameNumber =
      existing?.phone_number_id === phone_number_id &&
      existing?.registered_at != null

    let registeredAt: string | null = existing?.registered_at ?? null
    let registrationError: string | null = null
    let registrationSkipped = false

    const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0)
    if (needsRegistration) {
      if (!pin) {
        registrationSkipped = true
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          })
          registeredAt = new Date().toISOString()
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : 'Unknown Meta API error'
          console.error('Phone number /register failed:', registrationError)
        }
      }
    }

    let subscribedAppsAt: string | null = null
    if (waba_id) {
      try {
        await subscribeWabaToApp({
          wabaId: waba_id,
          accessToken: access_token,
        })
        subscribedAppsAt = new Date().toISOString()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('WABA subscribed_apps failed (non-fatal):', message)
      }
    }

    // Determine default status: if explicitly true or if first row
    let shouldBeDefault = is_default ?? existing?.is_default ?? false
    if (!existing) {
      const { count: currentCount } = await supabase
        .from('whatsapp_config')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
      if ((currentCount ?? 0) === 0) {
        shouldBeDefault = true
      }
    }

    const baseRow = {
      label: label || existing?.label || 'WhatsApp',
      is_default: shouldBeDefault,
      sort_order: typeof sort_order === 'number' ? sort_order : (existing?.sort_order || 0),
      phone_number_id,
      waba_id: waba_id || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt ?? null,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    }

    let savedConfig: any = null
    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('id', existing.id)
        .eq('account_id', accountId)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
      savedConfig = updated
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        })
        .select()
        .single()

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }
      savedConfig = inserted
    }

    return NextResponse.json({
      success: true,
      saved: true,
      config: savedConfig,
      registered: registeredAt != null,
      registration_skipped: registrationSkipped,
      registration_error: registrationError,
      phone_info: phoneInfo,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes a specified WhatsApp configuration row or all if unspecified.
 */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const id = url.searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      if (deleteError.code === '23503') {
        return NextResponse.json(
          { error: 'Cannot delete this number because active conversations exist for it.' },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
