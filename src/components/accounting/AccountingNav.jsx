import { Link, useLocation } from 'react-router-dom';
import {
  Wallet, Scale, BookOpen, Landmark, Boxes, ArrowLeftRight,
  ReceiptText, PieChart, Settings2
} from 'lucide-react';

// The accounting module has enough screens that burying them all in the main
// sidebar would double its length. They live behind one "Accounting" nav item
// and this strip, which is also how Pastel groups them under Process / View.
var TABS = [
  { path: '/accounting/cash-books',      label: 'Cash Books',        icon: Wallet },
  { path: '/accounting/bank-rec',        label: 'Bank Rec',          icon: Landmark },
  { path: '/accounting/journals',        label: 'Journals',          icon: BookOpen },
  { path: '/accounting/inventory-journals', label: 'Inventory',      icon: Boxes },
  { path: '/accounting/interstore',      label: 'Interstore',        icon: ArrowLeftRight },
  { path: '/accounting/tax-periods',     label: 'Tax',               icon: ReceiptText },
  { path: '/accounting/reports',         label: 'Reports',           icon: PieChart },
  { path: '/accounting/ledger',          label: 'Ledger',            icon: Scale },
  { path: '/accounting/settings',        label: 'Setup',             icon: Settings2 },
];

export default function AccountingNav() {
  var location = useLocation();
  var current = location.pathname;

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 print:hidden">
      {TABS.map(function (t) {
        var Icon = t.icon;
        var active = current === t.path || current.indexOf(t.path + '/') === 0;
        return (
          <Link
            key={t.path}
            to={t.path}
            className={
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ' +
              (active
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-muted/50')
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
