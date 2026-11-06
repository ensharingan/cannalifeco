// Parse a pasted WhatsApp-style stock list ("Name +qty" lines under category / size headings)
// and fuzzy-match every line to a product. Pure functions, no React or Supabase.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();

const CATEGORY_WORDS = [
  [/^pre ?rolls?$/, 'preroll'],
  [/^bags?$/, 'bag'],
  [/^specials?$/, 'special'],
  [/^dabs?$/, 'dab'],
  [/^(edibles?|drinks?|papers?|accessor(y|ies)|vapes?|carts?|cartridges?|concentrates?|extracts?|tubes?|bulk)$/, 'other'],
];
const categoryOf = (head) => {
  const n = norm(head);
  for (const [re, c] of CATEGORY_WORDS) if (re.test(n)) return c;
  return null;
};
const gradeOf = (s) => {
  const n = norm(s);
  if (/\bindoor\b/.test(n)) return 'indoor';
  if (/\bhydro\b/.test(n)) return 'hydro';
  if (/\bgh\b|green ?house/.test(n)) return 'gh';
  return '';
};
const SIZE_HEAD_RE = /^[a-z\s]*\d+(?:\.\d+)?\s*g$/i;

// Does a heading name one of the stores? (NXT LVL -> "NXT LVL Dispensary")
function storeMatch(head, stores) {
  const h = norm(head);
  if (!h) return null;
  const hs = h.replace(/\s/g, '');
  let best = null, bestScore = 0;
  for (const s of stores) {
    const n = norm(s.name);
    const ns = n.replace(/\s/g, '');
    let sc = 0;
    if (n === h || ns === hs) sc = 1;
    else if (ns.includes(hs) && hs.length >= 4) sc = 0.9;
    else if (hs.includes(ns) && ns.length >= 4) sc = 0.8;
    if (sc > bestScore) { best = s; bestScore = sc; }
  }
  return best;
}

export function parsePasteList(text, stores = []) {
  const lines = String(text || '').split(/\r?\n/)
    // strip WhatsApp prefixes like "[08:51, 11/6/2026] Rosie R: "
    .map(l => l.replace(/^\s*\[[^\]]{4,40}\]\s*[^:\[\]]{1,40}:\s*/, '').replace(/[‎‏]/g, '').trim())
    .filter(Boolean);

  const groups = [];
  const warnings = [];
  let g = null, cat = '', size = null, grade = '', section = '';
  const newGroup = (label, store) => {
    g = { label, store_id: store?.id || '', items: [] };
    groups.push(g);
    cat = ''; size = null; grade = ''; section = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(.*\S)\s*\+\s*(\d+(?:[.,]\d+)?)\s*$/);
    if (m) {
      if (!g) newGroup('', null);
      g.items.push({ raw: line, name: m[1].trim(), qty: parseFloat(m[2].replace(',', '.')), cat, size, grade, section });
      continue;
    }
    const head = line.replace(/\s*:\s*$/, '').trim();
    const c = categoryOf(head);
    if (c) { cat = c; size = null; grade = ''; section = ''; continue; }
    if (SIZE_HEAD_RE.test(head)) {
      size = parseFloat(head.match(/(\d+(?:\.\d+)?)\s*g$/i)[1]);
      grade = gradeOf(head);
      continue;
    }
    // A heading with no quantity: either a store / brand block, or a loose section.
    const sm = storeMatch(head, stores);
    const nextIsCat = i + 1 < lines.length && !!categoryOf(lines[i + 1].replace(/\s*:\s*$/, ''));
    if (sm || nextIsCat || !g) { newGroup(head, sm); }
    else { section = head; size = null; grade = ''; }
  }
  const empty = groups.filter(x => !x.items.length);
  if (empty.length) warnings.push(`Ignored headings with no items: ${empty.map(x => x.label || '(blank)').join(', ')}`);
  return { groups: groups.filter(x => x.items.length), warnings };
}

// ---------- matching ----------
const STOP = new Set(['of', 'the', 'and', 'n', 'a']);
const IGNORABLE = new Set(['pre', 'roll', 'rolls', 'preroll', 'g', 'bulk', 'pack', 'packs', 'pcs', 'aa', 'aaa', 'i', 'id', 'gh', 'hydro', 'indoor', 'greenhouse']);

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function tokSim(a, b) {
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.9;
  // plural / trailing s
  if (a.replace(/s$/, '') === b.replace(/s$/, '') && a.length > 2) return 0.97;
  if (a.length >= 4 && b.length >= 4) {
    const r = 1 - lev(a, b) / Math.max(a.length, b.length);
    if (r >= 0.72) return r * 0.95;
  }
  return 0;
}
const weight = (t) => STOP.has(t) ? 0.3 : Math.min(Math.max(t.length, 2), 6);
const sizeOf = (name) => { const m = String(name).toLowerCase().match(/(\d+(?:\.\d+)?)\s*g\b/); return m ? parseFloat(m[1]) : null; };
const stripSize = (s) => s.replace(/\d+(?:\.\d+)?\s*g\b/g, ' ');

export function buildIndex(products) {
  return products.filter(p => p.is_active !== false).map(p => {
    const n = norm(p.name);
    const pre = /\bpre\b|pre ?roll/.test(n);
    return { p, n, size: sizeOf(p.name), pre, dab: /\bdabs?\b/.test(n), grade: gradeOf(p.name), toks: stripSize(n).split(' ').filter(Boolean) };
  });
}

function scoreOne(q, ix) {
  const qn = norm(stripSize(q.name));
  const qt = qn.split(' ').filter(Boolean);
  if (!qt.length) return -1;
  const qw = qt.reduce((a, t) => a + weight(t), 0);
  let cov = 0;
  const used = new Set();
  for (const t of qt) {
    let best = 0, bi = -1;
    ix.toks.forEach((pt, i) => { const s = tokSim(t, pt); if (s > best) { best = s; bi = i; } });
    if (bi >= 0) used.add(bi);
    cov += weight(t) * best;
  }
  cov /= qw;
  let extra = 0;
  ix.toks.forEach((pt, i) => { if (!used.has(i) && !IGNORABLE.has(pt) && !/^\d+pcs$/.test(pt)) extra += weight(pt); });
  let s = cov - 0.18 * (extra / (extra + qw));

  // context from headings
  if (q.size != null) {
    if (ix.size === q.size) s += 0.15;
    else if (ix.size != null) s -= 0.5;
    else s -= 0.1;
  }
  if (q.cat === 'preroll') { if (ix.pre) s += 0.12; else if (ix.size != null) s -= 0.2; }
  if (q.cat === 'dab') { if (ix.dab) s += 0.12; }
  if (q.grade) { if (ix.grade === q.grade) s += 0.08; else if (ix.grade) s -= 0.08; }
  return s;
}

// Returns { product_id, conf: 'good'|'check'|'none', cands: [{id,name,sku,score}] }
export function matchItem(item, index) {
  const scored = [];
  for (const ix of index) { const s = scoreOne(item, ix); if (s > 0.3) scored.push({ id: ix.p.id, name: ix.p.name, sku: ix.p.sku, score: s }); }
  scored.sort((a, b) => b.score - a.score);
  const cands = scored.slice(0, 6);
  if (!cands.length || cands[0].score < 0.6) return { product_id: '', conf: 'none', cands };
  const margin = cands.length > 1 ? cands[0].score - cands[1].score : 1;
  const conf = cands[0].score >= 0.85 && margin >= 0.05 ? 'good' : 'check';
  return { product_id: cands[0].id, conf, cands };
}
