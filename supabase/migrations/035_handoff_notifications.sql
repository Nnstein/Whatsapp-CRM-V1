-- ============================================================
-- 035_handoff_notifications.sql — Handoff Notifications for Agents & Admins
-- ============================================================

-- Expand notifications type check constraint to support handoffs
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'conversation_handoff'));

-- Function to dispatch handoff notifications to designated agent or all account admins
CREATE OR REPLACE FUNCTION public.create_handoff_notification(
  p_account_id UUID,
  p_conversation_id UUID,
  p_reason TEXT DEFAULT 'Handoff to human agent'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_agent_id UUID;
  v_contact_id UUID;
  v_contact_name TEXT;
  v_admin_record RECORD;
BEGIN
  SELECT assigned_agent_id, contact_id INTO v_assigned_agent_id, v_contact_id
  FROM conversations
  WHERE id = p_conversation_id AND account_id = p_account_id;

  IF v_contact_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
    FROM contacts WHERE id = v_contact_id;
  END IF;

  -- If conversation has a designated assigned agent, notify that specific agent
  IF v_assigned_agent_id IS NOT NULL THEN
    INSERT INTO notifications (
      account_id, user_id, type, conversation_id, contact_id,
      title, body
    ) VALUES (
      p_account_id,
      v_assigned_agent_id,
      'conversation_handoff',
      p_conversation_id,
      v_contact_id,
      'Action Required: Customer Hand-off',
      'Conversation with ' || COALESCE(v_contact_name, 'a contact') || ' requires assistance (' || p_reason || ').'
    );
  ELSE
    -- If unassigned, notify all owners and admins in the account
    FOR v_admin_record IN
      SELECT user_id FROM account_members
      WHERE account_id = p_account_id AND role IN ('owner', 'admin')
    LOOP
      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id,
        title, body
      ) VALUES (
        p_account_id,
        v_admin_record.user_id,
        'conversation_handoff',
        p_conversation_id,
        v_contact_id,
        'Action Required: Unassigned Hand-off',
        'Unassigned conversation with ' || COALESCE(v_contact_name, 'a contact') || ' needs an agent (' || p_reason || ').'
      );
    END LOOP;
  END IF;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create handoff notification for conversation %: %', p_conversation_id, SQLERRM;
END;
$$;

ALTER FUNCTION public.create_handoff_notification(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_handoff_notification(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_handoff_notification(UUID, UUID, TEXT) TO authenticated, service_role;
