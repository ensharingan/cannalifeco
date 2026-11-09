import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';
import { LifeBuoy, X, Search, ThumbsUp, ThumbsDown, ChevronLeft, Stethoscope, AlertTriangle, Info, Send } from 'lucide-react';

// Ask Budify: search-only help assistant. No AI service, no per-chat cost.
// Answers come from public.help_articles via the search_help_articles RPC.
// "Check my club" runs rule-based checks on support_company_snapshot (owner/manager only).
// Props: role = profile.role ; position = 'floating' (default) | 'inline' ;
// brandName = platform name shown to users (default 'Budify') ; showCheck = false hides "Check my club"

var CATEGORIES = ['POS / Sales', 'Members', 'Loyalty', 'Products / Inventory', 'Reports / Finance', 'Settings / Team', 'Billing / Subscription', 'Other'];

function renderInline(text, keyBase) {
  var parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p) continue;
    if (p.indexOf('**') === 0 && p.length > 4) {
      out.push(<strong key={keyBase + '-' + i}>{p.slice(2, -2)}</strong>);
    } else if (p.charAt(0) === '`' && p.length > 2) {
      out.push(<code key={keyBase + '-' + i} className="rounded bg-gray-100 px-1 text-xs dark:bg-zinc-800">{p.slice(1, -1)}</code>);
    } else {
      out.push(p);
    }
  }
  return out;
}

function renderBody(body) {
  var lines = String(body || '').split('\n');
  var blocks = [];
  var list = null;
  function flush() {
    if (list) {
      blocks.push(list);
      list = null;
    }
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var ol = /^\d+\.\s+(.*)$/.exec(line);
    var ul = /^-\s+(.*)$/.exec(line);
    if (ol) {
      if (!list || list.type !== 'ol') {
        flush();
        list = { type: 'ol', items: [] };
      }
      list.items.push(ol[1]);
    } else if (ul) {
      if (!list || list.type !== 'ul') {
        flush();
        list = { type: 'ul', items: [] };
      }
      list.items.push(ul[1]);
    } else if (line.trim() === '') {
      flush();
    } else {
      flush();
      blocks.push({ type: 'p', text: line });
    }
  }
  flush();
  return blocks.map(function (b, idx) {
    if (b.type === 'p') {
      return <p key={idx} className="mb-2 text-sm leading-relaxed">{renderInline(b.text, 'p' + idx)}</p>;
    }
    var items = b.items.map(function (it, j) {
      return <li key={j}>{renderInline(it, 'l' + idx + '-' + j)}</li>;
    });
    if (b.type === 'ol') {
      return <ol key={idx} className="mb-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed">{items}</ol>;
    }
    return <ul key={idx} className="mb-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">{items}</ul>;
  });
}

function money(n) {
  var v = Math.abs(Number(n) || 0);
  return 'R' + v.toFixed(2);
}

// Rule-based checks. Reads only fields returned by support_company_snapshot.
function buildFindings(s, brand) {
  var f = [];
  if (!s) return f;
  var sess = s.sessions || {};
  var inv = s.inventory || {};
  var staff = s.staff || {};
  var sales = s.sales || {};
  var batches = s.batches || {};
  var company = s.company || {};

  if ((sess.stale_over_24h || 0) > 0) {
    var detail = [];
    var open = sess.open || [];
    for (var i = 0; i < open.length; i++) {
      if (open[i].age_hours > 24) {
        detail.push((open[i].cashier || 'Unknown cashier') + (open[i].store ? ' at ' + open[i].store : '') + ', opened ' + open[i].opened);
      }
    }
    f.push({
      level: 'warn',
      text: sess.stale_over_24h + ' till day(s) have been open for more than 24 hours.',
      detail: detail.slice(0, 4),
      slug: 'cant-sell-no-day-open'
    });
  }

  var vars = sess.big_variances_7d || [];
  if (vars.length > 0) {
    var worst = vars[0];
    for (var j = 1; j < vars.length; j++) {
      if (Math.abs(Number(vars[j].cash_variance)) > Math.abs(Number(worst.cash_variance))) worst = vars[j];
    }
    f.push({
      level: 'warn',
      text: vars.length + ' cash-up(s) in the last 7 days closed R100 or more out. Largest: ' + money(worst.cash_variance) + (Number(worst.cash_variance) < 0 ? ' short' : ' over') + ' (' + (worst.cashier || 'unknown') + ').',
      slug: 'refunds-and-cash-up'
    });
  }

  if ((staff.pin_locked || 0) > 0) {
    f.push({ level: 'warn', text: staff.pin_locked + ' staff member(s) are locked out by a wrong PIN.', slug: 'cashier-pin-locked' });
  }

  if ((inv.negative_rows || 0) > 0) {
    f.push({ level: 'warn', text: inv.negative_rows + ' product/branch stock lines are below zero.', slug: 'negative-stock' });
  }

  if ((inv.missing_store_rows || 0) > 0) {
    f.push({ level: 'info', text: inv.missing_store_rows + ' product/branch pair(s) have no stock record.', slug: 'product-stock-price-per-branch' });
  }

  if (company.batch_tracking_enabled && (batches.errors_7d || 0) > 0) {
    f.push({
      level: 'warn',
      text: batches.errors_7d + ' sale(s) in the last 7 days had no batch stock at the branch, so cost was not captured.',
      slug: 'sales-with-no-batch-stock'
    });
  }

  if ((sales.legacy_refunded_30d || 0) > 0) {
    f.push({
      level: 'info',
      text: sales.legacy_refunded_30d + ' order(s) were refunded in the last 30 days. Their stock was not returned automatically.',
      slug: 'refunds-and-cash-up'
    });
  }

  var tickets = s.open_tickets || [];
  if (tickets.length > 0) {
    f.push({ level: 'info', text: 'You have ' + tickets.length + ' open ticket(s) with ' + brand + ' support.' });
  }
  return f;
}

// Keep the ticket copy free of company email, fees and member totals.
function trimSnapshot(s) {
  if (!s) return null;
  return {
    flags: s.flags || [],
    sessions: { open: (s.sessions && s.sessions.open) || [], stale_over_24h: s.sessions && s.sessions.stale_over_24h, big_variances_7d: (s.sessions && s.sessions.big_variances_7d) || [] },
    inventory: s.inventory || null,
    batches: s.batches ? { errors_7d: s.batches.errors_7d, recent_errors: s.batches.recent_errors } : null,
    sales: s.sales || null,
    staff: s.staff || null,
    package: s.company ? s.company.effective_package : null,
    generated_at: s.generated_at
  };
}

// Articles are written for four audiences. Other role names used by some
// builds are folded into the closest one.
function audienceFor(role) {
  if (role === 'superadmin' || role === 'owner' || role === 'head_office') return 'owner';
  if (role === 'manager' || role === 'supervisor') return 'manager';
  if (role === 'cashier') return 'cashier';
  return 'staff';
}

function SupportAssistant(props) {
  var role = props.role || '';
  var position = props.position || 'floating';
  var brandName = props.brandName || 'Budify';
  // White-label builds without the club-health RPC pass showCheck={false}.
  var showCheck = props.showCheck !== false;
  var canCheck = showCheck && (role === 'owner' || role === 'manager' || role === 'superadmin');
  var audienceRole = audienceFor(role);

  var enabledState = useState(null);
  var enabled = enabledState[0];
  var setEnabled = enabledState[1];
  var openState = useState(false);
  var open = openState[0];
  var setOpen = openState[1];
  var viewState = useState('search');
  var view = viewState[0];
  var setView = viewState[1];
  var qState = useState('');
  var q = qState[0];
  var setQ = qState[1];
  var asked = useState('');
  var lastQuery = asked[0];
  var setLastQuery = asked[1];
  var busyState = useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];
  var resState = useState(null);
  var results = resState[0];
  var setResults = resState[1];
  var logState = useState(null);
  var logId = logState[0];
  var setLogId = logState[1];
  var fbState = useState(null);
  var feedback = fbState[0];
  var setFeedback = fbState[1];
  var findState = useState(null);
  var findings = findState[0];
  var setFindings = findState[1];
  var subjState = useState('');
  var subject = subjState[0];
  var setSubject = subjState[1];
  var detState = useState('');
  var details = detState[0];
  var setDetails = detState[1];
  var catState = useState('Other');
  var category = catState[0];
  var setCategory = catState[1];
  var priState = useState('normal');
  var priority = priState[0];
  var setPriority = priState[1];
  var errState = useState('');
  var error = errState[0];
  var setError = errState[1];

  useEffect(function () {
    var cancelled = false;
    async function load() {
      try {
        var idRes = await supabase.rpc('get_my_company_id');
        if (idRes.error || !idRes.data) {
          if (!cancelled) setEnabled(false);
          return;
        }
        var cRes = await supabase.from('companies').select('support_assistant_enabled').eq('id', idRes.data).maybeSingle();
        if (!cancelled) setEnabled(!!(cRes.data && cRes.data.support_assistant_enabled));
      } catch (e) {
        if (!cancelled) setEnabled(false);
      }
    }
    load();
    return function () {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  function resetSearch() {
    setResults(null);
    setFeedback(null);
    setLogId(null);
    setError('');
  }

  async function doSearch(text) {
    var query = String(text || '').trim();
    if (query.length < 3) return;
    setBusy(true);
    setView('search');
    resetSearch();
    setLastQuery(query);
    try {
      var res = await supabase.rpc('search_help_articles', { p_query: query, p_role: audienceRole, p_limit: 5 });
      if (res.error) throw res.error;
      var rows = res.data || [];
      setResults(rows);
      var slugs = rows.map(function (r) {
        return r.slug;
      });
      var logRes = await supabase.rpc('help_log_search', { p_query: query, p_slugs: slugs, p_role: role });
      if (!logRes.error) setLogId(logRes.data);
    } catch (e) {
      setError('Search failed. Please try again.');
      setResults([]);
    }
    setBusy(false);
  }

  async function openGuide(slug) {
    setBusy(true);
    setView('search');
    resetSearch();
    try {
      var res = await supabase
        .from('help_articles')
        .select('slug,title,summary,body,status,feature_note,required_packages')
        .eq('slug', slug)
        .maybeSingle();
      if (res.data) {
        setLastQuery(res.data.title);
        setResults([Object.assign({ available_to_club: true }, res.data)]);
      } else {
        setResults([]);
      }
    } catch (e) {
      setResults([]);
    }
    setBusy(false);
  }

  async function runCheck() {
    setBusy(true);
    setView('check');
    setFindings(null);
    setError('');
    try {
      var idRes = await supabase.rpc('get_my_company_id');
      var snap = await supabase.rpc('support_company_snapshot', { p_company_id: idRes.data });
      if (snap.error) throw snap.error;
      setFindings(buildFindings(snap.data, brandName));
    } catch (e) {
      setError('Could not run the check. Please try again or log a ticket.');
      setFindings([]);
    }
    setBusy(false);
  }

  async function sendFeedback(helpful) {
    setFeedback(helpful ? 'yes' : 'no');
    if (logId) {
      await supabase.rpc('help_log_feedback', { p_id: logId, p_helpful: helpful });
    }
    if (!helpful) startTicket();
  }

  function startTicket() {
    setSubject(lastQuery ? lastQuery.slice(0, 120) : '');
    setDetails('');
    setError('');
    setView('ticket');
  }

  async function submitTicket() {
    if (subject.trim().length < 5) {
      setError('Please give the problem a short title.');
      return;
    }
    if (details.trim().length < 10) {
      setError('Please describe what happened (branch, cashier, time).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      var uRes = await supabase.auth.getUser();
      var user = uRes && uRes.data ? uRes.data.user : null;
      var idRes = await supabase.rpc('get_my_company_id');
      var snapshot = null;
      if (canCheck) {
        try {
          var sRes = await supabase.rpc('support_company_snapshot', { p_company_id: idRes.data });
          if (!sRes.error) snapshot = trimSnapshot(sRes.data);
        } catch (e2) {
          snapshot = null;
        }
      }
      var shown = (results || []).map(function (r) {
        return r.slug;
      });
      var description = details.trim() + '\n\n---\nSent from the in-app help assistant.\nQuestion: ' + (lastQuery || '(none)') + '\nGuides shown: ' + (shown.length ? shown.join(', ') : 'none');
      var ins = await supabase
        .from('support_tickets')
        .insert({
          company_id: idRes.data,
          submitted_by: user ? user.id : null,
          submitter_email: user ? user.email : null,
          subject: subject.trim(),
          category: category,
          priority: priority,
          description: description,
          source: 'assistant',
          snapshot: snapshot
        })
        .select('id')
        .maybeSingle();
      if (ins.error) throw ins.error;
      if (logId) {
        await supabase.rpc('help_log_feedback', { p_id: logId, p_helpful: null, p_ticket: ins.data ? ins.data.id : null });
      }
      setView('done');
      toast.success('Ticket sent to ' + brandName + ' support');
    } catch (e) {
      setError((e && e.message) || 'Could not send the ticket. Please try again.');
    }
    setBusy(false);
  }

  function goHome() {
    setView('search');
    setFindings(null);
  }

  var buttonCls = position === 'inline'
    ? 'inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
    : 'fixed bottom-20 left-3 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 md:bottom-4';

  var inputCls = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

  function articleCard(a, idx) {
    return (
      <div key={a.slug} className="mb-3 rounded-lg border border-gray-200 p-3 dark:border-zinc-700">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{a.title}</h3>
          {a.status === 'db_only' ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Not on your screen yet</span> : null}
          {a.status === 'planned' ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Coming soon</span> : null}
          {a.available_to_club === false ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">Needs a higher package</span> : null}
        </div>
        {a.feature_note ? <p className="mb-2 text-xs text-gray-500 dark:text-zinc-400">{a.feature_note}</p> : null}
        <div>{renderBody(a.body)}</div>
      </div>
    );
  }

  var body = null;

  if (view === 'check') {
    body = (
      <div>
        <button type="button" onClick={goHome} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-zinc-300">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <h3 className="mb-2 text-sm font-semibold">Check my club</h3>
        {busy ? <p className="text-sm text-gray-500">Checking your club...</p> : null}
        {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
        {findings && findings.length === 0 && !error ? <p className="text-sm">No problems found.</p> : null}
        {(findings || []).map(function (it, i) {
          return (
            <div key={i} className="mb-2 flex gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-zinc-700">
              {it.level === 'warn' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />}
              <div className="min-w-0">
                <p>{it.text}</p>
                {(it.detail || []).map(function (d, k) {
                  return <p key={k} className="text-xs text-gray-500 dark:text-zinc-400">{d}</p>;
                })}
                {it.slug ? (
                  <button type="button" onClick={function () { openGuide(it.slug); }} className="mt-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400">
                    How to fix this
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (view === 'ticket') {
    body = (
      <div>
        <button type="button" onClick={goHome} className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-zinc-300">
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <h3 className="mb-2 text-sm font-semibold">Log a ticket with {brandName} support</h3>
        <label className="mb-1 block text-xs text-gray-600 dark:text-zinc-400">Short title</label>
        <input className={inputCls + ' mb-3'} value={subject} onChange={function (e) { setSubject(e.target.value); }} maxLength={140} />
        <label className="mb-1 block text-xs text-gray-600 dark:text-zinc-400">What happened? Include branch, cashier and time.</label>
        <textarea className={inputCls + ' mb-3'} rows={5} value={details} onChange={function (e) { setDetails(e.target.value); }} />
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-gray-600 dark:text-zinc-400">Area</label>
            <select className={inputCls} value={category} onChange={function (e) { setCategory(e.target.value); }}>
              {CATEGORIES.map(function (c) {
                return <option key={c} value={c}>{c}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-600 dark:text-zinc-400">Priority</label>
            <select className={inputCls} value={priority} onChange={function (e) { setPriority(e.target.value); }}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent: cannot sell</option>
            </select>
          </div>
        </div>
        {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
        <button type="button" disabled={busy} onClick={submitTicket} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          <Send className="h-4 w-4" /> {busy ? 'Sending...' : 'Send ticket'}
        </button>
      </div>
    );
  } else if (view === 'done') {
    body = (
      <div>
        <p className="mb-3 text-sm">Your ticket has been sent. {brandName} support will reply on the contact details for your club.</p>
        <button type="button" onClick={function () { setQ(''); resetSearch(); setView('search'); }} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700">
          Ask something else
        </button>
      </div>
    );
  } else {
    body = (
      <div>
        <form
          onSubmit={function (e) {
            e.preventDefault();
            doSearch(q);
          }}
          className="mb-3 flex gap-2"
        >
          <input className={inputCls} placeholder="Describe your problem or question" value={q} onChange={function (e) { setQ(e.target.value); }} maxLength={300} />
          <button type="submit" disabled={busy || q.trim().length < 3} className="inline-flex items-center rounded-md bg-emerald-600 px-3 text-white hover:bg-emerald-700 disabled:opacity-50" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
        </form>

        {canCheck && results === null ? (
          <button type="button" onClick={runCheck} className="mb-3 flex w-full items-center gap-2 rounded-lg border border-gray-200 p-3 text-left text-sm hover:bg-gray-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            <Stethoscope className="h-4 w-4 text-emerald-600" />
            <span>
              <span className="block font-medium">Check my club</span>
              <span className="block text-xs text-gray-500 dark:text-zinc-400">Look for open days, negative stock, big cash differences and more</span>
            </span>
          </button>
        ) : null}

        {busy ? <p className="text-sm text-gray-500">Searching...</p> : null}
        {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

        {results && results.length > 0 ? (
          <div>
            {results.map(articleCard)}
            {feedback === null ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span>Did this help?</span>
                <button type="button" onClick={function () { sendFeedback(true); }} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 dark:border-zinc-700"><ThumbsUp className="h-3.5 w-3.5" /> Yes</button>
                <button type="button" onClick={function () { sendFeedback(false); }} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 dark:border-zinc-700"><ThumbsDown className="h-3.5 w-3.5" /> No</button>
              </div>
            ) : null}
            {feedback === 'yes' ? <p className="mt-2 text-sm">Glad that helped.</p> : null}
            <button type="button" onClick={startTicket} className="mt-3 text-sm text-emerald-700 hover:underline dark:text-emerald-400">Still stuck? Log a ticket</button>
          </div>
        ) : null}

        {results && results.length === 0 && !busy ? (
          <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-zinc-700">
            <p className="mb-2">I could not find a guide for that. Try different words, or log a ticket and {brandName} support will help.</p>
            <button type="button" onClick={startTicket} className="rounded-md bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700">Log a ticket</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={function () { setOpen(true); }} className={buttonCls} aria-label={"Ask " + brandName}>
        <LifeBuoy className="h-5 w-5" />
        {position === 'inline' ? <span className="hidden sm:inline">Ask {brandName}</span> : null}
      </button>

      {open ? createPortal(
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={function () { setOpen(false); }} />
          <div className="relative flex h-full w-full flex-col bg-white text-gray-900 shadow-xl dark:bg-zinc-900 dark:text-zinc-100 sm:w-[420px]">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <LifeBuoy className="h-5 w-5 text-emerald-600" />
                <span className="font-semibold">Ask {brandName}</span>
              </div>
              <button type="button" onClick={function () { setOpen(false); }} aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{body}</div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

export default SupportAssistant;
