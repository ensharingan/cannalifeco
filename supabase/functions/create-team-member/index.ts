import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Act as the caller so the database decides what they may do.
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = String(body.full_name ?? "").trim() || email;
    const role = String(body.role ?? "");
    if (!email || !email.includes("@")) return json({ error: "A valid email is required" }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

    // Role / company / store-scope rules live in the database.
    const { data: prep, error: prepErr } = await userClient.rpc("team_prepare_add", { p_role: role });
    if (prepErr) return json({ error: prepErr.message }, 403);
    const companyId: string = prep.company_id;
    const storeIds: string[] = prep.store_ids ?? [];

    const admin = createClient(url, service, { auth: { persistSession: false } });

    let userId: string | null = null;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (created.error) {
      // Email already has a login: only re-attach people who are not on any team.
      const { data: existing } = await admin.from("profiles").select("id, company_id").eq("email", email).maybeSingle();
      if (!existing) return json({ error: created.error.message }, 400);
      if (existing.company_id) return json({ error: "That email already belongs to a team member" }, 400);
      userId = existing.id;
      await admin.auth.admin.updateUserById(userId, { password });
    } else {
      userId = created.data.user.id;
    }

    const { error: profErr } = await admin.from("profiles").upsert(
      { id: userId, email, full_name: fullName, role, company_id: companyId, removed_at: null, removed_from_company_id: null },
      { onConflict: "id" },
    );
    if (profErr) return json({ error: profErr.message }, 400);

    // Franchisee-created users inherit the creator's stores, and nothing else.
    await admin.from("franchise_store_access").delete().eq("user_id", userId);
    if (storeIds.length > 0) {
      const rows = storeIds.map((s) => ({ user_id: userId, store_id: s, company_id: companyId }));
      const { error: accErr } = await admin.from("franchise_store_access").insert(rows);
      if (accErr) return json({ error: accErr.message }, 400);
    }

    return json({ success: true, user_id: userId });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Failed to create team member" }, 500);
  }
});
