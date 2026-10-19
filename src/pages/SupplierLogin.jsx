import { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";
import { Leaf, Store } from "lucide-react";

export default function SupplierLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      toast.error("Enter your email and password");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Check if this user has a supplier profile
      const { data: supplier, error: supErr } = await supabase
        .from("marketplace_suppliers")
        .select("id, business_name")
        .eq("user_id", data.user.id)
        .single();

      if (supErr || !supplier) {
        await supabase.auth.signOut();
        toast.error("No supplier account found for this email. Sign up first.");
        return;
      }

      toast.success(`Welcome back, ${supplier.business_name}!`);
      navigate("/supplier-dashboard");
    } catch (err) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-sm w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
              <Leaf className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold">Cannalife Co</span>
          </div>
          <div className="flex items-center justify-center gap-2 text-primary">
            <Store className="w-5 h-5" />
            <span className="text-sm font-semibold uppercase tracking-wider">Supplier Portal</span>
          </div>
          <h1 className="text-xl font-bold">Supplier Login</h1>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@business.com"
              autoFocus
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
          </div>
          <Button onClick={handleLogin} disabled={loading} className="w-full">
            {loading ? "Logging in..." : "Log In"}
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Not a supplier yet?{" "}
          <Link to="/supplier-signup" className="text-primary hover:underline">Sign up</Link>
          {" · "}
          <Link to="/login" className="text-primary hover:underline">Cannalife Co Admin Login</Link>
        </p>
      </div>
    </div>
  );
}
