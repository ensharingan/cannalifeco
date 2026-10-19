-- Cannalife Co — functions the MCP permission layer refused to apply.
-- Run once in the Supabase SQL editor of the Cannalifeco project (runqrxtdxaofnjziegyr).
-- Identical to the CannaGQ source definitions (bodies copied verbatim).

CREATE OR REPLACE FUNCTION public.budify_profiles_mark_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.company_id is not null and new.company_id is null then
    new.removed_from_company_id := old.company_id;
    new.removed_at := now();
    new.store_id := null;
    new.role := 'staff';
    delete from public.cashier_store_assignments where cashier_id = old.id;
  elsif new.company_id is not null and new.company_id is distinct from old.company_id then
    new.removed_from_company_id := null;
    new.removed_at := null;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_team_member(p_email text, p_password text, p_full_name text, p_role text, p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
  new_user_id uuid;
BEGIN
  IF p_role NOT IN ('manager', 'staff', 'cashier') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  new_user_id := (
    SELECT id FROM auth.users WHERE email = lower(p_email)
  );

  IF new_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET company_id = p_company_id,
        role = p_role,
        full_name = COALESCE(NULLIF(p_full_name, ''), full_name)
    WHERE id = new_user_id;
  ELSE
    new_user_id := extensions.uuid_generate_v4();

    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      aud, role
    ) VALUES (
      new_user_id,
      '00000000-0000-0000-0000-000000000000',
      lower(p_email),
      crypt(p_password, gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
      jsonb_build_object('full_name', p_full_name),
      'authenticated',
      'authenticated'
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      new_user_id, new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', lower(p_email)),
      'email', new_user_id::text,
      now(), now(), now()
    );

    INSERT INTO public.profiles (id, email, full_name, role, company_id)
    VALUES (new_user_id, lower(p_email), p_full_name, p_role, p_company_id)
    ON CONFLICT (id) DO UPDATE SET
      company_id = p_company_id,
      role = p_role,
      full_name = COALESCE(NULLIF(p_full_name, ''), profiles.full_name);
  END IF;

  RETURN json_build_object('success', true, 'user_id', new_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_cashier(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_user_id
      AND role = 'cashier'
      AND company_id = get_my_company_id()
  ) THEN
    RAISE EXCEPTION 'Not authorized or cashier not found';
  END IF;

  DELETE FROM profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_company_and_data(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'auth'
AS $function$
DECLARE
  v_user_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_user_ids
  FROM profiles WHERE company_id = p_company_id;

  DELETE FROM refunds                   WHERE company_id = p_company_id;
  DELETE FROM store_credit_transactions WHERE company_id = p_company_id;
  DELETE FROM stock_movements           WHERE company_id = p_company_id;
  DELETE FROM store_inventory           WHERE company_id = p_company_id;
  DELETE FROM store_settings            WHERE company_id = p_company_id;
  DELETE FROM popia_consents            WHERE company_id = p_company_id;
  DELETE FROM data_subject_requests     WHERE company_id = p_company_id;
  DELETE FROM support_tickets           WHERE company_id = p_company_id;
  DELETE FROM reseller_commissions      WHERE company_id = p_company_id;
  DELETE FROM leads                     WHERE company_id = p_company_id;

  UPDATE profiles SET company_id = NULL WHERE company_id = p_company_id;

  DELETE FROM companies WHERE id = p_company_id;

  IF v_user_ids IS NOT NULL THEN
    FOR i IN 1..array_length(v_user_ids, 1) LOOP
      DELETE FROM profiles   WHERE id = v_user_ids[i];
      DELETE FROM auth.users WHERE id = v_user_ids[i];
    END LOOP;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_member_and_data(p_member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      uuid;
  v_caller_role     text;
  v_caller_company  uuid;
  v_name            text;
  v_membership_id   text;
  v_orders          int := 0;
  v_refunds         int := 0;
  v_activities      int := 0;
  v_credits         int := 0;
  v_redemptions     int := 0;
  v_vouchers        int := 0;
BEGIN
  SELECT company_id, trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), membership_id
    INTO v_company_id, v_name, v_membership_id
  FROM members WHERE id = p_member_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  SELECT role, company_id INTO v_caller_role, v_caller_company
  FROM profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL
     OR (v_caller_role <> 'superadmin'
         AND NOT (v_caller_role IN ('owner','manager') AND v_caller_company = v_company_id)) THEN
    RAISE EXCEPTION 'Not authorised to delete members for this company';
  END IF;

  UPDATE orders  SET member_id = NULL WHERE member_id = p_member_id;
  GET DIAGNOSTICS v_orders = ROW_COUNT;

  UPDATE refunds SET member_id = NULL WHERE member_id = p_member_id;
  GET DIAGNOSTICS v_refunds = ROW_COUNT;

  DELETE FROM voucher_redemptions       WHERE member_id = p_member_id;
  GET DIAGNOSTICS v_redemptions = ROW_COUNT;

  DELETE FROM vouchers                  WHERE member_id = p_member_id;
  GET DIAGNOSTICS v_vouchers = ROW_COUNT;

  DELETE FROM store_credit_transactions WHERE member_id = p_member_id;
  GET DIAGNOSTICS v_credits = ROW_COUNT;

  DELETE FROM member_activities         WHERE member_id = p_member_id;
  GET DIAGNOSTICS v_activities = ROW_COUNT;

  DELETE FROM members WHERE id = p_member_id;

  RETURN jsonb_build_object(
    'deleted', true,
    'member_name', v_name,
    'membership_id', v_membership_id,
    'company_id', v_company_id,
    'orders_detached', v_orders,
    'refunds_detached', v_refunds,
    'voucher_redemptions_deleted', v_redemptions,
    'vouchers_deleted', v_vouchers,
    'credit_transactions_deleted', v_credits,
    'activities_deleted', v_activities
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_product_and_data(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_company uuid;
  v_caller_role    text;
  v_product        products%ROWTYPE;
  v_inv_mov   int := 0;
  v_stock_mov int := 0;
  v_store_inv int := 0;
  v_count_it  int := 0;
  v_transfers int := 0;
  v_returns   int := 0;
  v_bundles   int := 0;
BEGIN
  SELECT company_id, role INTO v_caller_company, v_caller_role
  FROM profiles WHERE id = auth.uid();

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in.');
  END IF;

  IF v_caller_role NOT IN ('owner', 'manager', 'superadmin') THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Only an owner or manager can delete a product.');
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Product not found.');
  END IF;

  IF v_caller_role IS DISTINCT FROM 'superadmin'
     AND v_product.company_id IS DISTINCT FROM v_caller_company THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not your product.');
  END IF;

  UPDATE products SET bundle_linked_product_id = NULL
  WHERE bundle_linked_product_id = p_product_id;
  GET DIAGNOSTICS v_bundles = ROW_COUNT;

  DELETE FROM stock_count_items   WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_count_it = ROW_COUNT;

  DELETE FROM supplier_returns    WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_returns = ROW_COUNT;

  DELETE FROM stock_transfers     WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_transfers = ROW_COUNT;

  DELETE FROM stock_movements     WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_stock_mov = ROW_COUNT;

  DELETE FROM inventory_movements WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_inv_mov = ROW_COUNT;

  DELETE FROM store_inventory     WHERE product_id = p_product_id;
  GET DIAGNOSTICS v_store_inv = ROW_COUNT;

  DELETE FROM products WHERE id = p_product_id;

  RETURN jsonb_build_object(
    'ok', true,
    'product_name', v_product.name,
    'deleted', jsonb_build_object(
      'inventory_movements', v_inv_mov,
      'stock_movements',     v_stock_mov,
      'store_inventory',     v_store_inv,
      'stock_count_items',   v_count_it,
      'stock_transfers',     v_transfers,
      'supplier_returns',    v_returns,
      'bundles_unlinked',    v_bundles
    )
  );
END;
$function$;

-- Trigger
DROP TRIGGER IF EXISTS trg_budify_profiles_mark_removed ON public.profiles;
CREATE TRIGGER trg_budify_profiles_mark_removed BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.budify_profiles_mark_removed();

-- Grants (match the CannaGQ source exactly)
REVOKE ALL ON FUNCTION public.budify_profiles_mark_removed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.budify_profiles_mark_removed() TO service_role;

REVOKE ALL ON FUNCTION public.create_team_member(text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_member(text, text, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.delete_cashier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_cashier(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_company_and_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_company_and_data(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_member_and_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_member_and_data(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_product_and_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product_and_data(uuid) TO authenticated, service_role;
