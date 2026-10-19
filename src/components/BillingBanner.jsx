import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { usePosSettings } from "@/lib/usePosSettings";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Billing reminder shown to the people who can actually do something about it.
// Cashiers never see the club's payment state.
var BILLING_ROLES = ["owner", "manager", "superadmin"];

// Live Paystack payment links, keyed by package. Keep in step with
// paystack-webhook/index.ts PRICE_MAP and the pricing page.
var PAY_LINKS = {
  starter: "https://paystack.shop/pay/deii2ufhtv",
  growth: "https://paystack.shop/pay/1uyzfhgxnh",
};

var GROWTH_PRICE = 999;

// Which link to send them to.
//
// The price wins over the plan label, always. Around sixty companies carry
// subscription_plan 'growth' while paying 499, because signup defaults the plan
// name and nothing corrects it later. Trusting the label sends a Starter club
// to the R999 page, which is how a client ends up double-paying or giving up.
// price_zar is written from the actual Paystack amount and is correct.
function resolvePlan(billing) {
  var price = billing && billing.price_zar != null ? Number(billing.price_zar) : null;
  if (price !== null && price > 0) {
    return price >= GROWTH_PRICE ? "growth" : "starter";
  }
  var label = (billing && (billing.package || billing.subscription_plan)) || "starter";
  return label === "growth" ? "growth" : "starter";
}

function payLink(plan) {
  return PAY_LINKS[plan] || PAY_LINKS.starter;
}

// Whole days from now until the grace date, floored at zero. Both sides are
// pinned to midnight so "tomorrow" doesn't read as 0 days just because the
// grace timestamp happens to fall earlier in the day than right now.
function daysUntil(value) {
  if (!value) return null;
  var end = new Date(value);
  if (isNaN(end.getTime())) return null;
  var endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  var now = new Date();
  var nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diff = Math.round((endDay - nowDay) / 86400000);
  return diff < 0 ? 0 : diff;
}

function formatDate(value) {
  if (!value) return "";
  var d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "long" });
}

export default function BillingBanner() {
  var { profile } = useAuth();
  var { billing, isLoading } = usePosSettings();
  var [dismissed, setDismissed] = useState(false);

  var role = profile ? profile.role : null;
  var canSee = role && BILLING_ROLES.indexOf(role) !== -1;

  if (!canSee || isLoading || dismissed) return null;
  if (!billing || billing.subscription_status !== "overdue") return null;

  var remaining = daysUntil(billing.grace_period_ends_at);
  var lapsed = remaining === null || remaining <= 0;
  var plan = resolvePlan(billing);

  var headline = lapsed
    ? "Your subscription payment is overdue"
    : "Your subscription payment didn't go through";

  var detail;
  if (lapsed) {
    detail = "Settle now to keep your club running. Get in touch if you need more time.";
  } else if (remaining === 1) {
    detail = "Please settle by tomorrow, " + formatDate(billing.grace_period_ends_at) + ".";
  } else {
    detail =
      "You have " + remaining + " days to settle, until " + formatDate(billing.grace_period_ends_at) + ".";
  }

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 px-4 lg:px-6 py-3 border-b",
        lapsed
          ? "bg-red-500/10 border-red-500/20"
          : "bg-yellow-500/10 border-yellow-500/20"
      )}
    >
      <AlertTriangle
        className={cn("w-5 h-5 shrink-0 mt-0.5", lapsed ? "text-red-500" : "text-yellow-500")}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{headline}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </div>
      <a
        href={payLink(plan)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors",
          lapsed ? "bg-red-500 hover:bg-red-600" : "bg-yellow-600 hover:bg-yellow-700"
        )}
      >
        Pay now
      </a>
      {!lapsed && (
        <button
          type="button"
          onClick={function () {
            setDismissed(true);
          }}
          className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          title="Hide until next sign in"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
