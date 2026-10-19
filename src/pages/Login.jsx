import { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import cannalifeLogo from '../cannalife-logo.png';

/* ── helpers ── */
const looksLikePhone = (v) => /^\d{9,}$/.test(v.replace(/[\s\-()]+/g, ""));
const phoneToEmail = (phone) => {
  const digits = phone.replace(/\D/g, "");
  const normalized =
    digits.startsWith("27") && digits.length > 9
      ? "0" + digits.slice(2)
      : digits;
  return `${normalized}@cannalife.sms`;
};

export default function Login() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const trimmed = identifier.trim();
      const email = looksLikePhone(trimmed) ? phoneToEmail(trimmed) : trimmed;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/#/reset-password`,
      });
      if (error) throw error;
      setResetSent(true);
      toast.success("Check your inbox for a reset link");
    } catch (err) {
      toast.error(err.message || "Failed to send reset email");
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={cannalifeLogo} alt="Cannalife Co POS" className="h-20 w-auto mx-auto mb-3" />
          <p className="text-gray-500 text-sm mt-1">Sign in to your account</p>
        </div>

        {/* Sign In form */}
        {tab === "signin" && (
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Email or Phone Number</label>
              <input
                type="text"
                placeholder="you@email.com or 071 234 5678"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full p-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 transition-colors"
                required
                autoComplete="username"
              />
              {looksLikePhone(identifier) && (
                <p className="text-xs text-blue-600 mt-1">📱 Phone detected — will log in with your phone number</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-600 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-3 pr-12 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 transition-colors"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <button type="button" onClick={() => setTab("forgot")} className="text-xs text-green-600 hover:underline">
                Forgot password?
              </button>
            </div>

            <button type="submit" disabled={loading}
              className="w-full p-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {/* Forgot Password form */}
        {tab === "forgot" && (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-gray-500 text-sm">Enter your email and we&apos;ll send a password reset link.</p>
            <input
              type="email"
              placeholder="you@email.com"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              className="w-full p-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-green-500 transition-colors"
              required
            />
            <button type="submit" disabled={resetLoading || resetSent}
              className="w-full p-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
              {resetLoading ? "Sending..." : resetSent ? "Email Sent ✓" : "Send Reset Link"}
            </button>
            <p className="text-center text-gray-500 text-xs">
              Remembered it?{" "}
              <button type="button" onClick={() => setTab("signin")} className="text-green-600 hover:underline">Sign in</button>
            </p>
          </form>
        )}

      </div>
    </div>
  );
}
