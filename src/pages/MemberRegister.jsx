import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import cannalifeLogo from "../cannalife-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Leaf,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  CreditCard,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Shield,
} from "lucide-react";

const STEP_LABELS = ["Personal Info", "Contact Details", "Confirm"];

const MEMBERSHIP_TYPES = [
  { value: "bronze", label: "Bronze", color: "text-amber-700", activeBg: "bg-amber-100 border-amber-500 text-amber-800" },
  { value: "silver", label: "Silver", color: "text-gray-600", activeBg: "bg-gray-100 border-gray-400 text-gray-800" },
  { value: "gold", label: "Gold", color: "text-yellow-700", activeBg: "bg-yellow-100 border-yellow-500 text-yellow-800" },
  { value: "platinum", label: "Platinum", color: "text-purple-700", activeBg: "bg-purple-100 border-purple-500 text-purple-800" },
];

function generateMembershipId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "BUD-";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default function MemberRegister() {
  const [params] = useSearchParams();
  const companyId = params.get("company");

  const [step, setStep] = useState(0);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [membershipId, setMembershipId] = useState(null);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    gender: "",
    date_of_birth: "",
    id_number: "",
    nationality: "South African",
    email: "",
    phone: "",
    address: "",
    membership_type: "bronze",
    home_store_id: params.get("store") || "",
    agreed_tos: false,
  });

  const [errors, setErrors] = useState({});
  const [stores, setStores] = useState([]);

  useEffect(() => {
    if (!companyId) return;
    supabase.rpc("public_company_stores", { p_company_id: companyId }).then(({ data }) => {
      const list = data || [];
      setStores(list);
      setForm((f) => {
        if (f.home_store_id && list.some((s) => s.id === f.home_store_id)) return f;
        return { ...f, home_store_id: list.length === 1 ? list[0].id : "" };
      });
    });
  }, [companyId]);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      setError("Missing company ID. Please scan the QR code at your dispensary.");
      return;
    }
    (async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from("companies")
          .select("id, company_name, logo_url")
          .eq("id", companyId)
          .single();
        if (fetchErr || !data) {
          setError("Club not found. Please check the QR code and try again.");
        } else {
          setCompany(data);
        }
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  const set = (field) => (e) => {
    const val = e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [field]: val }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const validateStep = (s) => {
    const errs = {};
    if (s === 0) {
      if (!form.first_name.trim()) errs.first_name = "Required";
      if (!form.last_name.trim()) errs.last_name = "Required";
    }
    if (s === 1) {
      if (!form.phone.trim()) errs.phone = "Phone number is required";
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
        errs.email = "Invalid email";
    }
    if (s === 2) {
      if (!form.agreed_tos) errs.agreed_tos = "You must agree to continue";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, 2));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);
    try {
      const newId = generateMembershipId();
      const payload = {
        p_company_id: companyId,
        p_membership_id: newId,
        p_first_name: form.first_name.trim(),
        p_last_name: form.last_name.trim(),
        p_email: form.email.trim() || null,
        p_phone: form.phone.trim() || null,
        p_gender: form.gender || null,
        p_date_of_birth: form.date_of_birth || null,
        p_id_number: form.id_number.trim() || null,
        p_nationality: form.nationality.trim() || null,
        p_address: form.address.trim() || null,
        p_membership_type: form.membership_type || "bronze",
        p_home_store_id: form.home_store_id || null,
      };
      const { error: rpcErr } = await supabase.rpc("register_member", payload);
      if (rpcErr) {
        if (rpcErr.message?.includes("duplicate")) {
          setErrors({ submit: "A member with this phone or ID number already exists." });
        } else {
          setErrors({ submit: rpcErr.message || "Registration failed." });
        }
      } else {
        setMembershipId(newId);
        setSuccess(true);
      }
    } catch {
      setErrors({ submit: "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Registration Unavailable</h1>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (success) {
    const tier = MEMBERSHIP_TYPES.find((t) => t.value === form.membership_type);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-sm w-full text-center space-y-5">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-green-700" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900">Welcome!</h1>
            <p className="text-gray-600 text-sm">
              You're now a{" "}
              <span className={`font-semibold ${tier?.color}`}>{tier?.label}</span> member of{" "}
              <span className="text-green-700 font-medium">{company.company_name}</span>.
            </p>
          </div>
          <div className="bg-white shadow-sm border border-gray-200 rounded-xl p-4 space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Your Membership ID</p>
            <p className="text-2xl font-mono font-bold text-green-700 tracking-widest">
              {membershipId}
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Screenshot this — you'll need it at the counter.
            </p>
          </div>
          <p className="text-xs text-gray-500">You can close this page now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="px-4 pt-8 pb-4 text-center">
        <img src={cannalifeLogo} alt="Canna Life Co" className="h-16 w-auto mx-auto mb-3 object-contain" />
        <h1 className="text-xl font-bold text-gray-900">{company.company_name}</h1>
        <p className="text-sm text-gray-600 mt-1">Member Registration</p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-center gap-2 pb-4">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  i < step
                    ? "bg-green-600 text-white"
                    : i === step
                      ? "bg-green-600/20 text-green-700 ring-2 ring-green-500/40"
                      : "bg-gray-200 text-gray-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span className={`text-[10px] mt-1 ${i === step ? "text-green-700" : "text-gray-500"}`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`w-8 h-px mb-4 ${i < step ? "bg-green-600" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Form card */}
      <div className="px-4 pb-8">
        <div className="max-w-md mx-auto bg-white shadow-sm border border-gray-200 rounded-2xl p-5 space-y-5">

          {/* Step 0: Personal Info */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 mb-1">
                <User className="h-4 w-4" />
                <span className="text-sm font-medium">Personal Information</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-700 text-xs">First Name *</Label>
                  <Input
                    value={form.first_name}
                    onChange={set("first_name")}
                    placeholder="First name"
                    className={`mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 ${errors.first_name ? "border-red-500" : ""}`}
                  />
                  {errors.first_name && <p className="text-red-400 text-xs mt-1">{errors.first_name}</p>}
                </div>
                <div>
                  <Label className="text-gray-700 text-xs">Last Name *</Label>
                  <Input
                    value={form.last_name}
                    onChange={set("last_name")}
                    placeholder="Last name"
                    className={`mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 ${errors.last_name ? "border-red-500" : ""}`}
                  />
                  {errors.last_name && <p className="text-red-400 text-xs mt-1">{errors.last_name}</p>}
                </div>
              </div>
              <div>
                <Label className="text-gray-700 text-xs">Gender</Label>
                <div className="flex gap-2 mt-1">
                  {["Male", "Female", "Other"].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => set("gender")(g.toLowerCase())}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                        form.gender === g.toLowerCase()
                          ? "bg-green-600/20 text-green-700 border border-green-500/40"
                          : "bg-white text-gray-600 border border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-700 text-xs">Date of Birth</Label>
                  <Input
                    type="date"
                    value={form.date_of_birth}
                    onChange={set("date_of_birth")}
                    className="mt-1 bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div>
                  <Label className="text-gray-700 text-xs">SA ID / Passport</Label>
                  <Input
                    value={form.id_number}
                    onChange={set("id_number")}
                    placeholder="ID number"
                    className="mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
                  />
                </div>
              </div>
              <div>
                <Label className="text-gray-700 text-xs">Nationality</Label>
                <Input
                  value={form.nationality}
                  onChange={set("nationality")}
                  className="mt-1 bg-white border-gray-300 text-gray-900"
                />
              </div>
            </div>
          )}

          {/* Step 1: Contact Details */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 mb-1">
                <Phone className="h-4 w-4" />
                <span className="text-sm font-medium">Contact Details</span>
              </div>
              <div>
                <Label className="text-gray-700 text-xs">Phone Number *</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="e.g. 072 123 4567"
                  className={`mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 ${errors.phone ? "border-red-500" : ""}`}
                />
                {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
              </div>
              <div>
                <Label className="text-gray-700 text-xs">Email Address</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  placeholder="you@example.com"
                  className={`mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 ${errors.email ? "border-red-500" : ""}`}
                />
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
              </div>
              <div>
                <Label className="text-gray-700 text-xs">Address</Label>
                <Textarea
                  value={form.address}
                  onChange={set("address")}
                  placeholder="Street, suburb, city"
                  rows={2}
                  className="mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 resize-none"
                />
              </div>
              {stores.length > 1 && (
                <div>
                  <Label className="text-gray-700 text-xs">Home Club</Label>
                  <select
                    value={form.home_store_id}
                    onChange={(e) => set("home_store_id")(e.target.value)}
                    className="mt-1 w-full h-10 rounded-md border border-gray-300 bg-white text-gray-900 text-sm px-3"
                  >
                    <option value="">Select your home club</option>
                    {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label className="text-gray-700 text-xs">Membership Type</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {MEMBERSHIP_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => set("membership_type")(t.value)}
                      className={`py-2.5 rounded-lg text-sm font-medium transition-all border ${
                        form.membership_type === t.value
                          ? t.activeBg
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Confirm */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-700 mb-1">
                <Shield className="h-4 w-4" />
                <span className="text-sm font-medium">Review & Confirm</span>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 border border-gray-200">
                <Row label="Name" value={`${form.first_name} ${form.last_name}`} />
                {form.gender && <Row label="Gender" value={form.gender} capitalize />}
                {form.date_of_birth && <Row label="Date of Birth" value={form.date_of_birth} />}
                {form.id_number && <Row label="ID / Passport" value={form.id_number} />}
                {form.nationality && <Row label="Nationality" value={form.nationality} />}
                <div className="border-t border-gray-200 my-2" />
                <Row label="Phone" value={form.phone || "—"} />
                {form.email && <Row label="Email" value={form.email} />}
                {form.address && <Row label="Address" value={form.address} />}
                {form.home_store_id && <Row label="Home Club" value={stores.find((st) => st.id === form.home_store_id)?.name || ""} />}
                <Row label="Type" value={MEMBERSHIP_TYPES.find((t) => t.value === form.membership_type)?.label || form.membership_type} />
              </div>
              <label className="flex items-start gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={form.agreed_tos}
                  onChange={(e) => setForm((f) => ({ ...f, agreed_tos: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 bg-white text-green-600 focus:ring-green-500"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I confirm the information above is correct. I agree to the club's membership
                  terms and consent to my details being stored for membership purposes.
                </span>
              </label>
              {errors.agreed_tos && <p className="text-red-400 text-xs">{errors.agreed_tos}</p>}
              {errors.submit && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <p className="text-red-400 text-sm">{errors.submit}</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={back}
                className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            )}
            {step < 2 ? (
              <Button
                type="button"
                onClick={next}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Registering...
                  </>
                ) : (
                  "Complete Registration"
                )}
              </Button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Powered by <span className="text-gray-500">Canna Life Co</span>
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, capitalize }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 ${capitalize ? "capitalize" : ""}`}>{value}</span>
    </div>
  );
}
