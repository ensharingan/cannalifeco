import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { useParams, useNavigate } from "react-router-dom";
import { Search, MapPin, Phone, Mail, Cannabis, ChevronDown, ChevronUp, User, Send, CheckCircle, Lock, Leaf } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

var CATEGORY_ICONS = {
  flower: "🌿", pre_rolls: "🚬", hash_slab: "🔥", vape: "💨",
  tincture: "💧", gummies: "🍬", edibles: "🍪", accessories: "🔧",
  concentrates: "🔥", beverages: "🥤", topicals: "✨", oils: "💧",
  other: "📦", bundle: "🎁",
};

function normalizeCat(raw) {
  if (!raw) return "other";
  return raw.toLowerCase().replace(/-/g, "_").replace(/ /g, "_");
}

function prettyCategory(key) {
  var icon = CATEGORY_ICONS[key] || "📦";
  var name = key.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return icon + " " + name;
}

var EMPTY_ENQUIRY = {
  first_name: "", last_name: "", phone: "", email: "", id_number: "", notes: "",
};

export default function ClubPublicPage() {
  var { companyId } = useParams();
  var navigate = useNavigate();

  var [company, setCompany] = useState(null);
  var [products, setProducts] = useState([]);
  var [loading, setLoading] = useState(true);
  var [notFound, setNotFound] = useState(false);
  var [notActive, setNotActive] = useState(false);

  var [search, setSearch] = useState("");
  var [selectedCategory, setSelectedCategory] = useState("");
  var [expandedProduct, setExpandedProduct] = useState(null);

  var [enquiry, setEnquiry] = useState({ ...EMPTY_ENQUIRY });
  var [submitting, setSubmitting] = useState(false);
  var [submitted, setSubmitted] = useState(false);

  // ── Load company + products ──
  useEffect(function () {
    if (!companyId) return;
    var cancelled = false;

    async function load() {
      setLoading(true);
      try {
        var coRes = await supabase
          .from("companies")
          .select("id, company_name, trading_name, description, logo_url, logo, address, city, country, phone, email, owner_phone, status, is_listed")
          .eq("id", companyId)
          .single();

        if (cancelled) return;

        if (coRes.error || !coRes.data) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        var co = coRes.data;

        if (co.status !== "active") {
          setNotActive(true);
          setLoading(false);
          return;
        }

        setCompany(co);

        var prodRes = await supabase
          .from("products")
          .select("id, name, category, description, price, stock_quantity, unit_weight, product_type, price_tiers")
          .eq("company_id", companyId)
          .gt("stock_quantity", 0)
          .order("category")
          .limit(200);

        if (cancelled) return;
        setProducts(prodRes.data || []);
      } catch (err) {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return function () { cancelled = true; };
  }, [companyId]);

  var categories = useMemo(function () {
    var seen = {};
    products.forEach(function (p) {
      var k = normalizeCat(p.category);
      if (k) seen[k] = true;
    });
    return Object.keys(seen).sort();
  }, [products]);

  var filtered = useMemo(function () {
    return products.filter(function (p) {
      if (selectedCategory && normalizeCat(p.category) !== selectedCategory) return false;
      if (search && !(p.name || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, search, selectedCategory]);

  var upEnquiry = function (field, value) {
    setEnquiry(function (prev) { return { ...prev, [field]: value }; });
  };

  var handleEnquiry = async function () {
    if (!enquiry.first_name.trim() || !enquiry.last_name.trim() || !enquiry.phone.trim()) {
      toast.error("Please fill in your name and phone number");
      return;
    }
    setSubmitting(true);
    try {
      var insertRes = await supabase.from("members").insert({
        company_id: companyId,
        first_name: enquiry.first_name.trim(),
        last_name: enquiry.last_name.trim(),
        phone: enquiry.phone.trim(),
        email: enquiry.email.trim() || null,
        id_number: enquiry.id_number.trim() || null,
        notes: enquiry.notes.trim() || null,
        status: "pending",
        is_active: false,
        membership_type: "standard",
        membership_start_date: new Date().toISOString().split("T")[0],
        registration_date: new Date().toISOString(),
      });
      if (insertRes.error) throw insertRes.error;
      setSubmitted(true);
      setEnquiry({ ...EMPTY_ENQUIRY });
    } catch (err) {
      toast.error("Failed to submit — please try again or contact the club directly.");
    } finally {
      setSubmitting(false);
    }
  };

  var displayName = company ? (company.trading_name || company.company_name) : "";
  var logo = company ? (company.logo_url || company.logo) : null;
  var contactPhone = company ? (company.phone || company.owner_phone) : null;

  // ── Loading ──
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );

  // ── Not found ──
  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-8 text-center">
      <Leaf className="w-12 h-12 text-muted-foreground opacity-30" />
      <h1 className="text-2xl font-bold">Club not found</h1>
      <p className="text-muted-foreground text-sm">This club doesn't exist or the link is incorrect.</p>
    </div>
  );

  // ── Not active (trial or suspended) ──
  if (notActive) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-8 text-center">
      <Lock className="w-12 h-12 text-muted-foreground opacity-30" />
      <h1 className="text-2xl font-bold">Coming Soon</h1>
      <p className="text-muted-foreground text-sm max-w-sm">This club's website isn't live yet. Check back soon.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── Header / Hero ── */}
      <div className="bg-gradient-to-b from-primary/10 to-background border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col items-center text-center gap-4">
          {logo ? (
            <img src={logo} alt={displayName} className="w-20 h-20 rounded-2xl object-cover border border-border shadow-sm" />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center border border-border">
              <Leaf className="w-10 h-10 text-primary" />
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
            {company.description && (
              <p className="text-muted-foreground text-sm mt-2 max-w-lg mx-auto leading-relaxed">{company.description}</p>
            )}
          </div>

          {/* Contact pills */}
          <div className="flex flex-wrap gap-2 justify-center">
            {(company.address || company.city) && (
              <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-muted text-muted-foreground border border-border">
                <MapPin className="w-3.5 h-3.5" />
                {[company.address, company.city].filter(Boolean).join(", ")}
              </span>
            )}
            {contactPhone && (
              <a href={"tel:" + contactPhone}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-muted text-muted-foreground border border-border hover:border-primary/40 transition-colors">
                <Phone className="w-3.5 h-3.5" />
                {contactPhone}
              </a>
            )}
            {company.email && (
              <a href={"mailto:" + company.email}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-muted text-muted-foreground border border-border hover:border-primary/40 transition-colors">
                <Mail className="w-3.5 h-3.5" />
                {company.email}
              </a>
            )}
          </div>

          {/* Member login CTA */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 mt-1"
            onClick={function () { navigate("/member-portal/" + companyId); }}
          >
            <User className="w-4 h-4" /> Member Login
          </Button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">

        {/* ── Menu ── */}
        <section>
          <h2 className="text-xl font-bold mb-4">Our Menu</h2>

          {/* Search + category filter */}
          <div className="space-y-3 mb-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={function (e) { setSearch(e.target.value); }}
                className="pl-10"
              />
            </div>
            {categories.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={function () { setSelectedCategory(""); }}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border",
                    !selectedCategory ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent hover:border-border"
                  )}>
                  All
                </button>
                {categories.map(function (cat) {
                  return (
                    <button key={cat}
                      onClick={function () { setSelectedCategory(cat); }}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border",
                        selectedCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent hover:border-border"
                      )}>
                      {prettyCategory(cat)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Product list */}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No products available right now.</p>
          ) : (
            <div className="space-y-2">
              {filtered.map(function (p) {
                var isExpanded = expandedProduct === p.id;
                var tiers = p.price_tiers || [];
                return (
                  <div key={p.id} className="rounded-xl border border-border overflow-hidden">
                    <button
                      onClick={function () { setExpandedProduct(isExpanded ? null : p.id); }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors text-left gap-3"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className="text-xl shrink-0">{CATEGORY_ICONS[normalizeCat(p.category)] || "📦"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          {p.description && !isExpanded && (
                            <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-primary">{parseFloat(p.price).toFixed(2)}<span className="text-xs text-muted-foreground font-normal">/g</span></span>
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        }
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-border/50 bg-muted/10 space-y-3 pt-3">
                        {p.description && (
                          <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                        )}
                        {tiers.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Price tiers</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <div className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border">
                                <span className="text-sm font-bold text-primary">1g</span>
                                <span className="text-sm font-semibold">{parseFloat(p.price).toFixed(2)}</span>
                              </div>
                              {tiers.map(function (tier, idx) {
                                return (
                                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-border">
                                    <span className="text-sm font-bold text-primary">{tier.grams}g</span>
                                    <span className="text-sm font-semibold">{parseFloat(tier.price).toFixed(2)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {p.stock_quantity > 0 ? "✓ In stock" : "Out of stock"}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Join / Enquiry Form ── */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <div className="mb-5">
            <h2 className="text-xl font-bold">Become a Member</h2>
            <p className="text-sm text-muted-foreground mt-1">Fill in your details and the club will be in touch to complete your membership.</p>
          </div>

          {submitted ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-500" />
              <h3 className="font-semibold text-lg">Enquiry received!</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Thanks! The club will contact you shortly to finalise your membership.
              </p>
              <button
                onClick={function () { setSubmitted(false); }}
                className="text-xs text-primary hover:underline mt-2"
              >
                Submit another enquiry
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">First Name *</Label>
                  <Input value={enquiry.first_name} onChange={function (e) { upEnquiry("first_name", e.target.value); }} placeholder="First name" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Last Name *</Label>
                  <Input value={enquiry.last_name} onChange={function (e) { upEnquiry("last_name", e.target.value); }} placeholder="Last name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Phone *</Label>
                  <Input value={enquiry.phone} onChange={function (e) { upEnquiry("phone", e.target.value); }} placeholder="e.g. 082 000 0000" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <Input type="email" value={enquiry.email} onChange={function (e) { upEnquiry("email", e.target.value); }} placeholder="Optional" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">SA ID Number</Label>
                <Input value={enquiry.id_number} onChange={function (e) { upEnquiry("id_number", e.target.value); }} placeholder="Optional" maxLength={13} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Message</Label>
                <Textarea value={enquiry.notes} onChange={function (e) { upEnquiry("notes", e.target.value); }} placeholder="Anything you'd like the club to know..." rows={3} />
              </div>
              <Button
                onClick={handleEnquiry}
                disabled={submitting || !enquiry.first_name.trim() || !enquiry.last_name.trim() || !enquiry.phone.trim()}
                className="w-full gap-2"
              >
                <Send className="w-4 h-4" />
                {submitting ? "Submitting..." : "Send Membership Enquiry"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Your details are kept private and only shared with {displayName}.
              </p>
            </div>
          )}
        </section>

        {/* ── Already a member ── */}
        <section className="text-center space-y-2 pb-6">
          <p className="text-sm text-muted-foreground">Already a member?</p>
          <Button variant="outline" className="gap-2" onClick={function () { navigate("/member-portal/" + companyId); }}>
            <User className="w-4 h-4" /> Login to Member Portal
          </Button>
        </section>

      </div>

      {/* ── Footer ── */}
      <div className="border-t border-border bg-muted/20 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          {displayName} · Powered by{" "}
          <a href="https://www.cannalife.co.za" target="_blank" rel="noreferrer" className="text-primary hover:underline font-medium">
            Canna Life Co
          </a>
        </p>
      </div>
    </div>
  );
}
