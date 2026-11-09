-- Allow-list for the temporary Merge Duplicates tool (owners/admins always allowed).
create table if not exists public.merge_tool_access (user_id uuid primary key references auth.users(id) on delete cascade, note text, created_at timestamptz default now());
alter table public.merge_tool_access enable row level security;
insert into public.merge_tool_access(user_id, note) values
 ('cc52ba27-61c0-4ee2-a9ce-b52c3db8c88b','Rosie Russell'),
 ('44799cbf-e992-47e0-89c6-60461c33e1f2','Caelan Howes')
on conflict do nothing;
create or replace function public.merge_tool_allowed() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('owner','admin','superadmin'))
      or exists (select 1 from merge_tool_access m where m.user_id = auth.uid());
$$;
grant execute on function public.merge_tool_allowed() to authenticated;
-- duplicate_candidates() and product_merge_stock() now call merge_tool_allowed() instead of the owner/admin role check.
