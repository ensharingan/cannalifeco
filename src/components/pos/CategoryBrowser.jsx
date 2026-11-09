import { ChevronRight } from "lucide-react";

// Big tap targets for the till: categories first, then (if the category has more
// than one type) the types inside it, then the normal product grid.
export function Tiles({ items, onPick }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map(function (it) {
        return (
          <button key={it.key} type="button" onClick={function () { onPick(it.key); }}
            className="flex flex-col items-center justify-center gap-1 p-5 min-h-[120px] rounded-xl border border-border bg-card hover:shadow-md hover:border-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all text-center">
            {it.icon ? <span className="text-3xl">{it.icon}</span> : null}
            <span className="font-semibold text-sm">{it.label}</span>
            <span className="text-xs text-muted-foreground">{it.sub || (it.count + " item" + (it.count === 1 ? "" : "s"))}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Crumbs({ catLabel, groupLabel, onAll, onCat }) {
  return (
    <div className="flex items-center gap-1 text-sm flex-wrap">
      <button type="button" onClick={onAll} className="px-2 py-1 rounded-md bg-muted hover:bg-muted/70 font-medium">All categories</button>
      {catLabel && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      {catLabel && (groupLabel
        ? <button type="button" onClick={onCat} className="px-2 py-1 rounded-md bg-muted hover:bg-muted/70 font-medium">{catLabel}</button>
        : <span className="px-2 py-1 font-semibold">{catLabel}</span>)}
      {groupLabel && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      {groupLabel && <span className="px-2 py-1 font-semibold">{groupLabel}</span>}
    </div>
  );
}
