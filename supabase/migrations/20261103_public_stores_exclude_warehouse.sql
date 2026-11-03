-- Warehouses are not selectable as a member's home store on public registration.
CREATE OR REPLACE FUNCTION public.public_company_stores(p_company_id uuid)
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select s.id, s.name from stores s where s.company_id = p_company_id and coalesce(s.is_active, true) and coalesce(s.type, 'branch') <> 'warehouse' order by s.name $function$;
