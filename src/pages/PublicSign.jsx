import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Loader2, CheckCircle2, AlertTriangle, Upload, Eraser } from "lucide-react";

export default function PublicSign() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: null, ctx: null });
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [idFile, setIdFile] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState("");

  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("sign_get_context", { p_token: token });
      if (error) return setState({ loading: false, error: error.message, ctx: null });
      if (!data?.ok) return setState({ loading: false, error: data?.error || "invalid", ctx: null });
      setState({ loading: false, error: null, ctx: data });
      setTypedName(`${data.member.first_name || ""} ${data.member.last_name || ""}`.trim());
    })();
  }, [token]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, [state.ctx]);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    drawing.current = true;
    hasDrawn.current = true;
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
  };

  const uploadFile = async (file, prefix) => {
    if (!file) return null;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `member-signing/${state.ctx.company.id}/${state.ctx.member.id}-${prefix}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const { data } = supabase.storage.from("documents").getPublicUrl(path);
    return data.publicUrl;
  };

  const submit = async () => {
    setErr("");
    const c = state.ctx.contract;
    if (!agreed) return setErr("Please tick the box to accept the agreement.");
    if (!hasDrawn.current) return setErr("Please draw your signature.");
    if (!typedName.trim()) return setErr("Please type your full name.");
    if (c.require_id_document && !idFile) return setErr("Please upload your ID document.");
    if (c.require_profile_photo && !photoFile) return setErr("Please upload a profile photo.");

    setSubmitting(true);
    try {
      const signature = canvasRef.current.toDataURL("image/png");
      const idUrl = await uploadFile(idFile, "id");
      const photoUrl = await uploadFile(photoFile, "photo");

      const { data, error } = await supabase.rpc("sign_submit", {
        p_token: token,
        p_signature: signature,
        p_typed_name: typedName.trim(),
        p_id_document_url: idUrl,
        p_profile_image: photoUrl,
        p_ip: null,
        p_user_agent: navigator.userAgent.slice(0, 300),
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "submit failed");
      setDone(data.new_expiry_date);
    } catch (e) {
      setErr(e.message);
    }
    setSubmitting(false);
  };

  if (state.loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      </Shell>
    );
  }

  if (state.error) {
    const messages = {
      invalid_token: "This link isn't valid. Please ask the club for a new one.",
      already_signed: "This link has already been used. Your membership is already signed.",
      expired_token: "This link has expired. Please ask the club for a new one.",
      no_contract: "The club hasn't published a membership agreement yet.",
    };
    return (
      <Shell>
        <div className="text-center py-8">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <p className="text-zinc-700">{messages[state.error] || state.error}</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell club={state.ctx.company}>
        <div className="text-center py-8">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-zinc-900">You're all set</h2>
          <p className="text-zinc-600 mt-2">
            Your membership is renewed until <strong>{done}</strong>.
          </p>
        </div>
      </Shell>
    );
  }

  const { member, company, contract } = state.ctx;

  return (
    <Shell club={company}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">{contract.title}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {member.first_name} {member.last_name}
            {member.membership_id ? ` · ${member.membership_id}` : ""}
            {member.expiry_date ? ` · expired ${member.expiry_date}` : ""}
          </p>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 leading-relaxed">
          {renderBody(contract.body)}
        </div>

        <label className="flex items-start gap-3 text-sm text-zinc-800">
          <input
            type="checkbox"
            className="mt-1"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I have read and agree to the {contract.title} of {company.company_name}, and I confirm
            I am 18 years of age or older. I consent to {company.company_name} processing my personal
            information for membership administration.
          </span>
        </label>

        <div>
          <label className="text-sm font-medium text-zinc-800">Full name</label>
          <input
            className="w-full mt-1 px-3 py-2.5 rounded-lg border border-zinc-300 text-sm"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-zinc-800">Signature</label>
            <button onClick={clear} className="text-xs text-zinc-500 flex items-center gap-1">
              <Eraser className="w-3 h-3" /> Clear
            </button>
          </div>
          <canvas
            ref={canvasRef}
            className="w-full h-40 rounded-lg border-2 border-dashed border-zinc-300 bg-white touch-none"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          <p className="text-xs text-zinc-400 mt-1">Sign with your finger or mouse.</p>
        </div>

        {contract.require_id_document && (
          <FileField label="ID document (photo or scan)" file={idFile} onChange={setIdFile} accept="image/*,.pdf" />
        )}
        {contract.require_profile_photo && (
          <FileField label="Profile photo" file={photoFile} onChange={setPhotoFile} accept="image/*" />
        )}

        {err && (
          <div className="text-sm px-3 py-2 rounded bg-red-50 text-red-700 border border-red-200">{err}</div>
        )}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-3.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Submit &amp; renew membership
        </button>
      </div>
    </Shell>
  );
}

function FileField({ label, file, onChange, accept }) {
  return (
    <div>
      <label className="text-sm font-medium text-zinc-800">{label}</label>
      <label className="mt-1 flex items-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed border-zinc-300 cursor-pointer text-sm text-zinc-500 hover:border-zinc-400">
        <Upload className="w-4 h-4" />
        {file ? <span className="text-zinc-800">{file.name}</span> : <span>Tap to upload</span>}
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
      </label>
    </div>
  );
}

function renderBody(body) {
  return String(body || "").split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return <h3 key={i} className="font-bold text-zinc-900 mt-4 mb-1">{line.slice(3)}</h3>;
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    const bold = line.startsWith("**") && line.endsWith("**");
    return (
      <p key={i} className={bold ? "font-bold text-zinc-900 my-1" : "my-1"}>
        {bold ? line.slice(2, -2) : line}
      </p>
    );
  });
}

function Shell({ children, club }) {
  return (
    <div className="min-h-screen bg-zinc-100 py-6 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="bg-green-600 px-6 py-5 flex items-center gap-3">
          {club?.logo_url && (
            <img src={club.logo_url} alt="" className="h-9 w-9 rounded object-contain bg-white p-0.5" />
          )}
          <h1 className="text-white font-bold text-lg">{club?.company_name || "Membership"}</h1>
        </div>
        <div className="p-6">{children}</div>
        <div className="px-6 py-3 bg-zinc-50 border-t border-zinc-200">
          <p className="text-[11px] text-zinc-400">Powered by Cannalife Co · cannalife.co.za</p>
        </div>
      </div>
    </div>
  );
}
