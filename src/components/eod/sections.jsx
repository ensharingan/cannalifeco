import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Open/closed state for the End of Day sections, remembered per browser so each
// owner keeps the layout they prefer. A section not listed here defaults to open.
export const SECTION_DEFAULTS = {
  summary: true,
  cashup: true,
  stock: true,
  cashouts: true,
  payments: false,
  categories: false,
  stores: false,
  tills: false,
  items: false,
  expenses: false,
};

const STORAGE_KEY = 'eod_sections_v1';

export const SectionsCtx = createContext({
  open: SECTION_DEFAULTS,
  toggle: () => {},
  setAll: () => {},
});

export function useSectionsState() {
  const [open, setOpen] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { ...SECTION_DEFAULTS, ...saved };
    } catch (_e) {
      return { ...SECTION_DEFAULTS };
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(open)); } catch (_e) { /* private mode */ }
  }, [open]);

  const toggle = useCallback((id) => setOpen(o => ({ ...o, [id]: !(o[id] ?? true) })), []);
  const setAll = useCallback((value) => {
    setOpen(o => Object.fromEntries(Object.keys({ ...SECTION_DEFAULTS, ...o }).map(k => [k, value])));
  }, []);
  return { open, toggle, setAll };
}

export function useSection(id) {
  const ctx = useContext(SectionsCtx);
  return { isOpen: ctx.open[id] ?? true, toggle: () => ctx.toggle(id) };
}

// Clickable title row with a chevron. `children` render to the right of the title
// (only shown while the section is open, so a collapsed header stays tidy).
export function SectionHeader({ id, title, subtitle, badge, right }) {
  const { isOpen, toggle } = useSection(id);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex items-start gap-2 text-left min-w-0 group"
      >
        <ChevronDown
          className={cn("w-4 h-4 mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
            !isOpen && "-rotate-90")}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {badge}
          </span>
          {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
        </span>
      </button>
      {isOpen && right}
    </div>
  );
}
