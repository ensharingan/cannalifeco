import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import cannalifeLogo from '../cannalife-logo.png';

var supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

var PRODUCT_CATEGORIES = [
  "Flower / Bud",
  "Pre-rolls",
  "Edibles",
  "Concentrates / Extracts",
  "Tinctures / Oils",
  "Topicals",
  "Seeds / Clones",
  "Accessories & Hardware",
  "Packaging & Supplies",
  "Other",
];

var PROVINCES = [
  "Gauteng","Western Cape","KwaZulu-Natal","Eastern Cape",
  "Free State","Limpopo","Mpumalanga","North West","Northern Cape",
];

export default function SupplierSignup() {
  var [step, setStep] = useState(1);
  var [loading, setLoading] = useState(false);
  var [submitted, setSubmitted] = useState(false);
  var [error, setError] = useState("");

  var [form, setForm] = useState({
    business_name: "",
    contact_name: "",
    email: "",
    phone: "",
    whatsapp: "",
    location: "",
    province: "",
    description: "",
    product_categories: [],
    website: "",
    instagram: "",
  });

  function handleChange(e) {
    var n = e.target.name;
    var v = e.target.value;
    setForm(function(prev) { return Object.assign({}, prev, { [n]: v }); });
  }

  function toggleCategory(cat) {
    setForm(function(prev) {
      var cats = prev.product_categories;
      if (cats.includes(cat)) {
        return Object.assign({}, prev, { product_categories: cats.filter(function(c) { return c !== cat; }) });
      }
      return Object.assign({}, prev, { product_categories: cats.concat([cat]) });
    });
  }

  function validateStep1() {
    if (!form.business_name.trim()) return "Business name is required.";
    if (!form.contact_name.trim()) return "Contact name is required.";
    if (!form.email.trim() || !form.email.includes("@")) return "A valid email is required.";
    if (!form.phone.trim()) return "Phone number is required.";
    return "";
  }

  function validateStep2() {
    if (!form.province) return "Please select a province.";
    if (!form.description.trim()) return "Please add a short description.";
    if (form.product_categories.length === 0) return "Select at least one product category.";
    return "";
  }

  function handleNext() {
    var err = validateStep1();
    if (err) { setError(err); return; }
    setError("");
    setStep(2);
  }

  async function handleSubmit() {
    var err = validateStep2();
    if (err) { setError(err); return; }
    setError("");
    setLoading(true);

    var locationStr = form.province + (form.location.trim() ? ", " + form.location.trim() : "");
    var descriptionFull = form.description
      + (form.product_categories.length ? "\n\nCategories: " + form.product_categories.join(", ") : "")
      + (form.website ? "\nWebsite: " + form.website : "")
      + (form.instagram ? "\nInstagram: " + form.instagram : "");

    var result = await supabase.from("marketplace_suppliers").insert([{
      business_name: form.business_name.trim(),
      contact_name: form.contact_name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || form.phone.trim(),
      location: locationStr,
      description: descriptionFull,
      is_active: false,
      is_verified: false,
    }]);

    setLoading(false);

    if (result.error) {
      setError("Something went wrong: " + result.error.message);
      return;
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.successIcon}>✓</div>
          <h2 style={styles.successTitle}>Application Received</h2>
          <p style={styles.successText}>
            Thanks <strong>{form.contact_name}</strong>! We've received the application for <strong>{form.business_name}</strong>.
          </p>
          <p style={styles.successSub}>
            Our team will review your details and reach out via WhatsApp or email within 1–2 business days.
          </p>
          <p style={styles.successContact}>
            Questions? Email us: <a href="mailto:info@cannalife.co.za" style={styles.link}>info@cannalife.co.za</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        <div style={styles.header}>
          <img src={cannalifeLogo} alt="Canna Life Co" style={styles.logo} />
          <p style={styles.badge}>SUPPLIER MARKETPLACE</p>
          <h1 style={styles.title}>Register as a Supplier</h1>
          <p style={styles.subtitle}>List your products and reach dispensary owners across South Africa.</p>
        </div>

        <div style={styles.stepRow}>
          <div style={Object.assign({}, styles.stepDot, step >= 1 ? styles.stepDotActive : {})}>1</div>
          <div style={Object.assign({}, styles.stepLine, step >= 2 ? styles.stepLineActive : {})} />
          <div style={Object.assign({}, styles.stepDot, step >= 2 ? styles.stepDotActive : {})}>2</div>
        </div>
        <div style={styles.stepLabels}>
          <span style={Object.assign({}, styles.stepLabel, step === 1 ? styles.stepLabelActive : {})}>Your Details</span>
          <span style={Object.assign({}, styles.stepLabel, step === 2 ? styles.stepLabelActive : {})}>Your Products</span>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        {step === 1 && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Business Name *</label>
            <input style={styles.input} name="business_name" value={form.business_name} onChange={handleChange} placeholder="e.g. Green Valley Genetics" />

            <label style={styles.label}>Email Address *</label>
            <input style={styles.input} name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@yourbusiness.co.za" />

            <label style={styles.label}>Contact Person *</label>
            <input style={styles.input} name="contact_name" value={form.contact_name} onChange={handleChange} placeholder="Full name" />

            <label style={styles.label}>Phone Number *</label>
            <input style={styles.input} name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="e.g. 0821234567" />

            <label style={styles.label}>WhatsApp <span style={styles.optional}>(if different from phone)</span></label>
            <input style={styles.input} name="whatsapp" type="tel" value={form.whatsapp} onChange={handleChange} placeholder="Same as phone if blank" />

            <label style={styles.label}>Location</label>
            <input style={styles.input} name="location" value={form.location} onChange={handleChange} placeholder="e.g. Johannesburg" />

            <button style={styles.btnPrimary} onClick={handleNext}>Continue →</button>
          </div>
        )}

        {step === 2 && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Province *</label>
            <select style={styles.input} name="province" value={form.province} onChange={handleChange}>
              <option value="">Select province...</option>
              {PROVINCES.map(function(p) { return <option key={p} value={p}>{p}</option>; })}
            </select>

            <label style={styles.label}>What do you supply? *</label>
            <p style={styles.hint}>Select all that apply</p>
            <div style={styles.categoryGrid}>
              {PRODUCT_CATEGORIES.map(function(cat) {
                var active = form.product_categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    style={Object.assign({}, styles.categoryChip, active ? styles.categoryChipActive : {})}
                    onClick={function() { toggleCategory(cat); }}
                  >
                    {active ? "✓ " : ""}{cat}
                  </button>
                );
              })}
            </div>

            <label style={styles.label}>About Your Business *</label>
            <textarea
              style={Object.assign({}, styles.input, { resize: "vertical", minHeight: "90px", fontFamily: "inherit", lineHeight: "1.5" })}
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="What products do you supply? Min orders, quality, delivery areas..."
              rows={4}
            />

            <label style={styles.label}>Website <span style={styles.optional}>(optional)</span></label>
            <input style={styles.input} name="website" value={form.website} onChange={handleChange} placeholder="https://yourwebsite.co.za" />

            <label style={styles.label}>Instagram <span style={styles.optional}>(optional)</span></label>
            <input style={styles.input} name="instagram" value={form.instagram} onChange={handleChange} placeholder="@yourbusiness" />

            <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
              <button style={styles.btnSecondary} onClick={function() { setError(""); setStep(1); }}>← Back</button>
              <button
                style={Object.assign({}, styles.btnPrimary, { flex: 1, marginTop: "20px", opacity: loading ? 0.6 : 1 })}
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? "Submitting..." : "Submit Application"}
              </button>
            </div>
          </div>
        )}

        <p style={styles.footer}>
          Already a supplier? <a href="https://pos.cannalife.co.za" style={styles.link}>Canna Life Co Admin Login</a>
        </p>
      </div>
    </div>
  );
}

var green = "#34ad79";
var darkBg = "#0f1a12";
var cardBg = "#152018";
var borderColor = "#2a3d2e";
var textMain = "#e8f5ea";
var textMuted = "#7a9e80";

var styles = {
  page: { minHeight: "100vh", background: darkBg, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "'Inter', system-ui, sans-serif" },
  card: { background: cardBg, border: "1px solid " + borderColor, borderRadius: "16px", padding: "36px 32px", width: "100%", maxWidth: "460px", boxShadow: "0 8px 40px rgba(0,0,0,0.4)" },
  header: { textAlign: "center", marginBottom: "24px" },
  logo: { height: "44px", marginBottom: "10px" },
  badge: { fontSize: "11px", fontWeight: "700", color: green, letterSpacing: "0.1em", margin: "0 0 8px" },
  title: { fontSize: "20px", fontWeight: "700", color: textMain, margin: "0 0 6px" },
  subtitle: { fontSize: "13px", color: textMuted, margin: 0, lineHeight: "1.5" },
  stepRow: { display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "6px" },
  stepDot: { width: "28px", height: "28px", borderRadius: "50%", background: borderColor, color: textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" },
  stepDotActive: { background: green, color: "#0f1a12" },
  stepLine: { flex: 1, maxWidth: "80px", height: "2px", background: borderColor, margin: "0 8px" },
  stepLineActive: { background: green },
  stepLabels: { display: "flex", justifyContent: "space-between", paddingLeft: "8px", paddingRight: "8px", marginBottom: "20px" },
  stepLabel: { fontSize: "11px", color: textMuted },
  stepLabelActive: { color: green, fontWeight: "600" },
  errorBox: { background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "10px 14px", color: "#fca5a5", fontSize: "13px", marginBottom: "14px" },
  formGroup: { display: "flex", flexDirection: "column", gap: "4px" },
  label: { fontSize: "13px", fontWeight: "600", color: textMain, marginTop: "14px", marginBottom: "4px" },
  optional: { fontWeight: "400", color: textMuted, fontSize: "12px" },
  hint: { fontSize: "11px", color: textMuted, margin: "0 0 8px" },
  input: { background: "#0f1a12", border: "1px solid " + borderColor, borderRadius: "8px", color: textMain, fontSize: "14px", padding: "10px 14px", outline: "none", width: "100%", boxSizing: "border-box" },
  categoryGrid: { display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "4px" },
  categoryChip: { padding: "6px 12px", borderRadius: "20px", border: "1px solid " + borderColor, background: "transparent", color: textMuted, fontSize: "12px", cursor: "pointer" },
  categoryChipActive: { background: "rgba(74,222,128,0.12)", border: "1px solid " + green, color: green, fontWeight: "600" },
  btnPrimary: { background: green, color: "#0f1a12", border: "none", borderRadius: "8px", padding: "12px 20px", fontSize: "14px", fontWeight: "700", cursor: "pointer", marginTop: "20px", width: "100%" },
  btnSecondary: { background: "transparent", color: textMuted, border: "1px solid " + borderColor, borderRadius: "8px", padding: "12px 20px", fontSize: "14px", fontWeight: "600", cursor: "pointer", marginTop: "20px" },
  footer: { fontSize: "12px", color: textMuted, textAlign: "center", marginTop: "20px" },
  link: { color: green, textDecoration: "none" },
  successIcon: { width: "52px", height: "52px", background: "rgba(74,222,128,0.15)", border: "2px solid " + green, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", color: green, margin: "0 auto 16px", fontWeight: "700" },
  successTitle: { fontSize: "20px", fontWeight: "700", color: textMain, textAlign: "center", margin: "0 0 10px" },
  successText: { fontSize: "14px", color: textMain, textAlign: "center", lineHeight: "1.6", margin: "0 0 8px" },
  successSub: { fontSize: "13px", color: textMuted, textAlign: "center", lineHeight: "1.6", margin: "0 0 16px" },
  successContact: { fontSize: "13px", color: textMuted, textAlign: "center" },
};
