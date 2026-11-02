-- Cashiers/staff can close counting and SUBMIT a stock count for approval.
-- Stock is only adjusted when a manager/owner completes it (stock_count_apply is unchanged).
-- A submitted count is read-only: stock_count_scan/set already require status = 'in_progress'.

create or replace function public.stock_count_submit(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g record;
begin
  select * into g from public.stock_count_guard(p_count_id, false);
  if g.status in ('completed','cancelled') then raise exception 'This count is already %', g.status; end if;
  if g.status = 'submitted' then return jsonb_build_object('status','ok','count_status','submitted'); end if;

  update stock_counts set status = 'submitted', updated_at = now() where id = p_count_id;
  return jsonb_build_object('status','ok','count_status','submitted');
end;
$function$;

grant execute on function public.stock_count_submit(uuid) to authenticated, service_role;

-- Only a manager/owner can send a submitted count back to counting.
create or replace function public.stock_count_set_status(p_count_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g record;
begin
  select * into g from public.stock_count_guard(p_count_id, false);
  if p_status not in ('in_progress','paused') then
    raise exception 'Use stock_count_apply or stock_count_cancel to close a count';
  end if;
  if g.status in ('completed','cancelled') then raise exception 'This count is already %', g.status; end if;
  if g.status = 'submitted' and g.role not in ('owner','admin','manager','superadmin') then
    raise exception 'This count was submitted for approval. Ask a manager to send it back.';
  end if;

  update stock_counts set status = p_status, updated_at = now() where id = p_count_id;
  return jsonb_build_object('status','ok','count_status',p_status);
end;
$function$;
