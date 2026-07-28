import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'

import {
  deleteMessageTemplate,
  editMessageTemplate,
} from '@/lib/whatsapp/meta-api'
import { validateTemplateName } from '@/lib/whatsapp/template-validators'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = (await request.json().catch(() => null)) as {
      category?: string
      components?: unknown
    } | null

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body.' },
        { status: 400 },
      )
    }

    const { category, components } = body
    if (!category || typeof category !== 'string') {
      return NextResponse.json(
        { error: 'Category is required.' },
        { status: 400 },
      )
    }
    if (!Array.isArray(components)) {
      return NextResponse.json(
        { error: 'Components must be an array.' },
        { status: 400 },
      )
    }

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, status, meta_template_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    if (existing.status !== 'REJECTED') {
      return NextResponse.json(
        {
          error:
            'Only REJECTED templates can be resubmitted. Delete and recreate approved or pending templates.',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplateName(existing.name)
    } catch (valErr) {
      return NextResponse.json(
        { error: valErr instanceof Error ? valErr.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    let config: any = null
    const { data: defaultConfig } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle()
    config = defaultConfig
    if (!config) {
      const { data: fallbackConfig } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .limit(1)
        .maybeSingle()
      config = fallbackConfig
    }

    if (!config || !config.waba_id) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      )
    }

    const accessToken = decrypt(config.access_token)

    if (existing.meta_template_id && !isDryRun()) {
      try {
        await editMessageTemplate({
          metaTemplateId: existing.meta_template_id,
          accessToken,
          category: category as any,
          components: components as any,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta update failed.'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateErr } = await supabase
      .from('message_templates')
      .update({
        category,
        components,
        status: 'PENDING',
        rejected_reason: null,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: 'Failed to update local template record.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ template: updated, dry_run: isDryRun() })
  } catch (error) {
    console.error('Error updating template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to update template.',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, meta_template_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    const isDryRunId = existing.meta_template_id?.startsWith('dry-run-') ?? false

    if (existing.meta_template_id && !isDryRunId && !isDryRun()) {
      let config: any = null
      const { data: defaultConfig } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .eq('is_default', true)
        .maybeSingle()
      config = defaultConfig
      if (!config) {
        const { data: fallbackConfig } = await supabase
          .from('whatsapp_config')
          .select('*')
          .eq('account_id', accountId)
          .limit(1)
          .maybeSingle()
        config = fallbackConfig
      }
      if (!config || !config.waba_id) {
        return NextResponse.json(
          { error: 'WhatsApp not configured — cannot delete on Meta.' },
          { status: 400 },
        )
      }
      const accessToken = decrypt(config.access_token)
      try {
        await deleteMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          name: existing.name,
          metaTemplateId: existing.meta_template_id,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta delete failed.'
        const isAlreadyDeleted = /invalid parameter|not found|does not exist/i.test(message)
        if (!isAlreadyDeleted) {
          return NextResponse.json({ error: message }, { status: 502 })
        }
        console.warn(
          `[templates DELETE] template ${id} (${existing.name}) already deleted on Meta: ${message}. Proceeding with local database removal.`,
        )
      }
    }

    const { error: delErr } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
    if (delErr) {
      return NextResponse.json(
        {
          error: `Deleted on Meta but failed to delete locally: ${delErr.message}.`,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, dry_run: isDryRun() })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to delete template.',
      },
      { status: 500 },
    )
  }
}
