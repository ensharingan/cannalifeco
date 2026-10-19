// src/components/MarketplaceGate.jsx
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMarketplaceCompliance } from '@/lib/useMarketplaceCompliance';

function target(supplierId) {
  return supplierId
    ? '/marketplace-compliance?supplier=' + supplierId
    : '/marketplace-compliance';
}

/**
 * Wrap any "Order" / "Enquire" / "Contact Supplier" control.
 * Pass supplierId so the gate checks THAT supplier's requirements.
 *
 *   <MarketplaceGate supplierId={sup.id}>
 *     <Button onClick={enquire}>Enquire Now</Button>
 *   </MarketplaceGate>
 */
export default function MarketplaceGate({ children, supplierId, className }) {
  var navigate = useNavigate();
  var compliance = useMarketplaceCompliance(supplierId);

  if (compliance.loading) {
    return (
      <Button disabled variant="outline" className={className}>
        <Clock className="w-4 h-4 mr-2 animate-pulse" />
        Checking…
      </Button>
    );
  }

  if (compliance.isApproved) {
    return children;
  }

  var config = {
    not_started: {
      icon: Lock,
      text: 'Verify to Order',
      cls: 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10',
    },
    pending_review: {
      icon: Clock,
      text: 'Verification Pending',
      cls: 'border-blue-500/40 text-blue-400 hover:bg-blue-500/10',
    },
    rejected: {
      icon: ShieldAlert,
      text: 'Action Required',
      cls: 'border-red-500/40 text-red-400 hover:bg-red-500/10',
    },
  }[compliance.status] || {
    icon: Lock,
    text: 'Verify to Order',
    cls: 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10',
  };

  var Icon = config.icon;
  var done = compliance.approvedCount;
  var total = compliance.totalRequired;

  return (
    <Button
      variant="outline"
      className={(config.cls || '') + ' ' + (className || '')}
      onClick={function () { navigate(target(supplierId)); }}
      title="This supplier requires your store to be verified before ordering"
    >
      <Icon className="w-4 h-4 mr-2" />
      {config.text}
      {total > 0 && (
        <span className="ml-2 opacity-70 text-xs">{done}/{total}</span>
      )}
    </Button>
  );
}

/**
 * Status banner for the Marketplace page (baseline, not supplier-specific).
 */
export function MarketplaceComplianceBanner() {
  var navigate = useNavigate();
  var compliance = useMarketplaceCompliance();

  if (compliance.loading || compliance.isApproved) return null;

  var map = {
    not_started: {
      icon: Lock,
      tone: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
      title: 'Browsing only',
      body: 'Each supplier sets its own verification requirements. Open a product to see what that supplier needs.',
      cta: 'Start verification',
    },
    pending_review: {
      icon: Clock,
      tone: 'border-blue-500/30 bg-blue-500/10 text-blue-200',
      title: 'Verification under review',
      body: 'Your documents are with our compliance team. You will be notified once approved.',
      cta: 'View status',
    },
    rejected: {
      icon: ShieldAlert,
      tone: 'border-red-500/30 bg-red-500/10 text-red-200',
      title: 'Documents need attention',
      body: 'One or more of your documents could not be verified. Please review and re-upload.',
      cta: 'Fix now',
    },
  };

  var c = map[compliance.status] || map.not_started;
  var Icon = c.icon;

  return (
    <div className={'flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border px-4 py-3 mb-4 ' + c.tone}>
      <Icon className="w-5 h-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{c.title}</p>
        <p className="text-xs opacity-80">{c.body}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={function () { navigate('/marketplace-compliance'); }}
      >
        {c.cta}
      </Button>
    </div>
  );
}

export function VerifiedBadge({ supplierId }) {
  var compliance = useMarketplaceCompliance(supplierId);
  if (!compliance.isApproved) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
      <ShieldCheck className="w-3.5 h-3.5" />
      Verified Buyer
    </span>
  );
}
