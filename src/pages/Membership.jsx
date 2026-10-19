import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  FileSignature, Mail, Save, Send, Users, CheckCircle2,
  AlertTriangle, Loader2, RefreshCw, Link as LinkIcon, Copy
} from "lucide-react";

const TABS = [
  { key: "contract", label: "Contract", icon: FileSignature },
  { key: "signatures", label: "Signatures", icon: CheckCircle2 },
  { key: "email", label: "Bulk Email", icon: Mail },
];

export default function Membership() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [tab, setTab] = useState("contract");
  const [features, setFeatures] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    (async () => {
      const { data } = await supabase
        .from("companies").select("features").eq("id", companyId).single();
      setFeatures(data?.features || {});
      setLoading(false);
    })();
  }, [companyId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!features?.membership_contracts) {
    return (
      <div className="p-8">
        <div className="max-w-md rounded-lg border border-border bg-card p-6">
          <AlertTriangle className="w-6 h-6 text-amber-500 mb-3" />
          <h2 className="text-lg font-semibold mb-1">Not enabled</h2>
          <p className="text-sm text-muted-foreground">
            Membership contracts are not enabled for this account. Contact support to enable it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSignature className="w-6 h-6" /> Membership
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Contract, signups, renewals and member mailouts.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "contract" && <ContractTab companyId={companyId} />}
      {tab === "signatures" && <SignaturesTab companyId={companyId} />}
      {tab === "email" && <EmailTab companyId={companyId} enabled={!!features?.bulk_email} />}
    </div>
  );
}

/* ---------------- Contract ---------------- */

function ContractTab({ companyId }) {
  const [contract, setContract] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("membership_contracts")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1);
      setContract(data?.[0] || {
        company_id: companyId,
        title: "Membership Agreement & Contract",
        body: "",
        version: 1,
        is_active: true,
        require_id_document: true,
        require_profile_photo: true,
      });
    })();
  }, [companyId]);

  const save = async (newVersion) => {
    setSaving(true);
    setMsg("");
    try {
      if (newVersion && contract.id) {
        await supabase.from("membership_contracts")
          .update({ is_active: false }).eq("id", contract.id);
        const { data, error } = await supabase.from("membership_contracts").insert({
          company_id: companyId,
          title: contract.title,
          body: contract.body,
          version: (contract.version || 1) + 1,
          is_active: true,
          require_id_document: contract.require_id_document,
          require_profile_photo: contract.require_profile_photo,
        }).select().single();
        if (error) throw error;
        setContract(data);
        setMsg(`Published version ${data.version}. Existing signatures stay bound to their original version.`);
      } else if (contract.id) {
        const { error } = await supabase.from("membership_contracts").update({
          title: contract.title,
          body: contract.body,
          require_id_document: contract.require_id_document,
          require_profile_photo: contract.require_profile_photo,
          updated_at: new Date().toISOString(),
        }).eq("id", contract.id);
        if (error) throw error;
        setMsg("Saved.");
      } else {
        const { data, error } = await supabase.from("membership_contracts")
          .insert(contract).select().single();
        if (error) throw error;
        setContract(data);
        setMsg("Created.");
      }
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
    setSaving(false);
  };

  if (!contract) return <Loader2 className="w-4 h-4 animate-spin" />;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
          Version {contract.version} {contract.id ? "· active" : "· unsaved"}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save(false)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save edit
          </Button>
          <Button size="sm" onClick={() => save(true)} disabled={saving || !contract.id}>
            Publish new version
          </Button>
        </div>
      </div>

      {msg && <div className="text-sm px-3 py-2 rounded bg-muted">{msg}</div>}

      <div>
        <label className="text-sm font-medium">Title</label>
        <input
          className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
          value={contract.title || ""}
          onChange={(e) => setContract({ ...contract, title: e.target.value })}
        />
      </div>

      <div>
        <label className="text-sm font-medium">Body (Markdown-ish; supports ## headings and **bold**)</label>
        <textarea
          className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono leading-relaxed"
          rows={24}
          value={contract.body || ""}
          onChange={(e) => setContract({ ...contract, body: e.target.value })}
        />
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!contract.require_id_document}
            onChange={(e) => setContract({ ...contract, require_id_document: e.target.checked })}
          />
          Require ID document upload
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!contract.require_profile_photo}
            onChange={(e) => setContract({ ...contract, require_profile_photo: e.target.checked })}
          />
          Require profile photo
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Publishing a new version does not invalidate old signatures — each signature record stores the
        version the member actually agreed to.
      </p>
    </div>
  );
}

/* ---------------- Signatures ---------------- */

function SignaturesTab({ companyId }) {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, signed: 0, expired: 0 });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: sigs } = await supabase
      .from("member_contract_signatures")
      .select("id, member_id, contract_version, signed_at, signed_via, new_expiry_date, typed_full_name")
      .eq("company_id", companyId)
      .order("signed_at", { ascending: false })
      .limit(200);

    const ids = (sigs || []).map((s) => s.member_id);
    let mMap = {};
    if (ids.length) {
      const { data: members } = await supabase
        .from("members").select("id, first_name, last_name, membership_id, email").in("id", ids);
      (members || []).forEach((m) => { mMap[m.id] = m; });
    }
    setRows((sigs || []).map((s) => ({ ...s, member: mMap[s.member_id] })));

    const { count: total } = await supabase.from("members")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId);
    const { count: signed } = await supabase.from("member_contract_signatures")
      .select("id", { count: "exact", head: true }).eq("company_id", companyId);
    const { count: expired } = await supabase.from("members")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .lt("expiry_date", new Date().toISOString().slice(0, 10));
    setStats({ total: total || 0, signed: signed || 0, expired: expired || 0 });
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 max-w-xl">
        <Stat label="Members" value={stats.total} />
        <Stat label="Signed" value={stats.signed} />
        <Stat label="Expired" value={stats.expired} tone="warn" />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Member</th>
              <th className="text-left px-3 py-2 font-medium">Membership #</th>
              <th className="text-left px-3 py-2 font-medium">Signed</th>
              <th className="text-left px-3 py-2 font-medium">Via</th>
              <th className="text-left px-3 py-2 font-medium">Ver</th>
              <th className="text-left px-3 py-2 font-medium">New expiry</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                No signatures yet.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {r.member ? `${r.member.first_name} ${r.member.last_name}` : r.typed_full_name || "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{r.member?.membership_id || "—"}</td>
                <td className="px-3 py-2">{r.signed_at ? new Date(r.signed_at).toLocaleString("en-ZA") : "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.signed_via}</td>
                <td className="px-3 py-2 text-muted-foreground">v{r.contract_version}</td>
                <td className="px-3 py-2">{r.new_expiry_date || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === "warn" ? "text-amber-500" : ""}`}>{value}</p>
    </div>
  );
}

/* ---------------- Bulk Email ---------------- */

const DEFAULT_BODY = `Hi {{first_name}},

Your membership at {{club_name}} has expired.

To renew, tap the button below. You'll be asked to read and sign the membership agreement, and to upload your ID and a profile photo. It takes about two minutes.

See you soon.`;

function EmailTab({ companyId, enabled }) {
  const { profile } = useAuth();
  const [subject, setSubject] = useState("{{first_name}}, your membership has expired");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [audience, setAudience] = useState("expired");
  const [preview, setPreview] = useState({ count: 0, loading: true });
  const [campaigns, setCampaigns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [batchSize, setBatchSize] = useState(50);

  const audienceQuery = () => {
    let q = supabase.from("members").select("id, email", { count: "exact" })
      .eq("company_id", companyId)
      .not("email", "is", null)
      .neq("email", "");
    const today = new Date().toISOString().slice(0, 10);
    if (audience === "expired") q = q.lt("expiry_date", today);
    if (audience === "active") q = q.gte("expiry_date", today);
    if (audience === "unsigned") q = q.is("signature_image", null);
    return q;
  };

  const loadPreview = async () => {
    setPreview({ count: 0, loading: true });
    const { count } = await audienceQuery().limit(1);
    setPreview({ count: count || 0, loading: false });
  };

  const loadCampaigns = async () => {
    const { data } = await supabase.from("email_campaigns")
      .select("*").eq("company_id", companyId)
      .order("created_at", { ascending: false }).limit(20);
    setCampaigns(data || []);
  };

  useEffect(() => { loadPreview(); }, [audience, companyId]);
  useEffect(() => { loadCampaigns(); }, [companyId]);

  const fetchAllRecipients = async () => {
    const out = [];
    const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await audienceQuery().range(from, from + step - 1);
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < step) break;
    }
    return out;
  };

  const createCampaign = async () => {
    setBusy(true);
    setMsg("");
    try {
      const recipients = await fetchAllRecipients();
      if (recipients.length === 0) throw new Error("No recipients match this audience.");

      const { data: campaign, error } = await supabase.from("email_campaigns").insert({
        company_id: companyId,
        subject, body, audience,
        status: "queued",
        total_recipients: recipients.length,
        created_by: profile?.id,
      }).select().single();
      if (error) throw error;

      const rows = recipients.map((r) => ({
        campaign_id: campaign.id,
        company_id: companyId,
        member_id: r.id,
        email: r.email,
        status: "pending",
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e2 } = await supabase.from("email_sends").insert(rows.slice(i, i + 500));
        if (e2) throw e2;
      }

      setMsg(`Campaign queued: ${recipients.length} recipients. Nothing has been sent yet — use "Send next batch" below.`);
      loadCampaigns();
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
    setBusy(false);
  };

  const sendBatch = async (campaignId) => {
    setBusy(true);
    setMsg("");
    try {
      const { data, error } = await supabase.functions.invoke("send-member-emails", {
        body: { campaign_id: campaignId, batch_size: Number(batchSize) },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "send failed");
      setMsg(`Batch done — sent ${data.sent}, failed ${data.failed}, ${data.remaining} remaining.`);
      loadCampaigns();
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    }
    setBusy(false);
  };

  if (!enabled) {
    return (
      <div className="max-w-md rounded-lg border border-border bg-card p-6">
        <AlertTriangle className="w-6 h-6 text-amber-500 mb-3" />
        <p className="text-sm text-muted-foreground">Bulk email is not enabled for this account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="font-semibold">New campaign</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Audience</label>
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
            >
              <option value="expired">Expired members</option>
              <option value="active">Active members</option>
              <option value="unsigned">Members without a signature</option>
              <option value="all">All members with an email</option>
            </select>
          </div>
          <div className="flex items-end">
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              {preview.loading ? "counting…" : `${preview.count} recipients`}
            </p>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Subject</label>
          <input
            className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium">Body</label>
          <textarea
            className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Tags: <code>{"{{first_name}}"}</code> <code>{"{{last_name}}"}</code>{" "}
            <code>{"{{club_name}}"}</code> <code>{"{{expiry_date}}"}</code>. A unique
            "Renew &amp; Sign" button is appended to every email automatically.
          </p>
        </div>

        {msg && <div className="text-sm px-3 py-2 rounded bg-muted">{msg}</div>}

        <Button onClick={createCampaign} disabled={busy || preview.count === 0}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LinkIcon className="w-4 h-4 mr-2" />}
          Queue campaign ({preview.count})
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Campaigns</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Batch size</label>
            <input
              type="number" min={1} max={100}
              className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
            />
            <Button variant="outline" size="sm" onClick={loadCampaigns}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {campaigns.length === 0 && (
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
        )}

        {campaigns.map((c) => {
          const remaining = (c.total_recipients || 0) - (c.sent_count || 0) - (c.failed_count || 0);
          return (
            <div key={c.id} className="rounded-lg border border-border p-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {c.audience} · {c.total_recipients} total · {c.sent_count || 0} sent ·{" "}
                  {c.failed_count || 0} failed · {remaining} remaining ·{" "}
                  <span className="uppercase">{c.status}</span>
                </p>
              </div>
              <Button
                size="sm"
                disabled={busy || remaining <= 0}
                onClick={() => sendBatch(c.id)}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                Send next batch
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
