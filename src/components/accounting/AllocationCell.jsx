import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';

// GCS allocation, as a single grid cell.
//
// Accounts and suppliers are short lists, so a native <select> is the fastest
// thing to tab through — which matters when the accountant is capturing a
// month of bank entries. Members are not a short list (a club can have
// thousands), so that branch opens a search dialog instead of trying to render
// every option into the DOM of every row.

export default function AllocationCell({
  gcs, value, accounts, suppliers, members, onChange, disabled,
}) {
  var [searchOpen, setSearchOpen] = useState(false);
  var [term, setTerm] = useState('');

  var selectedMember = useMemo(function () {
    if (gcs !== 'C' || !value) return null;
    for (var i = 0; i < members.length; i++) if (members[i].id === value) return members[i];
    return null;
  }, [gcs, value, members]);

  var matches = useMemo(function () {
    if (!term.trim()) return members.slice(0, 40);
    var t = term.toLowerCase();
    var out = [];
    for (var i = 0; i < members.length && out.length < 40; i++) {
      var m = members[i];
      var hay = ((m.full_name || '') + ' ' + (m.member_number || '')).toLowerCase();
      if (hay.indexOf(t) !== -1) out.push(m);
    }
    return out;
  }, [term, members]);

  var cellClass =
    'w-full h-full px-1.5 py-1 text-xs bg-transparent border-0 outline-none focus:bg-primary/5 disabled:opacity-60';

  if (gcs === 'G') {
    return (
      <select
        className={cellClass}
        value={value || ''}
        disabled={disabled}
        onChange={function (e) { onChange(e.target.value || null); }}
      >
        <option value="">—</option>
        {accounts.map(function (a) {
          return (
            <option key={a.id} value={a.id}>
              {a.code}/{a.sub_code} {a.name}
            </option>
          );
        })}
      </select>
    );
  }

  if (gcs === 'S') {
    return (
      <select
        className={cellClass}
        value={value || ''}
        disabled={disabled}
        onChange={function (e) { onChange(e.target.value || null); }}
      >
        <option value="">—</option>
        {suppliers.map(function (s) {
          return <option key={s.id} value={s.id}>{s.name}</option>;
        })}
      </select>
    );
  }

  // Customer / member
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={function () { setSearchOpen(true); setTerm(''); }}
        className={cellClass + ' text-left truncate'}
        title={selectedMember ? selectedMember.full_name : 'Choose a member'}
      >
        {selectedMember
          ? (selectedMember.full_name + (selectedMember.member_number ? ' (' + selectedMember.member_number + ')' : ''))
          : <span className="text-muted-foreground">—</span>}
      </button>

      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-24">
          <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                autoFocus
                value={term}
                onChange={function (e) { setTerm(e.target.value); }}
                placeholder="Search members by name or number"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button onClick={function () { setSearchOpen(false); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {matches.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">No members match that.</p>
              )}
              {matches.map(function (m) {
                return (
                  <button
                    key={m.id}
                    onClick={function () { onChange(m.id); setSearchOpen(false); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50"
                  >
                    <span>{m.full_name}</span>
                    <span className="text-xs text-muted-foreground">{m.member_number || ''}</span>
                  </button>
                );
              })}
            </div>
            {value && (
              <div className="border-t border-border p-2">
                <button
                  onClick={function () { onChange(null); setSearchOpen(false); }}
                  className="w-full rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/50"
                >
                  Clear allocation
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
