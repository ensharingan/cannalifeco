import { useState, useEffect } from "react";
import { supabase } from "@/api/supabaseClient";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

export default function MemberPortalLogin() {
  var navigate = useNavigate();
  var params = useParams();
  var companyId = params.companyId;
  var [idNumber, setIdNumber] = useState("");
  var [phone, setPhone] = useState("");
  var [loading, setLoading] = useState(false);
  var [companyName, setCompanyName] = useState("");
  var [companyLogo, setCompanyLogo] = useState("");
  var [notFound, setNotFound] = useState(false);

  useEffect(function () {
    if (!companyId) {
      setNotFound(true);
      return;
    }
    supabase
      .from("companies")
      // NOTE: "logo" is a legacy column that is never populated — the real
      // uploaded club logo lives in "logo_url".
      .select("company_name, trading_name, logo_url")
      .eq("id", companyId)
      .single()
      .then(function (res) {
        if (res.error || !res.data) {
          setNotFound(true);
        } else {
          setCompanyName(res.data.trading_name || res.data.company_name || "Member Portal");
          setCompanyLogo(res.data.logo_url || "");
        }
      });
  }, [companyId]);

  var handleLogin = async function (e) {
    e.preventDefault();

    var cleanId = idNumber.trim();
    var cleanPhone = phone.trim();

    if (!cleanId || !cleanPhone) {
      toast.error("Please enter both your ID / passport number and your phone number");
      return;
    }

    setLoading(true);
    try {
      // Credential check runs inside Postgres (member_portal_login RPC).
      // It normalises punctuation, spacing and case on the document number, and
      // matches the phone on its last 9 digits so 082..., 27 82... and +2782...
      // all resolve to the same member.
      var { data, error } = await supabase.rpc("member_portal_login", {
        p_company_id: companyId,
        p_id_number: cleanId,
        p_phone: cleanPhone,
      });

      if (error) {
        toast.error("Something went wrong. Please try again.");
        return;
      }

      var member = Array.isArray(data) ? data[0] : data;

      if (!member) {
        toast.error("No member found. Check your ID / passport number and the phone number your club has on file.");
        return;
      }

      if (member.is_banned) {
        toast.error("Your membership has been suspended. Please contact your club.");
        return;
      }

      sessionStorage.setItem("portal_member", JSON.stringify(member));
      sessionStorage.setItem("portal_company_id", companyId);
      navigate("/member-portal/" + companyId + "/dashboard");
    } catch (err) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (notFound) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#f3f5f3",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Outfit', sans-serif",
        color: "#111827",
        padding: "20px",
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔒</div>
          <h1 style={{ fontSize: "22px", fontWeight: "600", marginBottom: "8px" }}>Portal Not Found</h1>
          <p style={{ color: "#6b7280", fontSize: "14px" }}>
            This member portal link is invalid. Please contact your club for the correct link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f3f5f3",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      fontFamily: "'Outfit', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      <div style={{ width: "100%", maxWidth: "420px" }}>
        {/* Logo / Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          {companyLogo ? (
            <img
              src={companyLogo}
              alt={companyName}
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "16px",
                objectFit: "cover",
                margin: "0 auto 16px",
                display: "block",
              }}
            />
          ) : (
            <div style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: "28px",
            }}>
              🌿
            </div>
          )}
          <h1 style={{
            color: "#111827",
            fontSize: "24px",
            fontWeight: "700",
            margin: "0 0 4px",
            letterSpacing: "-0.5px",
          }}>
            {companyName}
          </h1>
          <p style={{ color: "#6b7280", fontSize: "14px", margin: "0" }}>
            Member Portal — Log in to view your membership
          </p>
        </div>

        {/* Login Card */}
        <div style={{
          background: "#ffffff",
          border: "1px solid rgba(0,0,0,0.14)",
          borderRadius: "16px",
          padding: "32px 28px",
          backdropFilter: "blur(20px)",
        }}>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: "20px" }}>
              <label style={{
                display: "block",
                color: "#374151",
                fontSize: "13px",
                fontWeight: "500",
                marginBottom: "6px",
              }}>
                ID / Passport Number
              </label>
              <input
                type="text"
                value={idNumber}
                onChange={function (e) { setIdNumber(e.target.value); }}
                placeholder="SA ID, passport or permit number"
                maxLength={30}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: "rgba(0,0,0,0.04)",
                  border: "1px solid rgba(0,0,0,0.14)",
                  borderRadius: "10px",
                  color: "#111827",
                  fontSize: "16px",
                  outline: "none",
                  fontFamily: "'Outfit', sans-serif",
                  letterSpacing: "1px",
                  boxSizing: "border-box",
                }}
                onFocus={function (e) { e.target.style.borderColor = "#22c55e"; }}
                onBlur={function (e) { e.target.style.borderColor = "rgba(0,0,0,0.14)"; }}
              />
              <p style={{
                color: "#6b7280",
                fontSize: "11px",
                margin: "6px 2px 0",
                lineHeight: "1.4",
              }}>
                Use the same document you signed up with — SA ID, passport or permit.
              </p>
            </div>

            <div style={{ marginBottom: "28px" }}>
              <label style={{
                display: "block",
                color: "#374151",
                fontSize: "13px",
                fontWeight: "500",
                marginBottom: "6px",
              }}>
                Phone Number
              </label>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={function (e) { setPhone(e.target.value); }}
                placeholder="e.g. 0821234567"
                autoComplete="tel"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  background: "rgba(0,0,0,0.04)",
                  border: "1px solid rgba(0,0,0,0.14)",
                  borderRadius: "10px",
                  color: "#111827",
                  fontSize: "16px",
                  outline: "none",
                  fontFamily: "'Outfit', sans-serif",
                  boxSizing: "border-box",
                }}
                onFocus={function (e) { e.target.style.borderColor = "#22c55e"; }}
                onBlur={function (e) { e.target.style.borderColor = "rgba(0,0,0,0.14)"; }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "14px",
                background: loading ? "#374151" : "linear-gradient(135deg, #22c55e, #16a34a)",
                border: "none",
                borderRadius: "10px",
                color: "#fff",
                fontSize: "16px",
                fontWeight: "600",
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "'Outfit', sans-serif",
                transition: "all 0.2s",
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Checking..." : "Log In"}
            </button>
          </form>
        </div>

        <p style={{
          textAlign: "center",
          color: "#6b7280",
          fontSize: "12px",
          marginTop: "24px",
        }}>
          🌿 Powered by <span style={{ color: "#22c55e", fontWeight: "600" }}>Canna Life Co</span>
        </p>
      </div>
    </div>
  );
}
