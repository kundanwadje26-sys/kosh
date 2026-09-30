/* =====================================================================
   Kundan's Finance  (KOSH: Kundan On Savings Hustle)
   Expense tracker, fund manager and investment portfolio
   ---------------------------------------------------------------------
   A single-page app with no backend server. All data lives in ONE JSON
   file inside your own GitHub repository, read and written through the
   GitHub REST API. The browser keeps a cached copy in localStorage so
   the app opens instantly and keeps working when you're offline.

   File map (search for these headings):
     1. CONSTANTS & DEFAULTS
     2. SMALL UTILITIES
     3. LOCAL STATE & CHANGE LOG (localStorage cache)
     4. GITHUB REST API LAYER   <-- edit here to change how GitHub is used
     5. SYNC ENGINE             <-- fetch -> merge -> commit logic
     6. CALCULATIONS (balances, EMIs, cards, budgets)
     7. UI HELPERS (modal, toast, form fields)
     8. PAGES (dashboard, accounts, investments & SIPs, transactions,
        EMIs, subscriptions, budgets, export) + LIVE PRICES (NAV / stocks)
     9. FORMS & ACTIONS
    10. EXPORT / IMPORT
    11. SETTINGS
    12. STARTUP
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   1. CONSTANTS & DEFAULTS
   --------------------------------------------------------------------- */
// NOTE: these key names are deliberately unchanged from the first version
// of the app, so data already saved in your browser keeps loading.
const STORAGE_KEYS = {
  db: 'kosh.db.v1',             // cached copy of the whole database
  pending: 'kosh.pending.v1',   // changes made here but not yet on GitHub
  config: 'kosh.config.v1',     // GitHub connection details (incl. token)
  lastSync: 'kosh.lastSync.v1', // time of last successful sync
};
const APP_NAME = "Kundan's Finance";
const SCHEMA_VERSION = 3; // v2 added `sips`, v3 goals/wishlist/rules/taxItems; older files load unchanged
const COLLECTIONS = ['accounts', 'transactions', 'emis', 'subscriptions', 'budgets', 'sips', 'charts', 'goals', 'wishlist', 'rules', 'taxItems', 'notifications', 'creditScores'];

const ACCOUNT_TYPES = {
  cash:        { label: 'Cash & wallets',        single: 'Cash or wallet', icon: 'fa-wallet' },
  bank:        { label: 'Bank accounts',         single: 'Bank account',   icon: 'fa-building-columns' },
  credit_card: { label: 'Credit cards',          single: 'Credit card',    icon: 'fa-credit-card' },
  investment:  { label: 'Investments & savings', single: 'Investment',     icon: 'fa-seedling' },
  // A person you lend to or borrow from (Dad, friends). Balance above zero =
  // they owe you; below zero = you owe them. Managed on the People page.
  person:      { label: 'People',                single: 'Person',         icon: 'fa-user' },
};
const MONEY_TYPES = ['cash', 'bank', 'credit_card', 'investment']; // everything except people
const CASH_KINDS = ['Cash', 'UPI wallet', 'Prepaid card', 'Other'];
const BANK_KINDS = ['Savings', 'Current', 'Salary', 'NRE / NRO', 'Other'];
const INVESTMENT_KINDS = ['Mutual fund', 'Stocks', 'ETF', 'Fixed deposit', 'Recurring deposit', 'PPF / EPF', 'NPS', 'Gold', 'Bonds', 'Crypto', 'Other'];
/** How holdings are grouped in the portfolio allocation chart. */
const INVESTMENT_GROUPS = {
  'Mutual fund': 'Mutual funds', 'Stocks': 'Stocks & ETFs', 'ETF': 'Stocks & ETFs',
  'Fixed deposit': 'Deposits', 'Recurring deposit': 'Deposits', 'PPF / EPF': 'Retirement', 'NPS': 'Retirement',
  'Gold': 'Gold', 'Bonds': 'Bonds', 'Crypto': 'Crypto',
};
const investmentGroup = (a) => INVESTMENT_GROUPS[a.subtype] || 'Other';
const isDeposit = (a) => a.subtype === 'Fixed deposit' || a.subtype === 'Recurring deposit';
const SIP_FREQUENCIES = ['weekly', 'monthly', 'quarterly'];
const SIP_CATEGORY = 'SIP';                       // category on auto-recorded SIP transactions
const INVEST_SLICE = 'SIP & investments';         // label used in spending charts
const LOAN_KINDS = ['Home loan', 'Car loan', 'Two-wheeler loan', 'Personal loan', 'Education loan', 'Gold loan', 'Consumer durable', 'Other'];
const FREQUENCIES = {
  weekly:      { label: 'Weekly',         perMonth: 52 / 12 },
  monthly:     { label: 'Monthly',        perMonth: 1 },
  quarterly:   { label: 'Quarterly',      perMonth: 1 / 3 },
  half_yearly: { label: 'Every 6 months', perMonth: 1 / 6 },
  yearly:      { label: 'Yearly',         perMonth: 1 / 12 },
};
const CURRENCIES = {
  INR: 'en-IN', USD: 'en-US', EUR: 'en-IE', GBP: 'en-GB', AED: 'en-AE',
  SGD: 'en-SG', AUD: 'en-AU', CAD: 'en-CA', JPY: 'ja-JP',
};
const DEFAULT_SETTINGS = {
  ownerName: 'Kundan',       // shown in the app heading: "Kundan's Finance"
  currency: 'INR',
  sipAsSpending: true,       // show SIPs / money invested in monthly spending charts
  autoPrices: true,          // refresh mutual fund NAVs / stock prices when the app opens
  stockApiKey: '',           // optional Alpha Vantage key for live stock prices
  showNwToggles: true,       // small switches on the net worth card
  navLagDays: 1,             // SIP/lump sum units use the NAV this many working days after payment
  remindInApp: true,         // dashboard nudge when nothing is logged today (after 7 pm)
  reminderTime: '21:00',     // daily reminder time (calendar / phone notification)
  ntfyTopic: '',             // phone notifications via the free ntfy app (see Settings > Reminders)
  taxRegime: 'new',          // for the tax estimate: 'new' or 'old'
  salaried: true,            // standard deduction applies
  stampDuty: true,           // deduct 0.005% stamp duty when working out mutual fund units
  nwInvestments: true,       // net worth includes investments / portfolio
  nwCardDues: true,          // net worth subtracts credit card dues
  expenseCategories: ['Food & dining', 'Groceries', 'Transport', 'Fuel', 'Utilities', 'Rent', 'Shopping',
    'Health', 'Education', 'Entertainment', 'Travel', 'Subscriptions', 'EMI', 'Insurance',
    'Personal care', 'Family', 'Gifts & donations', 'Fees & charges', 'Other'],
  incomeCategories: ['Salary', 'Business', 'Freelance', 'Interest', 'Dividends', 'Refund',
    'Cashback', 'Gift', 'Rental income', 'Other'],
};
// Festive, high-contrast palette: peacock, marigold, rani pink, leaf, violet...
const CHART_COLORS = ['#0B84C6', '#14B8A6', '#E0306E', '#7C3AED', '#06B6D4', '#F97316',
  '#DB2777', '#2563EB', '#EAB308', '#A855F7', '#0F766E', '#94A3B8'];

/* ---------------------------------------------------------------------
   2. SMALL UTILITIES
   --------------------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Escape text before putting it inside HTML (prevents broken markup / XSS). */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ----- Dates are stored as plain 'YYYY-MM-DD' strings (local time). ----- */
const pad = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => toDateStr(new Date());
const thisMonth = () => todayStr().slice(0, 7);
function parseDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate(); // m is 0-based
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); }
/** Add months, keeping the original day where possible (31 Jan + 1 month = 28/29 Feb). */
function addMonths(s, n) {
  const d = parseDate(s);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  target.setDate(Math.min(d.getDate(), daysInMonth(target.getFullYear(), target.getMonth())));
  return toDateStr(target);
}
/** Build a date from year, 0-based month (may overflow) and day, clamped to month length. */
function makeDate(y, m, day) {
  const first = new Date(y, m, 1);
  first.setDate(Math.min(day, daysInMonth(first.getFullYear(), first.getMonth())));
  return toDateStr(first);
}
function daysUntil(s) { return Math.round((parseDate(s) - parseDate(todayStr())) / 86400000); }
function locale() { return CURRENCIES[db?.settings?.currency] || 'en-IN'; }
function fmtDate(s) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtMonth(mk, short = false) {
  return parseDate(mk + '-01').toLocaleDateString(locale(), { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });
}
function relDays(s) {
  const d = daysUntil(s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d} days overdue`;
  return `In ${d} days`;
}

/* ----- Money formatting (Indian grouping for INR: 1,23,456) ----- */
const _fmtCache = new Map();
function money(n, { compact = false, sign = false } = {}) {
  const cur = db?.settings?.currency || 'INR';
  const v = round2(num(n));
  if (compact && cur === 'INR') {
    // Indian short forms for chart axes: ₹90K, ₹4.5L, ₹1.2Cr (the browser's own
    // en-IN compact style prints "₹90T" for thousands, which reads badly).
    const a = Math.abs(v);
    const [div, suf] = a >= 1e7 ? [1e7, 'Cr'] : a >= 1e5 ? [1e5, 'L'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
    const out = '₹' + (+(a / div).toFixed(a / div < 10 && div > 1 ? 1 : 0)).toLocaleString('en-IN') + suf;
    return v < 0 ? '−' + out : sign && v > 0 ? '+' + out : out;
  }
  const frac = compact || Number.isInteger(v) ? 0 : 2;
  const key = `${cur}|${compact}|${frac}`;
  if (!_fmtCache.has(key)) {
    try {
      _fmtCache.set(key, new Intl.NumberFormat(CURRENCIES[cur] || 'en-IN', {
        style: 'currency', currency: cur, minimumFractionDigits: frac, maximumFractionDigits: compact ? 1 : frac,
        notation: compact ? 'compact' : 'standard',
      }));
    } catch { _fmtCache.set(key, new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })); }
  }
  const out = _fmtCache.get(key).format(Math.abs(v));
  if (v < 0) return '−' + out;
  return sign && v > 0 ? '+' + out : out;
}

/* ---------------------------------------------------------------------
   3. LOCAL STATE & CHANGE LOG
   ---------------------------------------------------------------------
   db       -> the full database (what the JSON file on GitHub contains)
   pending  -> list of change batches not yet committed to GitHub.
               Each batch = { message, at, ops: [...] }.
   An "op" is a tiny instruction, e.g.
     { op:'upsert', coll:'transactions', rec:{...} }  add or replace a record
     { op:'delete', coll:'accounts', id:'acc_x' }      remove a record
     { op:'settings', data:{ currency:'INR' } }        change settings
     { op:'replace', data:{...whole db...} }           restore a backup
   Keeping *changes* (not just the final file) lets us replay them on top
   of the newest GitHub copy, so edits from two devices don't overwrite
   each other.
   --------------------------------------------------------------------- */
function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch (e) { console.error(e); toast('This browser could not save data locally: ' + e.message, 'error'); }
}

function emptyDB() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { app: 'kosh-expense-tracker', updatedAt: null },
    settings: clone(DEFAULT_SETTINGS),
    accounts: [], transactions: [], emis: [], subscriptions: [], budgets: [], sips: [], charts: [],
    goals: [], wishlist: [], rules: [], taxItems: [], notifications: [], creditScores: [],
  };
}
/** Makes sure any loaded JSON has every expected key (safe against old/partial files).
    Older files simply get the new keys added (e.g. an empty `sips` list); nothing
    existing is removed or renamed, and unknown keys are kept as they are. */
function normalizeDB(d) {
  const base = emptyDB();
  if (!d || typeof d !== 'object') return base;
  const out = { ...base, ...d };
  out.meta = { ...base.meta, ...(d.meta || {}) };
  out.settings = { ...base.settings, ...(d.settings || {}) };
  for (const c of COLLECTIONS) out[c] = Array.isArray(d[c]) ? d[c] : [];
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

let config = Object.assign({ owner: '', repo: '', branch: 'main', path: 'data.json', token: '' }, readLS(STORAGE_KEYS.config, {}));
let db = normalizeDB(readLS(STORAGE_KEYS.db, null));
let pending = readLS(STORAGE_KEYS.pending, []);
const isFirstRun = !localStorage.getItem(STORAGE_KEYS.db);

function persist() {
  writeLS(STORAGE_KEYS.db, db);
  writeLS(STORAGE_KEYS.pending, pending);
}

/* ----- Op builders ----- */
function opUpsert(coll, rec, extra = {}) {
  const now = new Date().toISOString();
  return { op: 'upsert', coll, rec: { ...rec, createdAt: rec.createdAt || now, updatedAt: now }, ...extra };
}
const opDelete = (coll, id) => ({ op: 'delete', coll, id });
const opSettings = (data) => ({ op: 'settings', data });
const opReplace = (data) => ({ op: 'replace', data });

/** Apply ops to a database object (mutates and returns it). */
function applyOps(target, ops) {
  for (const o of ops) {
    if (o.op === 'upsert') {
      const arr = target[o.coll];
      const i = arr.findIndex((r) => r.id === o.rec.id);
      if (i >= 0) { if (!o.ifMissing) arr[i] = clone(o.rec); }
      else arr.push(clone(o.rec));
    } else if (o.op === 'delete') {
      target[o.coll] = target[o.coll].filter((r) => r.id !== o.id);
    } else if (o.op === 'settings') {
      target.settings = { ...target.settings, ...clone(o.data) };
    } else if (o.op === 'replace') {
      const fresh = normalizeDB(clone(o.data));
      for (const k of Object.keys(target)) delete target[k];
      Object.assign(target, fresh);
    }
  }
  return target;
}

/**
 * Every change in the app goes through commit():
 *   1) apply to the local copy + save to localStorage (instant, works offline)
 *   2) queue the change in `pending`
 *   3) ask the sync engine to push it to GitHub shortly
 */
function commit(ops, message) {
  if (!ops.length) return;
  applyOps(db, ops);
  db.meta.updatedAt = new Date().toISOString();
  pending.push({ message, at: new Date().toISOString(), ops });
  persist();
  render();
  scheduleSync();
}

/* ---------------------------------------------------------------------
   4. GITHUB REST API LAYER
   ---------------------------------------------------------------------
   Docs: https://docs.github.com/en/rest/repos/contents

   READ   GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
          -> { content: <base64 text>, sha: <version id>, ... }
   WRITE  PUT /repos/{owner}/{repo}/contents/{path}
          body { message, content: <base64 text>, branch, sha }
          -> creates a new commit containing the updated file.

   The "sha" is the fingerprint of the file version you last read. GitHub
   only accepts the PUT if that sha is still the latest; otherwise it
   answers 409 Conflict (someone/something changed the file). The sync
   engine then re-reads the file and tries again.

   Authentication uses your Personal Access Token in the Authorization
   header. The token is stored ONLY in this browser's localStorage.
   To point the app at a different repo, change the values in Settings,
   or change the defaults in `config` (section 3).
   --------------------------------------------------------------------- */
function gh(cfg = config) {
  const repoUrl = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const filePath = String(cfg.path || 'data.json').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  const fileUrl = `${repoUrl}/contents/${filePath}`;
  const branch = cfg.branch || 'main';

  const headers = (extra = {}) => ({
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    ...extra,
  });

  async function request(url, opts = {}) {
    try {
      // cache:'no-store' stops the browser from handing us an old copy
      // (an old sha would cause needless 409 conflicts).
      return await fetch(url, { cache: 'no-store', ...opts, headers: headers(opts.headers) });
    } catch {
      const err = new Error('Could not reach GitHub. Check your internet connection.');
      err.status = 0; throw err;
    }
  }

  async function toError(res, what) {
    let raw = res.statusText;
    try { const j = await res.json(); if (j.message) raw = j.message; } catch { /* ignore */ }
    const friendly = {
      401: 'GitHub rejected the token. It may have expired or been copied incompletely. Create a new one and paste it in Settings.',
      403: 'The token is not allowed to do this. Give it "Contents: Read and write" access to this repository (or you hit the API rate limit; wait an hour).',
      404: `GitHub could not find the ${what}. Check the owner, repository name, branch and file path, and that the token has access to this repository.`,
      409: 'The file changed on GitHub while saving.',
      422: `GitHub refused the update (${raw}).`,
    }[res.status] || `GitHub error ${res.status}: ${raw}`;
    const err = new Error(friendly); err.status = res.status; err.raw = raw; return err;
  }

  return {
    /** Checks the repository exists and the token can see it. Returns repo info. */
    async checkRepo() {
      const res = await request(repoUrl);
      if (!res.ok) throw await toError(res, 'repository');
      return res.json();
    },
    /** Checks the chosen branch exists. */
    async checkBranch() {
      const res = await request(`${repoUrl}/branches/${encodeURIComponent(branch)}`);
      if (res.status === 404) return false;
      if (!res.ok) throw await toError(res, 'branch');
      return true;
    },
    /**
     * Reads the JSON data file.
     * Returns { data, sha } or { data:null, sha:null } if the file doesn't exist yet.
     */
    async getFile() {
      const url = `${fileUrl}?ref=${encodeURIComponent(branch)}`;
      const res = await request(url);
      if (res.status === 404) return { data: null, sha: null };
      if (!res.ok) throw await toError(res, 'data file');
      const meta = await res.json();
      if (Array.isArray(meta)) throw new Error('The file path points to a folder. Use a file name such as data.json.');
      let text;
      if (meta.encoding === 'base64' && meta.content) {
        text = fromBase64(meta.content);                 // normal case (files up to 1 MB)
      } else {
        // Files over 1 MB come back without content; ask for the raw file instead.
        const raw = await request(url, { headers: { Accept: 'application/vnd.github.raw+json' } });
        if (!raw.ok) throw await toError(raw, 'data file');
        text = await raw.text();
      }
      let data = null;
      if (text.trim()) {
        try { data = JSON.parse(text); }
        catch { throw new Error(`${cfg.path} on GitHub is not valid JSON. Fix or delete it in the repository, then sync again.`); }
      }
      return { data, sha: meta.sha };
    },
    /**
     * Writes the JSON data file as a new commit.
     * Pass the sha you read; pass null to create the file.
     * Returns the new sha.
     */
    async putFile(data, sha, message) {
      const body = {
        message,
        content: toBase64(JSON.stringify(data, null, 2) + '\n'),
        branch,
      };
      if (sha) body.sha = sha;
      const res = await request(fileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await toError(res, 'repository or branch');
      const j = await res.json();
      return j.content?.sha || null;
    },
    webUrl: `https://github.com/${cfg.owner}/${cfg.repo}/blob/${branch}/${String(cfg.path || '').replace(/^\/+/, '')}`,
  };
}
const isConfigured = () => !!(config.owner && config.repo && config.path && config.token);

/* GitHub needs base64. These two helpers handle any Unicode text (₹, emoji, Hindi...). */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------------------------------------------------------------------
   5. SYNC ENGINE
   ---------------------------------------------------------------------
   runSync() does:
     a) GET the latest file from GitHub
     b) replay our pending changes on top of it
     c) PUT the result back as one commit
     d) on 409 conflict, wait a moment and repeat from (a) — up to 4 tries
   If there are no pending changes it simply downloads the latest data.
   Rapid edits are batched: commit() waits ~0.7s before syncing, so
   adding three expenses quickly creates one GitHub commit, not three.
   --------------------------------------------------------------------- */
// hold = true while the first-connection dialog is deciding what to do.
const sync = { busy: false, again: false, hold: false, timer: null, state: 'local', detail: '', lastPull: 0 };
const dataSignature = (d) => JSON.stringify([d.settings, ...COLLECTIONS.map((c) => d[c])]);

function scheduleSync(delay = 700) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(runSync, delay);
  if (isConfigured()) setSyncStatus(navigator.onLine ? 'pending' : 'offline');
  else setSyncStatus('local');
}

function commitMessage(batches) {
  const msgs = batches.map((b) => b.message).filter(Boolean);
  if (msgs.length <= 1) return `KOSH: ${msgs[0] || 'Update data'}`;
  return `KOSH: ${msgs.length} changes (${msgs.slice(0, 3).join('; ')}${msgs.length > 3 ? '; …' : ''})`;
}

async function runSync() {
  if (!isConfigured()) { setSyncStatus('local'); return false; }
  if (sync.hold) return false;
  if (!navigator.onLine) { setSyncStatus('offline'); return false; }
  if (sync.busy) { sync.again = true; return false; }
  sync.busy = true;
  setSyncStatus('syncing');
  const before = dataSignature(db);
  const api = gh();
  let ok = false;
  try {
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      const batches = pending.slice();               // snapshot of what we're sending
      const remote = await api.getFile();            // (a) latest copy from GitHub

      if (!batches.length && remote.data) {          // nothing to send: just download
        db = normalizeDB(remote.data);
        persist();
        ok = true;
        break;
      }

      // (b) replay local changes on top of GitHub's copy.
      //     If the file doesn't exist yet, our local copy becomes the first version.
      const merged = remote.data
        ? applyOps(normalizeDB(remote.data), batches.flatMap((b) => b.ops))
        : normalizeDB(clone(db));
      merged.meta.updatedAt = new Date().toISOString();

      try {
        await api.putFile(merged, remote.sha, batches.length ? commitMessage(batches) : 'KOSH: create data file'); // (c)
      } catch (e) {
        const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.raw || ''));
        if (conflict) { await sleep(500 * attempt); continue; }   // (d) retry
        throw e;
      }

      // Success: remove what we sent; keep anything added while we were busy.
      pending = pending.slice(batches.length);
      db = pending.length ? applyOps(clone(merged), pending.flatMap((b) => b.ops)) : merged;
      persist();
      ok = true;
    }
    if (!ok) throw new Error('The data file kept changing on GitHub. Tap the sync status to try again.');
    sync.lastPull = Date.now();
    writeLS(STORAGE_KEYS.lastSync, new Date().toISOString());
    setSyncStatus(pending.length ? 'pending' : 'synced');
    if (dataSignature(db) !== before) render();
  } catch (e) {
    console.error('Sync failed:', e);
    setSyncStatus('error', e.message);
    if ([401, 403, 404].includes(e.status)) toast(e.message, 'error');
  } finally {
    sync.busy = false;
    if (sync.again) { sync.again = false; scheduleSync(150); }
  }
  return ok;
}

function setSyncStatus(state, detail = '') {
  sync.state = state; sync.detail = detail;
  const el = $('#syncStatus');
  if (!el) return;
  const n = pending.length;
  const last = readLS(STORAGE_KEYS.lastSync, null);
  const lastTxt = last ? new Date(last).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) : '';
  const text = {
    local: 'This device only',
    syncing: 'Saving to GitHub…',
    synced: lastTxt ? `Synced at ${lastTxt}` : 'Synced',
    pending: n ? `${n} change${n > 1 ? 's' : ''} waiting` : 'Synced',
    offline: n ? `Offline, ${n} waiting` : 'Offline',
    error: 'Sync failed',
  }[state] || state;
  const tip = {
    local: 'Data is saved in this browser only. Click to connect GitHub.',
    error: `${detail} Click to retry.`,
    offline: 'Changes are saved on this device and will upload when you are back online.',
  }[state] || 'Click to sync now';
  el.className = `sync-chip ${state}`;
  el.title = tip;
  const icon = { local: 'fa-mobile-screen', syncing: 'fa-arrows-rotate fa-spin', synced: 'fa-cloud', pending: 'fa-cloud-arrow-up', offline: 'fa-cloud-arrow-up', error: 'fa-triangle-exclamation' }[state] || 'fa-cloud';
  el.setAttribute('aria-label', `${text}. ${tip}`);
  el.innerHTML = `<span class="dot"></span><i class="fa-solid ${icon} sync-ico" aria-hidden="true"></i><span class="txt">${esc(text)}</span>`;
  const foot = $('#sidebarFoot');
  if (foot) {
    foot.innerHTML = isConfigured()
      ? `Data file: <a class="underline" href="${esc(gh().webUrl)}" target="_blank" rel="noopener">${esc(config.owner)}/${esc(config.repo)}/${esc(config.path)}</a>`
      : 'Not connected to GitHub yet. Your data is only in this browser.';
  }
}

/* ---------------------------------------------------------------------
   6. CALCULATIONS
   ---------------------------------------------------------------------
   Balances are never stored; they are always worked out from:
     opening balance (as on its date) + money in - money out
   so editing or deleting any transaction automatically fixes balances.

   Sign convention (also used in exports):
     cash / bank / investment : positive = money you have
     credit card              : negative = amount you owe (outstanding)
   --------------------------------------------------------------------- */
const accountById = (id) => db.accounts.find((a) => a.id === id);
const accountName = (id) => (id ? (accountById(id)?.name || 'Deleted account') : '');

function computeBalances() {
  const bal = new Map();
  const since = new Map();
  for (const a of db.accounts) { bal.set(a.id, num(a.openingBalance)); since.set(a.id, a.openingDate || ''); }
  for (const t of db.transactions) {
    const amt = num(t.amount);
    const d = t.date || '';
    if (t.fromAccountId && bal.has(t.fromAccountId) && d >= since.get(t.fromAccountId)) bal.set(t.fromAccountId, bal.get(t.fromAccountId) - amt);
    if (t.toAccountId && bal.has(t.toAccountId) && d >= since.get(t.toAccountId)) bal.set(t.toAccountId, bal.get(t.toAccountId) + amt);
  }
  for (const [k, v] of bal) bal.set(k, round2(v));
  return bal;
}

/** Standard reducing-balance EMI maths. */
function emiCalc(e) {
  const P = num(e.principal);
  const n = Math.max(0, int(e.tenureMonths));
  const r = num(e.annualRate) / 1200;
  const standard = n > 0 ? (r > 0 ? (P * r * (1 + r) ** n) / ((1 + r) ** n - 1) : P / n) : 0;
  const emi = num(e.emiAmount) > 0 ? num(e.emiAmount) : round2(standard);
  const paid = Math.min(Math.max(0, int(e.paidInstallments)), n);
  const remainingAfter = (k) => {
    if (k >= n) return 0;
    const v = r > 0 ? P * (1 + r) ** k - (emi * ((1 + r) ** k - 1)) / r : P - emi * k;
    return Math.max(0, v);
  };
  const remaining = round2(remainingAfter(paid));
  const remainingMonths = n - paid;
  const totalPayable = round2(emi * n);
  const totalInterest = round2(Math.max(0, totalPayable - P));
  const interestLeft = round2(Math.max(0, emi * remainingMonths - remaining));
  const status = e.closed ? 'closed' : remainingMonths <= 0 ? 'completed' : 'active';
  return {
    n, r, emi, paid, remaining, remainingMonths, totalPayable, totalInterest, interestLeft, status,
    nextDue: status === 'active' && e.startDate ? addMonths(e.startDate, paid) : null,
    endDate: n > 0 && e.startDate ? addMonths(e.startDate, n - 1) : null,
    remainingAfter,
  };
}

/** Full amortisation schedule (for the "Schedule" view and exports). */
function emiSchedule(e) {
  const c = emiCalc(e);
  const rows = [];
  let bal = num(e.principal);
  for (let k = 1; k <= c.n; k++) {
    const interest = c.r > 0 ? bal * c.r : 0;
    let principal = c.emi - interest;
    if (k === c.n || principal > bal) principal = bal;
    bal = Math.max(0, bal - principal);
    rows.push({
      installment: k, dueDate: e.startDate ? addMonths(e.startDate, k - 1) : '',
      emi: round2(k === c.n ? principal + interest : c.emi), principal: round2(principal),
      interest: round2(interest), balance: round2(bal), paid: k <= c.paid,
    });
  }
  return rows;
}

/** Statement / due dates for a credit card from its billing-cycle days. */
function cardDates(a) {
  const sd = int(a.statementDay), dd = int(a.dueDay);
  if (!sd || !dd) return {};
  const today = todayStr();
  const t = parseDate(today);
  let lastStmt = makeDate(t.getFullYear(), t.getMonth(), sd);
  if (lastStmt > today) lastStmt = makeDate(t.getFullYear(), t.getMonth() - 1, sd);
  const dueFor = (stmt) => { const s = parseDate(stmt); return makeDate(s.getFullYear(), s.getMonth() + (dd > sd ? 0 : 1), dd); };
  const ls = parseDate(lastStmt);
  const nextStmt = makeDate(ls.getFullYear(), ls.getMonth() + 1, sd);
  let nextDue = dueFor(lastStmt);
  if (nextDue < today) nextDue = dueFor(nextStmt);
  return { lastStatement: lastStmt, nextStatement: nextStmt, nextDue };
}

/** Everything the pages need, computed once per render. */
function buildModel() {
  const balances = computeBalances();
  const emis = db.emis.map((e) => ({ e, c: emiCalc(e) }));
  const emiBlocked = new Map();
  for (const { e, c } of emis) {
    if (e.kind === 'credit_card' && c.status === 'active') emiBlocked.set(e.accountId, (emiBlocked.get(e.accountId) || 0) + c.remaining);
  }
  const T = { cash: 0, bank: 0, investment: 0, cardCredit: 0, cardDebt: 0, loans: 0, cardEmis: 0, owedToMe: 0, iOwe: 0 };
  for (const a of db.accounts) {
    const b = balances.get(a.id) || 0;
    if (a.type === 'credit_card') { if (b < 0) T.cardDebt += -b; else T.cardCredit += b; }
    else if (a.type === 'person') { if (b > 0) T.owedToMe += b; else T.iOwe += -b; }
    else if (T[a.type] !== undefined) T[a.type] += b;
  }
  for (const { e, c } of emis) {
    if (c.status !== 'active') continue;
    if (e.kind === 'loan') T.loans += c.remaining; else T.cardEmis += c.remaining;
  }
  T.assets = T.cash + T.bank + T.investment + T.cardCredit + T.owedToMe;
  T.liabilities = T.cardDebt + T.loans + T.cardEmis + T.iOwe;
  T.netWorth = T.assets - T.liabilities;
  return { balances, emis, emiBlocked, T, P: buildPortfolio(balances), reviews: unitReviews() };
}

/* ----- Investment portfolio -----
   Each investment account is one holding (a fund, a stock, an FD...).
     current value = its balance (opening value + money in - money out
                     + "Update value" adjustments for market moves)
     invested      = amount invested as on the opening date
                     + money put in since (SIPs, lump sums)
                     - money taken out since (redemptions)
     gain          = current value - invested
   Market moves are recorded as adjustments, so they change the value
   but not the invested amount. */
function buildPortfolio(balances) {
  const cost = new Map();
  const inv = db.accounts.filter((a) => a.type === 'investment');
  for (const a of inv) cost.set(a.id, num(a.investedAmount ?? a.openingBalance));
  for (const t of db.transactions) {
    if (t.type === 'adjustment') continue;
    const amt = num(t.amount);
    const to = cost.has(t.toAccountId) && (t.date || '') >= (accountById(t.toAccountId).openingDate || '');
    const from = cost.has(t.fromAccountId) && (t.date || '') >= (accountById(t.fromAccountId).openingDate || '');
    if (to) cost.set(t.toAccountId, cost.get(t.toAccountId) + amt);
    if (from) cost.set(t.fromAccountId, Math.max(0, cost.get(t.fromAccountId) - amt));
  }
  const holdings = inv.map((a) => {
    const value = round2(balances.get(a.id) || 0);
    const invested = round2(cost.get(a.id) || 0);
    const gain = round2(value - invested);
    return { a, value, invested, gain, gainPct: invested > 0 ? gain / invested : 0, group: investmentGroup(a), fd: fdInfo(a, invested) };
  });
  const active = holdings.filter((h) => !h.a.archived || h.value !== 0);
  const totals = { value: 0, invested: 0 };
  const groups = new Map();
  for (const h of active) {
    totals.value += h.value; totals.invested += h.invested;
    groups.set(h.group, (groups.get(h.group) || 0) + h.value);
  }
  totals.value = round2(totals.value); totals.invested = round2(totals.invested);
  totals.gain = round2(totals.value - totals.invested);
  totals.gainPct = totals.invested > 0 ? totals.gain / totals.invested : 0;
  const activeSips = db.sips.filter((x) => x.active);
  totals.sipMonthly = round2(activeSips.reduce((sum, x) => sum + sipAmountOn(x, todayStr()) * (FREQUENCIES[x.frequency]?.perMonth || 1), 0));
  totals.sipCount = activeSips.length;
  const allocation = [...groups.entries()].filter(([, v]) => v > 0).map(([group, value]) => ({ group, value: round2(value) })).sort((x, y) => y.value - x.value);
  return { holdings, totals, allocation };
}

/** Fixed deposit maths (quarterly compounding, the usual Indian bank convention).
    Needs an interest rate and a maturity date on the account. */
function fdInfo(a, principal) {
  if (a.subtype !== 'Fixed deposit' || !num(a.interestRate) || !a.maturityDate) return null;
  const start = a.depositDate || a.openingDate || todayStr();
  const P = num(a.principalAmount) || principal;
  const r = num(a.interestRate) / 100;
  const years = (s, e) => Math.max(0, (parseDate(e) - parseDate(s)) / (365.25 * 86400000));
  const grow = (y) => round2(P * (1 + r / 4) ** (4 * y));
  const today = todayStr();
  return {
    principal: P, start, maturityDate: a.maturityDate,
    maturityValue: grow(years(start, a.maturityDate)),
    estimatedToday: grow(years(start, today < a.maturityDate ? today : a.maturityDate)),
    matured: a.maturityDate <= today,
  };
}
let M = null; // current model

function cardMetrics(a) {
  const bal = M.balances.get(a.id) || 0;
  const outstanding = round2(-bal);
  const limit = num(a.creditLimit);
  const blocked = round2(M.emiBlocked.get(a.id) || 0);
  const used = Math.max(0, outstanding) + blocked;
  return {
    outstanding, limit, blocked,
    available: round2(limit - used),
    utilization: limit > 0 ? used / limit : 0,
    dates: cardDates(a),
  };
}

/** Money moved from bank / cash / card into an investment (SIPs, lump sums). */
function isInvestmentOutflow(t) {
  if (t.type !== 'transfer') return false;
  const to = accountById(t.toAccountId), from = accountById(t.fromAccountId);
  return to?.type === 'investment' && from && from.type !== 'investment';
}
/**
 * One month in numbers:
 *   income   money received
 *   spent    ordinary expenses
 *   invested money put into investments (SIPs etc.)
 *   left     income - spent - invested
 * `expense` is what the charts call "money out": spent, plus invested when
 * Settings > "Count SIPs as money going out" is on (the default).
 */
function monthSummary(mk) {
  let income = 0, spent = 0, invested = 0;
  for (const t of db.transactions) {
    if (!t.date || !t.date.startsWith(mk)) continue;
    if (t.type === 'income') income += num(t.amount);
    else if (t.type === 'expense') spent += num(t.amount);
    else if (isInvestmentOutflow(t)) invested += num(t.amount);
  }
  const expense = spent + (db.settings.sipAsSpending ? invested : 0);
  return {
    income: round2(income), spent: round2(spent), invested: round2(invested), expense: round2(expense),
    left: round2(income - spent - invested), net: round2(income - expense),
  };
}
function spendByCategory(mk, { withInvestments = db.settings.sipAsSpending } = {}) {
  const m = new Map();
  for (const t of db.transactions) {
    if (!t.date?.startsWith(mk)) continue;
    let k;
    if (t.type === 'expense') k = t.category || 'Other';
    else if (withInvestments && isInvestmentOutflow(t)) k = INVEST_SLICE;
    else continue;
    m.set(k, (m.get(k) || 0) + num(t.amount));
  }
  return [...m.entries()].map(([category, amount]) => ({ category, amount: round2(amount) })).sort((a, b) => b.amount - a.amount);
}
function lastMonths(endMk, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(endMk + '-01', -i).slice(0, 7));
  return out;
}
function monthsWithData() {
  const s = new Set([thisMonth()]);
  for (const t of db.transactions) if (t.date) s.add(t.date.slice(0, 7));
  return [...s].sort().reverse();
}

function advanceDate(s, freq) {
  if (freq === 'weekly') return addDays(s, 7);
  const months = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[freq] || 1;
  return addMonths(s, months);
}

/** Things due in the next `days` days (overdue items included). */
function upcomingItems(days = 30) {
  const today = todayStr();
  const limit = addDays(today, days);
  const items = [];
  for (const { e, c } of M.emis) {
    if (c.status === 'active' && c.nextDue && c.nextDue <= limit) {
      items.push({ date: c.nextDue, kind: 'emi', id: e.id, title: e.name, sub: `EMI ${c.paid + 1} of ${c.n}, from ${accountName(e.accountId)}`, amount: c.emi });
    }
  }
  for (const s of db.subscriptions) {
    if (s.active && s.nextRenewal && s.nextRenewal <= limit) {
      const k = recurKind(s);
      items.push({ date: s.nextRenewal, kind: k === 'income' ? 'income' : 'subscription', id: s.id, title: s.name, sub: `${FREQUENCIES[s.frequency]?.label || ''} ${k === 'income' ? 'income, into' : k === 'bill' ? 'bill,' : 'renewal,'} ${accountName(s.accountId)}`, amount: num(s.amount) });
    }
  }
  for (const x of db.sips) {
    if (x.active && x.nextDate && x.nextDate <= limit && !sipEnded(x, x.nextDate)) {
      items.push({ date: x.nextDate, kind: 'sip', id: x.id, title: `${x.name} SIP`, sub: `${accountName(x.fromAccountId)} to ${accountName(x.fundAccountId)}${x.autoLog ? ', invests automatically' : ''}`, amount: sipAmountOn(x, x.nextDate) });
    }
  }
  for (const r of M.reviews) {
    if (r.due <= limit) items.push({ date: r.due, kind: 'review', id: r.t.id, title: `Enter units: ${r.a.name}`, sub: `${r.t.relatedType === 'sip' ? 'SIP' : r.sell ? 'Withdrawal' : 'Purchase'} on ${fmtDate(r.t.date)}`, amount: num(r.t.amount) });
  }
  for (const h of M.P.holdings) {
    if (h.fd && !h.a.archived && h.fd.maturityDate >= today && h.fd.maturityDate <= limit) {
      items.push({ date: h.fd.maturityDate, kind: 'fd', id: h.a.id, title: `${h.a.name} matures`, sub: 'Fixed deposit maturity (estimated amount)', amount: h.fd.maturityValue });
    }
  }
  for (const a of db.accounts) {
    if (a.type !== 'credit_card' || a.archived) continue;
    const m = cardMetrics(a);
    if (m.outstanding > 0 && m.dates.nextDue && m.dates.nextDue <= limit) {
      items.push({ date: m.dates.nextDue, kind: 'card', id: a.id, title: `${a.name} bill`, sub: 'Credit card payment due', amount: m.outstanding });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Transactions created automatically use predictable ids, so the same
    payment can never be recorded twice (even from two devices). */
/* Recurring items (db.subscriptions) have a kind:
   'subscription' (default, e.g. Netflix), 'bill' (rent, electricity, maid)
   or 'income' (salary, rent received). Income records money coming in. */
const recurKind = (s) => s.kind || 'subscription';
function subscriptionTxn(s, date) {
  const income = recurKind(s) === 'income';
  return {
    id: `txn_sub_${s.id}_${date}`, date, type: income ? 'income' : 'expense', amount: round2(num(s.amount)),
    category: s.category || (income ? 'Salary' : 'Subscriptions'), description: s.name,
    fromAccountId: income ? '' : s.accountId || '', toAccountId: income ? s.accountId || '' : '', relatedType: 'subscription', relatedId: s.id,
    notes: `${FREQUENCIES[s.frequency]?.label || ''} ${income ? 'income' : recurKind(s) === 'bill' ? 'bill' : 'subscription renewal'}`,
  };
}
function emiTxn(e, k, c = emiCalc(e)) {
  return {
    id: `txn_emi_${e.id}_${k}`, date: addMonths(e.startDate, k - 1), type: 'expense', amount: round2(c.emi),
    category: 'EMI', description: `${e.name} (EMI ${k} of ${c.n})`,
    fromAccountId: e.accountId || '', toAccountId: '', relatedType: 'emi', relatedId: e.id,
    notes: e.kind === 'credit_card' ? 'Credit card EMI installment' : `${e.subtype || 'Loan'} installment`,
  };
}

/* ----- SIPs -----
   A SIP is stored as { name, fundAccountId, fromAccountId, amount, frequency,
   day, startDate, nextDate, endDate, stepUpPercent, autoLog, active }.
   Each instalment is a TRANSFER from your bank to the fund's investment
   account: your bank balance goes down (like an expense) and the fund's
   value goes up by the same amount, so net worth stays correct. */
function sipAmountOn(x, date) {
  const base = num(x.amount);
  const step = num(x.stepUpPercent);
  if (!step || !x.startDate || date < x.startDate) return round2(base);
  const s = parseDate(x.startDate), d = parseDate(date);
  const years = Math.floor(((d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth() - (d.getDate() < s.getDate() ? 1 : 0)) / 12);
  return Math.round(base * (1 + step / 100) ** Math.max(0, years));
}
/** Next instalment after `date`, keeping the chosen day of month (e.g. always the 1st). */
function advanceSip(x, date) {
  if (x.frequency === 'weekly') return addDays(date, 7);
  const d = parseDate(date);
  const months = x.frequency === 'quarterly' ? 3 : 1;
  return makeDate(d.getFullYear(), d.getMonth() + months, int(x.day) || d.getDate());
}
const sipEnded = (x, date) => !!x.endDate && date > x.endDate;
function sipTxn(x, date) {
  return {
    id: `txn_sip_${x.id}_${date}`, date, type: 'transfer', amount: sipAmountOn(x, date),
    category: SIP_CATEGORY, description: `${x.name} SIP`,
    fromAccountId: x.fromAccountId || '', toAccountId: x.fundAccountId || '', relatedType: 'sip', relatedId: x.id,
    notes: 'SIP instalment',
  };
}

/** Records subscription renewals, EMIs and SIPs marked "automatic" that are now due. */
function processAutoPayments() {
  const today = todayStr();
  const ops = [];
  let count = 0;
  for (const s of db.subscriptions) {
    if (!s.active || !s.autoLog || !s.nextRenewal || !s.accountId) continue;
    let next = s.nextRenewal, guard = 0;
    while (next <= today && guard < 60) { ops.push(opUpsert('transactions', subscriptionTxn(s, next))); next = advanceDate(next, s.frequency); guard++; }
    if (guard) { ops.push(opUpsert('subscriptions', { ...s, nextRenewal: next })); count += guard; }
  }
  for (const e of db.emis) {
    if (!e.autoLog || e.closed || !e.startDate || !e.accountId) continue;
    const c = emiCalc(e);
    let paid = c.paid, guard = 0;
    while (paid < c.n && addMonths(e.startDate, paid) <= today && guard < 600) { ops.push(opUpsert('transactions', emiTxn(e, paid + 1, c))); paid++; guard++; }
    if (guard) { ops.push(opUpsert('emis', { ...e, paidInstallments: paid })); count += guard; }
  }
  for (const x of db.sips) {
    if (!x.active || !x.autoLog || !x.nextDate || !accountById(x.fromAccountId) || !accountById(x.fundAccountId)) continue;
    let next = x.nextDate, guard = 0;
    while (next <= today && !sipEnded(x, next) && guard < 400) {
      // ifMissing: never overwrite an instalment you already recorded or edited
      ops.push(opUpsert('transactions', sipTxn(x, next), { ifMissing: true }));
      next = advanceSip(x, next); guard++;
    }
    if (guard) { ops.push(opUpsert('sips', { ...x, nextDate: next, ...(sipEnded(x, next) ? { active: false } : {}) })); count += guard; }
  }
  if (ops.length) {
    commit(ops, `Auto-record ${count} due payment${count > 1 ? 's' : ''}`);
    toast(`Recorded ${count} scheduled payment${count > 1 ? 's' : ''} that fell due.`, 'success');
  }
}

/* ---------------------------------------------------------------------
   7. UI HELPERS
   --------------------------------------------------------------------- */
function toast(msg, type = 'info') {
  const box = $('#toasts');
  if (!box) return;
  const icon = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' }[type] || 'fa-circle-info';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icon} mt-0.5"></i><div>${esc(msg)}</div>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 3500);
}

/* ----- Form field builders (return HTML strings) ----- */
function field(label, control, hint = '', extraClass = '') {
  return `<label class="block ${extraClass}"><span class="lbl">${label}</span>${control}${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
}
function input(name, value = '', attrs = '') {
  return `<input class="inp" name="${name}" value="${esc(value ?? '')}" ${attrs}>`;
}
function moneyInput(name, value = '', attrs = '') {
  return input(name, value === 0 || value ? value : '', `type="number" step="0.01" inputmode="decimal" ${attrs}`);
}
function textarea(name, value = '', attrs = '') {
  return `<textarea class="inp" name="${name}" ${attrs}>${esc(value ?? '')}</textarea>`;
}
function select(name, options, selected, attrs = '') {
  const opts = options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('');
  return `<select class="inp" name="${name}" ${attrs}>${opts}</select>`;
}
function checkbox(name, checked, label, hint = '') {
  return `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span>${label}${hint ? `<span class="hint">${hint}</span>` : ''}</span></label>`;
}
/** <select> of accounts grouped by type, showing current balances. */
function accountSelect(name, selected, { types = Object.keys(ACCOUNT_TYPES), placeholder = 'Choose an account', required = true } = {}) {
  let html = `<option value="">${esc(placeholder)}</option>`;
  for (const type of types) {
    const list = db.accounts.filter((a) => a.type === type && (!a.archived || a.id === selected));
    if (!list.length) continue;
    html += `<optgroup label="${esc(ACCOUNT_TYPES[type].label)}">`;
    for (const a of list) {
      const b = M.balances.get(a.id) || 0;
      const shown = type === 'credit_card' ? `owes ${money(Math.max(0, -b))}` : money(b);
      html += `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)} (${shown})</option>`;
    }
    html += '</optgroup>';
  }
  return `<select class="inp" name="${name}" ${required ? 'required' : ''}>${html}</select>`;
}
/** Wraps fields that should only appear for certain choices, e.g. data-show="expense transfer". */
const showFor = (values, html) => `<div data-show="${values}" class="space-y-4">${html}</div>`;
const twoCol = (a, b) => `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${a}${b}</div>`;

/**
 * Shows/hides [data-show] blocks based on the value of a select or radio group.
 * Hidden blocks are disabled so their inputs are neither validated nor submitted.
 */
function bindShowHide(form, controlName) {
  const update = () => {
    const el = form.elements[controlName];
    const val = el ? el.value : '';
    $$('[data-show]', form).forEach((block) => {
      const on = block.dataset.show.split(' ').includes(val);
      block.hidden = !on;
      $$('input, select, textarea', block).forEach((i) => { i.disabled = !on; });
    });
  };
  form.addEventListener('change', (e) => { if (e.target.name === controlName) update(); }, { signal: modalSignal() });
  update();
}

/** Reads a form into a plain object; checkboxes become true/false. */
function readForm(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
    else data[el.name] = typeof el.value === 'string' ? el.value.trim() : el.value;
  }
  return data;
}

/* ----- Modal ----- */
let modalState = null;
/* Listeners that belong to one modal session. The <form> element is reused for every
   modal, so anything attached in onOpen must be removed when the modal closes;
   passing { signal: modalSignal() } makes the browser do that automatically. */
let modalAbort = null;
const modalSignal = () => modalAbort?.signal;
function openModal({ title, body, submitLabel = 'Save', onSubmit, onOpen, onDelete, deleteLabel = 'Delete', wide = false, cancelLabel = 'Cancel' }) {
  modalAbort?.abort();
  modalAbort = new AbortController();
  modalState = { onSubmit, onDelete, lastFocus: document.activeElement };
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = body;
  const form = $('#modalForm');
  form.classList.toggle('sm:max-w-lg', !wide);
  form.classList.toggle('sm:max-w-3xl', wide);
  $('#modalFooter').innerHTML = `
    ${onDelete ? `<button type="button" class="btn btn-danger" id="modalDelete"><i class="fa-regular fa-trash-can"></i> ${esc(deleteLabel)}</button>` : ''}
    <div class="ml-auto flex gap-2">
      <button type="button" class="btn" data-close>${esc(onSubmit ? cancelLabel : 'Close')}</button>
      ${onSubmit ? `<button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>` : ''}
    </div>`;
  $('#modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (onOpen) onOpen(form);
  const first = $('#modalBody input:not([type=hidden]):not([disabled]), #modalBody select:not([disabled]), #modalBody textarea', form);
  setTimeout(() => (first || $('#modalFooter .btn', form))?.focus(), 30);
}
function closeModal() {
  // The chart builder's preview and unsaved colour picks end with the modal.
  if (typeof previewChart !== 'undefined' && previewChart) { previewChart.destroy(); previewChart = null; }
  if (typeof colorDraft !== 'undefined') colorDraft = null;
  $('#modal').classList.add('hidden');
  document.body.style.overflow = '';
  $('#modalBody').innerHTML = '';
  modalAbort?.abort();
  modalAbort = null;
  const back = modalState?.lastFocus;
  modalState = null;
  back?.focus?.();
}
function bindModal() {
  const form = $('#modalForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!modalState?.onSubmit) return closeModal();
    const result = await modalState.onSubmit(readForm(form), form);
    if (result !== false) closeModal();
  });
  $('#modal').addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]') || e.target.id === 'modalWrap') closeModal();
    if (e.target.closest('#modalDelete') && modalState?.onDelete) {
      const result = await modalState.onDelete();
      if (result !== false) closeModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
  });
}

/* ----- Router: #dashboard, #accounts, ... ----- */
const PAGES = {
  dashboard:     { title: 'Dashboard',        icon: 'fa-chart-pie' },
  insights:      { title: 'Insights',         icon: 'fa-lightbulb' },
  health:        { title: 'Money health',     short: 'Health', icon: 'fa-heart-pulse' },
  transactions:  { title: 'Transactions',     icon: 'fa-list' },
  calendar:      { title: 'Calendar',         icon: 'fa-calendar-days' },
  import:        { title: 'Import statement', short: 'Import', icon: 'fa-file-import' },
  accounts:      { title: 'Accounts',         icon: 'fa-building-columns' },
  portfolio:     { title: 'Portfolio',        icon: 'fa-chart-line' },
  goals:         { title: 'Goals & wishlist', short: 'Goals', icon: 'fa-flag-checkered' },
  planner:       { title: 'Planners',         icon: 'fa-compass' },
  people:        { title: 'People',           icon: 'fa-user-group' },
  notifications: { title: 'Notifications',    icon: 'fa-bell' },
  subscriptions: { title: 'Recurring',        icon: 'fa-rotate' },
  emis:          { title: 'EMIs & loans',     icon: 'fa-calendar-check' },
  budgets:       { title: 'Budgets',          icon: 'fa-bullseye' },
  charts:        { title: 'Charts',           icon: 'fa-chart-simple' },
  tax:           { title: 'Tax helper',       icon: 'fa-file-invoice' },
  data:          { title: 'Export & backup',  short: 'Export', icon: 'fa-file-export' },
};
const currentPage = () => { const h = location.hash.replace(/^#\/?/, ''); return PAGES[h] ? h : 'dashboard'; };

let charts = [];
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

function renderNav() {
  const cur = currentPage();
  $('#nav').innerHTML = Object.entries(PAGES).map(([k, p]) =>
    `<a href="#${k}" class="nav-link ${k === cur ? 'active' : ''}" ${k === cur ? 'aria-current="page"' : ''}><i class="fa-solid ${p.icon}"></i>${p.title}${k === 'portfolio' && M?.reviews?.length ? `<span class="nav-badge" title="Units to confirm">${M.reviews.length}</span>` : ''}${k === 'people' && typeof pendingHome === 'function' && pendingHome().length ? `<span class="nav-badge" title="Home expenses to take back">${pendingHome().length}</span>` : ''}</a>`).join('');
}

/** Redraws the current page from `db`. Called after every change. */
function render() {
  M = buildModel();
  const page = currentPage();
  destroyCharts();
  renderNav();
  const phone = window.innerWidth < 640;
  $('#pageTitle').textContent = phone && PAGES[page].short ? PAGES[page].short : PAGES[page].title;
  // Phone tab bar: highlight the current page ("More" for pages not on the bar)
  const onBar = ['dashboard', 'transactions', 'calendar'].includes(page);
  $$('#tabbar [data-tab]').forEach((el) => { const on = el.dataset.tab === page || (!onBar && el.dataset.tab === 'more'); el.classList.toggle('on', on); if (el.tagName === 'A') el.toggleAttribute('aria-current', el.dataset.tab === page); });
  const brand = brandName();
  document.title = `${PAGES[page].title} | ${brand}`;
  $$('[data-brand]').forEach((el) => { el.textContent = brand; });
  const view = $('#view');
  const fn = {
    dashboard: renderDashboard, accounts: renderAccounts, portfolio: renderPortfolio, charts: renderCharts, people: renderPeople, goals: renderGoals, insights: renderInsights, import: renderImport, tax: renderTax, calendar: renderCalendar, health: renderHealth, planner: renderPlanner, notifications: renderNotifications, transactions: renderTransactions,
    emis: renderEmis, subscriptions: renderSubscriptions, budgets: renderBudgets, data: renderData,
  }[page];
  view.innerHTML = fn();
  if (page === 'dashboard') drawDashboardCharts();
  if (page === 'portfolio') drawPortfolioChart();
  if (page === 'dashboard' || page === 'charts') drawChartCards();
  setSyncStatus(sync.state, sync.detail);
}

/** "Kundan's Finance" (the name comes from Settings > Your name). */
function brandName() {
  const n = String(db.settings.ownerName || '').trim();
  if (!n) return 'My Finance';
  return `${n}${/s$/i.test(n) ? "'" : "'s"} Finance`;
}

function toggleNav(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#navBackdrop').classList.toggle('hidden', !open);
}

const emptyState = (icon, text, actionHtml = '') =>
  `<div class="empty"><i class="fa-solid ${icon}"></i><p class="mb-4">${text}</p>${actionHtml}</div>`;

/* ---------------------------------------------------------------------
   8. PAGES
   --------------------------------------------------------------------- */

/* ===== Shared row renderers ===== */
function txnRow(t, withActions = true) {
  const kind = {
    expense:    { icon: 'fa-arrow-up', cls: 'out', label: 'Expense' },
    income:     { icon: 'fa-arrow-down', cls: 'in', label: 'Income' },
    transfer:   t.forHome ? { icon: 'fa-house', cls: 'home', label: 'Home expense' }
      : t.relatedType === 'sip' || isInvestmentOutflow(t) ? { icon: 'fa-seedling', cls: 'invest', label: 'Investment' }
      : accountById(t.toAccountId)?.type === 'person' || accountById(t.fromAccountId)?.type === 'person' ? { icon: 'fa-user', cls: 'move', label: 'Money with a person' }
      : { icon: 'fa-right-left', cls: 'move', label: 'Transfer' },
    adjustment: { icon: 'fa-scale-balanced', cls: '', label: 'Balance update' },
  }[t.type] || { icon: 'fa-circle', cls: '', label: t.type };
  const amt = num(t.amount);
  let amountHtml, flow;
  if (t.type === 'expense') { amountHtml = `<span class="text-loss">−${money(amt)}</span>`; flow = accountName(t.fromAccountId); }
  else if (t.type === 'income') { amountHtml = `<span class="text-gain">+${money(amt)}</span>`; flow = accountName(t.toAccountId); }
  else if (t.forHome) { amountHtml = `<span style="color:var(--violet)">−${money(amt)}</span>`; flow = `${accountName(t.fromAccountId)}, ${t.homeSettled ? 'taken back from' : 'to take back from'} ${accountName(t.toAccountId)}`; }
  else if (t.type === 'transfer') { amountHtml = money(amt); flow = `${accountName(t.fromAccountId)} to ${accountName(t.toAccountId)}`; }
  else { const up = !!t.toAccountId; amountHtml = `<span class="${up ? 'text-gain' : 'text-loss'}">${up ? '+' : '−'}${money(amt)}</span>`; flow = accountName(t.toAccountId || t.fromAccountId); }
  return `<div class="row txn-row" data-action="edit-txn" data-id="${t.id}" role="button" tabindex="0" aria-label="Edit ${esc(t.description || t.category || kind.label)}">
    <div class="row-icon ${kind.cls}" title="${kind.label}"><i class="fa-solid ${kind.icon}"></i></div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(t.description || t.category || kind.label)}</div>
      <div class="text-xs text-ink-3 flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
        <span class="txn-date">${fmtDate(t.date)}</span>
        ${t.category ? `<span class="pill">${esc(t.category)}</span>` : ''}
        ${t.units !== undefined && t.units !== null && t.units !== '' && (accountById(t.toAccountId)?.type === 'investment' || accountById(t.fromAccountId)?.type === 'investment')
          ? `<button class="pill blue" data-action="review-units" data-id="${t.id}" title="Units and NAV (click to change)">${num(t.units).toLocaleString('en-IN', { maximumFractionDigits: 3 })} units${t.unitNav ? ` at ${money(t.unitNav)}` : ''}</button>`
          : M?.reviews?.some((r) => r.t.id === t.id) ? `<button class="pill" style="background:var(--violet-tint);color:var(--violet)" data-action="review-units" data-id="${t.id}">Units to confirm</button>` : ''}
        <span class="truncate">${esc(flow)}</span>
      </div>
    </div>
    <div class="text-right num font-semibold whitespace-nowrap">${amountHtml}</div>
    ${withActions ? `<div class="row-actions">
      <button class="icon-btn sm" data-action="edit-txn" data-id="${t.id}" aria-label="Edit transaction"><i class="fa-regular fa-pen-to-square"></i></button>
      <button class="icon-btn sm" data-action="delete-txn" data-id="${t.id}" aria-label="Delete transaction"><i class="fa-regular fa-trash-can"></i></button>
    </div>` : ''}
  </div>`;
}
const sortTxns = (list) => list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));

function monthSelect(filterName, value, allowAll = false) {
  const opts = monthsWithData().map((m) => [m, fmtMonth(m)]);
  if (allowAll) opts.unshift(['', 'All time']);
  return `<select class="inp !w-auto !py-1.5 text-sm" data-filter="${filterName}" aria-label="Month">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

/* ===== Dashboard ===== */
let dashMonth = thisMonth();

function renderDashboard() {
  const T = M.T;
  const s = monthSummary(dashMonth);
  const keepRate = s.income > 0 ? Math.round(((s.left + s.invested) / s.income) * 100) : null;
  const upcoming = upcomingItems(30);
  const recent = sortTxns(db.transactions.filter((t) => t.relatedType !== 'market')).slice(0, 6);
  return `
    ${installCard()}
    ${gettingStarted()}
    ${logNudge()}
    ${nudgeStrip(2, true)}
    ${netWorthPanel(T)}
    <div class="quick-actions" aria-label="Quick actions">
      <button class="qa" data-action="split-new"><i class="fa-solid fa-people-arrows"></i><span>Split a bill</span></button>
      <button class="qa" data-action="cool-new"><i class="fa-solid fa-hourglass-half"></i><span>I want to buy this</span></button>
      <a class="qa" href="#health"><i class="fa-solid fa-heart-pulse"></i><span>Money health</span></a>
      <a class="qa" href="#planner"><i class="fa-solid fa-compass"></i><span>Planners</span></a>
    </div>
    ${dashboardInsights()}

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
      <section class="panel p-5 lg:col-span-2">
        <div class="panel-head">
          <h2 class="panel-title">${dashMonth === thisMonth() ? 'This month' : fmtMonth(dashMonth)}</h2>
          <div class="flex items-center gap-3"><a href="#calendar" class="text-sm link"><i class="fa-regular fa-calendar mr-1"></i>Calendar</a>${monthSelect('dashMonth', dashMonth)}</div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="stat-tile in"><div class="stat-label">Money in</div><div class="stat-value num">${money(s.income)}</div></div>
          <div class="stat-tile out"><div class="stat-label">Spent</div><div class="stat-value num">${money(s.spent)}</div></div>
          <div class="stat-tile invest"><div class="stat-label">Invested</div><div class="stat-value num">${money(s.invested)}</div></div>
          <div class="stat-tile"><div class="stat-label">Left over</div><div class="stat-value num ${s.left < 0 ? 'text-loss' : ''}">${money(s.left)}</div></div>
        </div>
        ${keepRate !== null ? `<p class="text-sm text-ink-2 mt-4">You kept or invested <b class="num">${keepRate}%</b> of what came in${s.invested ? `, including <b class="num">${money(s.invested)}</b> in SIPs and investments` : ''}.</p>` : ''}
      </section>
      ${portfolioMini()}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title">Where the money went</h2><span class="text-sm text-ink-3">${fmtMonth(dashMonth)}</span></div>
        <div class="relative h-72" id="catChartBox"><canvas id="catChart" aria-label="Spending by category chart" role="img"></canvas></div>
      </section>
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title">Money in and out, last 6 months</h2></div>
        <div class="relative h-72"><canvas id="trendChart" aria-label="Income and expenses chart" role="img"></canvas></div>
      </section>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
      <section class="panel p-5 lg:col-span-2">
        <div class="panel-head"><h2 class="panel-title">Due in the next 30 days</h2>
          <span class="text-sm text-ink-3 num">${upcoming.some((i) => !['fd', 'review', 'income', 'goal', 'wish'].includes(i.kind)) ? money(upcoming.filter((i) => !['fd', 'review', 'income', 'goal', 'wish'].includes(i.kind)).reduce((a, i) => a + i.amount, 0)) + ' to pay or invest' : ''}</span></div>
        ${upcoming.length ? `<div class="divider">${upcoming.map(upcomingRow).join('')}</div>`
          : emptyState('fa-calendar-check', 'Nothing due. SIPs, EMIs, subscriptions and card bills will show up here.')}
      </section>
      <div class="space-y-6">
        <section class="panel p-5">
          <div class="panel-head"><h2 class="panel-title">Budgets</h2><a href="#budgets" class="text-sm text-royal">Manage</a></div>
          ${budgetMini()}
        </section>
        ${subscriptionPanel()}
        ${healthMini()}
        ${goalsMini()}
      </div>
    </div>

    <section class="panel p-5 mt-6">
      <div class="panel-head"><h2 class="panel-title">Recent transactions</h2><a href="#transactions" class="text-sm text-royal">See all</a></div>
      ${recent.length ? `<div class="divider">${recent.map((t) => txnRow(t)).join('')}</div>`
        : emptyState('fa-receipt', 'No transactions yet.', `<button class="btn btn-primary" data-action="add-txn" data-type="expense"><i class="fa-solid fa-plus"></i> Add your first expense</button>`)}
    </section>

    ${pinnedChartsSection()}`;
}

function gettingStarted() {
  const steps = [
    { done: isConfigured(), text: 'Connect your GitHub repository so your data is backed up and synced.', action: '<button class="btn btn-sm" data-action="open-settings">Open settings</button>' },
    { done: db.accounts.some((a) => a.type !== 'cash' || num(a.openingBalance) !== 0), text: 'Add your bank accounts, credit cards and investments with today\'s balances.', action: '<a class="btn btn-sm" href="#accounts">Add accounts</a>' },
    { done: db.transactions.length > 0, text: 'Log an expense or income. Balances update on their own from then on.', action: '<button class="btn btn-sm" data-action="add-txn" data-type="expense">Add transaction</button>' },
  ];
  if (steps.every((s) => s.done) || localStorage.getItem('kosh.setupHidden')) return '';
  return `<section class="panel p-5 mb-6">
    <div class="flex items-start justify-between gap-2 mb-3"><h2 class="panel-title">Get KOSH ready in three steps</h2>
      <button class="icon-btn sm" data-action="setup-hide" aria-label="Hide these steps" title="Hide"><i class="fa-solid fa-xmark"></i></button></div>
    <ol class="space-y-3">
      ${steps.map((s, i) => `<li class="flex items-center gap-3 flex-wrap">
        <span class="row-icon ${s.done ? 'in' : ''}" style="width:1.75rem;height:1.75rem;font-size:.8rem">${s.done ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
        <span class="flex-1 min-w-[12rem] ${s.done ? 'text-ink-3 line-through' : ''}">${s.text}</span>
        ${s.done ? '' : s.action}
      </li>`).join('')}
    </ol>
  </section>`;
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const n = String(db.settings.ownerName || '').trim();
  return n ? `${part}, ${n}` : part;
}

/** The net worth "equation": assets minus liabilities, drawn to scale,
    on the bright hero band at the top of the dashboard. */
function netWorthPanel(T) {
  // The two switches (Settings can hide them) leave investments or card dues out of the figure.
  const incInv = db.settings.nwInvestments !== false, incCard = db.settings.nwCardDues !== false;
  const shown = round2(T.netWorth - (incInv ? 0 : T.investment) + (incCard ? 0 : T.cardDebt));
  const left = [!incInv && 'investments', !incCard && 'card dues'].filter(Boolean);
  const assets = [['Cash', T.cash, '#FBBF24'], ['Bank', T.bank, '#38BDF8']];
  if (incInv) assets.push(['Investments', T.investment, '#4ADE80']);
  if (T.cardCredit > 0) assets.push(['Card credit', T.cardCredit, '#E2E8F0']);
  if (T.owedToMe > 0) assets.push(['Owed to me', T.owedToMe, '#C4B5FD']);
  const liabs = incCard ? [['Card dues', T.cardDebt, '#FB7185']] : [];
  if (T.loans > 0) liabs.push(['Loans', T.loans, '#F472B6']);
  if (T.cardEmis > 0) liabs.push(['Card EMIs', T.cardEmis, '#FDBA74']);
  if (T.iOwe > 0) liabs.push(['I owe', T.iOwe, '#F9A8D4']);
  const assetSum = assets.reduce((a, [, v]) => a + Math.max(0, v), 0);
  const liabSum = liabs.reduce((a, [, v]) => a + v, 0);
  const scale = Math.max(assetSum, liabSum, 1);
  const track = (parts) => parts.filter(([, v]) => v > 0)
    .map(([k, v, c]) => `<span style="width:${(v / scale) * 100}%;background:${c}" title="${esc(k)}: ${money(v)}"></span>`).join('');
  const term = ([k, v, c]) => `<span class="term"><span class="sw" style="background:${c}"></span><span class="t-label">${k}</span><span class="t-val num">${money(v)}</span></span>`;
  return `<section class="hero p-5 sm:p-7">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="hero-hello">${esc(greeting())}</p>
        <div class="text-sm hero-dim mt-4 mb-1">Net worth${left.length ? ` <span class="nw-note">without ${left.join(' and ')}</span>` : ''}</div>
        <div class="display nw-figure num ${shown < 0 ? 'neg' : ''}">${money(shown)}</div>
      </div>
      <div class="flex flex-col items-end gap-2">
        ${db.settings.showNwToggles !== false ? `<div class="nw-toggles" role="group" aria-label="What net worth includes">
          ${miniSwitch('nwInvestments', incInv, 'Investments')}
          ${miniSwitch('nwCardDues', incCard, 'Card dues')}
        </div>` : ''}
        <div class="text-xs hero-dim">As on ${fmtDate(todayStr())}</div>
      </div>
    </div>
    <div class="mt-6 space-y-2" aria-hidden="true">
      <div class="nw-track">${track(assets)}</div>
      <div class="nw-track">${track(liabs)}</div>
    </div>
    <div class="equation mt-5">
      ${assets.map(term).join('<span class="op">+</span>')}
      ${liabs.map((l) => `<span class="op">−</span>${term(l)}`).join('')}
      <span class="op">=</span><span class="t-val num font-semibold">${money(shown)}</span>
    </div>
  </section>`;
}

function miniSwitch(key, on, label) {
  return `<label class="mini-switch" title="${on ? 'Included' : 'Left out'}: ${label.toLowerCase()}">
    <input type="checkbox" data-nw="${key}" ${on ? 'checked' : ''}><span class="track" aria-hidden="true"></span>${label}</label>`;
}

/** Small investments card on the dashboard. */
function portfolioMini() {
  const P = M.P.totals;
  const nextSip = db.sips.filter((x) => x.active && x.nextDate).sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
  if (!M.P.holdings.length && !db.sips.length) {
    return `<section class="panel p-5">
      <div class="panel-head"><h2 class="panel-title">Portfolio</h2></div>
      ${emptyState('fa-seedling', 'Add your mutual funds, stocks and FDs, and set up SIPs to invest automatically.', '<a class="btn btn-sm btn-primary" href="#portfolio">Set up investments</a>')}
    </section>`;
  }
  return `<section class="panel p-5 accent-leaf">
    <div class="panel-head"><h2 class="panel-title">Portfolio</h2><a href="#portfolio" class="text-sm link">Open</a></div>
    ${M.reviews.length ? `<a href="#portfolio" class="callout block mb-3 text-sm" style="background:var(--violet-tint)"><i class="fa-solid fa-clipboard-check mr-1" style="color:var(--violet)"></i>${M.reviews.length} instalment${M.reviews.length === 1 ? '' : 's'}: units to confirm</a>` : ''}
    <div class="stat-label">Current value</div>
    <div class="display text-3xl font-semibold num">${money(P.value)}</div>
    <div class="mt-1 text-sm num ${P.gain >= 0 ? 'text-gain' : 'text-loss'}">${money(P.gain, { sign: true })} (${pct(P.gainPct)}) on ${money(P.invested)} invested</div>
    <dl class="kv mt-4">
      <div><dt>Monthly SIPs</dt><dd>${money(P.sipMonthly)}</dd></div>
      <div><dt>Next SIP</dt><dd>${nextSip ? `${fmtDate(nextSip.nextDate)}` : 'None'}</dd></div>
    </dl>
  </section>`;
}
const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

function upcomingRow(it) {
  const d = parseDate(it.date);
  const days = daysUntil(it.date);
  const pill = days < 0 ? 'out' : days <= 3 ? 'due' : '';
  const action = { emi: 'pay-emi', subscription: 'pay-sub', income: 'pay-sub', card: 'pay-card', sip: 'pay-sip', fd: 'adjust-balance', review: 'review-units', goal: 'goal-add', wish: 'wish-buy' }[it.kind];
  const label = { card: 'Pay bill', sip: 'Invest now', fd: 'Update value', review: 'Enter units', income: 'Record income', goal: 'Add money', wish: 'Mark bought' }[it.kind] || 'Record payment';
  const icon = { emi: 'fa-calendar-check', subscription: 'fa-rotate', card: 'fa-credit-card', sip: 'fa-seedling', fd: 'fa-piggy-bank', review: 'fa-clipboard-check' }[it.kind];
  return `<div class="row">
    <div class="date-chip kind-bg-${it.kind}">
      <div class="display text-xl font-semibold leading-none num">${d.getDate()}</div>
      <div class="text-xs text-ink-3">${d.toLocaleDateString(locale(), { month: 'short' })}</div>
    </div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${it.kind === 'subscription' || it.kind === 'income' ? brandLogo(it.title, 'sm') : `<i class="fa-solid ${icon} kind-${it.kind} text-xs mr-1"></i>`}${esc(it.title)}</div>
      <div class="text-xs text-ink-3 truncate mt-0.5">${esc(it.sub)}</div>
    </div>
    <div class="text-right">
      <div class="num font-semibold">${money(it.amount)}</div>
      <span class="pill ${pill} mt-1">${it.kind === 'review' && days >= 0 ? `Due ${relDays(it.date).toLowerCase()}` : relDays(it.date)}</span>
    </div>
    <button class="btn btn-sm hidden sm:inline-flex" data-action="${action}" data-id="${it.id}">${label}</button>
  </div>`;
}

function budgetMini() {
  if (!db.budgets.length) return emptyState('fa-bullseye', 'Set monthly limits for categories to see progress here.', '<a class="btn btn-sm" href="#budgets">Create a budget</a>');
  const spend = new Map(spendByCategory(dashMonth).map((x) => [x.category, x.amount]));
  const list = db.budgets.map((b) => ({ b, spent: spend.get(b.category) || 0 }))
    .sort((x, y) => y.spent / (num(y.b.monthlyLimit) || 1) - x.spent / (num(x.b.monthlyLimit) || 1)).slice(0, 5);
  return `<div class="space-y-4">${list.map(({ b, spent }) => budgetBar(b, spent)).join('')}</div>`;
}
function budgetBar(b, spent) {
  const limit = num(b.monthlyLimit);
  const pct = limit > 0 ? spent / limit : 0;
  const color = pct > 1 ? 'var(--loss)' : pct > 0.8 ? 'var(--marigold)' : 'var(--gain)';
  return `<div>
    <div class="flex justify-between text-sm mb-1.5 gap-2"><span class="font-medium truncate">${esc(b.category)}</span>
      <span class="num text-ink-2 whitespace-nowrap">${money(spent)} of ${money(limit)}</span></div>
    <div class="bar"><span style="width:${Math.min(100, pct * 100)}%;background:${color}"></span></div>
  </div>`;
}

function drawDashboardCharts() {
  if (typeof Chart === 'undefined') {
    $$('canvas').forEach((c) => { c.parentElement.innerHTML = '<p class="text-sm text-ink-3">Charts could not load. Check your internet connection and reload.</p>'; });
    return;
  }
  chartDefaults();
  const tooltipMoney = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(ctx.parsed.y ?? ctx.parsed)}` } };

  const cats = spendByCategory(dashMonth);
  if (!cats.length) {
    $('#catChartBox').innerHTML = emptyState('fa-chart-pie', `No expenses recorded in ${fmtMonth(dashMonth)}.`);
  } else {
    const top = cats.slice(0, 9);
    const rest = cats.slice(9).reduce((a, c) => a + c.amount, 0);
    if (rest > 0) top.push({ category: 'Other', amount: rest });
    charts.push(new Chart($('#catChart'), {
      type: 'doughnut',
      data: { labels: top.map((c) => c.category), datasets: [{ data: top.map((c) => c.amount), backgroundColor: top.map((c) => colorFor(c.category)), borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }] },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: window.innerWidth < 640 ? 'bottom' : 'right', labels: { boxWidth: 10, boxHeight: 10, padding: 10 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}` } },
          kLabels: { mode: 'percent' },
        },
      },
    }));
  }

  const months = lastMonths(dashMonth, 6);
  const sums = months.map(monthSummary);
  charts.push(new Chart($('#trendChart'), {
    type: 'bar',
    data: {
      labels: months.map((m) => fmtMonth(m, true)),
      datasets: [
        { label: 'Income', data: sums.map((s) => s.income), backgroundColor: colorFor('Money in'), borderRadius: 5, maxBarThickness: 34, stack: 'in' },
        { label: 'Spent', data: sums.map((s) => s.spent), backgroundColor: colorFor('Spent'), borderRadius: 5, maxBarThickness: 34, stack: 'out' },
        { label: 'Invested', data: sums.map((s) => s.invested), backgroundColor: colorFor('Invested'), borderRadius: 5, maxBarThickness: 34, stack: 'out' },
      ],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#EEF1F8' }, ticks: { callback: (v) => money(v, { compact: true }) } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: tooltipMoney, kLabels: { mode: 'value', stacked: true } },
    },
  }));
}

function chartDefaults() {
  ensureChartPlugins(); // data labels
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.color = '#475569';
}

/* ===== Accounts ===== */
function renderAccounts() {
  const sections = Object.entries(ACCOUNT_TYPES).filter(([type]) => type !== 'person').map(([type, meta]) => {
    const list = db.accounts.filter((a) => a.type === type).sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name));
    const total = list.reduce((s, a) => s + (M.balances.get(a.id) || 0), 0);
    const totalLabel = type === 'credit_card' ? `${money(Math.max(0, -total))} owed` : money(total);
    const body = !list.length
      ? emptyState(meta.icon, `No ${meta.label.toLowerCase()} added yet.`)
      : type === 'credit_card'
        ? `<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${list.map(cardTile).join('')}</div>`
        : `<div class="divider">${list.map(accountRow).join('')}</div>`;
    return `<section class="${type === 'credit_card' ? '' : 'panel p-5'} mt-6 first:mt-0">
      <div class="panel-head">
        <div class="flex items-baseline gap-3"><h2 class="panel-title">${meta.label}</h2><span class="text-sm text-ink-3 num">${list.length ? totalLabel : ''}</span></div>
        <div class="flex gap-2">${type === 'investment' ? '<a class="btn btn-sm" href="#portfolio"><i class="fa-solid fa-chart-line"></i> Portfolio & SIPs</a>' : ''}
        <button class="btn btn-sm" data-action="add-account" data-type="${type}"><i class="fa-solid fa-plus"></i> Add ${meta.single.toLowerCase()}</button></div>
      </div>
      ${body}
    </section>`;
  });
  return sections.join('');
}

function accountSubtitle(a) {
  return [a.institution, a.subtype, a.last4 ? `ending ${a.last4}` : ''].filter(Boolean).map(esc).join(', ');
}

function accountRow(a) {
  const bal = M.balances.get(a.id) || 0;
  let extra = '';
  if (a.type === 'investment') {
    const h = M.P.holdings.find((x) => x.a.id === a.id);
    const bits = [];
    if (h && h.invested > 0 && h.gain) bits.push(`<span class="${h.gain > 0 ? 'text-gain' : 'text-loss'}">${money(h.gain, { sign: true })} (${pct(h.gainPct)}) on ${money(h.invested)} invested</span>`);
    if (a.maturityDate) bits.push(`matures ${fmtDate(a.maturityDate)}`);
    if (num(a.interestRate)) bits.push(`${num(a.interestRate)}% p.a.`);
    extra = bits.length ? `<div class="text-xs text-ink-3 mt-0.5">${bits.join(', ')}</div>` : '';
  }
  return `<div class="row ${a.archived ? 'opacity-60' : ''}">
    <div class="row-icon t-${a.type}"><i class="fa-solid ${ACCOUNT_TYPES[a.type].icon}"></i></div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(a.name)} ${a.archived ? '<span class="pill">Archived</span>' : ''}</div>
      <div class="text-xs text-ink-3 truncate mt-0.5">${accountSubtitle(a) || ACCOUNT_TYPES[a.type].single}</div>
      ${extra}
    </div>
    <div class="text-right num font-semibold whitespace-nowrap ${bal < 0 ? 'text-loss' : ''}">${money(bal)}</div>
    <div class="row-actions">
      <button class="icon-btn sm" data-action="adjust-balance" data-id="${a.id}" aria-label="${a.type === 'investment' ? 'Update value' : 'Update balance'}" title="${a.type === 'investment' ? 'Update value' : 'Update balance'}"><i class="fa-solid fa-scale-balanced"></i></button>
      <button class="icon-btn sm" data-action="edit-account" data-id="${a.id}" aria-label="Edit account" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
    </div>
  </div>`;
}

function cardTile(a) {
  const m = cardMetrics(a);
  const pctOut = m.limit ? Math.max(0, m.outstanding) / m.limit * 100 : 0;
  const pctBlk = m.limit ? m.blocked / m.limit * 100 : 0;
  const util = Math.round(m.utilization * 100);
  return `<article class="panel p-5 ${a.archived ? 'opacity-60' : ''}">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="font-semibold truncate">${esc(a.name)} ${a.archived ? '<span class="pill">Archived</span>' : ''}</h3>
        <div class="text-xs text-ink-3 truncate">${accountSubtitle(a) || 'Credit card'}</div>
      </div>
      <div class="flex gap-0.5">
        <button class="icon-btn sm" data-action="adjust-balance" data-id="${a.id}" title="Correct outstanding" aria-label="Correct outstanding"><i class="fa-solid fa-scale-balanced"></i></button>
        <button class="icon-btn sm" data-action="edit-account" data-id="${a.id}" title="Edit" aria-label="Edit card"><i class="fa-regular fa-pen-to-square"></i></button>
      </div>
    </div>
    <div class="mt-4 flex items-end justify-between gap-3">
      <div><div class="stat-label">${m.outstanding < 0 ? 'Credit balance' : 'Outstanding'}</div>
        <div class="display text-3xl font-semibold num ${m.outstanding > 0 ? 'text-loss' : 'text-gain'}">${money(Math.abs(m.outstanding))}</div></div>
      ${m.limit ? `<div class="text-right"><div class="stat-label">Available</div><div class="font-semibold num ${m.available < 0 ? 'text-loss' : ''}">${money(m.available)}</div></div>` : ''}
    </div>
    ${m.limit ? `<div class="bar mt-3" title="Used ${util}% of limit">
        <span style="width:${Math.min(100, pctOut)}%;background:var(--loss)"></span>
        <span style="width:${Math.min(100 - Math.min(100, pctOut), pctBlk)}%;background:var(--marigold)"></span></div>
      <div class="flex gap-4 text-xs text-ink-3 mt-1.5 flex-wrap">
        <span><span class="inline-block w-2 h-2 rounded-sm align-middle" style="background:var(--loss)"></span> Spent</span>
        <span><span class="inline-block w-2 h-2 rounded-sm align-middle" style="background:var(--marigold)"></span> Blocked by EMIs</span>
        <span class="ml-auto">${util}% of limit used</span></div>` : ''}
    <dl class="kv mt-4">
      <div><dt>Credit limit</dt><dd>${m.limit ? money(m.limit) : 'Not set'}</dd></div>
      <div><dt>Blocked by EMIs</dt><dd>${money(m.blocked)}</dd></div>
      ${m.dates.nextStatement ? `<div><dt>Next statement</dt><dd>${fmtDate(m.dates.nextStatement)}</dd></div>
      <div><dt>Payment due</dt><dd>${fmtDate(m.dates.nextDue)}</dd></div>` : '<div><dt>Billing cycle</dt><dd>Not set</dd></div>'}
    </dl>
    ${m.outstanding > 0 ? `<button class="btn btn-sm mt-4" data-action="pay-card" data-id="${a.id}"><i class="fa-solid fa-money-bill-transfer"></i> Pay bill</button>` : ''}
  </article>`;
}

/* ===== Transactions ===== */
const txFilter = { month: thisMonth(), type: '', account: '', category: '', q: '', limit: 100 };

function filteredTxns() {
  const q = txFilter.q.toLowerCase();
  return sortTxns(db.transactions).filter((t) =>
    (!txFilter.month || (t.date || '').startsWith(txFilter.month)) &&
    (!txFilter.type || t.type === txFilter.type) &&
    (!txFilter.account || t.fromAccountId === txFilter.account || t.toAccountId === txFilter.account) &&
    (!txFilter.category || t.category === txFilter.category) &&
    (!q || [t.description, t.category, t.notes, accountName(t.fromAccountId), accountName(t.toAccountId), t.amount]
      .join(' ').toLowerCase().includes(q)));
}

function allCategories() {
  const s = new Set([...db.settings.expenseCategories, ...db.settings.incomeCategories]);
  db.transactions.forEach((t) => t.category && s.add(t.category));
  return [...s].sort((a, b) => a.localeCompare(b));
}

function renderTransactions() {
  const filterSel = (name, opts, val, label) =>
    `<select class="inp text-sm" data-filter="${name}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `
    <div class="flex flex-wrap gap-2 mb-5">
      <button class="btn btn-primary hide-phone" data-action="add-txn" data-type="expense"><i class="fa-solid fa-arrow-up"></i> Add expense</button>
      <button class="btn" data-action="add-txn" data-type="income"><i class="fa-solid fa-arrow-down"></i> Add income</button>
      <button class="btn" data-action="add-txn" data-type="transfer"><i class="fa-solid fa-right-left"></i> Transfer money</button>
      <a class="btn" href="#import"><i class="fa-solid fa-file-import"></i> Import statement</a>
    </div>
    <section class="panel p-5">
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
        <input type="search" class="inp text-sm col-span-2 md:col-span-1" placeholder="Search" data-filter="q" value="${esc(txFilter.q)}" aria-label="Search transactions">
        ${monthSelect('month', txFilter.month, true).replace('!w-auto !py-1.5 ', '')}
        ${filterSel('type', [['', 'All types'], ['expense', 'Expenses'], ['income', 'Income'], ['transfer', 'Transfers'], ['adjustment', 'Balance updates']], txFilter.type, 'Type')}
        ${filterSel('account', [['', 'All accounts'], ...db.accounts.map((a) => [a.id, a.name])], txFilter.account, 'Account')}
        ${filterSel('category', [['', 'All categories'], ...allCategories().map((c) => [c, c])], txFilter.category, 'Category')}
      </div>
      <div id="txnResults">${txnResults()}</div>
    </section>`;
}

/** Transactions under day headings ("Today", "Yesterday", "Mon, 28 Sept") with each day's spend and income. */
function groupedByDay(list) {
  const today = todayStr(), yest = addDays(today, -1);
  const days = [];
  for (const t of list) { const last = days[days.length - 1]; if (last && last.date === t.date) last.items.push(t); else days.push({ date: t.date, items: [t] }); }
  return days.map((d) => {
    const out = d.items.filter((t) => t.type === 'expense').reduce((s, t) => s + num(t.amount), 0);
    const inn = d.items.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.amount), 0);
    const label = d.date === today ? 'Today' : d.date === yest ? 'Yesterday' : parseDate(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', ...(d.date.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) });
    return `<div class="day-group"><div class="day-head"><span>${esc(label)}</span><span class="num">${out ? `<span class="text-loss">−${money(out)}</span>` : ''}${inn ? ` <span class="text-gain">+${money(inn)}</span>` : ''}</span></div>
      <div class="divider">${d.items.map((t) => txnRow(t)).join('')}</div></div>`;
  }).join('');
}
function txnResults() {
  const list = filteredTxns();
  const inc = list.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.amount), 0);
  const exp = list.filter((t) => t.type === 'expense').reduce((s, t) => s + num(t.amount), 0);
  const shown = list.slice(0, txFilter.limit);
  return `
    <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3 pb-3 border-b border-line">
      <span class="text-ink-3">${list.length} transaction${list.length === 1 ? '' : 's'}</span>
      <span>In <b class="num text-gain">${money(inc)}</b></span>
      <span>Out <b class="num text-loss">${money(exp)}</b></span>
      <span>Net <b class="num">${money(inc - exp)}</b></span>
    </div>
    ${shown.length ? groupedByDay(shown)
      : emptyState('fa-magnifying-glass', db.transactions.length ? 'No transactions match these filters.' : 'No transactions yet. Add an expense or income to get started.')}
    ${list.length > shown.length ? `<div class="text-center mt-4"><button class="btn btn-sm" data-action="txn-more">Show ${Math.min(100, list.length - shown.length)} more</button></div>` : ''}`;
}

/* ===== EMIs & loans ===== */
function renderEmis() {
  const list = M.emis.slice().sort((a, b) => {
    const rank = (x) => (x.c.status === 'active' ? 0 : 1);
    return rank(a) - rank(b) || (a.c.nextDue || '9').localeCompare(b.c.nextDue || '9');
  });
  const active = list.filter((x) => x.c.status === 'active');
  const sum = (f) => active.reduce((s, x) => s + f(x), 0);
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Track loans and credit card EMIs. Remaining principal counts against your net worth, and card EMIs block part of the card's limit until paid.</p>
      <button class="btn btn-primary" data-action="add-emi"><i class="fa-solid fa-plus"></i> Add EMI or loan</button>
    </div>
    ${list.length ? `
    <section class="panel p-5 mb-6">
      <dl class="kv">
        <div><dt>Monthly EMIs</dt><dd class="text-lg">${money(sum((x) => x.c.emi))}</dd></div>
        <div><dt>Principal left</dt><dd class="text-lg">${money(sum((x) => x.c.remaining))}</dd></div>
        <div><dt>Interest still to pay</dt><dd class="text-lg">${money(sum((x) => x.c.interestLeft))}</dd></div>
        <div><dt>Card limit blocked</dt><dd class="text-lg">${money(sum((x) => (x.e.kind === 'credit_card' ? x.c.remaining : 0)))}</dd></div>
      </dl>
    </section>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${list.map(emiTile).join('')}</div>`
    : `<section class="panel">${emptyState('fa-calendar-check', 'No EMIs or loans yet. Add a home loan, car loan or a purchase converted to EMI on your card.', '<button class="btn btn-primary" data-action="add-emi"><i class="fa-solid fa-plus"></i> Add EMI or loan</button>')}</section>`}`;
}

function emiTile({ e, c }) {
  const pct = c.n ? (c.paid / c.n) * 100 : 0;
  const statusPill = { active: '<span class="pill blue">Active</span>', completed: '<span class="pill in">Completed</span>', closed: '<span class="pill">Closed</span>' }[c.status];
  const kindLabel = e.kind === 'credit_card' ? 'Card EMI' : (e.subtype || 'Loan');
  const overdue = c.nextDue && c.nextDue < todayStr();
  return `<article class="panel p-5 ${c.status !== 'active' ? 'opacity-70' : ''}">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 class="font-semibold truncate">${esc(e.name)}</h3>
        <div class="text-xs text-ink-3 mt-0.5 truncate">${esc([kindLabel, e.lender, `${e.kind === 'credit_card' ? 'on' : 'paid from'} ${accountName(e.accountId) || 'no account'}`].filter(Boolean).join(', '))}</div>
      </div>
      <div class="flex items-center gap-1 flex-none">${statusPill}${e.autoLog ? '<span class="pill" title="Recorded automatically on the due date">Auto</span>' : ''}</div>
    </div>
    <div class="mt-4">
      <div class="flex justify-between text-sm mb-1.5"><span>${c.paid} of ${c.n} paid</span><span class="text-ink-3">${c.remainingMonths} month${c.remainingMonths === 1 ? '' : 's'} left</span></div>
      <div class="bar"><span style="width:${pct}%;background:var(--royal)"></span></div>
    </div>
    <dl class="kv mt-4">
      <div><dt>Monthly EMI</dt><dd>${money(c.emi)}</dd></div>
      <div><dt>Interest rate</dt><dd>${num(e.annualRate)}% p.a.</dd></div>
      <div><dt>Principal</dt><dd>${money(e.principal)}</dd></div>
      <div><dt>Principal left</dt><dd>${money(c.remaining)}</dd></div>
      <div><dt>Total interest</dt><dd>${money(c.totalInterest)}</dd></div>
      <div><dt>Interest left</dt><dd>${money(c.interestLeft)}</dd></div>
      <div><dt>Next due</dt><dd class="${overdue ? 'text-loss' : ''}">${c.nextDue ? fmtDate(c.nextDue) : 'None'}</dd></div>
      <div><dt>Last EMI</dt><dd>${c.endDate ? fmtDate(c.endDate) : ''}</dd></div>
    </dl>
    <div class="flex flex-wrap gap-2 mt-4">
      ${c.status === 'active' ? `<button class="btn btn-sm" data-action="pay-emi" data-id="${e.id}"><i class="fa-solid fa-check"></i> Record payment</button>` : ''}
      <button class="btn btn-sm" data-action="emi-schedule" data-id="${e.id}"><i class="fa-solid fa-table-list"></i> Schedule</button>
      <button class="btn btn-sm" data-action="edit-emi" data-id="${e.id}"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
    </div>
  </article>`;
}

/* ===== Subscriptions ===== */
function renderSubscriptions() {
  const sorted = db.subscriptions.slice().sort((a, b) => (b.active - a.active) || (a.nextRenewal || '').localeCompare(b.nextRenewal || ''));
  const perMonth = (list) => list.filter((s) => s.active).reduce((sum, s) => sum + num(s.amount) * (FREQUENCIES[s.frequency]?.perMonth || 1), 0);
  const groups = [
    ['subscription', 'Subscriptions', 'Streaming, apps, gym, cloud storage…', 'fa-rotate'],
    ['bill', 'Bills', 'Rent, electricity, maid, society charges…', 'fa-house'],
    ['income', 'Income', 'Salary, rent you receive, pocket money…', 'fa-briefcase'],
  ];
  const outMonthly = perMonth(sorted.filter((s) => recurKind(s) !== 'income'));
  const inMonthly = perMonth(sorted.filter((s) => recurKind(s) === 'income'));
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Everything that repeats: subscriptions, bills like rent, and regular income like salary. Tick "record automatically" and they log themselves on the date.</p>
    </div>
    <section class="panel p-5 mb-6"><dl class="kv">
      <div><dt>Going out per month</dt><dd class="text-lg">${money(Math.round(outMonthly))}</dd></div>
      <div><dt>Coming in per month</dt><dd class="text-lg text-gain">${money(Math.round(inMonthly))}</dd></div>
      <div><dt>Going out per year</dt><dd class="text-lg">${money(Math.round(outMonthly * 12))}</dd></div>
    </dl></section>
    ${groups.map(([k, title, hint, icon]) => {
      const list = sorted.filter((s) => recurKind(s) === k);
      return `<section class="panel p-5 mb-6">
        <div class="panel-head"><div><h2 class="panel-title">${title}</h2><div class="text-xs text-ink-3 mt-0.5">${hint}${list.length ? ` ${money(Math.round(perMonth(list)))} a month.` : ''}</div></div>
          <button class="btn btn-sm" data-action="add-sub" data-kind="${k}"><i class="fa-solid fa-plus"></i> Add</button></div>
        ${list.length ? `<div class="divider">${list.map(subRow).join('')}</div>` : `<p class="text-sm text-ink-3">None yet.</p>`}
      </section>`;
    }).join('')}`;
}

function subRow(s) {
  const f = FREQUENCIES[s.frequency] || FREQUENCIES.monthly;
  const days = s.nextRenewal ? daysUntil(s.nextRenewal) : null;
  const pill = !s.active ? '<span class="pill">Paused</span>'
    : `<span class="pill ${days < 0 ? 'out' : days <= 7 ? 'due' : ''}">${relDays(s.nextRenewal)}</span>`;
  return `<div class="row ${s.active ? '' : 'opacity-60'}">
    ${brandLogo(s.name)}
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(s.name)} ${s.autoLog && s.active ? '<span class="pill" title="Recorded automatically on the renewal date">Auto</span>' : ''}</div>
      <div class="text-xs text-ink-3 truncate mt-0.5">${esc([f.label, (recurKind(s) === 'income' ? 'into ' : '') + accountName(s.accountId), s.nextRenewal ? `${recurKind(s) === 'subscription' ? 'renews' : 'next'} ${fmtDate(s.nextRenewal)}` : ''].filter(Boolean).join(', '))}</div>
    </div>
    <div class="text-right">
      <div class="num font-semibold ${recurKind(s) === 'income' ? 'text-gain' : ''}">${money(s.amount)}</div>
      <div class="mt-1">${pill}</div>
    </div>
    <div class="row-actions">
      ${s.active ? `<button class="icon-btn sm" data-action="pay-sub" data-id="${s.id}" title="Record payment" aria-label="Record payment"><i class="fa-solid fa-check"></i></button>` : ''}
      <button class="icon-btn sm" data-action="toggle-sub" data-id="${s.id}" title="${s.active ? 'Pause' : 'Resume'}" aria-label="${s.active ? 'Pause' : 'Resume'}"><i class="fa-solid ${s.active ? 'fa-pause' : 'fa-play'}"></i></button>
      <button class="icon-btn sm" data-action="edit-sub" data-id="${s.id}" title="Edit" aria-label="Edit subscription"><i class="fa-regular fa-pen-to-square"></i></button>
    </div>
  </div>`;
}

/* ===== Budgets ===== */
let budgetMonth = thisMonth();
function renderBudgets() {
  const spend = spendByCategory(budgetMonth);
  const spendMap = new Map(spend.map((x) => [x.category, x.amount]));
  const budgeted = new Set(db.budgets.map((b) => b.category));
  const totalLimit = db.budgets.reduce((s, b) => s + num(b.monthlyLimit), 0);
  const totalSpent = db.budgets.reduce((s, b) => s + (spendMap.get(b.category) || 0), 0);
  const unbudgeted = spend.filter((x) => !budgeted.has(x.category));
  const list = db.budgets.slice().sort((a, b) => a.category.localeCompare(b.category));
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      ${monthSelect('budgetMonth', budgetMonth)}
      <button class="btn btn-primary" data-action="add-budget"><i class="fa-solid fa-plus"></i> Add budget</button>
    </div>
    ${list.length ? `
    <section class="panel p-5 mb-6">
      <div class="flex flex-wrap justify-between gap-2 mb-2"><span class="font-medium">All budgets</span>
        <span class="num">${money(totalSpent)} of ${money(totalLimit)}, <span class="${totalLimit - totalSpent < 0 ? 'text-loss' : 'text-gain'}">${money(totalLimit - totalSpent)} left</span></span></div>
      <div class="bar"><span style="width:${totalLimit ? Math.min(100, (totalSpent / totalLimit) * 100) : 0}%;background:var(--royal)"></span></div>
    </section>
    <section class="panel p-5"><div class="space-y-5">
      ${list.map((b) => `<div class="flex items-center gap-3"><div class="flex-1 min-w-0">${budgetBar(b, spendMap.get(b.category) || 0)}</div>
        <button class="icon-btn sm" data-action="edit-budget" data-id="${b.id}" aria-label="Edit budget"><i class="fa-regular fa-pen-to-square"></i></button></div>`).join('')}
    </div></section>`
    : `<section class="panel">${emptyState('fa-bullseye', 'No budgets yet. Set a monthly limit for categories like food or shopping.', '<button class="btn btn-primary" data-action="add-budget"><i class="fa-solid fa-plus"></i> Add budget</button>')}</section>`}
    ${unbudgeted.length ? `<section class="panel p-5 mt-6">
      <h2 class="panel-title mb-3">Spending without a budget</h2>
      <div class="divider">${unbudgeted.map((x) => `<div class="row"><span class="flex-1">${esc(x.category)}</span><span class="num font-medium">${money(x.amount)}</span>
        <button class="btn btn-sm" data-action="add-budget" data-category="${esc(x.category)}">Set budget</button></div>`).join('')}</div>
    </section>` : ''}`;
}

/* ----- Brand icons for well-known subscriptions -----
   Uses Font Awesome's brand icons where it has one; otherwise a tile with the
   brand's initials in its colour. Matching is by the subscription's name. */
const BRAND_ICONS = [
  [/spotify/i, { fa: 'spotify', bg: '#1DB954' }],
  [/netflix/i, { mono: 'N', bg: '#E50914' }],
  [/prime|amazon|kindle/i, { fa: 'amazon', bg: '#232F3E' }],
  [/audible/i, { fa: 'audible', bg: '#F8991C' }],
  [/youtube/i, { fa: 'youtube', bg: '#FF0000' }],
  [/apple|icloud|itunes/i, { fa: 'apple', bg: '#111827' }],
  [/google play/i, { fa: 'google-play', bg: '#01875F' }],
  [/google|gemini/i, { fa: 'google', bg: '#4285F4' }],
  [/xbox|game pass/i, { fa: 'xbox', bg: '#107C10' }],
  [/microsoft|office|365|outlook|onedrive/i, { fa: 'microsoft', bg: '#0078D4' }],
  [/playstation|ps plus/i, { fa: 'playstation', bg: '#003791' }],
  [/hotstar|disney/i, { mono: 'H', bg: '#0C1A4B' }],
  [/jio ?cinema|jio/i, { mono: 'Jio', bg: '#0A2885' }],
  [/airtel/i, { mono: 'A', bg: '#E40000' }],
  [/vodafone|\bvi\b/i, { mono: 'Vi', bg: '#EE1C25' }],
  [/sony ?liv/i, { mono: 'SL', bg: '#111827' }],
  [/zee ?5/i, { mono: 'Z5', bg: '#8230C6' }],
  [/zomato/i, { mono: 'Z', bg: '#E23744' }],
  [/swiggy/i, { mono: 'S', bg: '#FC8019' }],
  [/linkedin/i, { fa: 'linkedin-in', bg: '#0A66C2' }],
  [/dropbox/i, { fa: 'dropbox', bg: '#0061FF' }],
  [/github|copilot/i, { fa: 'github', bg: '#181717' }],
  [/slack/i, { fa: 'slack', bg: '#4A154B' }],
  [/figma/i, { fa: 'figma', bg: '#1E1E1E' }],
  [/discord/i, { fa: 'discord', bg: '#5865F2' }],
  [/twitch/i, { fa: 'twitch', bg: '#9146FF' }],
  [/steam/i, { fa: 'steam', bg: '#171A21' }],
  [/patreon/i, { fa: 'patreon', bg: '#000000' }],
  [/medium/i, { fa: 'medium', bg: '#000000' }],
  [/twitter|x premium/i, { fa: 'x-twitter', bg: '#000000' }],
  [/telegram/i, { fa: 'telegram', bg: '#26A5E4' }],
  [/deezer/i, { fa: 'deezer', bg: '#A238FF' }],
  [/soundcloud/i, { fa: 'soundcloud', bg: '#FF5500' }],
  [/evernote/i, { fa: 'evernote', bg: '#00A82D' }],
  [/trello/i, { fa: 'trello', bg: '#0052CC' }],
  [/chatgpt|openai/i, { mono: 'AI', bg: '#10A37F' }],
  [/claude|anthropic/i, { mono: 'C', bg: '#D97757' }],
  [/canva/i, { mono: 'C', bg: '#00C4CC' }],
  [/notion/i, { mono: 'N', bg: '#191919' }],
  [/adobe|photoshop|lightroom|acrobat/i, { mono: 'A', bg: '#FA0F00' }],
  [/gym|cult|fitness/i, { solid: 'dumbbell', bg: '#F97316' }],
  [/electric|power|mseb|bescom/i, { solid: 'bolt', bg: '#EAB308' }],
  [/internet|wifi|wi-fi|broadband|fiber|fibre/i, { solid: 'wifi', bg: '#0B84C6' }],
  [/mobile|recharge|postpaid|prepaid/i, { solid: 'mobile-screen', bg: '#475569' }],
  [/insurance|\blic\b|policy|term plan/i, { solid: 'shield-heart', bg: '#0F766E' }],
  [/news|times|hindu|express/i, { solid: 'newspaper', bg: '#334155' }],
  [/rent|flat|house|pg\b|hostel/i, { solid: 'house', bg: '#7C3AED' }],
  [/salary|stipend|payroll/i, { solid: 'briefcase', bg: '#12A150' }],
  [/maid|cook|society|maintenance/i, { solid: 'broom', bg: '#0F766E' }],
  [/water/i, { solid: 'droplet', bg: '#06B6D4' }],
  [/gas|cylinder|lpg/i, { solid: 'fire-flame-simple', bg: '#F97316' }],
];
function brandFor(name) {
  const hit = BRAND_ICONS.find(([re]) => re.test(name || ''));
  if (hit) return hit[1];
  const words = String(name || '?').trim().split(/\s+/);
  return { mono: (words[0][0] + (words[1]?.[0] || '')).toUpperCase(), bg: colorFor(name) };
}
function brandLogo(name, size = '') {
  const b = brandFor(name);
  const inner = b.fa ? `<i class="fa-brands fa-${b.fa}"></i>` : b.solid ? `<i class="fa-solid fa-${b.solid}"></i>` : esc(b.mono);
  return `<span class="brand-logo ${b.mono ? 'mono' : ''} ${size}" style="background:${b.bg}" aria-hidden="true">${inner}</span>`;
}

/** Dashboard card: every subscription with its brand icon, monthly total and next renewal. */
function subscriptionPanel() {
  const subs = db.subscriptions.filter((s) => recurKind(s) === 'subscription').slice().sort((a, b) => (b.active - a.active) || (a.nextRenewal || '').localeCompare(b.nextRenewal || ''));
  if (!subs.length) return '';
  const monthly = subs.filter((s) => s.active).reduce((t, s) => t + num(s.amount) * (FREQUENCIES[s.frequency]?.perMonth || 1), 0);
  return `<section class="panel p-5">
    <div class="panel-head"><h2 class="panel-title">Subscriptions</h2><a href="#subscriptions" class="text-sm link">Manage</a></div>
    <div class="flex items-baseline gap-2 mb-4"><span class="display text-2xl font-semibold num">${money(Math.round(monthly))}</span><span class="text-sm text-ink-3">a month, <span class="num">${money(Math.round(monthly * 12))}</span> a year</span></div>
    <div class="divider">${subs.slice(0, 6).map((s) => `<div class="row ${s.active ? '' : 'opacity-60'}">
      ${brandLogo(s.name)}
      <div class="min-w-0 flex-1"><div class="font-medium truncate">${esc(s.name)}</div>
        <div class="text-xs text-ink-3">${s.active ? `renews ${esc(relDays(s.nextRenewal).toLowerCase())}` : 'Paused'}</div></div>
      <div class="num font-semibold text-sm">${money(s.amount)}<span class="text-ink-3 font-normal text-xs">/${{ weekly: 'wk', monthly: 'mo', quarterly: 'qtr', half_yearly: '6 mo', yearly: 'yr' }[s.frequency] || 'mo'}</span></div>
    </div>`).join('')}</div>
    ${subs.length > 6 ? `<a href="#subscriptions" class="text-sm link block mt-3">and ${subs.length - 6} more</a>` : ''}
  </section>`;
}

/* ===== Investments & SIPs (portfolio) =====
   Holdings are investment accounts (one per fund, stock, FD...).
   SIPs live in db.sips and create a bank -> fund transfer on each date. */
const GROUP_ICONS = {
  'Mutual funds': 'fa-seedling', 'Stocks & ETFs': 'fa-arrow-trend-up', 'Deposits': 'fa-piggy-bank',
  'Retirement': 'fa-umbrella', 'Gold': 'fa-coins', 'Bonds': 'fa-file-contract', 'Crypto': 'fa-bitcoin-sign', 'Other': 'fa-shapes',
};
const GROUP_COLORS = {
  'Mutual funds': '#12A150', 'Stocks & ETFs': '#0B84C6', 'Deposits': '#F59E0B', 'Retirement': '#7C3AED',
  'Gold': '#EAB308', 'Bonds': '#06B6D4', 'Crypto': '#E0306E', 'Other': '#94A3B8',
};
const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
function sipScheduleLabel(x) {
  if (x.frequency === 'weekly') return `Every ${parseDate(x.nextDate || todayStr()).toLocaleDateString('en-IN', { weekday: 'long' })}`;
  const day = int(x.day) || parseDate(x.nextDate || todayStr()).getDate();
  return `${x.frequency === 'quarterly' ? 'Every 3 months' : 'Every month'} on the ${ordinal(day)}`;
}

function renderPortfolio() {
  const P = M.P, T = P.totals;
  const sips = db.sips.slice().sort((a, b) => (b.active - a.active) || (a.nextDate || '').localeCompare(b.nextDate || ''));
  const groups = [...new Set(P.holdings.map((h) => h.group))];
  const byGroup = (g) => P.holdings.filter((h) => h.group === g).sort((a, b) => (a.a.archived - b.a.archived) || b.value - a.value);
  const up = T.gain >= 0;
  const anyLive = db.accounts.some((a) => a.type === 'investment' && hasLivePrice(a));
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Your funds and shares at today's prices. Search a fund or company, enter the units and average cost once, and the value stays live.</p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn" data-action="add-account" data-type="investment"><i class="fa-solid fa-plus"></i> Add holding</button>
        <button class="btn btn-primary" data-action="add-sip"><i class="fa-solid fa-seedling"></i> Add SIP</button>
      </div>
    </div>

    <section class="hero hero-leaf p-5 sm:p-7">
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-5">
        <div class="col-span-2">
          <div class="text-sm hero-dim mb-1">Current value</div>
          <div class="display text-4xl sm:text-5xl font-semibold num">${money(Math.round(T.value))}</div>
        </div>
        <div><div class="text-sm hero-dim mb-1">Invested</div><div class="display text-2xl font-semibold num">${money(Math.round(T.invested))}</div>
          ${(() => { const cost = P.holdings.reduce((s, h) => s + (num(h.a.expenseRatio) ? h.value * num(h.a.expenseRatio) / 100 : 0), 0); return cost ? `<div class="text-sm hero-dim" title="Fund expense ratios are already taken out of the NAV">Fund costs about ${money(Math.round(cost))} a year</div>` : ''; })()}</div>
        <div><div class="text-sm hero-dim mb-1">Total ${up ? 'profit' : 'loss'}</div>
          <div class="display text-2xl font-semibold num">${money(Math.round(T.gain), { sign: true })}</div>
          <div class="text-sm num hero-dim">${pct(T.gainPct)}</div></div>
        <div><div class="text-sm hero-dim mb-1">SIPs per month</div><div class="display text-2xl font-semibold num">${money(T.sipMonthly)}</div>
          <div class="text-sm hero-dim">${T.sipCount} active</div></div>
      </div>
    </section>

    <div class="flex flex-wrap items-center gap-3 mt-4 text-sm text-ink-2">
      ${anyLive ? `<span><i class="fa-solid fa-bolt mr-1" style="color:var(--marigold)"></i><span id="priceStatus">${esc(priceStatusText())}</span></span>
        <button class="btn btn-sm" data-action="refresh-prices" ${priceState.busy ? 'disabled' : ''}><i class="fa-solid fa-arrows-rotate"></i> Refresh prices</button>`
      : '<span><i class="fa-solid fa-bolt mr-1" style="color:var(--marigold)"></i>Edit a fund or stock and search its name to link it to live prices.</span>'}
    </div>

    ${M.reviews.length ? reviewPanel() : ''}

    ${groups.length ? `<section class="panel mt-6 overflow-hidden">
      <div class="panel-head px-5 pt-5"><h2 class="panel-title">Holdings</h2><span class="text-sm text-ink-3">${P.holdings.length} holding${P.holdings.length === 1 ? '' : 's'}</span></div>
      <div class="overflow-x-auto relative"><table class="holdings">
        <thead><tr><th>Name</th><th>Units</th><th>Avg. cost</th><th>Invested</th><th>Latest price</th><th>Current value</th><th>Profit / loss</th><th aria-label="Actions"></th></tr></thead>
        ${groups.map((g) => {
          const list = byGroup(g);
          const tv = list.reduce((x, h) => x + h.value, 0), ti = list.reduce((x, h) => x + h.invested, 0);
          return `<tbody>
            <tr class="group-row"><td><i class="fa-solid ${GROUP_ICONS[g] || 'fa-shapes'} mr-1.5" style="color:${colorFor(g)}"></i>${esc(g)}</td><td></td><td></td>
              <td class="num">${money(Math.round(ti))}</td><td></td><td class="num">${money(Math.round(tv))}</td>
              <td class="num ${tv - ti >= 0 ? 'text-gain' : 'text-loss'}">${money(Math.round(tv - ti), { sign: true })}</td><td></td></tr>
            ${list.map(holdingRow).join('')}
          </tbody>`;
        }).join('')}
      </table></div>
    </section>`
    : `<section class="panel mt-6">${emptyState('fa-seedling', 'No holdings yet. Add each mutual fund, stock or FD: search its name, then enter your units and average cost.', '<button class="btn btn-primary" data-action="add-account" data-type="investment"><i class="fa-solid fa-plus"></i> Add holding</button>')}</section>`}

    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
      <section class="panel p-5 lg:col-span-3">
        <div class="panel-head"><h2 class="panel-title">SIPs</h2>
          <button class="btn btn-sm" data-action="add-sip"><i class="fa-solid fa-plus"></i> Add SIP</button></div>
        ${sips.length ? `<div class="divider">${sips.map(sipRow).join('')}</div>`
          : emptyState('fa-seedling', 'No SIPs yet. Add one: it goes out of your bank on its date and asks you for the units a few days later.', '<button class="btn btn-primary" data-action="add-sip"><i class="fa-solid fa-seedling"></i> Add your first SIP</button>')}
      </section>
      <section class="panel p-5 lg:col-span-2">
        <div class="panel-head"><h2 class="panel-title">Allocation</h2></div>
        ${P.allocation.length ? `
          <div class="relative h-56" id="allocBox"><canvas id="allocChart" role="img" aria-label="Portfolio allocation chart"></canvas></div>
          <div class="space-y-3 mt-5">${P.allocation.map((g) => {
            const share = T.value > 0 ? g.value / T.value : 0;
            return `<div><div class="flex justify-between text-sm mb-1 gap-2"><span class="font-medium">${esc(g.group)}</span>
              <span class="num text-ink-2">${money(Math.round(g.value))} <span class="text-ink-3">${Math.round(share * 100)}%</span></span></div>
              <div class="bar"><span style="width:${share * 100}%;background:${colorFor(g.group)}"></span></div></div>`;
          }).join('')}</div>`
        : emptyState('fa-chart-pie', 'Add a holding to see how your money is spread.')}
      </section>
    </div>`;
}

function reviewPanel() {
  return `<section class="panel p-5 mt-6 review-panel">
    <div class="panel-head"><h2 class="panel-title"><i class="fa-solid fa-clipboard-check mr-1.5" style="color:var(--violet)"></i>Units to confirm</h2>
      <span class="text-sm text-ink-3">The app couldn't work these out by itself. Enter them from your statement.</span></div>
    <div class="divider">${M.reviews.map(reviewRow).join('')}</div>
  </section>`;
}
function reviewRow({ t, a, due, sell }) {
  const days = daysUntil(due);
  const pill = days < 0 ? `<span class="pill out">${-days} day${days === -1 ? '' : 's'} overdue</span>` : `<span class="pill due">${days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`}</span>`;
  const what = t.relatedType === 'sip' ? 'SIP' : sell ? 'Withdrawal' : 'Purchase';
  return `<div class="row">
    <div class="row-icon" style="background:var(--violet-tint);color:var(--violet)"><i class="fa-solid ${sell ? 'fa-arrow-up-from-bracket' : 'fa-seedling'}"></i></div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(a.name)}</div>
      <div class="text-xs text-ink-3 mt-0.5">${what} of ${money(t.amount)} on ${fmtDate(t.date)}</div>
    </div>
    <div class="hidden sm:block">${pill}</div>
    <button class="btn btn-sm btn-primary" data-action="review-units" data-id="${t.id}">Enter units</button>
  </div>`;
}

function holdingRow(h) {
  const a = h.a;
  const tracked = isUnitTracked(a);
  const U = tracked ? holdingUnits(a) : null;
  const units = U ? U.units : 0;
  const waiting = U ? U.pendingBuys.length + U.missing.length : 0;
  const avg = units > 0 ? h.invested / units : 0;
  const live = hasLivePrice(a) && num(a.unitPrice);
  const problem = priceState.problems[a.id];
  const sips = db.sips.filter((x) => x.active && x.fundAccountId === a.id);
  const sub = [a.institution, num(a.expenseRatio) ? `expense ratio ${num(a.expenseRatio)}% (about ${money(Math.round(h.value * num(a.expenseRatio) / 100))} a year, already in the NAV)` : '', h.fd ? `${num(a.interestRate)}% p.a., ${h.fd.matured ? 'matured' : 'matures'} ${fmtDate(h.fd.maturityDate)} (about ${money(h.fd.maturityValue)})` : a.maturityDate ? `matures ${fmtDate(a.maturityDate)}` : '']
    .filter(Boolean).map(esc).join(', ');
  const dash = '<span class="text-ink-3">—</span>';
  return `<tr class="${a.archived ? 'opacity-60' : ''}">
    <td class="name-cell">
      <div class="font-medium">${esc(a.name)}</div>
      <div class="flex flex-wrap gap-1 mt-1">
        ${live ? '<span class="pill blue"><i class="fa-solid fa-bolt"></i> Live</span>' : ''}
        ${sips.map((x) => `<span class="pill invest">SIP ${money(sipAmountOn(x, todayStr()))}</span>`).join('')}
        ${(() => { const wn = waitingForNav(a).length, conf = waiting - wn; return (wn ? `<button class="pill due" data-action="units-history" data-id="${a.id}" title="Units are added automatically once the NAV is published">${wn} waiting for NAV</button>` : '')
          + (conf > 0 ? `<button class="pill" style="background:var(--violet-tint);color:var(--violet)" data-action="units-history" data-id="${a.id}">${conf} to confirm</button>` : ''); })()}
        ${a.archived ? '<span class="pill">Archived</span>' : ''}
      </div>
      ${sub ? `<div class="text-xs text-ink-3 mt-1">${sub}</div>` : ''}
      ${units > 0 ? `<div class="text-xs text-ink-2 mt-1 phone-only">${units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units${avg > 0 ? `, avg. ${money(round2(avg))}` : ''}${live ? `, ${isMF(a) ? 'NAV' : 'price'} ${money(a.unitPrice)}` : ''}</div>` : ''}
      ${problem ? `<div class="text-xs mt-1" style="color:var(--marigold-ink)"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${esc(problem)}</div>` : ''}
    </td>
    <td class="num" data-label="Units">${units > 0 ? units.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : dash}</td>
    <td class="num" data-label="Avg. cost">${avg > 0 ? money(round2(avg)) : dash}</td>
    <td class="num" data-label="Invested">${money(Math.round(h.invested))}</td>
    <td class="num" data-label="Latest price">${live ? `${money(a.unitPrice)}<div class="text-xs text-ink-3">${a.priceDate ? fmtDate(a.priceDate) : ''}</div>` : dash}</td>
    <td class="num font-semibold" data-label="Current value">${money(Math.round(h.value))}</td>
    <td class="num ${h.gain >= 0 ? 'text-gain' : 'text-loss'}" data-label="Profit / loss">${h.invested > 0 ? `${money(Math.round(h.gain), { sign: true })}<div class="text-xs">${pct(h.gainPct)}</div>` : dash}</td>
    <td class="act-cell"><div class="row-actions justify-end">
      <button class="icon-btn sm" data-action="invest-more" data-id="${a.id}" title="Add money" aria-label="Add money to ${esc(a.name)}"><i class="fa-solid fa-plus"></i></button>
      ${tracked ? `<button class="icon-btn sm" data-action="units-history" data-id="${a.id}" title="Units" aria-label="Units history"><i class="fa-solid fa-list-ol"></i></button>` : ''}
      ${live ? '' : `<button class="icon-btn sm" data-action="adjust-balance" data-id="${a.id}" title="Update value" aria-label="Update value"><i class="fa-solid fa-scale-balanced"></i></button>`}
      <button class="icon-btn sm" data-action="edit-account" data-id="${a.id}" title="Edit" aria-label="Edit holding"><i class="fa-regular fa-pen-to-square"></i></button>
    </div></td>
  </tr>`;
}

function sipRow(x) {
  const days = x.nextDate ? daysUntil(x.nextDate) : null;
  const ended = sipEnded(x, x.nextDate || todayStr());
  const pill = !x.active ? `<span class="pill">${ended ? 'Ended' : 'Paused'}</span>`
    : `<span class="pill ${days < 0 ? 'out' : days <= 3 ? 'due' : 'invest'}">${relDays(x.nextDate)}</span>`;
  const extra = [num(x.stepUpPercent) ? `steps up ${num(x.stepUpPercent)}% a year` : '', x.endDate ? `until ${fmtDate(x.endDate)}` : ''].filter(Boolean).join(', ');
  return `<div class="row ${x.active ? '' : 'opacity-60'}">
    <div class="row-icon invest"><i class="fa-solid fa-seedling"></i></div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(x.name)} ${x.autoLog && x.active ? '<span class="pill invest" title="Invested automatically on the SIP date">Auto</span>' : ''}</div>
      <div class="text-xs text-ink-3 mt-0.5">${esc(sipScheduleLabel(x))}, from ${esc(accountName(x.fromAccountId))}${x.name !== accountName(x.fundAccountId) ? ` into ${esc(accountName(x.fundAccountId))}` : ''}${extra ? `, ${esc(extra)}` : ''}</div>
    </div>
    <div class="text-right">
      <div class="num font-semibold">${money(sipAmountOn(x, x.nextDate || todayStr()))}</div>
      <div class="mt-1">${pill}</div>
    </div>
    <div class="row-actions">
      ${x.active ? `<button class="icon-btn sm" data-action="pay-sip" data-id="${x.id}" title="Invest now" aria-label="Record this SIP instalment"><i class="fa-solid fa-check"></i></button>` : ''}
      <button class="icon-btn sm" data-action="toggle-sip" data-id="${x.id}" title="${x.active ? 'Pause' : 'Resume'}" aria-label="${x.active ? 'Pause SIP' : 'Resume SIP'}"><i class="fa-solid ${x.active ? 'fa-pause' : 'fa-play'}"></i></button>
      <button class="icon-btn sm" data-action="edit-sip" data-id="${x.id}" title="Edit" aria-label="Edit SIP"><i class="fa-regular fa-pen-to-square"></i></button>
    </div>
  </div>`;
}

function drawPortfolioChart() {
  const canvas = $('#allocChart');
  if (!canvas) return;
  if (typeof Chart === 'undefined') { $('#allocBox').remove(); return; }
  chartDefaults();
  const A = M.P.allocation;
  charts.push(new Chart(canvas, {
    type: 'doughnut',
    data: { labels: A.map((g) => g.group), datasets: [{ data: A.map((g) => g.value), backgroundColor: A.map((g) => colorFor(g.group)), borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }] },
    options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}` } } } },
  }));
}

/* ----- SIP form ----- */
function openSipForm(existing, presetFundId) {
  const isNew = !existing;
  const x = existing ? { ...existing } : {
    frequency: 'monthly', nextDate: makeDate(new Date().getFullYear(), new Date().getMonth() + 1, 1),
    autoLog: true, active: true, fundAccountId: presetFundId || '',
  };
  const funds = db.accounts.filter((a) => a.type === 'investment' && (!a.archived || a.id === x.fundAccountId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fundOpts = [['', 'Choose a fund you already hold'], ...funds.map((a) => [a.id, a.name]), ['__new', '+ A fund not added yet']];
  const selectedFund = x.fundAccountId || (funds.length ? '' : '__new');
  const freqOpts = SIP_FREQUENCIES.map((k) => [k, FREQUENCIES[k].label]);
  const body = `
    ${field('SIP into', select('fundAccountId', fundOpts, selectedFund, 'required'), 'The SIP takes the fund\'s name.')}
    ${showFor('__new', instrumentPicker({}, { kind: 'mf', queryName: 'pickName', label: 'Find the mutual fund' }) +
      twoCol(field('Units you already hold (optional)', input('newUnits', '', 'type="number" step="any" min="0" placeholder="0 if this is a new SIP"')),
        field('Average cost per unit (optional)', moneyInput('newAvgCost', '', 'min="0" placeholder="e.g. 64.20"'))) +
      field('Platform (optional)', input('newPlatform', '', 'placeholder="e.g. Groww, Zerodha Coin, Kuvera"')))}
    ${twoCol(field('SIP amount', moneyInput('amount', x.amount, 'required min="1"')), field('How often', select('frequency', freqOpts, x.frequency)))}
    ${twoCol(field('Next SIP date', input('nextDate', x.nextDate, 'type="date" required'), 'Monthly SIPs repeat on this day, e.g. the 1st of every month.'),
      field('Paid from', accountSelect('fromAccountId', x.fromAccountId || firstAccountOf(['bank']), { types: ['bank', 'cash'], placeholder: 'Choose a bank account' })))}
    ${twoCol(field('Units are allotted at the NAV of', select('navLagDays', [['0', 'The SIP date'], ['1', '1 working day later'], ['2', '2 working days later'], ['3', '3 working days later']], String(x.navLagDays ?? db.settings.navLagDays ?? 1)), 'How long your platform takes to place the order. The app uses the NAV of that day to work out the units.'),
      field('Expense ratio % (optional)', input('expenseRatio', existing ? accountById(x.fundAccountId)?.expenseRatio ?? '' : '', 'type="number" step="0.01" min="0" max="5" placeholder="e.g. 0.63"'), 'From the fund\'s factsheet. Already inside the NAV; shown as a yearly cost.'))}
    ${twoCol(field('Yearly step-up % (optional)', input('stepUpPercent', x.stepUpPercent || '', 'type="number" min="0" max="100" step="0.5" placeholder="e.g. 10"'), 'Raises the SIP amount once a year.'),
      field('Stop after (optional)', input('endDate', x.endDate, 'type="date"')))}
    ${checkbox('autoLog', x.autoLog, 'Record automatically on the SIP date', 'The amount goes out of your bank as money spent on the SIP date. Once the NAV of the allotment day is published, the app works out the units and adds them to your holding. You can check or change the units and NAV any time. A date in the past fills in missed instalments.')}
    ${isNew ? '' : checkbox('active', x.active, 'Active', 'Untick to pause without deleting.')}
    ${field('Notes (optional)', textarea('notes', x.notes, 'rows="2" placeholder="Folio number, goal..."'))}`;

  openModal({
    title: isNew ? 'Add SIP' : `Edit ${x.name} SIP`,
    body,
    submitLabel: isNew ? 'Add SIP' : 'Save changes',
    onOpen: (form) => { bindShowHide(form, 'fundAccountId'); bindInstrumentPicker(form); },
    onSubmit: (d) => {
      const ops = [];
      let fundId = d.fundAccountId;
      if (!fundId) { toast('Choose the fund this SIP invests into.', 'error'); return false; }
      if (!d.fromAccountId) { toast('Choose the account the SIP is paid from.', 'error'); return false; }
      if (d.endDate && d.endDate < d.nextDate) { toast('The stop date is before the next SIP date.', 'error'); return false; }
      let fundName;
      if (fundId === '__new') {
        fundName = (d.schemeName || d.pickName || '').trim();
        if (!fundName) { toast('Search for the fund and pick it from the list (or type its name).', 'error'); return false; }
        const units = num(d.newUnits), cost = num(d.newAvgCost), price = num(d.latestPrice);
        const invested = round2(units * cost);
        const value = units > 0 ? round2(units * (price || cost)) : 0;
        const fund = {
          id: uid('acc'), name: fundName, type: 'investment', subtype: 'Mutual fund', institution: d.newPlatform || '', last4: '',
          openingBalance: value, investedAmount: invested || value,
          // Units you already hold are "as on today"; a brand-new fund starts empty on its first SIP date.
          openingDate: units > 0 || d.nextDate > todayStr() ? todayStr() : d.nextDate,
          creditLimit: null, statementDay: null, dueDay: null, interestRate: null, maturityDate: '', notes: '', archived: false,
          units: units > 0 ? units : null, unitsDate: units > 0 ? todayStr() : '',
          schemeCode: d.schemeCode || '', schemeName: d.schemeCode ? d.schemeName || fundName : '',
          unitPrice: price || null, priceDate: price ? d.latestDate || todayStr() : '',
          expenseRatio: d.expenseRatio === '' ? null : num(d.expenseRatio),
        };
        ops.push(opUpsert('accounts', fund));
        fundId = fund.id;
      } else {
        fundName = accountName(fundId);
        const fa = accountById(fundId);
        if (fa && d.expenseRatio !== '' && num(d.expenseRatio) !== num(fa.expenseRatio)) ops.push(opUpsert('accounts', { ...fa, expenseRatio: num(d.expenseRatio) }));
      }
      const sameDate = existing && existing.nextDate === d.nextDate;
      const rec = {
        ...(existing || {}), id: existing?.id || uid('sip'),
        name: fundName, fundAccountId: fundId, fromAccountId: d.fromAccountId,
        amount: round2(num(d.amount)), frequency: d.frequency,
        day: sameDate && existing.day ? existing.day : parseDate(d.nextDate).getDate(),
        startDate: existing?.startDate || d.nextDate, nextDate: d.nextDate, endDate: d.endDate || '',
        stepUpPercent: num(d.stepUpPercent) || 0, navLagDays: int(d.navLagDays),
        autoLog: !!d.autoLog, active: isNew ? true : !!d.active, notes: d.notes || '',
      };
      ops.push(opUpsert('sips', rec));
      commit(ops, `${isNew ? 'Add' : 'Edit'} SIP ${rec.name}`);
      toast(isNew ? 'SIP added' : 'SIP saved', 'success');
      if (rec.autoLog) setTimeout(processAutoPayments, 50);
      const fundAcc = accountById(fundId);
      if (fundAcc && hasLivePrice(fundAcc) && navigator.onLine) setTimeout(() => refreshPrices({ onlyId: fundId }), 400);
    },
    onDelete: existing ? () => {
      if (!confirm(`Delete the ${x.name} SIP? Instalments already recorded stay in your transactions and the fund keeps its units.`)) return false;
      commit([opDelete('sips', x.id)], `Delete SIP ${x.name}`);
      toast('SIP deleted');
    } : null,
  });
}

/** Record one SIP instalment by hand ("Invest now"). */
function paySip(id) {
  const x = db.sips.find((s) => s.id === id);
  if (!x) return;
  const due = x.nextDate || todayStr();
  const txn = sipTxn(x, due);
  const next = advanceSip(x, due);
  openModal({
    title: `Record ${x.name} SIP`,
    body: `${twoCol(field('Amount', moneyInput('amount', txn.amount, 'required min="0.01"')), field('Date', input('date', due, 'type="date" required')))}
      ${field('Paid from', accountSelect('fromAccountId', x.fromAccountId, { types: ['bank', 'cash'] }))}
      <p class="callout">Records the payment into <b>${esc(accountName(x.fundAccountId))}</b>. The units are added automatically once the NAV of the allotment day is out. The next SIP moves to ${fmtDate(next)}.</p>`,
    submitLabel: 'Record SIP',
    onSubmit: (d) => {
      commit([
        opUpsert('transactions', { ...txn, amount: round2(num(d.amount)), date: d.date, fromAccountId: d.fromAccountId }),
        opUpsert('sips', { ...x, nextDate: next, ...(sipEnded(x, next) ? { active: false } : {}) }),
      ], `Record SIP ${x.name}`);
      toast('SIP recorded', 'success');
      setTimeout(() => autoAllotUnits({ onlyId: x.fundAccountId }), 200);
    },
  });
}

function toggleSip(id) {
  const x = db.sips.find((s) => s.id === id);
  if (!x) return;
  commit([opUpsert('sips', { ...x, active: !x.active })], `${x.active ? 'Pause' : 'Resume'} SIP ${x.name}`);
  toast(x.active ? `${x.name} SIP paused` : `${x.name} SIP resumed`);
}

function investMore(id) {
  const a = accountById(id);
  if (!a) return;
  openTxnForm(null, { type: 'transfer', toAccountId: id, fromAccountId: firstAccountOf(['bank']), description: `Lump sum into ${a.name}` });
}

/* ---------------------------------------------------------------------
   LIVE PRICES
   ---------------------------------------------------------------------
   Mutual funds: latest NAV from MFapi.in (free, no key; AMFI data,
     refreshed several times a day). Docs: https://www.mfapi.in/docs/
       search  GET https://api.mfapi.in/mf/search?q=parag
       latest  GET https://api.mfapi.in/mf/{schemeCode}/latest
       history GET https://api.mfapi.in/mf/{schemeCode}?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   Stocks & ETFs: latest price from Alpha Vantage (free key, 25 calls
     a day), BSE symbols such as TCS.BSE. Docs: https://www.alphavantage.co/documentation/

   How a holding is valued:
     units held  = units you entered (as on `unitsDate`)
                   + units bought by later SIPs / lump sums
                   - units sold by later withdrawals
     value       = units held x latest NAV or price
   Each SIP instalment (or lump sum) goes on a review list until you enter
   the units allotted and the NAV; they are saved on the transaction
   (`units`, `unitNav`). Until then it counts at its rupee cost.
   The change in value is saved as ONE "Market value" adjustment per
   holding per month (id txn_mkt_<account>_<YYYY-MM>), which is updated
   on every refresh, so market moves never count as income or spending.
   --------------------------------------------------------------------- */
const MFAPI = 'https://api.mfapi.in';
const ALPHA = 'https://www.alphavantage.co/query';
const PRICE_KEY = 'kosh.prices.v1';                  // per-device: last refresh times
const MF_REFRESH_HOURS = 3;                          // auto refresh at most every 3 hours
const STOCK_REFRESH_HOURS = 20;                      // Alpha Vantage free tier is 25 calls/day
const priceState = { busy: false, problems: {} };    // problems: accountId -> message (this device only)

const isMF = (a) => a.subtype === 'Mutual fund' && !!a.schemeCode;
const isStockLive = (a) => ['Stocks', 'ETF'].includes(a.subtype) && !!a.ticker;
const hasLivePrice = (a) => isMF(a) || isStockLive(a);
/** 'TCS' -> 'TCS.BSE' (Alpha Vantage's code for BSE listings). */
const avSymbol = (t) => { const s = String(t || '').trim().toUpperCase(); return !s ? '' : /\.[A-Z]+$/.test(s) ? s : `${s}.BSE`; };
/** MFapi dates are DD-MM-YYYY; the app uses YYYY-MM-DD. */
const mfDate = (s) => { const [d, m, y] = String(s).split('-'); return y ? `${y}-${m}-${d}` : ''; };

async function fetchJSON(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The price service took too long to answer.' : `Couldn't reach the price service (${e.message}).`);
  } finally { clearTimeout(timer); }
}

async function mfSearch(q) {
  const list = await fetchJSON(`${MFAPI}/mf/search?q=${encodeURIComponent(q)}`);
  return Array.isArray(list) ? list : [];
}
async function mfLatest(code) {
  const j = await fetchJSON(`${MFAPI}/mf/${encodeURIComponent(code)}/latest`);
  const row = j?.data?.[0];
  if (!row || !num(row.nav)) throw new Error('No NAV found for this scheme code.');
  return { price: num(row.nav), date: mfDate(row.date), name: j.meta?.scheme_name || '' };
}
/** NAV history between two dates, oldest first: [{ date, nav }]. */
async function mfHistory(code, from, to) {
  const j = await fetchJSON(`${MFAPI}/mf/${encodeURIComponent(code)}?startDate=${from}&endDate=${to}`, 25000);
  return (j?.data || []).map((r) => ({ date: mfDate(r.date), nav: num(r.nav) }))
    .filter((r) => r.nav > 0 && r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}
async function stockLatest(ticker, key) {
  const j = await fetchJSON(`${ALPHA}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(avSymbol(ticker))}&apikey=${encodeURIComponent(key)}`);
  // Alpha Vantage reports limits and errors inside a normal 200 response.
  if (j.Note || j.Information) throw new Error('Daily limit of the free stock price key reached. Try again tomorrow.');
  if (j['Error Message']) throw new Error(`Symbol ${avSymbol(ticker)} was not found.`);
  const q = j['Global Quote'] || {};
  if (!num(q['05. price'])) throw new Error(`No price for ${avSymbol(ticker)}. Check the symbol.`);
  return { price: num(q['05. price']), date: q['07. latest trading day'] || todayStr() };
}

/**
 * Units held in a holding. Transactions after `unitsDate` (or from the
 * opening date if units were never entered) add or remove their `units`.
 * `overrides` lets a refresh use units it is about to save.
 */
function holdingUnits(a, overrides = {}) {
  let units = num(a.units);
  const pendingBuys = [], missing = [];
  for (const t of db.transactions) {
    if (t.type === 'adjustment') continue;
    const into = t.toAccountId === a.id, out = t.fromAccountId === a.id;
    if (!into && !out) continue;
    const d = t.date || '';
    if (a.unitsDate ? d <= a.unitsDate : d < (a.openingDate || '')) continue;
    const u = overrides[t.id] ?? t.units;
    if (u === undefined || u === null || u === '') { (into ? pendingBuys : missing).push(t); continue; }
    units += into ? num(u) : -num(u);
  }
  return { units: Math.round(units * 10000) / 10000, pendingBuys, missing };
}

/** Ops that set a holding's value to `target` via this month's market-value adjustment. */
function marketValueOps(a, target, note) {
  const month = todayStr().slice(0, 7);
  const id = `txn_mkt_${a.id}_${month}`;
  const existing = db.transactions.find((t) => t.id === id);
  const signed = existing ? (existing.toAccountId ? num(existing.amount) : -num(existing.amount)) : 0;
  const withoutIt = (M.balances.get(a.id) || 0) - signed;
  const diff = round2(target - withoutIt);
  if (Math.abs(diff) < 0.01) return existing ? [opDelete('transactions', id)] : [];
  const date = todayStr() < (a.openingDate || '') ? a.openingDate : todayStr();
  return [opUpsert('transactions', {
    ...(existing || {}), id, date, type: 'adjustment', amount: Math.abs(diff),
    category: 'Market value', description: `${a.name} market value`,
    fromAccountId: diff < 0 ? a.id : '', toAccountId: diff > 0 ? a.id : '',
    relatedType: 'market', relatedId: a.id, notes: note,
  })];
}

function priceRuns() { return readLS(PRICE_KEY, { mf: 0, stock: 0 }); }
function hoursSince(ts) { return (Date.now() - (ts || 0)) / 3600000; }

/**
 * Fetch the latest NAVs / prices and update holding values.
 * auto = true when called on app start: runs only if due, and stays quiet.
 */
async function refreshPrices({ auto = false, onlyId = null } = {}) {
  if (priceState.busy || !navigator.onLine) { if (!auto && !navigator.onLine) toast('You are offline. Prices will update when you are back online.'); return; }
  if (auto && db.settings.autoPrices === false) return;
  const runs = priceRuns();
  const key = String(db.settings.stockApiKey || '').trim();
  const doMF = !auto || hoursSince(runs.mf) >= MF_REFRESH_HOURS;
  const doStock = !!key && (!auto || hoursSince(runs.stock) >= STOCK_REFRESH_HOURS);
  const targets = db.accounts.filter((a) => a.type === 'investment' && !a.archived && (!onlyId || a.id === onlyId)
    && ((isMF(a) && doMF) || (isStockLive(a) && doStock)));
  if (!targets.length) {
    if (!auto) toast(db.accounts.some(isStockLive) && !key ? 'Add a free stock price key in Settings to update stock prices.' : 'Link a holding to its fund or stock (edit the holding) to get live prices.');
    return;
  }

  // First give new SIP instalments their units, so the value below includes them.
  if (targets.some(isMF)) await autoAllotUnits({ onlyId });
  priceState.busy = true;
  renderPriceStatus();
  M = buildModel();
  const ops = [];
  let updated = 0;
  for (const a of targets) {
    try {
      const live = isMF(a) ? await mfLatest(a.schemeCode) : await stockLatest(a.ticker, key);

      const { units, pendingBuys, missing } = holdingUnits(a);
      if (missing.length) {
        priceState.problems[a.id] = 'A withdrawal is waiting for its units. Enter them under "Needs your review".';
        ops.push(opUpsert('accounts', { ...a, unitPrice: live.price, priceDate: live.date }));
        continue;
      }
      if (!units && !pendingBuys.length) {
        priceState.problems[a.id] = 'Enter the units you hold (edit the holding) to see its live value.';
        ops.push(opUpsert('accounts', { ...a, unitPrice: live.price, priceDate: live.date }));
        continue;
      }
      // Instalments still waiting for you to enter their units count at cost until reviewed.
      const waiting = pendingBuys.reduce((s, t) => s + num(t.amount), 0);
      const target = round2(units * live.price + waiting);
      const label = isMF(a) ? 'NAV' : 'Price';
      ops.push(...marketValueOps(a, target, `${label} ${live.price} on ${live.date}, ${units} units`));
      ops.push(opUpsert('accounts', { ...a, unitPrice: live.price, priceDate: live.date, ...(isMF(a) && live.name ? { schemeName: live.name } : {}) }));
      delete priceState.problems[a.id];
      updated++;
    } catch (e) {
      priceState.problems[a.id] = e.message;
    }
  }
  priceState.busy = false;
  if (doMF && targets.some(isMF)) runs.mf = Date.now();
  if (doStock && targets.some(isStockLive)) runs.stock = Date.now();
  writeLS(PRICE_KEY, runs);
  if (ops.length) commit(ops, `Update live prices (${updated} holding${updated === 1 ? '' : 's'})`);
  else render();
  const failed = targets.filter((a) => priceState.problems[a.id]).length;
  if (!auto) { // on app start it stays quiet; notes show next to each holding
    if (updated) toast(`Prices updated for ${updated} holding${updated === 1 ? '' : 's'}${failed ? `, ${failed} need attention` : ''}.`, failed ? 'info' : 'success');
    else if (failed) toast(`Couldn't update prices: ${priceState.problems[targets.find((a) => priceState.problems[a.id]).id]}`, 'error');
  }
}

function priceStatusText() {
  if (priceState.busy) return 'Updating prices…';
  const last = Math.max(priceRuns().mf || 0, priceRuns().stock || 0);
  if (!last) return 'Prices not updated on this device yet';
  const d = new Date(last);
  const same = toDateStr(d) === todayStr();
  return `Prices updated ${same ? 'today' : fmtDate(toDateStr(d))} at ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}
function renderPriceStatus() {
  const el = $('#priceStatus');
  if (el) el.textContent = priceStatusText();
  const btn = $('[data-action="refresh-prices"]');
  if (btn) btn.disabled = priceState.busy;
}

async function stockSearch(q, key) {
  const j = await fetchJSON(`${ALPHA}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(q)}&apikey=${encodeURIComponent(key)}`);
  if (j.Note || j.Information) throw new Error('Daily limit of the free stock price key reached. Try again tomorrow.');
  const all = (j.bestMatches || []).map((m) => ({ code: m['1. symbol'], name: m['2. name'], region: m['4. region'] || '' }));
  const india = all.filter((m) => /\.(BSE|NSE)$/i.test(m.code) || /india/i.test(m.region));
  return (india.length ? india : all).map((m) => ({ code: m.code, name: m.name, extra: m.code }));
}

/* ----- Fund / company search used in the holding and SIP forms -----
   kind: 'mf' (mutual funds), 'stock', or 'auto' (follows the Kind select).
   On a pick it fills the official name, links the scheme code / symbol and
   fetches the latest NAV or price. */
function instrumentPicker(a = {}, { kind = 'auto', queryName = '', label = 'Find the fund or company' } = {}) {
  const linked = a.schemeCode ? { code: a.schemeCode, name: a.schemeName || a.name, k: 'NAV' } : a.ticker ? { code: a.ticker, name: a.name, k: 'Price' } : null;
  return `<div class="picker" data-picker data-kind="${kind}">
    <span class="lbl">${label}</span>
    <div class="flex gap-2">
      <input class="inp" data-pick-q ${queryName ? `name="${queryName}"` : ''} value="${esc(queryName ? a.name || '' : '')}" placeholder="Type a few letters, e.g. parag parikh, tata motors" autocomplete="off">
      <button type="button" class="btn" data-pick-find><i class="fa-solid fa-magnifying-glass"></i> Search</button>
    </div>
    <div class="pick-results" data-pick-results hidden></div>
    <div class="pick-linked" data-pick-linked ${linked ? '' : 'hidden'}>${linked ? `<i class="fa-solid fa-bolt"></i> Linked to <b>${esc(linked.name)}</b>${a.unitPrice ? `. Latest ${linked.k.toLowerCase()} ${money(a.unitPrice)}${a.priceDate ? ` on ${fmtDate(a.priceDate)}` : ''}` : ''}` : ''}</div>
    <input type="hidden" name="schemeCode" value="${esc(a.schemeCode || '')}">
    <input type="hidden" name="schemeName" value="${esc(a.schemeName || '')}">
    <input type="hidden" name="ticker" value="${esc(a.ticker || '')}">
    <input type="hidden" name="latestPrice" value="${esc(a.unitPrice ?? '')}">
    <input type="hidden" name="latestDate" value="${esc(a.priceDate || '')}">
  </div>`;
}
function bindInstrumentPicker(form, { onPick } = {}) {
  const box = $('[data-picker]', form);
  if (!box) return;
  const q = $('[data-pick-q]', box), results = $('[data-pick-results]', box), linked = $('[data-pick-linked]', box);
  const h = (n) => $(`input[name="${n}"]`, box);
  const kind = () => {
    if (box.dataset.kind !== 'auto') return box.dataset.kind;
    const sub = $$('select[name="subtype"]', form).find((el) => !el.disabled)?.value || '';
    return sub === 'Mutual fund' ? 'mf' : ['Stocks', 'ETF'].includes(sub) ? 'stock' : '';
  };
  const signal = { signal: modalSignal() };
  let seq = 0;
  const search = async () => {
    const text = q.value.trim();
    const k = kind();
    if (text.length < 3) { results.hidden = false; results.innerHTML = '<p class="hint">Type at least 3 letters.</p>'; return; }
    const key = String(db.settings.stockApiKey || '').trim();
    if (k === 'stock' && !key) {
      results.hidden = false;
      results.innerHTML = '<p class="hint">Company search and live stock prices need the free stock price key (Settings). You can still type the company name and enter units and cost yourself.</p>';
      return;
    }
    const my = ++seq;
    results.hidden = false; results.innerHTML = '<p class="hint">Searching…</p>';
    try {
      const list = k === 'stock' ? await stockSearch(text, key)
        : (await mfSearch(text)).map((x) => ({ code: String(x.schemeCode), name: x.schemeName }));
      if (my !== seq) return;
      results.innerHTML = list.length
        ? list.slice(0, 40).map((x) => `<button type="button" class="pick-item" data-code="${esc(x.code)}" data-name="${esc(x.name)}">${esc(x.name)}${x.extra ? ` <span class="text-ink-3">${esc(x.extra)}</span>` : ''}</button>`).join('')
        : '<p class="hint">Nothing found. Try fewer or different words.</p>';
    } catch (e) { if (my === seq) results.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  };
  const pick = async (code, name) => {
    const k = kind();
    results.hidden = true;
    q.value = name;
    h('schemeCode').value = k === 'mf' ? code : '';
    h('schemeName').value = k === 'mf' ? name : '';
    h('ticker').value = k === 'stock' ? code : '';
    const nameInput = $$('input[name="name"]', form).find((el) => !el.disabled);
    if (nameInput) nameInput.value = name;
    linked.hidden = false;
    linked.innerHTML = `<i class="fa-solid fa-bolt"></i> Linked to <b>${esc(name)}</b>. Getting the latest ${k === 'mf' ? 'NAV' : 'price'}…`;
    try {
      const live = k === 'mf' ? await mfLatest(code) : await stockLatest(code, String(db.settings.stockApiKey || '').trim());
      h('latestPrice').value = live.price; h('latestDate').value = live.date;
      linked.innerHTML = `<i class="fa-solid fa-bolt"></i> Linked to <b>${esc(name)}</b>. Latest ${k === 'mf' ? 'NAV' : 'price'} <b class="num">${money(live.price)}</b> on ${fmtDate(live.date)}.`;
    } catch (e) {
      linked.innerHTML = `<i class="fa-solid fa-bolt"></i> Linked to <b>${esc(name)}</b>. The latest price couldn't be fetched right now (${esc(e.message)}); it will update later.`;
    }
    onPick?.();
  };
  $('[data-pick-find]', box).addEventListener('click', search, signal);
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }, signal);
  // Mutual fund search is free, so it searches as you type; stock search uses the daily quota, so it waits for the button.
  const typeAhead = debounce(() => { if (kind() === 'mf' && q.value.trim().length >= 3) search(); }, 400);
  q.addEventListener('input', () => {
    if (h('schemeCode').value || h('ticker').value) { // typing again unlinks
      h('schemeCode').value = ''; h('ticker').value = ''; h('schemeName').value = ''; h('latestPrice').value = ''; h('latestDate').value = '';
      linked.hidden = true;
    }
    typeAhead();
  }, signal);
  results.addEventListener('click', (e) => { const b = e.target.closest('.pick-item'); if (b) pick(b.dataset.code, b.dataset.name); }, signal);
}

/* ----- Units: automatic for mutual funds, editable any time -----
   When a SIP instalment (or lump sum / withdrawal) goes through a linked
   mutual fund, the app works out the units by itself:
     allotment date = transaction date + the SIP's "order takes N working days"
     NAV            = the first NAV published on or after that date (MFapi)
     units          = amount x (1 - stamp duty 0.005%) / NAV   (purchases)
   The result is saved on the transaction (units, unitNav, navDate,
   unitsSource 'auto'). You can open any entry and change the units or NAV;
   your figures are then kept (unitsSource 'you').
   The expense ratio is NOT subtracted again: a fund's NAV is already
   published after its expenses. The app only shows what it costs you a year.
   Anything that can't be worked out (stocks, unlinked funds, NAV not found
   a few days after it was due) goes on the "Units to confirm" list. */
const REVIEW_DAYS = 5;          // manual entries: remind after 5 days
const AUTO_GRACE_DAYS = 3;      // auto entries: remind if the NAV still isn't found 3 days after the allotment date
const STAMP_DUTY = 0.00005;     // 0.005% on mutual fund purchases (India, since July 2020)
const isUnitTracked = (a) => a.type === 'investment' && (hasLivePrice(a) || num(a.units) > 0);
function addWorkingDays(date, n) {
  let d = date, left = int(n);
  while (left > 0) { d = addDays(d, 1); const wd = parseDate(d).getDay(); if (wd !== 0 && wd !== 6) left--; }
  return d;
}
function navLagFor(t) {
  const sip = t.relatedType === 'sip' ? db.sips.find((x) => x.id === t.relatedId) : null;
  return int(sip?.navLagDays ?? db.settings.navLagDays ?? 1);
}
const allotDateFor = (t) => addWorkingDays(t.date, navLagFor(t));

function unitReviews() {
  const today = todayStr();
  const out = [];
  for (const a of db.accounts) {
    if (!isUnitTracked(a) || a.archived) continue;
    const { pendingBuys, missing } = holdingUnits(a);
    for (const t of [...pendingBuys, ...missing]) {
      if ((t.date || '') > today) continue;
      // Linked mutual funds fill themselves in; only nag if that hasn't happened in time.
      const due = isMF(a) ? addDays(allotDateFor(t), AUTO_GRACE_DAYS) : addDays(t.date, REVIEW_DAYS);
      if (isMF(a) && due > today) continue;
      out.push({ t, a, due, sell: t.fromAccountId === a.id });
    }
  }
  return out.sort((x, y) => x.due.localeCompare(y.due));
}
/** Units still waiting for their NAV in a linked fund (shown quietly on the holding). */
function waitingForNav(a) {
  if (!isMF(a)) return [];
  const today = todayStr();
  const { pendingBuys, missing } = holdingUnits(a);
  return [...pendingBuys, ...missing].filter((t) => t.date <= today && addDays(allotDateFor(t), AUTO_GRACE_DAYS) > today);
}
function unitsFor(t, a, nav) {
  const sell = t.fromAccountId === a.id;
  const stamp = !sell && db.settings.stampDuty !== false ? STAMP_DUTY : 0;
  return Math.round(((num(t.amount) * (1 - stamp)) / nav) * 1000) / 1000;
}

/** Work out units for linked mutual funds from the NAV of each allotment date. */
const allotState = { busy: false };
async function autoAllotUnits({ onlyId = null, quiet = true } = {}) {
  if (allotState.busy || !navigator.onLine) return 0;
  const today = todayStr();
  const work = db.accounts.filter((a) => isMF(a) && !a.archived && (!onlyId || a.id === onlyId)).map((a) => {
    const { pendingBuys, missing } = holdingUnits(a);
    return { a, items: [...pendingBuys, ...missing].filter((t) => t.date <= today && allotDateFor(t) <= today) };
  }).filter((w) => w.items.length);
  if (!work.length) return 0;
  allotState.busy = true;
  M = buildModel();
  const ops = [];
  let count = 0;
  for (const { a, items } of work) {
    try {
      const from = items.reduce((m, t) => { const d = allotDateFor(t); return d < m ? d : m; }, today);
      const hist = await mfHistory(a.schemeCode, from, today);
      const overrides = {};
      for (const t of items) {
        const target = allotDateFor(t);
        const row = hist.find((r) => r.date >= target);
        if (!row) continue; // NAV for that day not published yet
        overrides[t.id] = unitsFor(t, a, row.nav);
        ops.push(opUpsert('transactions', { ...t, units: overrides[t.id], unitNav: row.nav, navDate: row.date, unitsSource: 'auto' }));
        count++;
      }
      if (Object.keys(overrides).length) ops.push(...revalueOps(a, overrides));
    } catch (e) { if (!quiet) toast(e.message, 'error'); }
  }
  allotState.busy = false;
  if (ops.length) commit(ops, `Units added automatically (${count})`);
  if (count && !quiet) toast(`Units worked out for ${count} instalment${count === 1 ? '' : 's'}.`, 'success');
  return count;
}

/** Market-value ops for a holding at its last known price (no network). */
function revalueOps(a, overrides = {}) {
  if (!num(a.unitPrice)) return [];
  const { units, pendingBuys, missing } = holdingUnits(a, overrides);
  if (missing.length) return [];
  const waiting = pendingBuys.reduce((s, t) => s + num(t.amount), 0);
  return marketValueOps(a, round2(units * num(a.unitPrice) + waiting), `${isMF(a) ? 'NAV' : 'Price'} ${a.unitPrice} on ${a.priceDate || ''}, ${units} units`);
}

/** Enter or change the units / NAV of any purchase or withdrawal. */
function openReview(txnId) {
  const t = db.transactions.find((x) => x.id === txnId);
  if (!t) return;
  const a = [accountById(t.toAccountId), accountById(t.fromAccountId)].find((x) => x && x.type === 'investment');
  if (!a) return;
  const sell = t.fromAccountId === a.id;
  const amt = num(t.amount);
  const what = t.relatedType === 'sip' ? 'SIP instalment' : sell ? 'withdrawal' : 'purchase';
  const has = t.units !== undefined && t.units !== null && t.units !== '';
  const target = allotDateFor(t);
  openModal({
    title: `${has ? 'Units' : 'Enter units'}: ${a.name}`,
    body: `<p class="callout">${money(amt)} ${what} on <b>${fmtDate(t.date)}</b>${sell ? ' from' : ' into'} <b>${esc(a.name)}</b>.
      ${has ? (t.unitsSource === 'auto' ? `Worked out automatically from the NAV of ${fmtDate(t.navDate || target)}${!sell && db.settings.stampDuty !== false ? ', after 0.005% stamp duty' : ''}. Change it if your statement shows different figures.` : 'You entered these figures.')
        : `Enter the ${sell ? 'units sold' : 'units allotted'} and the ${isMF(a) ? 'NAV' : 'price'} from your statement or fund app.`}</p>
      ${twoCol(field(sell ? 'Units sold' : 'Units allotted', input('units', has ? t.units : '', 'type="number" step="any" min="0.0001" required placeholder="e.g. 58.914"')),
        field(`${isMF(a) ? 'NAV' : 'Price'} per unit`, moneyInput('nav', t.unitNav ?? '', 'min="0" placeholder="e.g. 84.60"'), 'Fill either box; the other is worked out from the amount.'))}
      <div data-suggest class="text-sm text-ink-2"></div>`,
    submitLabel: 'Save units',
    deleteLabel: 'Clear units',
    onOpen: (form) => {
      const u = form.elements.units, n = form.elements.nav;
      const sig = { signal: modalSignal() };
      const stamp = !sell && db.settings.stampDuty !== false ? STAMP_DUTY : 0;
      u.addEventListener('input', () => { if (num(u.value) > 0) n.value = Math.round(((amt * (1 - stamp)) / num(u.value)) * 10000) / 10000; }, sig);
      n.addEventListener('input', () => { if (num(n.value) > 0) u.value = unitsFor(t, a, num(n.value)); }, sig);
      if (isMF(a) && navigator.onLine) {
        const box = $('[data-suggest]', form);
        box.textContent = 'Looking up the NAV…';
        mfHistory(a.schemeCode, target, addDays(target, 10)).then((hist) => {
          const row = hist.find((x) => x.date >= target);
          if (!box.isConnected) return;
          if (!row) { box.textContent = `The NAV for ${fmtDate(target)} isn't published yet.`; return; }
          const est = unitsFor(t, a, row.nav);
          box.innerHTML = `NAV on ${fmtDate(row.date)} (${navLagFor(t)} working day${navLagFor(t) === 1 ? '' : 's'} after the ${t.relatedType === 'sip' ? 'SIP date' : 'payment'}) was <b class="num">${money(row.nav)}</b>, so about <b class="num">${est}</b> units. <button type="button" class="btn btn-sm ml-1" data-use>Use this</button>`;
          $('[data-use]', box).addEventListener('click', () => { n.value = row.nav; u.value = est; form.dataset.auto = row.date; }, sig);
        }).catch(() => { if (box.isConnected) box.textContent = ''; });
      }
    },
    onSubmit: (d, form) => {
      const units = num(d.units);
      if (units <= 0) { toast('Enter the units.', 'error'); return false; }
      const nav = num(d.nav) || round2(amt / units);
      const auto = form.dataset.auto && Math.abs(nav - num(form.elements.nav.value)) < 1e-9;
      const ops = [opUpsert('transactions', { ...t, units, unitNav: nav, navDate: auto ? form.dataset.auto : t.navDate || '', unitsSource: auto ? 'auto' : 'you', reviewedAt: new Date().toISOString() })];
      ops.push(...revalueOps(a, { [t.id]: units }));
      commit(ops, `Units for ${a.name} on ${t.date}`);
      toast('Units saved. The live value now includes them.', 'success');
    },
    onDelete: has ? () => {
      const rest = { ...t }; delete rest.units; delete rest.unitNav; delete rest.navDate; delete rest.unitsSource;
      commit([opUpsert('transactions', rest)], `Clear units for ${a.name} on ${t.date}`);
      toast(isMF(a) ? 'Cleared. The app will work them out again from the NAV.' : 'Units cleared.');
      if (isMF(a)) setTimeout(() => autoAllotUnits({ onlyId: a.id }), 200);
    } : null,
  });
}

/** Every purchase and withdrawal of a holding, with its units and NAV. */
function openUnitsHistory(accountId) {
  const a = accountById(accountId);
  if (!a) return;
  const since = a.unitsDate || '';
  const list = db.transactions.filter((t) => t.type !== 'adjustment' && (t.toAccountId === a.id || t.fromAccountId === a.id)
    && (since ? t.date > since : t.date >= (a.openingDate || ''))).sort((x, y) => y.date.localeCompare(x.date));
  const U = holdingUnits(a);
  const status = (t) => {
    if (t.units !== undefined && t.units !== null && t.units !== '') return t.unitsSource === 'auto' ? '<span class="pill blue">Auto</span>' : '<span class="pill">You</span>';
    return isMF(a) && addDays(allotDateFor(t), AUTO_GRACE_DAYS) > todayStr() ? `<span class="pill due" title="Units come from the NAV of ${fmtDate(allotDateFor(t))}">Waiting for NAV</span>` : '<span class="pill out">To confirm</span>';
  };
  openModal({
    title: `Units: ${a.name}`,
    wide: true,
    body: `<div class="kv"><div><dt>Units held now</dt><dd>${U.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</dd></div>
        <div><dt>Latest ${isMF(a) ? 'NAV' : 'price'}</dt><dd>${num(a.unitPrice) ? `${money(a.unitPrice)} <span class="text-ink-3 font-normal text-xs">${a.priceDate ? fmtDate(a.priceDate) : ''}</span>` : '—'}</dd></div>
        ${num(a.expenseRatio) ? `<div><dt>Expense ratio</dt><dd>${num(a.expenseRatio)}% a year</dd></div>` : ''}</div>
      <div class="overflow-x-auto mt-4"><table class="sched">
        <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>${isMF(a) ? 'NAV' : 'Price'} (date)</th><th>Units</th><th>Source</th><th></th></tr></thead>
        <tbody>
          ${list.map((t) => `<tr><td>${fmtDate(t.date)}</td><td>${t.relatedType === 'sip' ? 'SIP' : t.fromAccountId === a.id ? 'Withdrawal' : 'Purchase'}</td><td>${money(t.amount)}</td>
            <td>${t.unitNav ? `${money(t.unitNav)}${t.navDate ? ` <span class="text-ink-3">(${parseDate(t.navDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})</span>` : ''}` : '—'}</td>
            <td>${t.units !== undefined && t.units !== null && t.units !== '' ? `${t.fromAccountId === a.id ? '−' : '+'}${num(t.units).toLocaleString('en-IN', { maximumFractionDigits: 3 })}` : '—'}</td>
            <td>${status(t)}</td><td><button type="button" class="link text-sm" data-action="review-units" data-id="${t.id}">${t.units !== undefined && t.units !== null && t.units !== '' ? 'Change' : 'Enter'}</button></td></tr>`).join('')}
          <tr class="done"><td>${fmtDate(a.unitsDate || a.openingDate)}</td><td colspan="3">Units you entered for the holding</td><td>${num(a.units).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td><td><span class="pill">You</span></td><td><button type="button" class="link text-sm" data-action="edit-account" data-id="${a.id}">Change</button></td></tr>
        </tbody></table></div>`,
    submitLabel: 'Done',
    cancelLabel: 'Close',
    onSubmit: () => {},
  });
}

/* ---------------------------------------------------------------------
   YOUR CHARTS (custom chart builder)
   ---------------------------------------------------------------------
   A saved chart is a small record in db.charts:
     { id, title, type, value, period, top, size, pinned, order,
       filters: ['period','category','account','group'],  // shown on the chart
       labels: 'value' | 'percent' | 'both' | 'none',     // data labels
       color }                                             // single-colour charts
   - type   : how it is drawn (pie, bar, treemap, KPI...) -> CHART_TYPES
   - value  : what it shows (spending by category...)     -> CHART_VALUES
   - period : which dates it covers                         -> PERIODS
   Pinned charts appear on the dashboard for everyone who opens the app,
   because they are saved in data.json like everything else.
   Data sources return one of these shapes:
     cat    { labels, series: [{ name, data }] }       one value per label
     cat2   same, with two series (e.g. budget vs spent)
     series { labels (months/days), series: [...] }    values over time
     matrix { rows, cols, cells: [[{ v, title }]] }     heatmaps
   COLOURS: every category, account, holding and series has ONE colour
   everywhere (colorFor). You can change any of them in the chart builder;
   the choice is saved in settings.colors and used by every chart.
   --------------------------------------------------------------------- */

/* ----- Colours ----- */
const PALETTE = ['#0B84C6', '#E0306E', '#F59E0B', '#12A150', '#7C3AED', '#06B6D4', '#F97316', '#DB2777', '#2563EB', '#EAB308',
  '#0F766E', '#A855F7', '#65A30D', '#DC2626', '#0891B2', '#C026D3', '#4F46E5', '#CA8A04', '#059669', '#9333EA'];
const FIXED_COLORS = {
  'Money in': '#12A150', Income: '#12A150', Spent: '#E0306E', Expenses: '#E0306E', Invested: '#F59E0B',
  'SIP & investments': '#F59E0B', 'Net worth': '#0A6FB0', Assets: '#12A150', Liabilities: '#E0306E',
  Budget: '#94A3B8', Other: '#94A3B8', 'Left over': '#0A6FB0', 'Money with me': '#0B84C6', 'Savings rate': '#12A150',
  Cash: '#EAB308', Bank: '#0B84C6', 'Credit card': '#E0306E', Investments: '#12A150', 'Card credit': '#94A3B8',
  'Card dues': '#E0306E', Loans: '#DB2777', 'Card EMIs': '#F97316', EMIs: '#DB2777', SIPs: '#F59E0B',
  'Current value': '#12A150', 'This month': '#0A6FB0', 'Last month': '#94A3B8',
};
let colorDraft = null; // colours being edited in the builder (label -> hex, or null to reset)
function hashStr(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
/** The one colour used for `label` in every chart. */
function colorFor(label) {
  if (colorDraft && label in colorDraft) { if (colorDraft[label]) return colorDraft[label]; }
  else if (db.settings.colors?.[label]) return db.settings.colors[label];
  if (FIXED_COLORS[label]) return FIXED_COLORS[label];
  if (typeof GROUP_COLORS !== 'undefined' && GROUP_COLORS[label]) return GROUP_COLORS[label];
  const ex = db.settings.expenseCategories.indexOf(label);
  if (ex >= 0) return PALETTE[ex % PALETTE.length];
  const inc = db.settings.incomeCategories.indexOf(label);
  if (inc >= 0) return PALETTE[(inc + 3) % PALETTE.length];
  const acc = db.accounts.findIndex((a) => a.name === label);
  if (acc >= 0) return PALETTE[(acc * 7 + 4) % PALETTE.length];
  return PALETTE[hashStr(label) % PALETTE.length];
}
function hexA(hex, a) { const n = parseInt(String(hex).slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

/* ----- Units ----- */
function fmtVal(v, unit = 'money', compact = false) {
  if (unit === 'pct') return `${(Math.round(num(v) * 10) / 10).toLocaleString('en-IN')}%`;
  if (unit === 'count') return Math.round(num(v)).toLocaleString('en-IN');
  return money(v, { compact });
}

const PERIODS = [
  ['this_month', 'This month'], ['last_month', 'Last month'], ['last_3', 'Last 3 months'],
  ['last_6', 'Last 6 months'], ['last_12', 'Last 12 months'], ['this_year', 'This year (Jan to Dec)'],
  ['this_fy', 'This financial year (Apr to Mar)'], ['last_fy', 'Last financial year'], ['all', 'All time'],
];
const periodLabel = (k) => (PERIODS.find(([v]) => v === k) || [, ''])[1];
const monthKeysBetween = (fromMk, toMk) => {
  const out = [];
  for (let d = fromMk + '-01'; d.slice(0, 7) <= toMk && out.length < 120; d = addMonths(d, 1)) out.push(d.slice(0, 7));
  return out;
};
function periodRange(key) {
  const today = todayStr(), t = parseDate(today), y = t.getFullYear(), m = t.getMonth();
  const mk = (yy, mm) => makeDate(yy, mm, 1).slice(0, 7);
  const fyStart = m >= 3 ? y : y - 1; // Indian financial year starts in April
  let from, to = today;
  switch (key) {
    case 'this_month': from = mk(y, m); break;
    case 'last_month': from = mk(y, m - 1); to = addDays(mk(y, m) + '-01', -1); break;
    case 'last_3': from = mk(y, m - 2); break;
    case 'last_6': from = mk(y, m - 5); break;
    case 'this_year': from = `${y}-01`; break;
    case 'this_fy': from = `${fyStart}-04`; break;
    case 'last_fy': from = `${fyStart - 1}-04`; to = `${fyStart}-03-31`; break;
    case 'all': {
      const first = [...db.transactions.map((x) => x.date), ...db.accounts.map((a) => a.openingDate)].filter(Boolean).sort()[0] || today;
      from = first.slice(0, 7); break;
    }
    default: from = mk(y, m - 11); // last_12
  }
  return { from: from + '-01', to, months: monthKeysBetween(from, to.slice(0, 7)) };
}


/* ----- Filters shown on a chart (top right) ----- */
const FILTER_KINDS = {
  period:   { label: 'Period' },
  category: { label: 'Category' },
  account:  { label: 'Account or card' },
  group:    { label: 'Investment type' },
};
const CHART_FILTER_KEY = 'kosh.chartFilters.v1';     // what each chart's filters are set to, per device
let chartFilterState = readLS(CHART_FILTER_KEY, {});
function filterOptions(kind) {
  if (kind === 'period') return PERIODS;
  if (kind === 'category') {
    const cats = [...new Set([...db.settings.expenseCategories, ...(db.settings.sipAsSpending ? [INVEST_SLICE] : []), ...db.settings.incomeCategories])];
    return [['', 'All categories'], ...cats.map((x) => [x, x])];
  }
  if (kind === 'account') return [['', 'All accounts'], ...db.accounts.filter((a) => !a.archived).map((a) => [a.id, a.name])];
  if (kind === 'group') return [['', 'All types'], ...[...new Set(M.P.holdings.map((h) => h.group))].map((g) => [g, g])];
  return [];
}
const supportedFilters = (v) => Object.keys(FILTER_KINDS).filter((k) => (k === 'period' ? v.period : k === 'group' ? v.pf : (k === 'category' || k === 'account') && v.tx));
/** The chart with its on-chart filters applied. */
function effectiveChart(c) {
  const st = chartFilterState[c.id] || {};
  const on = (k) => (c.filters || []).includes(k) && supportedFilters(CHART_VALUES[c.value] || {}).includes(k);
  return {
    ...c,
    period: on('period') && st.period ? st.period : c.period || 'last_6',
    flt: { category: on('category') ? st.category || '' : '', account: on('account') ? st.account || '' : '', group: on('group') ? st.group || '' : '' },
  };
}

/* ----- Helpers shared by the data sources ----- */
const inRange = (t, r) => t.date && t.date >= r.from && t.date <= r.to;
/** What counts as spending: expenses, plus money invested when Settings > "Count SIPs as money going out" is on. */
function spendKey(t) {
  if (t.type === 'expense') return t.category || 'Other';
  if (db.settings.sipAsSpending && isInvestmentOutflow(t)) return INVEST_SLICE;
  return null;
}
const expenseKey = (t) => (t.type === 'expense' ? t.category || 'Other' : null);
/** Does a transaction pass the chart's date range and category / account filters? */
function passes(t, r, flt = {}) {
  if (r && !inRange(t, r)) return false;
  if (flt.account && t.fromAccountId !== flt.account && t.toAccountId !== flt.account) return false;
  if (flt.category) {
    const k = t.type === 'expense' || t.type === 'income' ? t.category || 'Other' : isInvestmentOutflow(t) ? INVEST_SLICE : t.category;
    if (k !== flt.category) return false;
  }
  return true;
}
function sumBy(r, keyFn, flt, count = false) {
  const m = new Map();
  for (const t of db.transactions) {
    if (!passes(t, r, flt)) continue;
    const k = keyFn(t);
    if (k === null || k === undefined) continue;
    m.set(k, (m.get(k) || 0) + (count ? 1 : num(t.amount)));
  }
  return m;
}
/** Map -> cat shape, biggest first, everything after `top` folded into "Other". */
function toCat(map, name, top = 0, keepOrder = false) {
  let rows = [...map.entries()].filter(([, v]) => Math.abs(v) >= 0.005);
  if (!keepOrder) rows.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (top && rows.length > top) {
    const rest = rows.slice(top - 1).reduce((s, [, v]) => s + v, 0);
    rows = [...rows.slice(0, top - 1), ['Other', rest]];
  }
  return { labels: rows.map(([k]) => k), series: [{ name, data: rows.map(([, v]) => round2(v)) }] };
}
function monthSeries(r, parts, flt) { // parts: [{ name, fn(t) -> amount|0 }]
  const idx = new Map(r.months.map((m, i) => [m, i]));
  const series = parts.map((p) => ({ name: p.name, data: r.months.map(() => 0) }));
  for (const t of db.transactions) {
    if (!passes(t, r, flt)) continue;
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    parts.forEach((p, j) => { const v = p.fn(t); if (v) series[j].data[i] += v; });
  }
  series.forEach((s) => { s.data = s.data.map(round2); });
  return { labels: r.months.map((m) => fmtMonth(m, true)), series };
}
/** Balances by kind at the end of a day (for "over time" charts). */
function snapshotAt(date) {
  const bal = new Map();
  for (const a of db.accounts) if ((a.openingDate || '') <= date) bal.set(a.id, num(a.openingBalance));
  for (const t of db.transactions) {
    if (!t.date || t.date > date) continue;
    const amt = num(t.amount);
    if (bal.has(t.fromAccountId) && t.date >= (accountById(t.fromAccountId).openingDate || '')) bal.set(t.fromAccountId, bal.get(t.fromAccountId) - amt);
    if (bal.has(t.toAccountId) && t.date >= (accountById(t.toAccountId).openingDate || '')) bal.set(t.toAccountId, bal.get(t.toAccountId) + amt);
  }
  const k = { cash: 0, bank: 0, investment: 0, cardDebt: 0, cardCredit: 0, loans: 0, owedToMe: 0, iOwe: 0 };
  for (const [id, b] of bal) {
    const a = accountById(id);
    if (a.type === 'credit_card') { if (b < 0) k.cardDebt += -b; else k.cardCredit += b; }
    else if (a.type === 'person') { if (b > 0) k.owedToMe += b; else k.iOwe += -b; }
    else if (k[a.type] !== undefined) k[a.type] += b;
  }
  for (const e of db.emis) {
    if (e.closed || !e.startDate || e.startDate > date) continue;
    const c = emiCalc(e);
    let due = 0;
    for (let n = 0; n < c.n && addMonths(e.startDate, n) <= date; n++) due++;
    k.loans += c.remainingAfter(Math.min(due, c.paid));
  }
  const assets = k.cash + k.bank + k.investment + k.cardCredit + k.owedToMe, liab = k.cardDebt + k.loans + k.iOwe;
  return { ...k, liquid: round2(k.cash + k.bank), assets: round2(assets), liab: round2(liab), net: round2(assets - liab) };
}
function monthEnds(r) {
  const today = todayStr();
  const first = db.accounts.map((a) => a.openingDate).filter(Boolean).sort()[0] || today;
  return r.months.filter((m) => m >= first.slice(0, 7)).map((m) => {
    const end = addDays(addMonths(m + '-01', 1), -1);
    return { m, date: end > today ? today : end };
  });
}
const endsSeries = (r, parts) => {
  const ends = monthEnds(r), snaps = ends.map((e) => snapshotAt(e.date));
  return { labels: ends.map((e) => fmtMonth(e.m, true)), series: parts.map(([name, key]) => ({ name, data: snaps.map((s) => round2(s[key])) })) };
};
function heatFromMap(rowsKeys, colsKeys, get, titleFn) {
  return { rows: rowsKeys, cols: colsKeys.map((c) => c.label ?? c), cells: rowsKeys.map((rk, i) => colsKeys.map((ck, j) => { const v = get(i, j); return { v, title: titleFn(i, j, v) }; })) };
}
function heatBy(r, flt, rowKeyFn, rowsKeys) {
  const grid = rowsKeys.map(() => r.months.map(() => 0));
  for (const t of db.transactions) {
    if (!passes(t, r, flt) || !spendKey(t)) continue;
    const i = rowsKeys.indexOf(rowKeyFn(t)), j = r.months.indexOf(t.date.slice(0, 7));
    if (i >= 0 && j >= 0) grid[i][j] += num(t.amount);
  }
  return heatFromMap(rowsKeys, r.months.map((m) => ({ label: fmtMonth(m, true) })), (i, j) => round2(grid[i][j]), (i, j, v) => `${rowsKeys[i]}, ${fmtMonth(r.months[j])}: ${money(v)}`);
}
const perMonthOf = (freq) => FREQUENCIES[freq]?.perMonth || 1;
const holdingsF = (flt) => M.P.holdings.filter((h) => !h.a.archived && (!flt?.group || h.group === flt.group));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayOf = (d) => WEEKDAYS[(parseDate(d).getDay() + 6) % 7];

/* ----- What a chart can show -----
   group: heading in the list; shape: see top; period: uses a date range;
   top: "show the biggest N"; tx: category/account filters apply;
   pf: investment-type filter applies; unit: money | pct | count;
   signed: can be negative; multi: always several series. */
const CHART_VALUES = {
  // Money with me
  people_balance: { group: 'Money with me', label: 'Money with people (owed to me or by me)', shape: 'cat', signed: true,
    build: () => toCat(new Map(db.accounts.filter((a) => a.type === 'person' && !a.archived).map((a) => [a.name, M.balances.get(a.id) || 0])), 'Balance') },
  money_now: { group: 'Money with me', label: 'Money with me now (cash and bank), by account', shape: 'cat',
    build: (c) => toCat(new Map(db.accounts.filter((a) => !a.archived && ['cash', 'bank'].includes(a.type)).map((a) => [a.name, M.balances.get(a.id) || 0])), 'Money with me', c.top) },
  money_trend: { group: 'Money with me', label: 'Money with me (cash and bank) at each month end', shape: 'series', period: true,
    build: (c, r) => endsSeries(r, [['Money with me', 'liquid']]) },
  own_mix: { group: 'Money with me', label: 'What I own, by kind', shape: 'cat',
    build: () => toCat(new Map([['Cash', M.T.cash], ['Bank', M.T.bank], ['Investments', M.T.investment], ['Card credit', M.T.cardCredit], ['Owed to me', M.T.owedToMe]]), 'Value') },
  owe_mix: { group: 'Money with me', label: 'What I owe, by kind', shape: 'cat',
    build: () => toCat(new Map([['Card dues', M.T.cardDebt], ['Loans', M.T.loans], ['Card EMIs', M.T.cardEmis], ['I owe', M.T.iOwe]]), 'Owed') },
  balances_now: { group: 'Money with me', label: 'All account balances today', shape: 'cat', top: true,
    build: (c) => toCat(new Map(db.accounts.filter((a) => !a.archived && MONEY_TYPES.includes(a.type) && a.type !== 'credit_card').map((a) => [a.name, M.balances.get(a.id) || 0])), 'Balance', c.top) },
  networth_trend: { group: 'Money with me', label: 'Net worth at each month end', shape: 'series', period: true,
    build: (c, r) => endsSeries(r, [['Net worth', 'net']]) },
  assets_liab: { group: 'Money with me', label: 'Assets vs liabilities at each month end', shape: 'series', period: true, multi: true,
    build: (c, r) => endsSeries(r, [['Assets', 'assets'], ['Liabilities', 'liab']]) },

  // Spending
  spend_category: { group: 'Spending', label: 'Spending by category (with SIPs if counted)', shape: 'cat', period: true, top: true, tx: true,
    build: (c, r, f) => toCat(sumBy(r, spendKey, f), 'Spent', c.top) },
  expense_category: { group: 'Spending', label: 'Expenses by category (without investments)', shape: 'cat', period: true, top: true, tx: true,
    build: (c, r, f) => toCat(sumBy(r, expenseKey, f), 'Expenses', c.top) },
  spend_count: { group: 'Spending', label: 'Number of expenses by category', shape: 'cat', period: true, top: true, tx: true, unit: 'count',
    build: (c, r, f) => toCat(sumBy(r, expenseKey, f, true), 'Expenses', c.top) },
  spend_account: { group: 'Spending', label: 'Spending by account or card', shape: 'cat', period: true, tx: true,
    build: (c, r, f) => toCat(sumBy(r, (t) => (spendKey(t) ? accountName(t.fromAccountId) || 'Unknown' : null), f), 'Spent', c.top) },
  spend_mode: { group: 'Spending', label: 'Spending by payment mode (cash, bank, card)', shape: 'cat', period: true, tx: true,
    build: (c, r, f) => toCat(sumBy(r, (t) => (spendKey(t) ? ({ cash: 'Cash', bank: 'Bank', credit_card: 'Credit card' }[accountById(t.fromAccountId)?.type] || 'Other') : null), f), 'Spent') },
  spend_merchant: { group: 'Spending', label: 'Spending by description (shop, merchant)', shape: 'cat', period: true, top: true, tx: true,
    build: (c, r, f) => toCat(sumBy(r, (t) => (t.type === 'expense' ? (t.description || t.category || 'Other').trim() : null), f), 'Spent', c.top || 10) },
  spend_largest: { group: 'Spending', label: 'Biggest single expenses', shape: 'cat', period: true, top: true, tx: true,
    build: (c, r, f) => {
      const list = db.transactions.filter((t) => t.type === 'expense' && passes(t, r, f)).sort((a, b) => num(b.amount) - num(a.amount)).slice(0, c.top || 10);
      return { labels: list.map((t) => `${(t.description || t.category || 'Expense').slice(0, 28)} (${parseDate(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`), series: [{ name: 'Spent', data: list.map((t) => num(t.amount)) }] };
    } },
  spend_weekday: { group: 'Spending', label: 'Spending by day of the week', shape: 'cat', period: true, tx: true, ordered: true,
    build: (c, r, f) => { const m = sumBy(r, (t) => (spendKey(t) ? weekdayOf(t.date) : null), f); return toCat(new Map(WEEKDAYS.map((d) => [d, m.get(d) || 0])), 'Spent', 0, true); } },
  spend_trend: { group: 'Spending', label: 'Spending by month', shape: 'series', period: true, tx: true,
    build: (c, r, f) => monthSeries(r, [{ name: 'Spent', fn: (t) => (spendKey(t) ? num(t.amount) : 0) }], f) },
  spend_cat_trend: { group: 'Spending', label: 'Spending by category, month by month', shape: 'series', period: true, top: true, tx: true, multi: true,
    build: (c, r, f) => {
      const top = toCat(sumBy(r, spendKey, f), '', c.top || 6).labels;
      const named = new Set(top.filter((k) => k !== 'Other'));
      return monthSeries(r, top.map((k) => ({ name: k, fn: (t) => { const s = spendKey(t); if (!s) return 0; return (k === 'Other' ? !named.has(s) : s === k) ? num(t.amount) : 0; } })), f);
    } },
  spend_avg_daily: { group: 'Spending', label: 'Average spending per day, by month', shape: 'series', period: true, tx: true,
    build: (c, r, f) => {
      const d = monthSeries(r, [{ name: 'Spent', fn: (t) => (spendKey(t) ? num(t.amount) : 0) }], f);
      const today = todayStr();
      d.series[0].name = 'Per day';
      d.series[0].data = d.series[0].data.map((v, i) => { const m = r.months[i]; const days = m === today.slice(0, 7) ? parseDate(today).getDate() : daysInMonth(+m.slice(0, 4), +m.slice(5) - 1); return round2(v / days); });
      return d;
    } },
  spend_cumulative: { group: 'Spending', label: 'This month vs last month, day by day (running total)', shape: 'series', tx: true, multi: true,
    build: (c, r, f) => {
      const cur = thisMonth(), prev = addMonths(cur + '-01', -1).slice(0, 7), today = parseDate(todayStr()).getDate();
      const run = (mk, upto) => { const days = Array(31).fill(0); for (const t of db.transactions) { if (!t.date?.startsWith(mk) || !spendKey(t) || !passes(t, null, f)) continue; days[parseDate(t.date).getDate() - 1] += num(t.amount); } let s = 0; return days.map((v, i) => (i < upto ? round2((s += v)) : null)); };
      return { labels: Array.from({ length: 31 }, (_, i) => String(i + 1)), series: [{ name: 'This month', data: run(cur, today) }, { name: 'Last month', data: run(prev, daysInMonth(+prev.slice(0, 4), +prev.slice(5) - 1)) }] };
    } },
  card_trend: { group: 'Spending', label: 'Credit card spending by month, per card', shape: 'series', period: true, tx: true, multi: true,
    build: (c, r, f) => monthSeries(r, db.accounts.filter((a) => a.type === 'credit_card' && !a.archived)
      .map((a) => ({ name: a.name, fn: (t) => (t.type === 'expense' && t.fromAccountId === a.id ? num(t.amount) : 0) })), f) },

  // Income and savings
  income_source: { group: 'Income and savings', label: 'Income by source', shape: 'cat', period: true, top: true, tx: true,
    build: (c, r, f) => toCat(sumBy(r, (t) => (t.type === 'income' ? t.category || 'Other' : null), f), 'Income', c.top) },
  income_trend: { group: 'Income and savings', label: 'Income by month', shape: 'series', period: true, tx: true,
    build: (c, r, f) => monthSeries(r, [{ name: 'Income', fn: (t) => (t.type === 'income' ? num(t.amount) : 0) }], f) },
  cashflow: { group: 'Income and savings', label: 'Money in, spent and invested by month', shape: 'series', period: true, tx: true, multi: true,
    build: (c, r, f) => monthSeries(r, [
      { name: 'Money in', fn: (t) => (t.type === 'income' ? num(t.amount) : 0) },
      { name: 'Spent', fn: (t) => (t.type === 'expense' ? num(t.amount) : 0) },
      { name: 'Invested', fn: (t) => (isInvestmentOutflow(t) ? num(t.amount) : 0) },
    ], f) },
  leftover_trend: { group: 'Income and savings', label: 'Money left over by month', shape: 'series', period: true, signed: true,
    build: (c, r) => monthSeries(r, [{ name: 'Left over', fn: (t) => (t.type === 'income' ? num(t.amount) : t.type === 'expense' || isInvestmentOutflow(t) ? -num(t.amount) : 0) }]) },
  savings_rate: { group: 'Income and savings', label: 'Savings rate by month (% of income not spent)', shape: 'series', period: true, unit: 'pct', signed: true,
    build: (c, r) => {
      const d = monthSeries(r, [{ name: 'in', fn: (t) => (t.type === 'income' ? num(t.amount) : 0) }, { name: 'out', fn: (t) => (t.type === 'expense' ? num(t.amount) : 0) }]);
      return { labels: d.labels, series: [{ name: 'Savings rate', data: d.series[0].data.map((inc, i) => (inc > 0 ? round2(((inc - d.series[1].data[i]) / inc) * 100) : 0)) }] };
    } },
  cashflow_waterfall: { group: 'Income and savings', label: 'Where the money went (money in, spent, invested, left)', shape: 'cat', period: true, signed: true, waterfall: true, ordered: true,
    build: (c, r) => {
      let inc = 0, sp = 0, inv = 0;
      for (const t of db.transactions) { if (!inRange(t, r)) continue; if (t.type === 'income') inc += num(t.amount); else if (t.type === 'expense') sp += num(t.amount); else if (isInvestmentOutflow(t)) inv += num(t.amount); }
      return { labels: ['Money in', 'Spent', 'Invested', 'Left over'], series: [{ name: 'Amount', data: [round2(inc), round2(-sp), round2(-inv), round2(inc - sp - inv)] }], totalLast: true };
    } },
  invest_trend: { group: 'Income and savings', label: 'Invested (SIPs and lump sums) by month', shape: 'series', period: true,
    build: (c, r) => monthSeries(r, [{ name: 'Invested', fn: (t) => (isInvestmentOutflow(t) ? num(t.amount) : 0) }]) },

  // Budgets, bills and loans
  budget_actual: { group: 'Budgets, bills and loans', label: 'Budget vs spent by category', shape: 'cat2', period: true,
    build: (c, r, f) => {
      const spent = sumBy(r, spendKey, f);
      const months = r.months.length || 1;
      const rows = db.budgets.map((b) => [b.category, num(b.monthlyLimit) * months, spent.get(b.category) || 0]);
      return { labels: rows.map((x) => x[0]), series: [{ name: 'Budget', data: rows.map((x) => round2(x[1])) }, { name: 'Spent', data: rows.map((x) => round2(x[2])) }] };
    } },
  budget_used: { group: 'Budgets, bills and loans', label: 'Budget used (%) by category', shape: 'cat', period: true, unit: 'pct', ordered: true,
    build: (c, r) => {
      const spent = sumBy(r, spendKey), months = r.months.length || 1;
      return toCat(new Map(db.budgets.filter((b) => num(b.monthlyLimit) > 0).map((b) => [b.category, ((spent.get(b.category) || 0) / (num(b.monthlyLimit) * months)) * 100])), 'Used');
    } },
  card_dues: { group: 'Budgets, bills and loans', label: 'Credit card dues by card', shape: 'cat',
    build: () => toCat(new Map(db.accounts.filter((a) => a.type === 'credit_card' && !a.archived).map((a) => [a.name, Math.max(0, cardMetrics(a).outstanding)])), 'Due') },
  card_util: { group: 'Budgets, bills and loans', label: 'Credit card limit used (%) by card', shape: 'cat', unit: 'pct',
    build: () => toCat(new Map(db.accounts.filter((a) => a.type === 'credit_card' && !a.archived && num(a.creditLimit) > 0).map((a) => [a.name, cardMetrics(a).utilization * 100])), 'Used') },
  loans_left: { group: 'Budgets, bills and loans', label: 'Loans and EMIs: amount left to repay', shape: 'cat',
    build: () => toCat(new Map(M.emis.filter(({ c }) => c.status === 'active').map(({ e, c }) => [e.name, c.remaining])), 'Left to repay') },
  emi_monthly: { group: 'Budgets, bills and loans', label: 'Monthly EMI by loan', shape: 'cat',
    build: () => toCat(new Map(M.emis.filter(({ c }) => c.status === 'active').map(({ e, c }) => [e.name, c.emi])), 'EMI') },
  subs_cost: { group: 'Budgets, bills and loans', label: 'Subscriptions: cost per month each', shape: 'cat', top: true,
    build: (c) => toCat(new Map(db.subscriptions.filter((x) => x.active && recurKind(x) === 'subscription').map((x) => [x.name, num(x.amount) * perMonthOf(x.frequency)])), 'Per month', c.top) },
  fixed_costs: { group: 'Budgets, bills and loans', label: 'Fixed monthly outgoings (EMIs, subscriptions, SIPs)', shape: 'cat',
    build: () => toCat(new Map([
      ['EMIs', M.emis.filter(({ c }) => c.status === 'active').reduce((s, { c }) => s + c.emi, 0)],
      ['Subscriptions', db.subscriptions.filter((x) => x.active && recurKind(x) === 'subscription').reduce((s, x) => s + num(x.amount) * perMonthOf(x.frequency), 0)],
      ['Bills', db.subscriptions.filter((x) => x.active && recurKind(x) === 'bill').reduce((s, x) => s + num(x.amount) * perMonthOf(x.frequency), 0)],
      ['SIPs', M.P.totals.sipMonthly],
    ]), 'Per month') },

  // Portfolio
  portfolio_mix: { group: 'Portfolio', label: 'Portfolio by type', shape: 'cat',
    build: () => toCat(new Map(M.P.allocation.map((g) => [g.group, g.value])), 'Value') },
  holdings_value: { group: 'Portfolio', label: 'Holdings by current value', shape: 'cat', top: true, pf: true,
    build: (c, r, f) => toCat(new Map(holdingsF(f).map((h) => [h.a.name, h.value])), 'Current value', c.top) },
  holdings_cost_value: { group: 'Portfolio', label: 'Invested vs current value by holding', shape: 'cat2', pf: true,
    build: (c, r, f) => { const hs = holdingsF(f).filter((h) => h.invested > 0).sort((a, b) => b.value - a.value); return { labels: hs.map((h) => h.a.name), series: [{ name: 'Invested', data: hs.map((h) => h.invested) }, { name: 'Current value', data: hs.map((h) => h.value) }] }; } },
  holdings_pl: { group: 'Portfolio', label: 'Profit or loss by holding', shape: 'cat', top: true, signed: true, pf: true,
    build: (c, r, f) => toCat(new Map(holdingsF(f).filter((h) => h.invested > 0).map((h) => [h.a.name, h.gain])), 'Profit / loss', c.top) },
  holdings_return: { group: 'Portfolio', label: 'Return (%) by holding', shape: 'cat', signed: true, pf: true, unit: 'pct',
    build: (c, r, f) => toCat(new Map(holdingsF(f).filter((h) => h.invested > 0).map((h) => [h.a.name, h.gainPct * 100])), 'Return') },
  sip_by_fund: { group: 'Portfolio', label: 'Monthly SIP by fund', shape: 'cat',
    build: () => { const m = new Map(); for (const x of db.sips.filter((s) => s.active)) m.set(accountName(x.fundAccountId) || x.name, (m.get(accountName(x.fundAccountId) || x.name) || 0) + sipAmountOn(x, todayStr()) * perMonthOf(x.frequency)); return toCat(m, 'SIP per month'); } },

  // Heatmaps
  cat_month_heat: { group: 'Heatmaps', label: 'Spending: category by month', shape: 'matrix', period: true, top: true, tx: true,
    build: (c, r, f) => { const cats = toCat(sumBy(r, spendKey, f), '', c.top || 8).labels; const named = new Set(cats.filter((k) => k !== 'Other')); return heatBy(r, f, (t) => { const s = spendKey(t); return named.has(s) ? s : 'Other'; }, cats); } },
  account_month_heat: { group: 'Heatmaps', label: 'Spending: account or card by month', shape: 'matrix', period: true, tx: true,
    build: (c, r, f) => { const accs = toCat(sumBy(r, (t) => (spendKey(t) ? accountName(t.fromAccountId) || 'Unknown' : null), f), '').labels; return heatBy(r, f, (t) => accountName(t.fromAccountId) || 'Unknown', accs); } },
  weekday_heat: { group: 'Heatmaps', label: 'Spending: weekday by month', shape: 'matrix', period: true, tx: true,
    build: (c, r, f) => heatBy(r, f, (t) => weekdayOf(t.date), WEEKDAYS) },
  daily_heat: { group: 'Heatmaps', label: 'Daily spending calendar', shape: 'matrix', period: true, tx: true,
    build: (c, r, f) => {
      const byDay = sumBy(r, (t) => (spendKey(t) ? t.date : null), f);
      let start = r.from; while ((parseDate(start).getDay() + 6) % 7) start = addDays(start, -1);
      const weeks = [];
      for (let w = start; w <= r.to && weeks.length < 60; w = addDays(w, 7)) weeks.push(w);
      const dateAt = (i, j) => addDays(weeks[j], i);
      let lastM = '';
      const cols = weeks.map((w) => { const mo = addDays(w, 6).slice(0, 7); const lab = mo !== lastM ? parseDate(mo + '-01').toLocaleDateString('en-IN', { month: 'short' }) : ''; lastM = mo; return { label: lab }; });
      const out = heatFromMap(WEEKDAYS, cols, (i, j) => { const d = dateAt(i, j); return d < r.from || d > r.to ? null : round2(byDay.get(d) || 0); },
        (i, j, v) => (v === null ? '' : `${fmtDate(dateAt(i, j))}: ${money(v)}`));
      out.compact = true;
      return out;
    } },
};

/* ----- Chart types ----- */
const CHART_TYPES = {
  bar:         { label: 'Bar',            icon: 'fa-chart-column',   shapes: ['cat', 'cat2', 'series'] },
  hbar:        { label: 'Horizontal bar', icon: 'fa-bars-staggered', shapes: ['cat', 'cat2', 'series'] },
  stacked:     { label: 'Stacked bar',    icon: 'fa-layer-group',    shapes: ['series'], multi: true },
  stacked100:  { label: '100% stacked',   icon: 'fa-percent',        shapes: ['series'], multi: true, noSigned: true },
  line:        { label: 'Line',           icon: 'fa-chart-line',     shapes: ['series'] },
  area:        { label: 'Area',           icon: 'fa-chart-area',     shapes: ['series'] },
  stackedArea: { label: 'Stacked area',   icon: 'fa-mountain',       shapes: ['series'], multi: true, noSigned: true },
  combo:       { label: 'Bar + line',     icon: 'fa-chart-simple',   shapes: ['series'], multi: true },
  pie:         { label: 'Pie',            icon: 'fa-chart-pie',      shapes: ['cat'], noSigned: true },
  doughnut:    { label: 'Doughnut',       icon: 'fa-circle-notch',   shapes: ['cat'], noSigned: true },
  polarArea:   { label: 'Polar area',     icon: 'fa-bullseye',       shapes: ['cat'], noSigned: true },
  radar:       { label: 'Radar',          icon: 'fa-spider',         shapes: ['cat', 'cat2'], noSigned: true },
  treemap:     { label: 'Treemap',        icon: 'fa-table-cells-large', shapes: ['cat'], noSigned: true, html: true },
  waterfall:   { label: 'Waterfall',      icon: 'fa-stairs',         shapes: ['cat'] },
  progress:    { label: 'Progress bars',  icon: 'fa-bars-progress',  shapes: ['cat2', 'catpct'], html: true },
  heatmap:     { label: 'Heatmap',        icon: 'fa-table-cells',    shapes: ['matrix'], html: true, oneColor: true },
  kpi:         { label: 'Big number',     icon: 'fa-hashtag',        shapes: ['cat', 'cat2', 'series'], html: true, oneColor: true },
  table:       { label: 'Table',          icon: 'fa-table-list',     shapes: ['cat', 'cat2', 'series', 'matrix'], html: true },
};
const ROUND = ['pie', 'doughnut', 'polarArea'];
function valuesFor(type) {
  const T = CHART_TYPES[type];
  return Object.entries(CHART_VALUES).filter(([, v]) => {
    const shape = v.shape === 'cat' && v.unit === 'pct' && T.shapes.includes('catpct') ? 'catpct' : v.shape;
    if (!T.shapes.includes(shape)) return false;
    if (T.noSigned && v.signed) return false;
    if (T.multi && !v.multi) return false;
    if (type === 'waterfall' && v.unit && v.unit !== 'money') return false;
    if (ROUND.includes(type) && v.unit === 'pct') return false;
    return true;
  });
}
const defaultTitle = (c) => `${CHART_VALUES[c.value]?.label || 'Chart'}${CHART_VALUES[c.value]?.period ? `, ${periodLabel(c.period).replace(/ \(.*\)/, '').toLowerCase()}` : ''}`;

function chartData(c) {
  const v = CHART_VALUES[c.value];
  if (!v) return null;
  try { return v.build(c, periodRange(c.period || 'last_6'), c.flt || {}); } catch (e) { console.warn('chart data', e); return null; }
}
const isEmptyData = (d) => !d || (d.cells ? !d.cells.some((row) => row.some((x) => x.v)) : !d.labels.length || !d.series.some((s) => s.data.some((x) => x)));

/* ----- Data labels (drawn by this small Chart.js plugin; no extra library) ----- */
const kLabelsPlugin = {
  id: 'kLabels',
  afterDatasetsDraw(chart, _args, o) {
    if (!o || !o.mode || o.mode === 'none') return;
    const { ctx } = chart;
    const round = ROUND.includes(chart.config.type);
    ctx.save();
    ctx.font = '600 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, di) => {
      if (!chart.isDatasetVisible(di)) return;
      const meta = chart.getDatasetMeta(di);
      const shown = ds.kValues || ds.data.map((v) => (Array.isArray(v) ? v[1] - v[0] : v));
      const total = shown.reduce((s, v) => s + Math.abs(num(v)), 0) || 1;
      const isLine = meta.type === 'line' || meta.type === 'radar';
      const many = meta.data.length > 12;
      const lastIdx = shown.reduce((li, x, k) => (x !== null && x !== undefined ? k : li), -1);
      // Long lines: every few points; several long lines: just each line's last value.
      const step = isLine && many ? Math.ceil(meta.data.length / 10) : 1;
      const onlyLast = isLine && many && chart.data.datasets.length > 1;
      meta.data.forEach((el, i) => {
        const v = shown[i];
        if (v === null || v === undefined || !num(v)) return;
        if (onlyLast ? i !== lastIdx : isLine && i % step && i !== lastIdx) return;
        const pctTxt = `${Math.round((Math.abs(v) / total) * 100)}%`;
        const valTxt = fmtVal(v, ds.kUnit || o.unit, true);
        const text = o.mode === 'percent' ? pctTxt : o.mode === 'both' ? `${valTxt} · ${pctTxt}` : valTxt;
        const w = ctx.measureText(text).width;
        if (round) {
          if (Math.abs(v) / total < 0.05) return;
          const p = el.tooltipPosition();
          ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 3;
          ctx.fillText(text, p.x, p.y);
          ctx.shadowBlur = 0;
          return;
        }
        if (isLine) {
          ctx.textAlign = 'center'; ctx.fillStyle = '#334155';
          ctx.fillText(text, el.x, el.y - 11);
          return;
        }
        const horizontal = chart.options.indexAxis === 'y';
        const { x, y, base, width, height } = el.getProps(['x', 'y', 'base', 'width', 'height'], true);
        const barLen = Math.abs(horizontal ? x - base : y - base);
        const thick = horizontal ? height : width;
        if (o.stacked) {
          if ((horizontal ? barLen < w + 8 : barLen < 15 || thick < w - 8)) return;
          ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.fillText(text, horizontal ? (x + base) / 2 : x, horizontal ? y : (y + base) / 2);
          return;
        }
        if (!horizontal && thick < w - 6 && meta.data.length > 6) return; // too crowded
        ctx.fillStyle = '#334155';
        if (horizontal) {
          const neg = x < base;
          if (!neg) { ctx.textAlign = 'left'; ctx.fillText(text, x + 5, y); }
          else if (barLen > w + 10) { ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.fillText(text, x + 5, y); } // inside the bar, clear of the names
          else { ctx.textAlign = 'left'; ctx.fillText(text, base + 5, y); }
        }
        else { const neg = y > base; ctx.textAlign = 'center'; ctx.fillText(text, x, y + (neg ? 9 : -9)); }
      });
    });
    ctx.restore();
  },
};
function ensureChartPlugins() {
  if (typeof Chart === 'undefined' || typeof Chart.register !== 'function' || ensureChartPlugins.done) return;
  Chart.register(kLabelsPlugin);
  ensureChartPlugins.done = true;
}

/* ----- Drawing ----- */
/** Draws chart `c` into element `box`; returns the Chart.js instance, or null for HTML-drawn types. */
function drawChartInto(box, c) {
  const d = chartData(c);
  const v = CHART_VALUES[c.value] || {};
  const unit = v.unit || 'money';
  box.classList.toggle('is-html', !!CHART_TYPES[c.type]?.html && c.type !== 'treemap');
  if (isEmptyData(d)) { box.innerHTML = emptyState('fa-chart-simple', 'No data for this selection yet.'); return null; }
  if (c.type === 'heatmap') { box.innerHTML = heatmapHTML(d, c); return null; }
  if (c.type === 'table') { box.innerHTML = tableHTML(d, unit); return null; }
  if (c.type === 'kpi') { box.innerHTML = kpiHTML(d, c, v); return null; }
  if (c.type === 'progress') { box.innerHTML = progressHTML(d, v); return null; }
  if (c.type === 'treemap') { box.innerHTML = treemapHTML(d, c, unit); return null; }
  if (typeof Chart === 'undefined') { box.innerHTML = emptyState('fa-chart-simple', 'Charts could not load. Check your internet connection.'); return null; }
  ensureChartPlugins();
  box.innerHTML = '<canvas role="img"></canvas>';
  const canvas = box.firstChild;
  canvas.setAttribute('aria-label', c.title || defaultTitle(c));
  chartDefaults();
  const labelsMode = c.labels || 'value';
  const single = d.series.length === 1;
  const signedColors = (s) => s.data.map((x) => (x >= 0 ? '#12A150' : '#E0306E'));
  const perLabel = (s) => (v.signed ? signedColors(s) : d.labels.map((l) => colorFor(l)));
  const tipLabel = (ctx, val) => ` ${single && (ROUND.includes(c.type) || v.shape === 'cat') ? ctx.label : ctx.dataset.label}: ${fmtVal(val, ctx.dataset.kUnit || unit)}`;
  const tick = { callback: (x) => fmtVal(x, unit, true) };
  const base = { maintainAspectRatio: false, layout: { padding: { top: 18, right: c.type === 'hbar' ? 48 : ['line', 'area', 'stackedArea', 'combo'].includes(c.type) ? 26 : 10, left: 4 } } };
  let cfg;

  if (ROUND.includes(c.type)) {
    const data = d.series[0].data.map(Math.abs);
    cfg = { type: c.type, data: { labels: d.labels, datasets: [{ data, backgroundColor: d.labels.map((l) => (c.type === 'polarArea' ? hexA(colorFor(l), 0.8) : colorFor(l))), borderColor: '#fff', borderWidth: 2 }] },
      options: { ...base, ...(c.type === 'doughnut' ? { cutout: '58%' } : {}),
        plugins: { legend: { position: box.clientWidth < 480 ? 'bottom' : 'right', labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtVal(data[ctx.dataIndex], unit)}` } }, kLabels: { mode: labelsMode, unit } },
        ...(c.type === 'polarArea' ? { scales: { r: { ticks: { display: false } } } } : {}) } };
  } else if (c.type === 'radar') {
    cfg = { type: 'radar', data: { labels: d.labels, datasets: d.series.map((s) => { const col = single ? '#0A6FB0' : colorFor(s.name); return { label: s.name, data: s.data, borderColor: col, backgroundColor: hexA(col, 0.18), pointBackgroundColor: col, pointRadius: 3 }; }) },
      options: { ...base, plugins: { legend: { display: !single }, tooltip: { callbacks: { label: (ctx) => tipLabel(ctx, ctx.parsed.r) } }, kLabels: { mode: labelsMode === 'value' ? 'value' : labelsMode, unit } },
        scales: { r: { beginAtZero: true, ticks: { display: false }, pointLabels: { font: { size: 11, weight: '600' } } } } } };
  } else if (c.type === 'waterfall') {
    // Each bar floats from the running total before it to the running total after it.
    let run = 0;
    const vals = d.series[0].data;
    const bars = vals.map((x, i) => { if (d.totalLast && i === vals.length - 1) return [0, x]; const from = run; run += x; return [from, run]; });
    const colors = vals.map((x, i) => (d.totalLast && i === vals.length - 1 ? '#0A6FB0' : x >= 0 ? '#12A150' : '#E0306E'));
    cfg = { type: 'bar', data: { labels: d.labels, datasets: [{ label: d.series[0].name, data: bars, kValues: vals, backgroundColor: colors, borderRadius: 4, maxBarThickness: 48 }] },
      options: { ...base, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtVal(vals[ctx.dataIndex], unit)}` } }, kLabels: { mode: labelsMode === 'none' ? 'none' : 'value', unit } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#EEF1F8' }, ticks: tick } } } };
  } else {
    const kind = ['line', 'area', 'stackedArea'].includes(c.type) ? 'line' : 'bar';
    const horizontal = c.type === 'hbar';
    const stacked = ['stacked', 'stacked100', 'stackedArea'].includes(c.type);
    const pct100 = c.type === 'stacked100';
    const totals = pct100 ? d.labels.map((_, i) => d.series.reduce((s, x) => s + Math.abs(num(x.data[i])), 0) || 1) : null;
    const datasets = d.series.map((s, si) => {
      const col = single && kind === 'line' ? colorFor(s.name) : colorFor(s.name);
      const data = pct100 ? s.data.map((x, i) => round2((Math.abs(num(x)) / totals[i]) * 100)) : s.data;
      const extra = pct100 ? { kValues: data, kUnit: 'pct', raw: s.data } : {};
      if (c.type === 'combo' && si > 0) return { type: 'line', label: s.name, data, borderColor: col, backgroundColor: col, tension: 0.3, pointRadius: 3, borderWidth: 2.5, order: 0, ...extra };
      if (kind === 'line') return { label: s.name, data, borderColor: col, backgroundColor: hexA(col, c.type === 'line' ? 1 : 0.22), fill: c.type === 'area' ? 'origin' : c.type === 'stackedArea' ? (si ? '-1' : 'origin') : false, tension: 0.3, pointRadius: 3, borderWidth: 2.5, spanGaps: false, ...extra };
      const perBar = single && v.shape !== 'series' && v.shape !== 'cat2';
      return { label: s.name, data, backgroundColor: perBar ? perLabel(s) : v.signed && single ? signedColors(s) : col, borderRadius: stacked ? 2 : 5, maxBarThickness: 38, order: 1, ...extra };
    });
    const valAxis = { beginAtZero: true, stacked, grid: { color: '#EEF1F8' }, ticks: pct100 ? { callback: (x) => `${x}%` } : tick, ...(pct100 ? { max: 100 } : {}) };
    const catAxis = { stacked, grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } };
    cfg = { type: kind, data: { labels: d.labels, datasets },
      options: { ...base, indexAxis: horizontal ? 'y' : 'x', interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: !single, labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: (ctx) => {
            const val = horizontal ? ctx.parsed.x : ctx.parsed.y;
            return pct100 ? ` ${ctx.dataset.label}: ${fmtVal(ctx.dataset.raw[ctx.dataIndex], unit)} (${val}%)` : tipLabel(ctx, val);
          } } },
          kLabels: { mode: labelsMode, unit: pct100 ? 'pct' : unit, stacked } },
        scales: horizontal ? { x: valAxis, y: catAxis } : { x: catAxis, y: valAxis } } };
  }
  return new Chart(canvas, cfg);
}

/* ----- HTML-drawn chart types ----- */
function heatmapHTML(d, c) {
  const hue = c.color || '#D6245F';
  const vals = d.cells.flat().map((x) => x.v).filter((v) => v !== null);
  const max = Math.max(...vals, 1);
  const shade = (v) => {
    if (v === null) return 'background:transparent';
    if (!v) return 'background:#EEF2F8';
    const t = Math.min(1, Math.max(0.12, Math.sqrt(v / max)));
    return `background:${hexA(hue, t)}${t > 0.55 ? ';color:#fff' : ''}`;
  };
  const showNums = (c.labels || 'value') !== 'none' && !d.compact && d.cols.length <= 12;
  return `<div class="heat-wrap"><table class="heat ${d.compact ? 'compact' : ''}">
    <thead><tr><th></th>${d.cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map((r, i) => `<tr><th>${esc(r)}</th>${d.cells[i].map((x) => `<td style="${shade(x.v)}" title="${esc(x.title)}">${showNums && x.v ? money(x.v, { compact: true }) : ''}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>
  <div class="heat-legend"><span>Less</span>${[0.12, 0.35, 0.6, 0.85, 1].map((t) => `<i style="background:${hexA(hue, t)}"></i>`).join('')}<span>More</span><span class="ml-auto">Highest: ${money(max)}</span></div></div>`;
}
function tableHTML(d, unit) {
  if (d.cells) {
    return `<div class="overflow-x-auto"><table class="sched"><thead><tr><th></th>${d.cols.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r, i) => `<tr><td>${esc(r)}</td>${d.cells[i].map((x) => `<td>${x.v ? fmtVal(x.v, 'money') : x.v === null ? '' : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  const showTotal = unit !== 'pct';
  return `<div class="overflow-x-auto chart-table"><table class="sched">
    <thead><tr><th></th>${d.series.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead>
    <tbody>${d.labels.map((l, i) => `<tr><td><span class="sw-dot" style="background:${colorFor(l)}"></span>${esc(l)}</td>${d.series.map((s) => `<td>${s.data[i] === null ? '' : fmtVal(s.data[i], unit)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${showTotal ? `<tfoot><tr><td>Total</td>${d.series.map((s) => `<td>${fmtVal(s.data.reduce((a, x) => a + num(x), 0), unit)}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div>`;
}
function kpiHTML(d, c, v) {
  const unit = v.unit || 'money';
  const hue = c.color || '#0A6FB0';
  const s = d.series[d.series.length > 1 && v.shape === 'cat2' ? 1 : 0];
  let big, sub = '';
  if (v.shape === 'series') {
    const vals = s.data.filter((x) => x !== null);
    const last = vals[vals.length - 1] ?? 0, prev = vals[vals.length - 2];
    const isRunning = /running total|at each month end|rate/i.test(v.label);
    big = isRunning || unit === 'pct' ? last : vals.reduce((a, x) => a + num(x), 0);
    const label = isRunning || unit === 'pct' ? `Latest (${d.labels[s.data.lastIndexOf(last)] || ''})` : `Total over ${vals.length} ${vals.length === 1 ? 'month' : 'months'}`;
    const change = prev !== undefined && prev !== 0 ? ((last - prev) / Math.abs(prev)) * 100 : null;
    sub = `<div class="kpi-sub">${esc(label)}${change !== null ? `<span class="kpi-chg ${change >= 0 ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${change >= 0 ? 'up' : 'down'}"></i> ${Math.abs(Math.round(change))}% vs previous</span>` : ''}</div>`;
  } else {
    big = unit === 'pct' ? s.data.reduce((a, x) => a + num(x), 0) / (s.data.length || 1) : s.data.reduce((a, x) => a + num(x), 0);
    const topI = s.data.reduce((bi, x, i, arr) => (Math.abs(x) > Math.abs(arr[bi]) ? i : bi), 0);
    sub = `<div class="kpi-sub">${unit === 'pct' ? 'Average' : 'Total'} of ${d.labels.length} item${d.labels.length === 1 ? '' : 's'}. Largest: <b>${esc(d.labels[topI])}</b> ${fmtVal(s.data[topI], unit)}</div>`;
  }
  return `<div class="kpi" style="--kpi:${hue}"><div class="kpi-num num">${fmtVal(big, unit)}</div>${sub}</div>`;
}
function progressHTML(d, v) {
  const two = d.series.length > 1;
  const rows = d.labels.map((l, i) => {
    const target = two ? num(d.series[0].data[i]) : 100;
    const actual = two ? num(d.series[1].data[i]) : num(d.series[0].data[i]);
    const p = target > 0 ? (actual / target) * 100 : 0;
    const col = p > 100 ? '#E0306E' : p >= 80 ? '#F59E0B' : colorFor(l);
    return `<div><div class="flex justify-between text-sm mb-1 gap-2"><span class="font-medium truncate">${esc(l)}</span>
      <span class="num text-ink-2 whitespace-nowrap">${two ? `${fmtVal(actual, v.unit)} of ${fmtVal(target, v.unit)}` : ''} <b>${Math.round(p)}%</b></span></div>
      <div class="bar"><span style="width:${Math.min(100, p)}%;background:${col}"></span></div></div>`;
  });
  return `<div class="space-y-3 py-1">${rows.join('')}</div>`;
}
/** Squarified treemap drawn with positioned boxes. */
function treemapHTML(d, c, unit) {
  const items = d.labels.map((l, i) => ({ l, v: Math.abs(num(d.series[0].data[i])) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((s, x) => s + x.v, 0) || 1;
  const rects = [];
  const layout = (list, x, y, w, h) => {
    if (!list.length) return;
    if (list.length === 1) { rects.push({ ...list[0], x, y, w, h }); return; }
    const sum = list.reduce((s, it) => s + it.v, 0);
    let acc = 0, k = 0;
    while (k < list.length - 1 && (acc + list[k].v) / sum <= 0.5) acc += list[k++].v;
    if (k === 0) { acc = list[0].v; k = 1; }
    const f = acc / sum;
    if (w >= h) { layout(list.slice(0, k), x, y, w * f, h); layout(list.slice(k), x + w * f, y, w * (1 - f), h); }
    else { layout(list.slice(0, k), x, y, w, h * f); layout(list.slice(k), x, y + h * f, w, h * (1 - f)); }
  };
  layout(items, 0, 0, 100, 100);
  const mode = c.labels || 'value';
  return `<div class="treemap">${rects.map((r) => {
    const share = `${Math.round((r.v / total) * 100)}%`;
    const val = mode === 'percent' ? share : mode === 'both' ? `${fmtVal(r.v, unit, true)} · ${share}` : fmtVal(r.v, unit, true);
    return `<div class="tm-cell" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%;background:${colorFor(r.l)}" title="${esc(r.l)}: ${esc(fmtVal(r.v, unit))} (${share})">
      ${r.w * r.h > 60 ? `<span class="tm-label">${esc(r.l)}</span>${mode !== 'none' ? `<span class="tm-val num">${esc(val)}</span>` : ''}` : ''}</div>`;
  }).join('')}</div>`;
}

/* ----- Cards on the dashboard and the Charts page ----- */
const sortedCharts = () => db.charts.slice().sort((a, b) => (num(a.order) - num(b.order)) || (a.createdAt || '').localeCompare(b.createdAt || ''));
const chartInstances = new Map();
function chartSubtitle(c) {
  const e = effectiveChart(c), v = CHART_VALUES[c.value];
  return [CHART_TYPES[c.type]?.label, v?.period ? periodLabel(e.period) : v?.label?.includes('This month vs') ? '' : 'Today'].filter(Boolean).join(', ');
}
function filterControls(c) {
  const v = CHART_VALUES[c.value] || {};
  const kinds = (c.filters || []).filter((k) => supportedFilters(v).includes(k));
  const st = chartFilterState[c.id] || {};
  return kinds.map((k) => `<select class="chart-filter" data-chart-filter="${k}" data-id="${c.id}" aria-label="${FILTER_KINDS[k].label}">
    ${filterOptions(k).map(([val, lab]) => `<option value="${esc(val)}" ${(k === 'period' ? st.period || c.period : st[k] || '') === val ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
  </select>`).join('');
}
function chartCard(c, where) {
  const i = sortedCharts().findIndex((x) => x.id === c.id);
  const filters = filterControls(c);
  return `<section class="panel p-5 ${c.size === 'full' ? 'lg:col-span-2' : ''}">
    <div class="panel-head flex-nowrap items-start">
      <div class="min-w-0 flex-1"><h2 class="panel-title chart-title" title="${esc(c.title || defaultTitle(c))}">${esc(c.title || defaultTitle(c))}</h2>
        <div class="text-xs text-ink-3 mt-0.5" data-chart-sub="${c.id}">${esc(chartSubtitle(c))}</div></div>
      <div class="flex gap-0.5 flex-none">
        ${where === 'page' ? `<button class="icon-btn sm" data-action="chart-move" data-id="${c.id}" data-dir="-1" title="Move earlier" aria-label="Move chart earlier" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
          <button class="icon-btn sm" data-action="chart-move" data-id="${c.id}" data-dir="1" title="Move later" aria-label="Move chart later"><i class="fa-solid fa-arrow-down"></i></button>` : ''}
        <button class="icon-btn sm ${c.pinned ? 'pinned' : ''}" data-action="chart-pin" data-id="${c.id}" title="${c.pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}" aria-label="${c.pinned ? 'Unpin' : 'Pin'} chart"><i class="fa-solid fa-thumbtack"></i></button>
        <button class="icon-btn sm" data-action="chart-edit" data-id="${c.id}" title="Edit" aria-label="Edit chart"><i class="fa-regular fa-pen-to-square"></i></button>
      </div>
    </div>
    ${filters ? `<div class="chart-filters">${filters}</div>` : ''}
    <div class="chart-box" data-chart-id="${c.id}"></div>
  </section>`;
}
function drawOneCard(box) {
  const c = db.charts.find((x) => x.id === box.dataset.chartId);
  if (!c) return;
  const old = chartInstances.get(c.id);
  if (old) { old.destroy(); charts = charts.filter((x) => x !== old); chartInstances.delete(c.id); }
  const inst = drawChartInto(box, effectiveChart(c));
  if (inst) { charts.push(inst); chartInstances.set(c.id, inst); }
}
function drawChartCards() {
  chartInstances.clear();
  $$('[data-chart-id]').forEach(drawOneCard);
}
/** A filter on a chart changed: remember it on this device and redraw just that chart. */
function onChartFilter(el) {
  const id = el.dataset.id, kind = el.dataset.chartFilter;
  chartFilterState[id] = { ...(chartFilterState[id] || {}), [kind]: el.value };
  writeLS(CHART_FILTER_KEY, chartFilterState);
  const c = db.charts.find((x) => x.id === id);
  const sub = $(`[data-chart-sub="${id}"]`);
  if (c && sub) sub.textContent = chartSubtitle(c);
  const box = $(`[data-chart-id="${id}"]`);
  if (box) drawOneCard(box);
}
function pinnedChartsSection() {
  const pinned = sortedCharts().filter((c) => c.pinned);
  return `<div class="flex items-center justify-between gap-3 mt-8 mb-3">
      <h2 class="display text-xl font-semibold">Your charts</h2>
      <div class="flex gap-2"><a class="btn btn-sm" href="#charts"><i class="fa-solid fa-chart-simple"></i> All charts</a>
      <button class="btn btn-sm btn-primary" data-action="chart-new"><i class="fa-solid fa-plus"></i> New chart</button></div>
    </div>
    ${pinned.length ? `<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">${pinned.map((c) => chartCard(c, 'dash')).join('')}</div>`
      : `<section class="panel">${emptyState('fa-chart-simple', 'Build your own charts: pick a chart type and what it should show, then pin it here.', '<button class="btn btn-primary" data-action="chart-new"><i class="fa-solid fa-plus"></i> Make a chart</button>')}</section>`}`;
}
function renderCharts() {
  const list = sortedCharts();
  return `<div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Make as many charts as you like. Pinned charts <i class="fa-solid fa-thumbtack text-xs"></i> show on the dashboard for everyone who opens the app; unpinned ones stay here.</p>
      <button class="btn btn-primary" data-action="chart-new"><i class="fa-solid fa-plus"></i> New chart</button>
    </div>
    ${list.length ? `<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">${list.map((c) => chartCard(c, 'page')).join('')}</div>`
      : `<section class="panel">${emptyState('fa-chart-simple', 'No charts yet.', '<button class="btn btn-primary" data-action="chart-new"><i class="fa-solid fa-plus"></i> Make your first chart</button>')}</section>`}`;
}

/* ----- Builder ----- */
let previewChart = null;
function openChartBuilder(existing) {
  const isNew = !existing;
  const c = existing ? { ...existing } : { type: 'bar', value: 'cashflow', period: 'last_6', top: 8, size: 'half', pinned: true, labels: 'value', filters: ['period'] };
  colorDraft = {};
  const typeTiles = Object.entries(CHART_TYPES).map(([k, t]) => `
    <input type="radio" name="type" id="ct_${k}" value="${k}" ${k === c.type ? 'checked' : ''}>
    <label for="ct_${k}"><i class="fa-solid ${t.icon}"></i><span>${t.label}</span></label>`).join('');
  const body = `
    <div><span class="lbl">1. Type of chart</span><div class="type-grid">${typeTiles}</div></div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      ${field('2. What it shows', `<select class="inp" name="value" data-values></select>`)}
      <div data-period>${field('Period', select('period', PERIODS, c.period || 'last_6'))}</div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div data-top>${field('Show the biggest', select('top', [['5', 'Top 5'], ['8', 'Top 8'], ['10', 'Top 10'], ['15', 'Top 15'], ['0', 'All']], String(c.top ?? 8)))}</div>
      <div data-labels>${field('Data labels', select('labels', [['value', 'Show values'], ['percent', 'Show % of total'], ['both', 'Values and %'], ['none', 'No labels']], c.labels || 'value'))}</div>
      ${field('Size on the dashboard', select('size', [['half', 'Half width'], ['full', 'Full width']], c.size || 'half'))}
    </div>
    <div data-filters><span class="lbl">3. Filters on the chart <span class="font-normal text-ink-3">(appear at its top right, so you can switch without editing)</span></span><div class="filter-picks"></div></div>
    <div><span class="lbl">4. Colours <span class="font-normal text-ink-3">(a colour you pick is used for that item in every chart)</span></span><div class="color-picks" data-colors></div></div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
      ${field('Title', input('title', c.title || '', 'maxlength="80" placeholder="Automatic"'))}
      ${checkbox('pinned', c.pinned !== false, 'Pin to the dashboard', 'Shows on the dashboard every time the app is opened, on any device.')}
    </div>
    <div><span class="lbl">Preview</span><div class="chart-box preview" id="chartPreview"></div></div>`;
  let singleColor = c.color || '';
  openModal({
    title: isNew ? 'New chart' : 'Edit chart',
    wide: true,
    body,
    submitLabel: isNew ? 'Save chart' : 'Save changes',
    onOpen: (form) => {
      const sel = $('[data-values]', form);
      const sig = { signal: modalSignal() };
      const pickedFilters = new Set(c.filters || []);
      const current = () => ({
        id: c.id || '__preview', type: form.elements.type.value, value: sel.value, period: form.elements.period.value,
        top: int(form.elements.top.value), size: form.elements.size.value, title: form.elements.title.value.trim(),
        labels: form.elements.labels.value, color: singleColor, filters: [...pickedFilters], flt: {},
      });
      const fillValues = () => {
        const opts = valuesFor(form.elements.type.value);
        const keep = opts.some(([k]) => k === sel.value) ? sel.value : opts.some(([k]) => k === c.value) ? c.value : opts[0][0];
        const groups = [...new Set(opts.map(([, v]) => v.group))];
        sel.innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">${opts.filter(([, v]) => v.group === g).map(([k, v]) => `<option value="${k}" ${k === keep ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</optgroup>`).join('');
      };
      const fillFilters = () => {
        const kinds = supportedFilters(CHART_VALUES[sel.value]);
        $('[data-filters]', form).hidden = !kinds.length;
        $('.filter-picks', form).innerHTML = kinds.map((k) => `<label class="check-chip"><input type="checkbox" data-fpick="${k}" ${pickedFilters.has(k) ? 'checked' : ''}> ${FILTER_KINDS[k].label}</label>`).join('');
      };
      const fillColors = (cur) => {
        const box = $('[data-colors]', form);
        const T = CHART_TYPES[cur.type];
        const v = CHART_VALUES[cur.value];
        if (T.oneColor) {
          box.innerHTML = `<label class="color-pick"><input type="color" data-one value="${singleColor || (cur.type === 'heatmap' ? '#D6245F' : '#0A6FB0')}"> Chart colour</label>`;
          return;
        }
        if (cur.type === 'waterfall' || v.signed) { box.innerHTML = '<p class="hint">This chart colours rises green and falls pink.</p>'; return; }
        const d = chartData(cur);
        if (!d || d.cells) { box.innerHTML = ''; return; }
        const names = (v.shape === 'cat' && d.series.length === 1 ? d.labels : d.series.map((s) => s.name)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 24);
        box.innerHTML = names.map((n) => `<label class="color-pick"><input type="color" data-color-for="${esc(n)}" value="${colorFor(n)}"> ${esc(n)}
          ${db.settings.colors?.[n] || colorDraft[n] ? `<button type="button" class="link text-xs" data-reset-color="${esc(n)}">reset</button>` : ''}</label>`).join('') || '<p class="hint">Nothing to colour yet.</p>';
      };
      const preview = (withColors = true) => {
        const cur = current();
        const v = CHART_VALUES[cur.value];
        const T = CHART_TYPES[cur.type];
        $('[data-period]', form).hidden = !v.period;
        $('[data-top]', form).hidden = !v.top;
        $('[data-labels]', form).hidden = ['kpi', 'table', 'progress'].includes(cur.type);
        form.elements.title.placeholder = defaultTitle(cur);
        if (previewChart) { previewChart.destroy(); previewChart = null; }
        const box = $('#chartPreview');
        box.classList.toggle('is-heat', cur.type === 'heatmap');
        previewChart = drawChartInto(box, cur);
        if (withColors) fillColors(cur);
        void T;
      };
      fillValues(); fillFilters(); preview();
      form.addEventListener('change', (e) => {
        const n = e.target.name;
        if (n === 'type') { fillValues(); fillFilters(); }
        if (n === 'value') fillFilters();
        if (e.target.dataset.fpick) { e.target.checked ? pickedFilters.add(e.target.dataset.fpick) : pickedFilters.delete(e.target.dataset.fpick); return; }
        if (['type', 'value', 'period', 'top', 'labels'].includes(n)) preview();
      }, sig);
      form.addEventListener('input', (e) => {
        if (e.target.name === 'title') form.elements.title.placeholder = defaultTitle(current());
        if (e.target.dataset.colorFor !== undefined) { colorDraft[e.target.dataset.colorFor] = e.target.value; preview(false); }
        if (e.target.dataset.one !== undefined) { singleColor = e.target.value; preview(false); }
      }, sig);
      form.addEventListener('click', (e) => {
        const r = e.target.closest('[data-reset-color]');
        if (!r) return;
        colorDraft[r.dataset.resetColor] = null;
        preview();
      }, sig);
    },
    onSubmit: (d) => {
      if (previewChart) { previewChart.destroy(); previewChart = null; }
      const form = $('#modalForm');
      const filters = [...form.querySelectorAll('[data-fpick]')].filter((x) => x.checked).map((x) => x.dataset.fpick);
      const maxOrder = Math.max(0, ...db.charts.map((x) => num(x.order)));
      const rec = {
        ...(existing || {}), id: existing?.id || uid('chart'),
        type: d.type, value: d.value, period: d.period || 'last_6', top: int(d.top), size: d.size,
        title: (d.title || '').trim(), pinned: !!d.pinned, order: existing?.order ?? maxOrder + 1,
        labels: d.labels || 'value', filters, color: CHART_TYPES[d.type].oneColor ? singleColor : existing?.color || '',
      };
      const ops = [opUpsert('charts', rec)];
      const draft = colorDraft || {};
      colorDraft = null;
      if (Object.keys(draft).length) {
        const colors = { ...(db.settings.colors || {}) };
        for (const [k, val] of Object.entries(draft)) { if (val) colors[k] = val; else delete colors[k]; }
        ops.push(opSettings({ colors }));
      }
      commit(ops, `${isNew ? 'Add' : 'Edit'} chart ${rec.title || defaultTitle(rec)}`);
      toast(rec.pinned ? 'Chart saved and pinned to the dashboard' : 'Chart saved', 'success');
    },
    onDelete: existing ? () => {
      if (!confirm('Delete this chart? Your data is not affected.')) return false;
      if (previewChart) { previewChart.destroy(); previewChart = null; }
      colorDraft = null;
      commit([opDelete('charts', existing.id)], 'Delete chart');
      toast('Chart deleted');
    } : null,
  });
}
function toggleChartPin(id) {
  const c = db.charts.find((x) => x.id === id);
  if (!c) return;
  commit([opUpsert('charts', { ...c, pinned: !c.pinned })], `${c.pinned ? 'Unpin' : 'Pin'} chart`);
  toast(c.pinned ? 'Unpinned from the dashboard' : 'Pinned to the dashboard');
}
function moveChart(id, dir) {
  const list = sortedCharts();
  const i = list.findIndex((x) => x.id === id), j = i + int(dir);
  if (i < 0 || j < 0 || j >= list.length) return;
  const next = list.map((x, k) => ({ ...x, order: k + 1 }));
  [next[i].order, next[j].order] = [next[j].order, next[i].order];
  commit(next.filter((x, k) => x.order !== num(list[k].order)).map((x) => opUpsert('charts', x)), 'Reorder charts');
}

/* ===== People: money lent / borrowed, and home expenses to take back =====
   Each person is an account of type 'person'. Money you give them is a
   transfer from your account to theirs; money they give you is a transfer
   back. Their balance above zero means they owe you; below zero, you owe them.
   A "home expense" is an expense you paid that someone (e.g. Dad) will pay
   back: it is stored as a transfer to that person with forHome: true, so it
   isn't counted as your own spending, and it stays on the Home expenses list
   until you mark it as taken back (homeSettled). */
const peopleList = () => db.accounts.filter((a) => a.type === 'person').sort((a, b) => (a.archived - b.archived) || a.name.localeCompare(b.name));
function newPersonRecord(name, opening = 0, date = todayStr()) {
  return { id: uid('acc'), name, type: 'person', subtype: 'Person', institution: '', last4: '', openingBalance: round2(opening), openingDate: date,
    creditLimit: null, statementDay: null, dueDay: null, interestRate: null, maturityDate: '', notes: '', archived: false };
}
function defaultClaimPerson() {
  const list = peopleList().filter((a) => !a.archived);
  const recent = sortTxns(db.transactions.filter((t) => t.forHome))[0];
  return recent?.toAccountId || (list.find((a) => /dad|papa|father|pappa|baba/i.test(a.name)) || list[0])?.id || '__new';
}
const homeClaims = (personId) => db.transactions.filter((t) => t.forHome && (!personId || t.toAccountId === personId));
const pendingHome = (personId) => homeClaims(personId).filter((t) => !t.homeSettled);
function personLine(bal) {
  if (Math.abs(bal) < 0.5) return { text: 'All settled', cls: 'text-ink-3' };
  return bal > 0 ? { text: `Owes you ${money(bal)}`, cls: 'text-gain' } : { text: `You owe ${money(-bal)}`, cls: 'text-loss' };
}
function avatar(name) {
  const initials = String(name).trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return `<span class="avatar" style="background:${colorFor(name)}">${esc(initials)}</span>`;
}

function renderPeople() {
  const ppl = peopleList();
  const pend = pendingHome();
  const pendTotal = pend.reduce((s, t) => s + num(t.amount), 0);
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Money you lend or borrow, with family and friends, and home expenses you'll take back. Balances count in your net worth.</p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn" data-action="person-add"><i class="fa-solid fa-user-plus"></i> Add person</button>
        <button class="btn" data-action="split-new"><i class="fa-solid fa-people-arrows"></i> Split a bill</button>
        <button class="btn btn-primary" data-action="add-txn" data-type="expense" data-home="1"><i class="fa-solid fa-house"></i> Add home expense</button>
      </div>
    </div>
    <section class="panel p-5 mb-6"><dl class="kv">
      <div><dt>People owe me</dt><dd class="text-lg text-gain">${money(M.T.owedToMe)}</dd></div>
      <div><dt>I owe people</dt><dd class="text-lg text-loss">${money(M.T.iOwe)}</dd></div>
      <div><dt>Home expenses to take back</dt><dd class="text-lg">${money(pendTotal)}</dd></div>
    </dl></section>

    ${ppl.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">${ppl.map((p) => {
      const bal = M.balances.get(p.id) || 0, l = personLine(bal), ph = pendingHome(p.id);
      return `<section class="panel p-5 ${p.archived ? 'opacity-60' : ''}">
        <div class="flex items-center gap-3">${avatar(p.name)}
          <div class="min-w-0 flex-1"><div class="font-semibold truncate">${esc(p.name)}</div><div class="text-sm font-semibold num ${l.cls}">${l.text}</div></div>
          <button class="icon-btn sm" data-action="person-edit" data-id="${p.id}" title="Edit" aria-label="Edit ${esc(p.name)}"><i class="fa-regular fa-pen-to-square"></i></button></div>
        ${ph.length ? `<div class="text-xs text-ink-2 mt-3"><i class="fa-solid fa-house mr-1" style="color:var(--violet)"></i>${ph.length} home expense${ph.length === 1 ? '' : 's'} to take back: <b class="num">${money(ph.reduce((s, t) => s + num(t.amount), 0))}</b> (already counted in the balance above)</div>` : ''}
        <div class="grid grid-cols-2 gap-2 mt-4">
          <button class="btn btn-sm" data-action="person-money" data-id="${p.id}" data-dir="out"><i class="fa-solid fa-arrow-up"></i> I gave</button>
          <button class="btn btn-sm" data-action="person-money" data-id="${p.id}" data-dir="in"><i class="fa-solid fa-arrow-down"></i> I got</button>
        </div>
        <button class="link text-sm mt-3" data-action="person-history" data-id="${p.id}">History</button>
      </section>`;
    }).join('')}</div>`
    : `<section class="panel mb-6">${emptyState('fa-user-group', 'Add the people you share money with, like Dad or a friend.', '<button class="btn btn-primary" data-action="person-add"><i class="fa-solid fa-user-plus"></i> Add person</button>')}</section>`}

    <section class="panel p-5">
      <div class="panel-head"><div><h2 class="panel-title"><i class="fa-solid fa-house mr-1.5" style="color:var(--violet)"></i>Home expenses to take back</h2>
        <div class="text-xs text-ink-3 mt-0.5">Mark an expense "Paid for home" when you add it. Tick the ones you've been paid for.</div></div>
        ${pend.length ? '<button class="btn btn-sm btn-primary" data-action="home-settle">Mark ticked as taken back</button>' : ''}</div>
      ${pend.length ? `<div class="divider">${sortTxns(pend).map((t) => `<label class="row cursor-pointer">
          <input type="checkbox" class="home-pick" value="${t.id}" checked style="accent-color:var(--royal);width:1.05rem;height:1.05rem">
          <div class="min-w-0 flex-1"><div class="font-medium truncate">${esc(t.description || t.category)}</div>
            <div class="text-xs text-ink-3 mt-0.5">${fmtDate(t.date)}, ${esc(t.category)}, paid from ${esc(accountName(t.fromAccountId))}, to take back from ${esc(accountName(t.toAccountId))}</div></div>
          <div class="num font-semibold">${money(t.amount)}</div>
          <button type="button" class="icon-btn sm" data-action="edit-txn" data-id="${t.id}" aria-label="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
        </label>`).join('')}
        <div class="row font-semibold"><div class="flex-1">Total</div><div class="num">${money(pendTotal)}</div><div class="w-8"></div></div></div>`
        : emptyState('fa-house', 'Nothing to take back right now.')}
      ${homeClaims().some((t) => t.homeSettled) ? `<details class="mt-4"><summary class="text-sm link cursor-pointer">Taken back earlier</summary>
        <div class="divider mt-2">${sortTxns(homeClaims().filter((t) => t.homeSettled)).slice(0, 25).map((t) => `<div class="row text-sm">
          <div class="min-w-0 flex-1">${esc(t.description || t.category)} <span class="text-ink-3">${fmtDate(t.date)}</span></div>
          <div class="num">${money(t.amount)}</div><span class="pill in">Taken back ${t.settledOn ? fmtDate(t.settledOn) : ''}</span>
          <button class="link text-xs" data-action="home-unsettle" data-id="${t.id}">Undo</button></div>`).join('')}</div></details>` : ''}
    </section>
    ${splitsSection()}`;
}

function openPersonForm(existing) {
  const isNew = !existing;
  const p = existing ? { ...existing } : { openingBalance: 0, openingDate: todayStr() };
  const ob = num(p.openingBalance);
  openModal({
    title: isNew ? 'Add person' : `Edit ${p.name}`,
    body: `${field('Name', input('name', p.name, 'required maxlength="60" placeholder="e.g. Dad, Rahul"'))}
      <div><span class="lbl">Right now</span>
        <div class="seg">${[['none', 'We are settled'], ['they', 'They owe me'], ['me', 'I owe them']].map(([v, l]) => `<input type="radio" name="dir" id="pd_${v}" value="${v}" ${(ob > 0 ? 'they' : ob < 0 ? 'me' : 'none') === v ? 'checked' : ''}><label for="pd_${v}">${l}</label>`).join('')}</div></div>
      ${showFor('they me', twoCol(field('How much', moneyInput('amount', Math.abs(ob) || '', 'min="0"')), field('As on', input('openingDate', p.openingDate, 'type="date"'))))}
      ${isNew ? '' : checkbox('archived', p.archived, 'Hide (archive)', 'Keeps their history but hides them from lists.')}
      ${field('Notes (optional)', textarea('notes', p.notes, 'rows="2"'))}`,
    submitLabel: isNew ? 'Add person' : 'Save',
    onOpen: (form) => bindShowHide(form, 'dir'),
    onSubmit: (d) => {
      const amt = d.dir === 'none' ? 0 : round2(num(d.amount)) * (d.dir === 'me' ? -1 : 1);
      const rec = existing ? { ...existing, name: d.name.trim(), openingBalance: amt, openingDate: d.openingDate || existing.openingDate || todayStr(), archived: !!d.archived, notes: d.notes || '' }
        : { ...newPersonRecord(d.name.trim(), amt, d.openingDate || todayStr()), notes: d.notes || '' };
      commit([opUpsert('accounts', rec)], `${isNew ? 'Add' : 'Edit'} person ${rec.name}`);
      toast(isNew ? `${rec.name} added` : 'Saved', 'success');
    },
    onDelete: existing ? () => {
      const used = db.transactions.some((t) => t.fromAccountId === p.id || t.toAccountId === p.id);
      if (used) { toast('They have history. Tick "Hide (archive)" instead.', 'error'); return false; }
      if (!confirm(`Delete ${p.name}?`)) return false;
      commit([opDelete('accounts', p.id)], `Delete person ${p.name}`);
    } : null,
  });
}

/** Money between you and a person. dir 'out' = you gave, 'in' = you received. */
function openPersonMoney(personId, dir) {
  const p = accountById(personId);
  if (!p) return;
  const bal = M.balances.get(p.id) || 0;
  const kinds = dir === 'out'
    ? [['lent', `Lent / gave money to ${p.name}`], ['repaid', `Paid back what I owed ${p.name}`]]
    : [['borrowed', `Borrowed / took money from ${p.name}`], ['gotback', `${p.name} paid me back`]];
  const guess = dir === 'out' ? (bal < 0 ? 'repaid' : 'lent') : (bal > 0 ? 'gotback' : 'borrowed');
  openModal({
    title: dir === 'out' ? `Money I gave ${p.name}` : `Money I got from ${p.name}`,
    body: `${field('What was it?', select('what', kinds, guess))}
      ${twoCol(field('Amount', moneyInput('amount', '', 'required min="0.01"')), field('Date', input('date', todayStr(), 'type="date" required')))}
      ${field(dir === 'out' ? 'From my' : 'Into my', accountSelect('acc', firstAccountOf(['bank', 'cash']), { types: ['cash', 'bank', 'credit_card'] }))}
      ${field('Note (optional)', input('description', '', 'maxlength="120" placeholder="e.g. for college fees"'))}
      <p class="hint">${esc(p.name)}: ${personLine(bal).text.toLowerCase()} right now.</p>`,
    submitLabel: 'Save',
    onSubmit: (d) => {
      const amount = round2(num(d.amount));
      if (amount <= 0) { toast('Enter an amount.', 'error'); return false; }
      const label = { lent: 'Lent', repaid: 'Repaid', borrowed: 'Borrowed', gotback: 'Got back' }[d.what];
      const rec = { id: uid('txn'), date: d.date, type: 'transfer', amount, category: label,
        description: d.description || `${label} ${dir === 'out' ? 'to' : 'from'} ${p.name}`,
        fromAccountId: dir === 'out' ? d.acc : p.id, toAccountId: dir === 'out' ? p.id : d.acc, relatedType: 'person', relatedId: p.id, notes: '' };
      commit([opUpsert('transactions', rec)], `${label} ${money(amount)} ${dir === 'out' ? 'to' : 'from'} ${p.name}`);
      const after = (M.balances.get(p.id) || 0);
      toast(`${p.name}: ${personLine(after).text.toLowerCase()}`, 'success');
    },
  });
}

function openPersonHistory(personId) {
  const p = accountById(personId);
  if (!p) return;
  const list = sortTxns(db.transactions.filter((t) => t.fromAccountId === p.id || t.toAccountId === p.id));
  let run = M.balances.get(p.id) || 0;
  const rows = list.map((t) => {
    const signed = t.toAccountId === p.id ? num(t.amount) : -num(t.amount);
    const r = `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.forHome ? `Home: ${t.description || t.category}` : t.description || t.category)}${t.forHome ? ` <span class="pill ${t.homeSettled ? 'in' : 'due'}">${t.homeSettled ? 'taken back' : 'to take back'}</span>` : ''}</td>
      <td class="${signed > 0 ? 'text-gain' : 'text-loss'}">${signed > 0 ? '+' : '−'}${money(Math.abs(signed))}</td><td>${money(run)}</td></tr>`;
    run -= signed;
    return r;
  });
  openModal({
    title: `${p.name}: history`,
    wide: true,
    body: `<p class="text-sm mb-3"><b class="${personLine(M.balances.get(p.id) || 0).cls}">${personLine(M.balances.get(p.id) || 0).text}</b>. <span class="text-ink-3">+ means they owe you more, − means less.</span></p>
      <div class="overflow-x-auto"><table class="sched"><thead><tr><th>Date</th><th>What</th><th>Change</th><th>Balance after</th></tr></thead>
      <tbody>${rows.join('')}<tr class="done"><td>${fmtDate(p.openingDate)}</td><td>Starting balance</td><td></td><td>${money(p.openingBalance)}</td></tr></tbody></table></div>`,
    submitLabel: 'Done', cancelLabel: 'Close', onSubmit: () => {},
  });
}

/** Mark the ticked home expenses as taken back, optionally recording the money received. */
function settleHomeExpenses() {
  const ids = $$('.home-pick').filter((x) => x.checked).map((x) => x.value);
  const list = db.transactions.filter((t) => ids.includes(t.id));
  if (!list.length) { toast('Tick the expenses you were paid back for.'); return; }
  const total = round2(list.reduce((s, t) => s + num(t.amount), 0));
  const who = [...new Set(list.map((t) => t.toAccountId))];
  const person = accountById(who[0]);
  openModal({
    title: `Taken back: ${money(total)}`,
    body: `<p class="text-sm">${list.length} home expense${list.length === 1 ? '' : 's'}${who.length === 1 ? ` from ${esc(person.name)}` : ''}.</p>
      <div class="seg">${[['cash', 'Money was paid to me'], ['adjust', 'Adjust against what I owe']].map(([v, l], i) => `<input type="radio" name="how" id="hs_${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="hs_${v}">${l}</label>`).join('')}</div>
      ${showFor('cash', twoCol(field('Received in', accountSelect('acc', firstAccountOf(['bank', 'cash']), { types: ['bank', 'cash'] })), field('Date', input('date', todayStr(), 'type="date" required'))))}
      ${showFor('adjust', '<p class="hint">No money moves. Use this if you owed them money anyway (for example, you had borrowed from Dad): their balance already nets it off.</p>')}`,
    submitLabel: 'Mark as taken back',
    onOpen: (form) => bindShowHide(form, 'how'),
    onSubmit: (d) => {
      const on = d.how === 'cash' ? d.date : todayStr();
      const ops = list.map((t) => opUpsert('transactions', { ...t, homeSettled: true, settledOn: on }));
      if (d.how === 'cash') {
        for (const pid of who) {
          const amt = round2(list.filter((t) => t.toAccountId === pid).reduce((s, t) => s + num(t.amount), 0));
          ops.push(opUpsert('transactions', { id: uid('txn'), date: d.date, type: 'transfer', amount: amt, category: 'Got back', description: `Home expenses paid back by ${accountName(pid)}`,
            fromAccountId: pid, toAccountId: d.acc, relatedType: 'person', relatedId: pid, notes: `${list.filter((t) => t.toAccountId === pid).length} home expense(s)` }));
        }
      }
      commit(ops, `Home expenses taken back ${money(total)}`);
      toast('Marked as taken back', 'success');
    },
  });
}
function unsettleHome(id) {
  const t = db.transactions.find((x) => x.id === id);
  if (!t) return;
  commit([opUpsert('transactions', { ...t, homeSettled: false, settledOn: '' })], 'Undo taken back');
}

/* ===== Goals and wishlist =====
   goal:     { id, name, icon, target, targetDate, contributions: [{ date, amount, note }],
               linkedAccountIds: [], done }
             Saved so far = money you set aside for it (contributions) + the
             current balance of any linked accounts (e.g. an RD or a fund).
   wishlist: { id, name, price, priority, link, notes, wantBy, status: 'wanted'|'bought', boughtOn, goalId } */
const GOAL_ICONS = [['fa-bullseye', 'Target'], ['fa-shield-heart', 'Emergency fund'], ['fa-plane', 'Travel'], ['fa-motorcycle', 'Bike'], ['fa-car', 'Car'],
  ['fa-house', 'Home'], ['fa-graduation-cap', 'Education'], ['fa-laptop', 'Gadget'], ['fa-ring', 'Wedding'], ['fa-gift', 'Gift'], ['fa-cube', '3D printer / hobby'], ['fa-heart', 'Family']];
function goalSaved(g) {
  const set = (g.contributions || []).reduce((s, c) => s + num(c.amount), 0);
  const linked = (g.linkedAccountIds || []).reduce((s, id) => s + Math.max(0, M.balances.get(id) || 0), 0);
  return round2(set + linked);
}
function monthsBetween(from, to) {
  const a = parseDate(from), b = parseDate(to);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + (b.getDate() >= a.getDate() ? 0 : -1) + 1);
}
function goalStats(g) {
  const saved = goalSaved(g), target = num(g.target), left = Math.max(0, target - saved);
  const pct = target > 0 ? Math.min(1, saved / target) : 0;
  const monthsLeft = g.targetDate ? Math.max(1, monthsBetween(todayStr(), g.targetDate)) : null;
  const perMonth = monthsLeft ? Math.ceil(left / monthsLeft) : null;
  let status = 'none';
  if (g.done || left <= 0) status = 'done';
  else if (g.targetDate && g.targetDate < todayStr()) status = 'late';
  else if (g.targetDate && g.createdAt) {
    const start = g.createdAt.slice(0, 10), total = parseDate(g.targetDate) - parseDate(start), gone = parseDate(todayStr()) - parseDate(start);
    const expected = total > 0 ? target * Math.min(1, gone / total) : target;
    status = saved + 1 >= expected * 0.9 ? 'on' : 'behind';
  }
  return { saved, target, left, pct, monthsLeft, perMonth, status };
}
/** Average money left over in the last 3 full months (what you could save). */
function avgLeftOver(n = 3) {
  const months = lastMonths(addMonths(thisMonth() + '-01', -1).slice(0, 7), n);
  const vals = months.map((m) => monthSummary(m).left);
  return round2(vals.reduce((s, v) => s + v, 0) / (vals.length || 1));
}
const goalColor = (g) => db.settings.colors?.[g.name] || PALETTE[(Math.max(0, db.goals.findIndex((x) => x.id === g.id)) * 7 + 2) % PALETTE.length];
const wishColor = (w) => db.settings.colors?.[w.name] || PALETTE[(Math.max(0, db.wishlist.findIndex((x) => x.id === w.id)) * 7 + 4) % PALETTE.length];
const STATUS_PILL = { on: '<span class="pill in">On track</span>', behind: '<span class="pill due">Behind</span>', late: '<span class="pill out">Past its date</span>', done: '<span class="pill in">Reached</span>', none: '' };

function goalCard(g) {
  const s = goalStats(g);
  return `<section class="panel p-5 ${g.done ? 'opacity-70' : ''}">
    <div class="flex items-start gap-3">
      <span class="goal-icon" style="background:${goalColor(g)}"><i class="fa-solid ${g.icon || 'fa-bullseye'}"></i></span>
      <div class="min-w-0 flex-1"><div class="font-semibold truncate">${esc(g.name)}</div>
        <div class="text-xs text-ink-3 mt-0.5">${g.targetDate ? `by ${fmtDate(g.targetDate)}` : 'No deadline'} ${STATUS_PILL[s.status]}</div></div>
      <button class="icon-btn sm" data-action="goal-edit" data-id="${g.id}" aria-label="Edit goal"><i class="fa-regular fa-pen-to-square"></i></button>
    </div>
    <div class="flex items-baseline justify-between mt-4 gap-2"><span class="display text-2xl font-semibold num">${money(s.saved)}</span><span class="text-sm text-ink-3 num">of ${money(s.target)}</span></div>
    <div class="bar mt-2" style="height:10px"><span style="width:${s.pct * 100}%;background:${goalColor(g)}"></span></div>
    ${(() => { const lag = !g.done && goalLag(g); return lag && lag.behind > 500 ? `<div class="text-xs mt-2 text-loss font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${money(lag.behind)} behind plan.${lag.reason ? ` ${esc(lag.reason)}` : ''}</div>` : ''; })()}
    <div class="text-xs text-ink-2 mt-2">${s.status === 'done' ? 'Goal reached. Well done!' : `${Math.round(s.pct * 100)}% saved, ${money(s.left)} to go${s.perMonth ? `. Save <b class="num">${money(s.perMonth)}</b> a month to make it` : ''}.`}</div>
    ${g.done ? '' : `<div class="flex gap-2 mt-4"><button class="btn btn-sm btn-primary" data-action="goal-add" data-id="${g.id}"><i class="fa-solid fa-plus"></i> Add money</button>
      <button class="btn btn-sm" data-action="goal-add" data-id="${g.id}" data-take="1">Take out</button></div>`}
  </section>`;
}

function renderGoals() {
  const goals = db.goals.slice().sort((a, b) => (a.done - b.done) || (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));
  const cooling = db.wishlist.filter((w) => w.status === 'cooling');
  const wins = savingWins(), winCount = db.wishlist.filter((w) => w.status === 'skipped').length;
  const wants = db.wishlist.filter((w) => !['cooling', 'skipped'].includes(w.status)).sort((a, b) => ((a.status === 'bought') - (b.status === 'bought')) || ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1));
  const avg = avgLeftOver();
  const wantedTotal = wants.filter((w) => w.status !== 'bought').reduce((s, w) => s + num(w.price), 0);
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Save towards things that matter, and keep a list of what you want to buy. The app tells you how much to put aside each month.</p>
      <div class="flex gap-2 flex-wrap"><button class="btn" data-action="cool-new"><i class="fa-solid fa-hourglass-half"></i> I want to buy this</button><button class="btn" data-action="wish-add"><i class="fa-solid fa-plus"></i> Add to wishlist</button>
        <button class="btn btn-primary" data-action="goal-new"><i class="fa-solid fa-bullseye"></i> New goal</button></div>
    </div>
    <h2 class="display text-xl font-semibold mb-3">Goals</h2>
    ${goals.length ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">${goals.map(goalCard).join('')}</div>`
      : `<section class="panel">${emptyState('fa-bullseye', 'No goals yet. Emergency fund, a trip, a bike: set a target and a date.', '<button class="btn btn-primary" data-action="goal-new">Set your first goal</button>')}</section>`}

    <div class="flex items-baseline justify-between gap-3 mt-8 mb-3"><h2 class="display text-xl font-semibold">Cool-off list</h2>${wins ? `<span class="text-sm text-gain font-semibold"><i class="fa-solid fa-trophy mr-1"></i>${winCount} saving win${winCount === 1 ? '' : 's'}: ${money(wins)} kept</span>` : ''}</div>
    ${cooling.length ? `<section class="panel p-5"><div class="divider">${cooling.map((w) => { const left = coolLeft(w); return `<div class="row">
      <span class="goal-icon sm" style="background:${left ? '#94A3B8' : '#12A150'}"><i class="fa-solid ${left ? 'fa-hourglass-half' : 'fa-hourglass-end'}"></i></span>
      <div class="min-w-0 flex-1"><div class="font-medium">${esc(w.name)}</div><div class="text-xs text-ink-3">${left ? `Cooling off: decide in ${left}` : 'Cool-off over: time to decide'} · invested, about ${money(investIllustration(w.price).value)} in ${investIllustration(w.price).years} years</div></div>
      <div class="num font-semibold">${money(w.price)}</div>
      <div class="row-actions">${left ? `<button class="icon-btn sm" data-action="cool-skip" data-id="${w.id}" title="Skip it now" aria-label="Skip it now"><i class="fa-solid fa-trophy"></i></button>` : `<button class="icon-btn sm" data-action="cool-decide" data-id="${w.id}" title="Decide" aria-label="Decide"><i class="fa-solid fa-scale-balanced"></i></button>`}</div></div>`; }).join('')}</div></section>`
      : `<section class="panel p-5"><p class="text-sm text-ink-2">Tempted to buy something? Tap <b>I want to buy this</b> instead of checking out. After a 48-hour cool-off you decide; skipping it counts as a saving win.</p></section>`}

    <div class="flex items-baseline justify-between gap-3 mt-8 mb-3"><h2 class="display text-xl font-semibold">Wishlist</h2>
      ${wantedTotal ? `<span class="text-sm text-ink-3">${money(wantedTotal)} in total${avg > 0 ? `, about ${Math.ceil(wantedTotal / avg)} month${Math.ceil(wantedTotal / avg) > 1 ? 's' : ''} of your usual savings` : ''}</span>` : ''}</div>
    ${wants.length ? `<section class="panel p-5"><div class="divider">${wants.map((w) => wishRow(w, avg)).join('')}</div></section>`
      : `<section class="panel">${emptyState('fa-gift', 'Add things you want to buy, like a 3D printer, with their price.', '<button class="btn btn-primary" data-action="wish-add">Add an item</button>')}</section>`}`;
}
function wishRow(w, avg) {
  const g = w.goalId ? db.goals.find((x) => x.id === w.goalId) : null;
  const gs = g ? goalStats(g) : null;
  const bought = w.status === 'bought';
  const pr = { high: '<span class="pill out">Must have</span>', medium: '<span class="pill">Nice to have</span>', low: '<span class="pill">Someday</span>' }[w.priority] || '';
  let hint = '';
  if (bought) hint = `Bought ${w.boughtOn ? fmtDate(w.boughtOn) : ''}`;
  else if (gs) hint = `${money(gs.saved)} saved of ${money(gs.target)} (${Math.round(gs.pct * 100)}%)`;
  else if (avg > 0) hint = `At your usual ${money(avg)} left over a month: about ${Math.max(1, Math.ceil(num(w.price) / avg))} month${Math.ceil(num(w.price) / avg) > 1 ? 's' : ''}`;
  else hint = 'Log income and expenses to see when you can afford it';
  return `<div class="row ${bought ? 'opacity-60' : ''}">
    <span class="goal-icon sm" style="background:${wishColor(w)}"><i class="fa-solid fa-gift"></i></span>
    <div class="min-w-0 flex-1"><div class="font-medium truncate">${esc(w.name)} ${pr} ${w.link ? `<a class="link text-xs" href="${esc(w.link)}" target="_blank" rel="noopener">link</a>` : ''}</div>
      <div class="text-xs text-ink-3 mt-0.5">${esc(hint)}${w.wantBy && !bought ? `, want it by ${fmtDate(w.wantBy)}` : ''}</div>
      ${gs && !bought ? `<div class="bar mt-1.5" style="max-width:16rem"><span style="width:${gs.pct * 100}%;background:${wishColor(w)}"></span></div>` : ''}</div>
    <div class="num font-semibold">${money(w.price)}</div>
    <div class="row-actions">
      ${bought ? '' : `${g ? '' : `<button class="icon-btn sm" data-action="wish-goal" data-id="${w.id}" title="Start saving for it" aria-label="Start saving"><i class="fa-solid fa-piggy-bank"></i></button>`}
      <button class="icon-btn sm" data-action="wish-buy" data-id="${w.id}" title="Mark as bought" aria-label="Mark as bought"><i class="fa-solid fa-bag-shopping"></i></button>`}
      <button class="icon-btn sm" data-action="wish-edit" data-id="${w.id}" title="Edit" aria-label="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
    </div>
  </div>`;
}

function openGoalForm(existing, preset = {}) {
  const isNew = !existing;
  const g = existing ? { ...existing } : { icon: 'fa-bullseye', contributions: [], linkedAccountIds: [], ...preset };
  const linkable = db.accounts.filter((a) => ['bank', 'investment', 'cash'].includes(a.type) && !a.archived);
  openModal({
    title: isNew ? 'New goal' : `Edit ${g.name}`,
    body: `${field('What are you saving for?', input('name', g.name, 'required maxlength="60" placeholder="e.g. Emergency fund, Goa trip"'))}
      ${twoCol(field('Target amount', moneyInput('target', g.target, 'required min="1"')), field('By when (optional)', input('targetDate', g.targetDate, 'type="date"')))}
      <div><span class="lbl">Icon</span><div class="icon-grid">${GOAL_ICONS.map(([ic, l]) => `<input type="radio" name="icon" id="gi_${ic}" value="${ic}" ${g.icon === ic ? 'checked' : ''}><label for="gi_${ic}" title="${l}"><i class="fa-solid ${ic}"></i></label>`).join('')}</div></div>
      ${isNew ? field('Already saved for it (optional)', moneyInput('startAmount', '', 'min="0" placeholder="0"')) : ''}
      ${linkable.length ? `<div><span class="lbl">Count these accounts towards it (optional)</span><div class="filter-picks">${linkable.map((a) => `<label class="check-chip"><input type="checkbox" name="link_${a.id}" ${(g.linkedAccountIds || []).includes(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>
        <p class="hint">For example an RD or a fund you keep only for this goal. Its whole balance counts.</p></div>` : ''}
      ${isNew ? '' : checkbox('done', g.done, 'Goal finished', 'Keeps it on the page, greyed out.')}`,
    submitLabel: isNew ? 'Create goal' : 'Save',
    onSubmit: (d) => {
      const linked = linkable.filter((a) => d[`link_${a.id}`]).map((a) => a.id);
      const rec = { ...(existing || {}), id: existing?.id || uid('goal'), name: d.name.trim(), target: round2(num(d.target)), targetDate: d.targetDate || '',
        icon: d.icon || 'fa-bullseye', linkedAccountIds: linked, done: !!d.done,
        contributions: existing ? g.contributions || [] : num(d.startAmount) > 0 ? [{ date: todayStr(), amount: round2(num(d.startAmount)), note: 'Already saved' }] : [] };
      const ops = [opUpsert('goals', rec)];
      if (preset.wishId) { const w = db.wishlist.find((x) => x.id === preset.wishId); if (w) ops.push(opUpsert('wishlist', { ...w, goalId: rec.id })); }
      commit(ops, `${isNew ? 'New' : 'Edit'} goal ${rec.name}`);
      toast(isNew ? 'Goal created' : 'Saved', 'success');
    },
    onDelete: existing ? () => {
      if (!confirm(`Delete the goal "${g.name}"? No money moves; it only removes the goal.`)) return false;
      commit([opDelete('goals', g.id), ...db.wishlist.filter((w) => w.goalId === g.id).map((w) => opUpsert('wishlist', { ...w, goalId: '' }))], `Delete goal ${g.name}`);
    } : null,
  });
}
function openGoalMoney(id, take) {
  const g = db.goals.find((x) => x.id === id);
  if (!g) return;
  const s = goalStats(g);
  openModal({
    title: `${take ? 'Take out of' : 'Add to'} ${g.name}`,
    body: `${twoCol(field('Amount', moneyInput('amount', take ? '' : s.perMonth || '', 'required min="0.01"')), field('Date', input('date', todayStr(), 'type="date" required')))}
      ${field('Note (optional)', input('note', '', 'maxlength="80"'))}
      <p class="hint">This sets money aside for the goal; your account balances don't change. To actually move money (into an RD, say), add a transfer too.</p>`,
    submitLabel: take ? 'Take out' : 'Add',
    onSubmit: (d) => {
      const amt = round2(num(d.amount)) * (take ? -1 : 1);
      const rec = { ...g, contributions: [...(g.contributions || []), { date: d.date, amount: amt, note: d.note || '' }] };
      if (!take && goalSaved(rec) >= num(g.target)) rec.done = true;
      commit([opUpsert('goals', rec)], `${take ? 'Take from' : 'Add to'} goal ${g.name}`);
      toast(rec.done && !g.done ? `Goal reached: ${g.name}!` : 'Saved', 'success');
    },
  });
}
function openWishForm(existing) {
  const isNew = !existing;
  const w = existing ? { ...existing } : { priority: 'medium', status: 'wanted' };
  openModal({
    title: isNew ? 'Add to wishlist' : `Edit ${w.name}`,
    body: `${field('What do you want?', input('name', w.name, 'required maxlength="80" placeholder="e.g. 3D printer"'))}
      ${twoCol(field('Price', moneyInput('price', w.price, 'required min="1"')), field('How much do you want it?', select('priority', [['high', 'Must have'], ['medium', 'Nice to have'], ['low', 'Someday']], w.priority)))}
      ${twoCol(field('Want it by (optional)', input('wantBy', w.wantBy, 'type="date"')), field('Link (optional)', input('link', w.link, 'type="url" placeholder="https://"')))}
      ${field('Notes (optional)', textarea('notes', w.notes, 'rows="2" placeholder="Model, where to buy..."'))}`,
    submitLabel: isNew ? 'Add' : 'Save',
    onSubmit: (d) => {
      const rec = { ...(existing || {}), id: existing?.id || uid('wish'), name: d.name.trim(), price: round2(num(d.price)), priority: d.priority, wantBy: d.wantBy || '', link: d.link || '', notes: d.notes || '', status: w.status || 'wanted' };
      commit([opUpsert('wishlist', rec)], `${isNew ? 'Add' : 'Edit'} wishlist ${rec.name}`);
    },
    onDelete: existing ? () => { commit([opDelete('wishlist', w.id)], `Remove ${w.name} from wishlist`); } : null,
  });
}
function wishToGoal(id) {
  const w = db.wishlist.find((x) => x.id === id);
  if (!w) return;
  openGoalForm(null, { name: `Buy ${w.name}`, target: w.price, targetDate: w.wantBy || addMonths(todayStr(), 6), icon: 'fa-gift', wishId: w.id });
}
function wishBought(id) {
  const w = db.wishlist.find((x) => x.id === id);
  if (!w) return;
  const ops = [opUpsert('wishlist', { ...w, status: 'bought', boughtOn: todayStr() })];
  const g = w.goalId && db.goals.find((x) => x.id === w.goalId);
  if (g) ops.push(opUpsert('goals', { ...g, done: true }));
  commit(ops, `Bought ${w.name}`);
  toast(`Nice! Now add what you paid for ${w.name}.`, 'success');
  setTimeout(() => openTxnForm(null, { type: 'expense', amount: w.price, description: w.name, category: 'Shopping' }), 150);
}
function goalsMini() {
  const goals = db.goals.filter((g) => !g.done).slice(0, 3);
  if (!goals.length && !db.wishlist.length) return '';
  return `<section class="panel p-5">
    <div class="panel-head"><h2 class="panel-title">Goals</h2><a href="#goals" class="text-sm link">Open</a></div>
    ${goals.length ? `<div class="space-y-4">${goals.map((g) => { const s = goalStats(g); return `<div>
      <div class="flex justify-between text-sm mb-1 gap-2"><span class="font-medium truncate"><i class="fa-solid ${g.icon || 'fa-bullseye'} mr-1" style="color:${goalColor(g)}"></i>${esc(g.name)}</span><span class="num text-ink-2">${Math.round(s.pct * 100)}%</span></div>
      <div class="bar"><span style="width:${s.pct * 100}%;background:${goalColor(g)}"></span></div>
      <div class="text-xs text-ink-3 mt-1">${money(s.saved)} of ${money(s.target)}${s.perMonth ? `, ${money(s.perMonth)}/month needed` : ''}</div></div>`; }).join('')}</div>`
      : '<p class="text-sm text-ink-3">No active goals.</p>'}
    ${db.wishlist.filter((w) => w.status !== 'bought').length ? `<p class="text-xs text-ink-3 mt-4"><i class="fa-solid fa-gift mr-1"></i>${db.wishlist.filter((w) => w.status !== 'bought').length} on your wishlist</p>` : ''}
  </section>`;
}

/* ===== Insights: a precise monthly report =====
   Everything is compared with your own "usual": the average of the three
   months before the one you're looking at (only months that have data).
   For the current month it also projects where spending will end up:
     spent so far + (everyday spending per day so far x days left)
     + recurring payments and EMIs still due this month. */
let insightMonth = thisMonth();
const pctChange = (cur, base) => (base > 0 ? ((cur - base) / base) * 100 : null);
const fmtPct = (p) => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`;
const isVariable = (t) => t.type === 'expense' && !['subscription', 'emi'].includes(t.relatedType);
const merchantOf = (t) => (t.description || t.category || 'Other').trim().replace(/\s+/g, ' ');
const normMerchant = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(pvt|ltd|private|limited|india|payment|upi|order)\b/g, '').replace(/\s+/g, ' ').trim();

function computeInsights(mk) {
  const today = todayStr();
  const isCurrent = mk === thisMonth();
  const y = +mk.slice(0, 4), m = +mk.slice(5) - 1;
  const dim = daysInMonth(y, m);
  const elapsed = isCurrent ? parseDate(today).getDate() : dim;
  const firstData = [...db.transactions.map((t) => t.date), ...db.accounts.map((a) => a.openingDate)].filter(Boolean).sort()[0]?.slice(0, 7) || mk;
  const base = lastMonths(addMonths(mk + '-01', -1).slice(0, 7), 3).filter((x) => x >= firstData);
  const S = monthSummary(mk);
  const avg = (fn) => (base.length ? base.reduce((s, b) => s + fn(b), 0) / base.length : null);
  const B = base.length ? { spent: avg((b) => monthSummary(b).spent), income: avg((b) => monthSummary(b).income), invested: avg((b) => monthSummary(b).invested), left: avg((b) => monthSummary(b).left) } : null;
  const inMonth = (t, k = mk) => t.date?.startsWith(k);
  const exp = db.transactions.filter((t) => t.type === 'expense' && inMonth(t));
  const byCat = (k) => { const mm = new Map(); for (const t of db.transactions) if (t.type === 'expense' && inMonth(t, k)) mm.set(t.category || 'Other', (mm.get(t.category || 'Other') || 0) + num(t.amount)); return mm; };
  const cur = byCat(mk);
  const baseCats = base.map(byCat);
  const cats = [...new Set([...cur.keys(), ...baseCats.flatMap((x) => [...x.keys()])])].map((c) => {
    const a = cur.get(c) || 0;
    const usual = baseCats.length ? baseCats.reduce((s, x) => s + (x.get(c) || 0), 0) / baseCats.length : 0;
    // For the current month compare with the usual amount *so far* (pro-rated), except fixed costs like rent.
    const fair = isCurrent && !['Rent', 'EMI', 'Subscriptions', 'Insurance', 'Education'].includes(c) ? usual * (elapsed / dim) : usual;
    return { c, cur: round2(a), usual: round2(usual), fair: round2(fair), diff: round2(a - fair), pct: pctChange(a, fair) };
  }).filter((x) => x.cur > 0 || x.usual > 0).sort((a, b) => b.cur - a.cur);

  // Projection for the current month
  let projection = null;
  if (isCurrent && elapsed < dim) {
    const variableSoFar = exp.filter(isVariable).reduce((s, t) => s + num(t.amount), 0);
    const monthEnd = `${mk}-${String(dim).padStart(2, '0')}`;
    const scheduled = db.subscriptions.filter((s) => s.active && recurKind(s) !== 'income' && s.nextRenewal > today && s.nextRenewal <= monthEnd).reduce((s, x) => s + num(x.amount), 0)
      + M.emis.filter(({ c }) => c.status === 'active' && c.nextDue && c.nextDue > today && c.nextDue <= monthEnd).reduce((s, { c }) => s + c.emi, 0);
    const pace = variableSoFar / elapsed;
    projection = { total: round2(S.spent + pace * (dim - elapsed) + scheduled), pace: round2(pace), scheduled: round2(scheduled), monthEnd };
  }

  // Places you spend most, new places, unusual expenses
  const mer = new Map();
  for (const t of exp.filter((x) => isVariable(x) && !['Rent', 'EMI', 'Insurance', 'Education'].includes(x.category))) { const k = normMerchant(merchantOf(t)); const e = mer.get(k) || { name: merchantOf(t), n: 0, amt: 0 }; e.n++; e.amt += num(t.amount); mer.set(k, e); }
  const places = [...mer.values()].sort((a, b) => b.amt - a.amt).slice(0, 5);
  const past6 = lastMonths(addMonths(mk + '-01', -1).slice(0, 7), 6);
  const seenBefore = new Set(db.transactions.filter((t) => t.type === 'expense' && past6.some((p) => inMonth(t, p))).map((t) => normMerchant(merchantOf(t))));
  const newPlaces = [...mer.entries()].filter(([k, v]) => !seenBefore.has(k) && v.amt >= 500 && seenBefore.size).map(([, v]) => v).sort((a, b) => b.amt - a.amt).slice(0, 4);
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const unusual = exp.filter((t) => {
    const hist = db.transactions.filter((x) => x.type === 'expense' && x.category === t.category && past6.some((p) => inMonth(x, p))).map((x) => num(x.amount));
    return hist.length >= 3 && num(t.amount) >= 1000 && num(t.amount) > 3 * median(hist) && !['Rent', 'EMI', 'Insurance'].includes(t.category);
  }).sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 3);
  const biggest = exp.slice().sort((a, b) => num(b.amount) - num(a.amount)).slice(0, 5);

  // Habits
  const dayTotals = new Map();
  for (const t of exp.filter(isVariable)) dayTotals.set(t.date, (dayTotals.get(t.date) || 0) + num(t.amount));
  let weekend = 0, weekday = 0, wkndDays = 0, wkDays = 0;
  for (let d = 1; d <= elapsed; d++) {
    const ds = `${mk}-${String(d).padStart(2, '0')}`, wd = parseDate(ds).getDay();
    if (wd === 0 || wd === 6) { weekend += dayTotals.get(ds) || 0; wkndDays++; } else { weekday += dayTotals.get(ds) || 0; wkDays++; }
  }
  const noSpendDays = Array.from({ length: elapsed }, (_, i) => `${mk}-${String(i + 1).padStart(2, '0')}`).filter((d) => !exp.some((t) => t.date === d)).length;
  const loggedDays = new Set(db.transactions.filter((t) => inMonth(t) && ['expense', 'income', 'transfer'].includes(t.type) && !t.relatedType).map((t) => t.date)).size;
  const atm = db.transactions.filter((t) => inMonth(t) && t.type === 'transfer' && accountById(t.fromAccountId)?.type === 'bank' && accountById(t.toAccountId)?.type === 'cash').reduce((s, t) => s + num(t.amount), 0);
  const card = db.transactions.filter((t) => inMonth(t) && t.type === 'expense' && accountById(t.fromAccountId)?.type === 'credit_card').reduce((s, t) => s + num(t.amount), 0);

  // Fixed costs vs income
  const fixed = db.subscriptions.filter((s) => s.active && recurKind(s) !== 'income').reduce((s, x) => s + num(x.amount) * (FREQUENCIES[x.frequency]?.perMonth || 1), 0)
    + M.emis.filter(({ c }) => c.status === 'active').reduce((s, { c }) => s + c.emi, 0);

  // Regular payments not yet in Recurring: same place in each of the last 3 months, similar amount
  const last3 = lastMonths(mk, 3);
  const known = new Set(db.subscriptions.map((s) => normMerchant(s.name)));
  const recurring = [];
  const groups = new Map();
  for (const t of db.transactions) if (t.type === 'expense' && !t.relatedType && last3.some((p) => inMonth(t, p))) { const k = normMerchant(merchantOf(t)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  for (const [k, list] of groups) {
    if (!k || known.has(k)) continue;
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 3) continue;
    const amts = list.map((t) => num(t.amount)), mid = median(amts);
    if (amts.every((a) => Math.abs(a - mid) <= mid * 0.15) && list.length <= 4) recurring.push({ name: merchantOf(list[0]), amount: mid, category: list[0].category });
  }

  const budgets = db.budgets.map((b) => ({ c: b.category, limit: num(b.monthlyLimit), spent: spendByCategory(mk).find((x) => x.category === b.category)?.amount || 0 }))
    .map((b) => ({ ...b, pct: b.limit ? b.spent / b.limit : 0 })).sort((a, b) => b.pct - a.pct);
  const goalsAdded = db.goals.reduce((s, g) => s + (g.contributions || []).filter((c) => c.date?.startsWith(mk)).reduce((x, c) => x + num(c.amount), 0), 0);
  return { mk, isCurrent, dim, elapsed, base, S, B, cats, projection, places, newPlaces, unusual, biggest, weekend, weekday, wkndDays, wkDays,
    noSpendDays, loggedDays, atm, card, fixed, recurring: recurring.slice(0, 4), budgets, goalsAdded };
}

/** Short, specific sentences with a tone (good, bad or neutral), most important first. */
function insightCards(I) {
  const out = [];
  const add = (tone, icon, title, text, action = '') => out.push({ tone, icon, title, text, action });
  const mName = fmtMonth(I.mk);
  const { S, B } = I;
  if (S.income || S.spent) {
    const k = S.income > 0 ? Math.round(((S.income - S.spent) / S.income) * 100) : null;
    if (k !== null) add(k >= 30 ? 'good' : k >= 10 ? 'neutral' : 'bad', 'fa-piggy-bank', `You kept ${k}% of your income`, `${money(S.income)} came in and ${money(S.spent)} was spent${S.invested ? `; ${money(S.invested)} of what you kept went into investments` : ''}.${B && B.income > 0 ? ` Usually you keep ${Math.round(((B.income - B.spent) / B.income) * 100)}%.` : ''}`);
  }
  if (I.projection) {
    const p = I.projection, lastM = B ? B.spent : null;
    add(lastM && p.total > lastM * 1.1 ? 'bad' : 'neutral', 'fa-gauge-high', `On course to spend about ${money(Math.round(p.total / 100) * 100)} this month`,
      `So far ${money(S.spent)} in ${I.elapsed} days. Everyday spending is running at ${money(Math.round(p.pace))} a day${p.scheduled ? `, and ${money(p.scheduled)} of bills and EMIs are still due` : ''}.${lastM ? ` Your usual month is ${money(Math.round(lastM))}.` : ''}`);
  } else if (B && S.spent) {
    const ch = pctChange(S.spent, B.spent);
    if (ch !== null) add(ch > 10 ? 'bad' : ch < -10 ? 'good' : 'neutral', 'fa-scale-balanced', Math.abs(ch) < 5 ? 'Spending in line with your usual' : `Spending ${ch > 0 ? 'up' : 'down'} ${Math.abs(Math.round(ch))}% on your usual`, `${money(S.spent)} in ${mName} against an average of ${money(Math.round(B.spent))} over the previous ${I.base.length} month${I.base.length > 1 ? 's' : ''}.`);
  }
  const ups = I.cats.filter((c) => c.pct !== null && c.diff >= 500 && c.pct >= 20).sort((a, b) => b.diff - a.diff).slice(0, 2);
  for (const c of ups) add('bad', 'fa-arrow-trend-up', `${c.c}: ${money(c.cur)}, ${fmtPct(c.pct)}`, `That's ${money(c.diff)} more than usual${I.isCurrent ? ' for this point in the month' : ''} (usually ${money(Math.round(I.isCurrent ? c.fair : c.usual))}).`);
  const downs = I.cats.filter((c) => c.pct !== null && c.diff <= -500 && c.pct <= -20).sort((a, b) => a.diff - b.diff).slice(0, 1);
  for (const c of downs) add('good', 'fa-arrow-trend-down', `${c.c} down ${Math.abs(Math.round(c.pct))}%`, `${money(c.cur)} against a usual ${money(Math.round(I.isCurrent ? c.fair : c.usual))}. You saved about ${money(-c.diff)} here.`);
  const over = I.budgets.filter((b) => b.pct > 1);
  if (over.length) add('bad', 'fa-bullseye', `Over budget in ${over.length} categor${over.length === 1 ? 'y' : 'ies'}`, over.map((b) => `${b.c} ${money(b.spent)} of ${money(b.limit)}`).join(', ') + '.');
  else if (I.budgets.length) add('good', 'fa-bullseye', 'Within all your budgets', I.budgets.slice(0, 3).map((b) => `${b.c} ${Math.round(b.pct * 100)}%`).join(', ') + '.');
  for (const t of I.unusual) add('bad', 'fa-triangle-exclamation', `Unusually large: ${merchantOf(t)} ${money(t.amount)}`, `On ${fmtDate(t.date)}, more than 3 times your typical ${t.category} expense.`);
  if (I.places[0]) { const p = I.places[0]; add('neutral', 'fa-store', `Most spent at ${p.name}`, `${money(p.amt)} over ${p.n} payment${p.n > 1 ? 's' : ''}${I.places[1] ? `; next ${I.places[1].name} ${money(I.places[1].amt)}` : ''}.`); }
  if (I.newPlaces.length) add('neutral', 'fa-location-dot', 'New places this month', I.newPlaces.map((p) => `${p.name} ${money(p.amt)}`).join(', ') + '.');
  if (I.wkndDays && I.wkDays && (I.weekend || I.weekday)) {
    const we = I.weekend / I.wkndDays, wd = I.weekday / I.wkDays;
    if (we > wd * 1.5 && we - wd > 200) add('neutral', 'fa-champagne-glasses', `Weekends cost ${Math.round(we / Math.max(wd, 1))}x more`, `${money(Math.round(we))} a day on weekends vs ${money(Math.round(wd))} on weekdays (everyday spending).`);
  }
  if (I.noSpendDays >= 3) add('good', 'fa-leaf', `${I.noSpendDays} no-spend day${I.noSpendDays > 1 ? 's' : ''}`, `Days with no expenses at all${I.isCurrent ? ' so far' : ''} in ${mName}.`);
  if (S.income > 0 && I.fixed > 0) { const f = Math.round((I.fixed / S.income) * 100); add(f > 50 ? 'bad' : 'neutral', 'fa-house-lock', `Fixed costs take ${f}% of income`, `Rent, bills, subscriptions and EMIs add up to ${money(Math.round(I.fixed))} a month.`); }
  if (S.invested) add('good', 'fa-seedling', `Invested ${money(S.invested)}`, `${S.income > 0 ? `${Math.round((S.invested / S.income) * 100)}% of your income. ` : ''}${B && B.invested ? `Usually ${money(Math.round(B.invested))}.` : ''}`);
  if (I.goalsAdded) add('good', 'fa-flag-checkered', `Put ${money(I.goalsAdded)} towards goals`, db.goals.filter((g) => !g.done).map((g) => `${g.name} ${Math.round(goalStats(g).pct * 100)}%`).join(', '));
  const behind = db.goals.filter((g) => !g.done && goalStats(g).status === 'behind');
  if (behind.length) add('bad', 'fa-flag', `${behind.length} goal${behind.length > 1 ? 's are' : ' is'} behind`, behind.map((g) => `${g.name}: save ${money(goalStats(g).perMonth)} a month`).join(', ') + '.', '<a class="btn btn-sm" href="#goals">Open goals</a>');
  const home = typeof pendingHome === 'function' ? pendingHome().reduce((s, t) => s + num(t.amount), 0) : 0;
  if (home) add('neutral', 'fa-house', `${money(home)} of home expenses to take back`, `${pendingHome().length} expense${pendingHome().length > 1 ? 's' : ''} waiting to be paid back.`, '<a class="btn btn-sm" href="#people">See them</a>');
  if (M.T.iOwe) add('neutral', 'fa-hand-holding-dollar', `You owe ${money(M.T.iOwe)}`, db.accounts.filter((a) => a.type === 'person' && (M.balances.get(a.id) || 0) < 0).map((a) => `${a.name} ${money(-(M.balances.get(a.id)))}`).join(', ') + '.');
  if (I.card) add('neutral', 'fa-credit-card', `${money(I.card)} spent on credit cards`, `${S.spent ? Math.round((I.card / S.spent) * 100) : 0}% of your spending. Card dues right now: ${money(M.T.cardDebt)}.`);
  if (I.atm) add('neutral', 'fa-money-bill-wave', `${money(I.atm)} withdrawn as cash`, 'Cash spending is easy to forget: log it in the Cash account.');
  for (const r of I.recurring) add('neutral', 'fa-rotate', `${r.name} looks like a regular payment`, `About ${money(r.amount)} every month for 3 months. Add it to Recurring so it logs itself.`, `<button class="btn btn-sm" data-action="recurring-from" data-name="${esc(r.name)}" data-amount="${r.amount}" data-category="${esc(r.category || '')}">Add to Recurring</button>`);
  const days = I.elapsed;
  if (days >= 5) add(I.loggedDays / days >= 0.6 ? 'good' : 'neutral', 'fa-pen-to-square', `You logged on ${I.loggedDays} of ${days} days`, I.loggedDays / days >= 0.6 ? 'Great habit: your numbers are reliable.' : 'Logging a little every day makes these insights more accurate. Turn on a daily reminder in Settings.');
  const wish = db.wishlist.filter((w) => w.status !== 'bought').sort((a, b) => num(a.price) - num(b.price))[0];
  const keep = S.income - S.spent - S.invested;
  if (wish && keep > 0) add('neutral', 'fa-gift', `${wish.name}: ${Math.max(1, Math.ceil(num(wish.price) / keep))} month${Math.ceil(num(wish.price) / keep) > 1 ? 's' : ''} away`, `At this month's leftover of ${money(Math.round(keep))}, the ${money(wish.price)} ${wish.name} on your wishlist is within reach.`);
  return out;
}

function renderInsights() {
  const I = computeInsights(insightMonth);
  const cards = insightCards(I);
  const { S, B } = I;
  const tile = (label, v, usual, cls = '', goodUp = true) => {
    const ch = usual ? pctChange(v, usual) : null;
    const good = ch === null ? null : goodUp ? ch >= 0 : ch <= 0;
    return `<div class="stat-tile ${cls}"><div class="stat-label">${label}</div><div class="stat-value num">${money(Math.round(v))}</div>
      ${ch !== null && Math.abs(ch) >= 1 && !I.isCurrent ? `<div class="text-xs mt-1 font-semibold ${good ? 'text-gain' : 'text-loss'}">${fmtPct(ch)} vs usual</div>` : usual ? `<div class="text-xs text-ink-3 mt-1">usually ${money(Math.round(usual))}</div>` : ''}</div>`;
  };
  const maxCat = Math.max(1, ...I.cats.map((c) => Math.max(c.cur, c.usual)));
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">A report on your month, compared with your own usual (the average of the ${I.base.length || 'previous'} month${I.base.length === 1 ? '' : 's'} before it).</p>
      ${monthSelect('insightMonth', insightMonth)}
    </div>
    <section class="panel p-5">
      <div class="panel-head"><h2 class="panel-title">${fmtMonth(I.mk)}${I.isCurrent ? ` so far (${I.elapsed} of ${I.dim} days)` : ''}</h2></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        ${tile('Money in', S.income, B?.income, 'in')}${tile('Spent', S.spent, B?.spent, 'out', false)}${tile('Invested', S.invested, B?.invested, 'invest')}${tile('Left over', S.left, B?.left)}
      </div>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
      ${cards.length ? cards.map((c) => `<div class="insight ${c.tone}"><span class="insight-icon"><i class="fa-solid ${c.icon}"></i></span>
        <div class="min-w-0 flex-1"><div class="font-semibold">${esc(c.title)}</div><div class="text-sm text-ink-2 mt-0.5">${esc(c.text)}</div>${c.action ? `<div class="mt-2">${c.action}</div>` : ''}</div></div>`).join('')
        : `<section class="panel lg:col-span-2">${emptyState('fa-lightbulb', 'Log a few expenses and income to see insights for this month.')}</section>`}
    </div>

    ${I.cats.length ? `<section class="panel p-5 mt-6">
      <div class="panel-head"><h2 class="panel-title">Categories: this month vs usual</h2><span class="text-xs text-ink-3">${I.isCurrent ? 'Usual is scaled to the days so far, except fixed costs like rent' : 'Usual = average of previous months'}</span></div>
      <div class="overflow-x-auto"><table class="sched cat-table"><thead><tr><th>Category</th><th>This month</th><th>Usual</th><th>Change</th><th class="w-2/5"></th></tr></thead>
      <tbody>${I.cats.map((c) => `<tr><td><span class="sw-dot" style="background:${colorFor(c.c)}"></span>${esc(c.c)}</td><td>${money(c.cur)}</td><td>${c.usual ? money(Math.round(I.isCurrent ? c.fair : c.usual)) : '–'}</td>
        <td class="${c.pct === null ? '' : c.diff > 0 ? 'text-loss' : 'text-gain'}">${c.pct === null ? 'new' : Math.abs(c.diff) < 1 ? '–' : `${c.diff > 0 ? '+' : '−'}${money(Math.abs(Math.round(c.diff)))}`}</td>
        <td><div class="cmp-bar"><span style="width:${(c.cur / maxCat) * 100}%;background:${colorFor(c.c)}"></span><i style="left:${((I.isCurrent ? c.fair : c.usual) / maxCat) * 100}%" title="Usual"></i></div></td></tr>`).join('')}</tbody></table></div>
    </section>` : ''}

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <section class="panel p-5"><div class="panel-head"><h2 class="panel-title">Biggest expenses</h2></div>
        ${I.biggest.length ? `<div class="divider">${I.biggest.map((t) => txnRow(t, false)).join('')}</div>` : emptyState('fa-receipt', 'No expenses.')}</section>
      <section class="panel p-5"><div class="panel-head"><h2 class="panel-title">Where you spent most</h2></div>
        ${I.places.length ? `<div class="divider">${I.places.map((p) => `<div class="row"><span class="brand-logo" style="background:${colorFor(p.name)}">${esc(p.name.slice(0, 1).toUpperCase())}</span>
          <div class="min-w-0 flex-1"><div class="font-medium truncate">${esc(p.name)}</div><div class="text-xs text-ink-3">${p.n} payment${p.n > 1 ? 's' : ''}, average ${money(Math.round(p.amt / p.n))}</div></div>
          <div class="num font-semibold">${money(p.amt)}</div></div>`).join('')}</div>` : emptyState('fa-store', 'No expenses.')}</section>
    </div>`;
}

/** Two short highlights for the dashboard. */
function dashboardInsights() {
  const cards = insightCards(computeInsights(thisMonth())).filter((c) => c.tone !== 'neutral' || /On course/.test(c.title)).slice(0, 3);
  if (!cards.length) return '';
  return `<section class="mt-6"><div class="flex items-center justify-between mb-3"><h2 class="display text-xl font-semibold">This month's insights</h2><a href="#insights" class="text-sm link">All insights</a></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">${cards.map((c) => `<div class="insight ${c.tone}"><span class="insight-icon"><i class="fa-solid ${c.icon}"></i></span>
      <div class="min-w-0"><div class="font-semibold">${esc(c.title)}</div><div class="text-sm text-ink-2 mt-0.5">${esc(c.text)}</div></div></div>`).join('')}</div></section>`;
}

/** Dashboard nudge: nothing logged today (after 7 pm). */
function logNudge() {
  if (db.settings.remindInApp === false || new Date().getHours() < 19) return '';
  const today = todayStr();
  if (db.transactions.some((t) => t.date === today && !t.relatedType)) return '';
  return `<div class="nudge"><i class="fa-solid fa-bell"></i><div class="flex-1"><b>Nothing logged today yet.</b> Add what you spent while you remember it.</div>
    <button class="btn btn-sm btn-primary" data-action="add-txn" data-type="expense">Add expense</button></div>`;
}

/* ===== Import statements =====
   Supported:
   - PhonePe transaction statement (PDF, from PhonePe > History > Download statement)
   - Bank / card statements as CSV or Excel (columns are detected; you can fix them)
   - Other PDF statements (best effort: lines that start with a date and end with amounts)
   Only rows inside the date range you pick are shown. Each row gets an account,
   a type and a category: from what you chose before for the same payee, then
   common keywords. Rows already in the app (from any statement) are matched.
   Libraries are loaded only when needed:
     pdf.js (cdnjs)  for PDFs,  SheetJS (cdnjs) for Excel. */
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const loadedScripts = {};
function loadScript(url) {
  if (!loadedScripts[url]) loadedScripts[url] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = () => rej(new Error('Could not load the file reader. Check your internet connection.'));
    document.head.appendChild(s);
  });
  return loadedScripts[url];
}

/* ----- Dates and numbers in Indian statements ----- */
const MONTHS3 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n) => String(n).padStart(2, '0');
function parseStmtDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
  const s = String(v).trim();
  let m;
  const yy = (y) => (y.length === 2 ? 2000 + +y : +y);
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/))) return `${yy(m[3])}-${pad2(m[2])}-${pad2(m[1])}`; // day first (India)
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,4})[a-z]*[\s,-]+(\d{2,4})\b/)) && MONTHS3[m[2].toLowerCase()]) return `${yy(m[3])}-${pad2(MONTHS3[m[2].toLowerCase()])}-${pad2(m[1])}`;
  if ((m = s.match(/^([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/)) && MONTHS3[m[1].toLowerCase()]) return `${m[3]}-${pad2(MONTHS3[m[1].toLowerCase()])}-${pad2(m[2])}`;
  return '';
}
const parseAmt = (v) => { if (typeof v === 'number') return v; const n = parseFloat(String(v || '').replace(/[₹,\s]|Rs\.?|INR/gi, '')); return Number.isFinite(n) ? n : 0; };

/* ----- Reading files ----- */
async function readPdfLines(file, password) {
  // pdf.js reads the PDF on the page itself (the worker code is loaded as a normal
  // script), which works the same on every browser and on iPhone, even offline once cached.
  await loadScript(PDFJS_URL);
  await loadScript(PDFJS_WORKER_URL);
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await lib.getDocument({ data, password: password || undefined }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3, x = it.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, s: it.str });
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => lines.push(items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()));
  }
  return lines;
}
function parseCsvText(text) {
  const rows = []; let row = [], cell = '', q = false;
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : text.split('\n')[0].includes('\t') ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}
async function readTable(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    await loadScript(XLSX_URL);
    const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  }
  return parseCsvText(await file.text());
}

/* ----- PhonePe PDF ----- */

/* ----- Account numbers, payees and reference numbers in statement text ----- */
// Masked account/card numbers: "XXXXXXXX1234", "xx50", "**** 9950", "A/c XX5678"
const MASKED_RE = /(?:[Xx*•]{2,}[\s-]*|\bA\/?c(?:count)?\s*(?:no\.?)?\s*:?\s*[Xx*]*)(\d{2,4})\b/g;
function maskedTails(text) { return [...String(text || '').matchAll(MASKED_RE)].map((m) => m[1]); }
// 12-digit UTR / RRN numbers, and PhonePe transaction IDs, used to spot the same payment in two statements.
function refsIn(...texts) {
  const out = new Set();
  for (const t of texts) for (const m of String(t || '').matchAll(/\b([A-Z]{1,3}\d{12,24}|\d{12})\b/g)) out.add(m[1]);
  return [...out];
}
const PAYEE_NOISE = /\b(upi|imps|neft|rtgs|p2a|p2m|payment|paid|to|from|received|transfer|transferred|order|pvt|private|ltd|limited|india|technologies|services|retail|the|bank|ac|a c|mb|ib|dr|cr|ref|txn|by)\b/g;
/** A readable payee name from a PhonePe line or a bank narration like "UPI-SWIGGY-swiggy@axb-...". */
function extractPayee(desc) {
  const s = String(desc || '').trim();
  const pp = s.match(/^(?:Paid to|Received from|Transfer to|Transferred to|Payment to|Refund from|Cashback from)\s+(.+)$/i);
  if (pp) return pp[1].trim();
  if (/^(UPI|IMPS|NEFT|RTGS|MMT|POS|ECOM|ACH|NACH)\b/i.test(s)) {
    const parts = s.split(/[-/:]+/).map((p) => p.trim()).filter(Boolean);
    const words = parts.slice(1).filter((p) => /[A-Za-z]{3,}/.test(p) && !/@/.test(p) && !/^(upi|imps|neft|rtgs|p2a|p2m|ib|mb|payment|ref|sbin|hdfc|icic|utib|kkbk|yesb)/i.test(p) && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(p));
    if (words[0]) return words[0].replace(/\s+/g, ' ');
    const vpa = parts.find((p) => /@/.test(p));
    if (vpa) return vpa.split('@')[0];
  }
  return s;
}
/** The key used to remember choices: "Swiggy Limited", "SWIGGY" and "UPI-SWIGGY-..." all become "swiggy". */
function normPayee(desc) {
  return extractPayee(desc).toLowerCase().replace(/@\S+/g, ' ').replace(/[^a-z ]/g, ' ').replace(PAYEE_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/* ----- PhonePe PDF ----- */
const PP_DATE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i;
function isPhonePe(lines) { return lines.some((l) => /phonepe/i.test(l)) || (lines.filter((l) => PP_DATE.test(l)).length > 1 && lines.some((l) => /\b(DEBIT|CREDIT)\b/.test(l) && /(Paid to|Received from)/i.test(l))); }
function parsePhonePe(lines) {
  const blocks = [];
  for (const l of lines) {
    if (PP_DATE.test(l)) blocks.push([l]);
    else if (blocks.length) blocks[blocks.length - 1].push(l);
  }
  return blocks.map((b) => {
    const text = b.join(' ');
    const date = parseStmtDate(text.match(PP_DATE)[0]);
    const dir = (text.match(/\b(DEBIT|CREDIT)\b/i) || [])[1];
    if (!date || !dir) return null;
    const after = text.slice(text.search(/\b(DEBIT|CREDIT)\b/i));
    const amtM = after.match(/(?:₹|Rs\.?|INR)?\s*([\d,]+\.\d{1,2}|[\d,]{1,12})/);
    const amount = amtM ? parseAmt(amtM[1]) : 0;
    const desc = (text.replace(PP_DATE, '').match(/((?:Paid to|Received from|Transfer to|Transferred to|Payment to|Bill paid[^A-Za-z]*|Mobile recharged|Recharged|Refund from|Cashback from|Added to|Paid)\s*.*?)(?=\s+\b(DEBIT|CREDIT)\b)/i) || [])[1] || '';
    const payee = extractPayee(desc).replace(/\s*\d{1,2}:\d{2}\s*[ap]m.*/i, '').trim();
    // "Paid by XXXXXXXX1234", "Debited from XX50", "Credited to XXXXXX1234" = your account or card.
    const own = text.match(/(?:Paid by|Debited from|Credited to|Paid using|Paid via)\s*:?\s*[A-Za-z ]{0,20}?[Xx*•]+[\s-]*(\d{2,4})\b/i);
    const tail = own ? own[1] : '';
    // Any other masked number (e.g. "Transfer to XXXX5678") is the other side: maybe your own account.
    const others = maskedTails(text).filter((t) => t !== tail);
    const utr = (text.match(/UTR\s*No\.?\s*:?\s*([A-Za-z0-9]{6,})/i) || [])[1] || '';
    const tid = (text.match(/Transaction ID\s*:?\s*([A-Za-z0-9]{6,})/i) || [])[1] || '';
    return { date, out: /debit/i.test(dir), amount, desc: payee || desc || 'PhonePe payment', raw: desc, ref: utr || tid, refs: [utr, tid].filter(Boolean), tail, others };
  }).filter((r) => r && r.amount > 0);
}
/* ----- Other PDFs: lines that start with a date and end with amounts ----- */
function parseGenericPdf(lines) {
  const out = []; let prevBal = null;
  for (const l of lines) {
    const date = parseStmtDate(l);
    if (!date) continue;
    const nums = [...l.matchAll(/(-?[\d,]+\.\d{2})(\s*(Cr|Dr|CR|DR))?/g)];
    if (!nums.length) continue;
    const bal = nums.length >= 2 ? parseAmt(nums[nums.length - 1][1]) : null;
    const amtTok = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
    const amount = Math.abs(parseAmt(amtTok[1]));
    let outFlow = null;
    if (/\bdr\b/i.test(amtTok[3] || '')) outFlow = true;
    else if (/\bcr\b/i.test(amtTok[3] || '')) outFlow = false;
    else if (bal !== null && prevBal !== null) outFlow = bal < prevBal;
    if (bal !== null) prevBal = bal;
    const raw = l.slice(0, amtTok.index).replace(/^\s*\S+(\s+\d{1,2}[/-]\w{2,3}[/-]\d{2,4})?/, '').replace(/\d{1,2}[/-]\w{2,3}[/-]\d{2,4}/g, '').trim();
    out.push({ date, out: outFlow ?? true, amount, desc: extractPayee(raw) || 'Statement entry', raw, refs: refsIn(raw), ref: refsIn(raw)[0] || '', others: maskedTails(raw), guessed: outFlow === null });
  }
  return out.filter((r) => r.amount > 0);
}
/* ----- CSV / Excel with column mapping ----- */
const COLS = { date: /^(txn |transaction |value |tran )?date/i, desc: /(narration|description|particulars|details|remarks|transaction details)/i, debit: /(debit|withdrawal|dr amount|paid out)/i,
  credit: /(credit|deposit|cr amount|paid in)/i, amount: /^(amount|txn amount|transaction amount)/i, drcr: /^(dr ?\/ ?cr|type|cr\/dr|debit\/credit)$/i, ref: /(utr|ref|reference|chq|cheque|transaction id)/i };
function guessMapping(rows) {
  let hi = rows.findIndex((r) => r.some((c) => COLS.date.test(String(c).trim())) && r.some((c) => COLS.desc.test(String(c)) || COLS.debit.test(String(c)) || COLS.amount.test(String(c))));
  if (hi < 0) hi = 0;
  const head = rows[hi].map((c) => String(c).trim());
  const find = (re) => head.findIndex((h) => re.test(h));
  const map = { header: hi, date: find(COLS.date), desc: find(COLS.desc), debit: find(COLS.debit), credit: find(COLS.credit), amount: -1, drcr: find(COLS.drcr), ref: find(COLS.ref) };
  if (map.debit < 0 && map.credit < 0) map.amount = find(COLS.amount);
  if (map.credit === map.debit) map.credit = -1;
  return { map, head };
}
function parseTableRows(rows, map) {
  const out = [];
  for (const r of rows.slice(map.header + 1)) {
    const date = parseStmtDate(r[map.date]);
    if (!date) continue;
    let amount = 0, outFlow = true;
    if (map.debit >= 0 || map.credit >= 0) {
      const d = map.debit >= 0 ? parseAmt(r[map.debit]) : 0, c = map.credit >= 0 ? parseAmt(r[map.credit]) : 0;
      if (d) { amount = Math.abs(d); outFlow = true; } else if (c) { amount = Math.abs(c); outFlow = false; }
    } else if (map.amount >= 0) {
      const a = parseAmt(r[map.amount]);
      amount = Math.abs(a);
      const flag = map.drcr >= 0 ? String(r[map.drcr]) : '';
      outFlow = flag ? /d/i.test(flag) : a < 0;
    }
    if (!amount) continue;
    const raw = String(r[map.desc] ?? '').trim();
    const refCol = map.ref >= 0 ? String(r[map.ref] ?? '').trim() : '';
    const refs = refsIn(raw, refCol);
    if (refCol && !refs.includes(refCol) && refCol.length >= 6) refs.push(refCol);
    out.push({ date, out: outFlow, amount: round2(amount), desc: extractPayee(raw) || 'Statement entry', raw, ref: refs[0] || '', refs, others: maskedTails(raw) });
  }
  return out;
}

/* ----- Finding your accounts from masked numbers ----- */
/** "1234" -> the account whose last 4 digits are 1234; "50" (cards often show xx50) -> the account ending in 50. */
function accountForTail(tail, { exclude = '', preferCard = false } = {}) {
  if (!tail) return '';
  const learned = db.rules.find((x) => x.type === 'acct' && x.tail === tail);
  if (learned && accountById(learned.accountId) && learned.accountId !== exclude) return learned.accountId;
  const list = db.accounts.filter((a) => MONEY_TYPES.includes(a.type) && !a.archived && a.id !== exclude && a.last4 && String(a.last4).endsWith(tail));
  if (list.length === 1) return list[0].id;
  if (list.length > 1 && (preferCard || tail.length <= 2)) {
    const cards = list.filter((a) => a.type === 'credit_card');
    if (cards.length === 1) return cards[0].id;
  }
  return '';
}

/* ----- Suggesting type and category ----- */
const KEYWORD_CATEGORIES = [
  [/swiggy|zomato|domino|pizza|kfc|mcdonald|burger|restaurant|cafe|starbucks|chai|biryani|eatsure|hotel/i, 'Food & dining'],
  [/bigbasket|blinkit|zepto|instamart|dmart|d-mart|d mart|grocer|kirana|jiomart|reliance fresh|more retail|milk|dairy|vegetable/i, 'Groceries'],
  [/uber|ola|rapido|metro|irctc|railway|redbus|bus|auto|cab|fastag|parking|toll/i, 'Transport'],
  [/petrol|fuel|diesel|hpcl|bpcl|iocl|indian oil|shell|hp pay/i, 'Fuel'],
  [/electric|mseb|mahadiscom|bescom|tneb|power|water bill|gas|piped|broadband|airtel|jio|vodafone|\bvi\b|bsnl|act fibernet|recharge|dth|tata play/i, 'Utilities'],
  [/rent|landlord|nobroker|housing|pg /i, 'Rent'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|croma|decathlon|shop|mall|store|mart/i, 'Shopping'],
  [/pharma|medical|apollo|medplus|1mg|netmeds|hospital|clinic|doctor|lab|diagnostic/i, 'Health'],
  [/netflix|spotify|hotstar|prime video|youtube|sonyliv|zee5|apple|google play|icloud/i, 'Subscriptions'],
  [/bookmyshow|pvr|inox|cinema|movie|game/i, 'Entertainment'],
  [/school|college|university|course|udemy|coursera|fees|tuition|book/i, 'Education'],
  [/makemytrip|goibibo|cleartrip|ixigo|oyo|airbnb|indigo|air india|vistara|flight/i, 'Travel'],
  [/lic|insurance|policy|premium|acko|hdfc life|icici pru/i, 'Insurance'],
  [/salon|barber|spa|parlour|parlor|urban company/i, 'Personal care'],
  [/charges|fee|gst|penalty|late payment|annual fee/i, 'Fees & charges'],
];
const INCOME_KEYWORDS = [[/salary|payroll|sal cr|stipend/i, 'Salary'], [/refund|reversal/i, 'Refund'], [/cashback|reward/i, 'Cashback'], [/interest|int\.? cr/i, 'Interest'], [/dividend/i, 'Dividends']];
const pickCat = (c, list) => (list.includes(c) ? c : list.includes('Other') ? 'Other' : list[0]);
const payeeRules = () => db.rules.filter((x) => x.type !== 'acct' && x.match);
/** The rule for a payee: exact name first, then one name containing the other (at least 4 letters). */
const compact = (k) => String(k || '').replace(/ /g, ''); // "d mart" and "dmart" are the same payee
function ruleFor(key, dir) {
  if (!key) return null;
  const k = compact(key);
  const list = payeeRules().filter((x) => (x.dir || dir) === dir);
  return list.find((x) => compact(x.match) === k)
    || list.filter((x) => compact(x.match).length >= 4 && (k.includes(compact(x.match)) || (k.length >= 4 && compact(x.match).includes(k)))).sort((a, b) => b.match.length - a.match.length)[0] || null;
}
/** What you did last time with this payee, from transactions already in the app. */
let historyIndex = null;
function buildHistoryIndex() {
  historyIndex = new Map();
  for (const t of sortTxns(db.transactions).reverse()) { // oldest first, so the newest wins
    if (!t.description || t.relatedType === 'sip' || t.relatedType === 'emi') continue;
    const key = normPayee(t.description);
    if (key.length < 3) continue;
    let kind, target = '';
    if (t.forHome) kind = 'home';
    else if (t.type === 'expense' || t.type === 'income') kind = t.type;
    else if (t.type === 'transfer') { const p = [accountById(t.toAccountId), accountById(t.fromAccountId)].find((a) => a?.type === 'person'); kind = p ? 'person' : 'transfer'; target = p ? p.id : ''; }
    else continue;
    if (kind === 'transfer') continue; // transfers depend on the account, not the payee
    const dir = t.type === 'income' || (t.type === 'transfer' && accountById(t.fromAccountId)?.type === 'person') ? 'in' : 'out';
    historyIndex.set(`${dir}|${compact(key)}`, { kind, category: t.category || '', target });
  }
}
function suggestFor(r) {
  const dir = r.out ? 'out' : 'in';
  const key = normPayee(r.raw || r.desc);
  // 1. Your own account on the other side: a self transfer.
  for (const tl of r.others || []) {
    const other = accountForTail(tl, { exclude: r.accountId });
    if (other) return { kind: 'transfer', target: other, category: '', how: 'self' };
  }
  // 1b. Money to or from someone with your own name, when you have exactly one other bank account.
  const me = normPayee(db.settings.ownerName || '').split(' ')[0];
  if (me && me.length >= 3 && key.split(' ')[0] === me && !ruleFor(key, dir)) {
    const banks = db.accounts.filter((a) => a.type === 'bank' && !a.archived && a.id !== r.accountId);
    if (banks.length === 1) return { kind: 'transfer', target: banks[0].id, category: '', how: 'selfname' };
  }
  // 2. What you chose before for this payee (remembered choices, then your past entries).
  const rule = ruleFor(key, dir);
  if (rule && (rule.kind !== 'person' || accountById(rule.target)) && (rule.kind !== 'transfer' || (accountById(rule.target) && rule.target !== r.accountId))) return { kind: rule.kind, category: rule.category, target: rule.target || '', how: 'rule' };
  const hist = historyIndex.get(`${dir}|${compact(key)}`);
  if (hist) return { ...hist, how: 'history' };
  // 3. A person you've added.
  const person = db.accounts.find((a) => a.type === 'person' && !a.archived && normPayee(a.name).length >= 3 && key.split(' ').includes(normPayee(a.name).split(' ')[0]));
  if (person) return { kind: 'person', target: person.id, category: '', how: 'person' };
  // 4. Common keywords.
  if (!r.out) {
    const hit = INCOME_KEYWORDS.find(([re]) => re.test(r.raw || r.desc));
    return { kind: 'income', category: pickCat(hit ? hit[1] : 'Other', db.settings.incomeCategories), how: hit ? 'keyword' : '' };
  }
  const hit = KEYWORD_CATEGORIES.find(([re]) => re.test(r.raw || r.desc));
  return { kind: 'expense', category: pickCat(hit ? hit[1] : 'Other', db.settings.expenseCategories), how: hit ? 'keyword' : '' };
}
/** Remember a choice for a payee (used by imports and when you edit a transaction's category). */
function learnPayee(desc, dir, kind, category, target = '') {
  const key = normPayee(desc);
  if (key.length < 3 || !['expense', 'income', 'home', 'person', 'transfer'].includes(kind)) return null;
  const existing = db.rules.find((x) => x.type !== 'acct' && compact(x.match) === compact(key) && (x.dir || dir) === dir);
  if (existing && existing.kind === kind && existing.category === category && (existing.target || '') === target) return null;
  return opUpsert('rules', { ...(existing || {}), id: existing?.id || uid('rule'), type: 'payee', match: key, dir, kind, category: category || '', target: target || '' });
}

/* ----- Matching rows with transactions already in the app ----- */
function findMatch(r, accId, used) {
  const refs = (r.refs || []).filter(Boolean);
  const cands = db.transactions.filter((t) => !used.has(t.id) && Math.abs(num(t.amount) - r.amount) < 0.01 && t.type !== 'adjustment');
  // Same UTR / reference number: the same payment, whichever statement it came from.
  const byRef = refs.length && cands.find((t) => [t.ref, ...(t.refs || [])].some((x) => x && refs.includes(x)));
  if (byRef) return { t: byRef, how: 'ref' };
  const dayDiff = (t) => Math.abs(parseDate(t.date) - parseDate(r.date)) / 86400000;
  const side = (t) => (r.out ? t.fromAccountId : t.toAccountId);
  // Same amount within 2 days on the same account.
  const byAcc = accId && cands.filter((t) => side(t) === accId && dayDiff(t) <= 2).sort((a, b) => dayDiff(a) - dayDiff(b))[0];
  if (byAcc) return { t: byAcc, how: 'amount' };
  // Imported earlier without a reliable account (e.g. PhonePe): same amount, same day, same direction.
  const loose = cands.filter((t) => t.importBatch && dayDiff(t) <= 1 && (r.out ? !!t.fromAccountId : !!t.toAccountId) && !(r.refs?.length && t.refs?.length)).sort((a, b) => dayDiff(a) - dayDiff(b))[0];
  if (loose && normPayee(loose.description) && normPayee(loose.description) === normPayee(r.raw || r.desc)) return { t: loose, how: 'payee' };
  return null;
}

/* ----- The Import page ----- */
const AUTO = '__auto';
const imp = { step: 1, file: null, kind: '', rows: [], table: null, map: null, head: null, accountId: '', from: '', to: todayStr(), outside: 0, error: '', learn: true };
function lastEntryDate(accId) { return sortTxns(db.transactions.filter((t) => t.fromAccountId === accId || t.toAccountId === accId))[0]?.date || ''; }
function throughSelect() {
  const opts = db.accounts.filter((a) => MONEY_TYPES.includes(a.type) && !a.archived && a.type !== 'investment');
  const group = (type) => { const l = opts.filter((a) => a.type === type); return l.length ? `<optgroup label="${esc(ACCOUNT_TYPES[type].label)}">${l.map((a) => `<option value="${a.id}" ${imp.accountId === a.id ? 'selected' : ''}>${esc(a.name)}${a.last4 ? ` (…${esc(a.last4)})` : ''}</option>`).join('')}</optgroup>` : ''; };
  return `<select class="inp" name="impAccount"><option value="${AUTO}" ${imp.accountId === AUTO ? 'selected' : ''}>Read it from the statement (PhonePe, several accounts)</option>${['bank', 'credit_card', 'cash'].map(group).join('')}</select>`;
}
function renderImport() {
  if (!imp.accountId) imp.accountId = AUTO;
  if (!imp.from) imp.from = `${thisMonth()}-01`;
  const lastBatch = sortTxns(db.transactions.filter((t) => t.importBatch))[0]?.importBatch;
  const batchCount = lastBatch ? db.transactions.filter((t) => t.importBatch === lastBatch).length : 0;
  const noDigits = db.accounts.filter((a) => ['bank', 'credit_card'].includes(a.type) && !a.archived && !a.last4);
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Bring in transactions from a PhonePe statement (PDF) or a bank or card statement (CSV, Excel or PDF). You check every row before anything is added, and the app remembers your choices for next time.</p>
      <div class="flex gap-2 flex-wrap">${batchCount ? `<button class="btn btn-sm" data-action="import-undo" data-batch="${lastBatch}"><i class="fa-solid fa-rotate-left"></i> Undo last import (${batchCount})</button>` : ''}
        <button class="btn btn-sm" data-action="rules-open"><i class="fa-solid fa-brain"></i> Remembered choices (${db.rules.length})</button></div>
    </div>
    ${noDigits.length ? `<p class="callout warn mb-5"><b>Tip:</b> add the last 4 digits to ${noDigits.map((a) => esc(a.name)).join(', ')} (Accounts → edit) so statement rows are matched to the right account by themselves. For cards, the full last 4 (e.g. 9950) also matches statements that show only xx50.</p>` : ''}
    <section class="panel p-5">
      <div class="panel-head"><h2 class="panel-title">1. Choose the statement</h2></div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>${field('Statement file', `<input type="file" class="inp" id="stmtFile" accept=".pdf,.csv,.xlsx,.xls,.txt">`, 'PhonePe: History → download icon → choose dates → the PDF arrives by email or in the app. Banks: download the statement as Excel or CSV if you can (most reliable).')}
          ${imp.file ? `<p class="text-sm mt-2"><i class="fa-solid fa-file-lines mr-1 text-ink-3"></i>${esc(imp.file.name)}${imp.kind ? ` <span class="pill blue">${esc(imp.kind)}</span>` : ''}</p>` : ''}</div>
        <div class="space-y-4">
          ${field('Money went through', throughSelect(), 'For a PhonePe statement leave it on "Read it from the statement": each row is matched to your account or card by its number (…1234 or xx50). For a statement of one bank account or card, choose that account.')}
          <div><span class="lbl">Only import these dates</span>
            <div class="grid grid-cols-2 gap-2"><input type="date" class="inp" id="impFrom" value="${imp.from}"><input type="date" class="inp" id="impTo" value="${imp.to}"></div>
            <div class="flex flex-wrap gap-1.5 mt-2">
              <button class="btn btn-sm" data-action="imp-range" data-r="month">This month</button>
              <button class="btn btn-sm" data-action="imp-range" data-r="last">Last month</button>
              <button class="btn btn-sm" data-action="imp-range" data-r="since">Since my last entry</button>
              <button class="btn btn-sm" data-action="imp-range" data-r="all">Everything</button></div></div>
        </div>
      </div>
      <div id="pdfPass" ${imp.needPassword ? '' : 'hidden'} class="mt-4 max-w-sm">${field('This PDF has a password', `<input class="inp" id="impPass" type="password" autocomplete="off" value="">`, 'Often your phone number, date of birth or a mix given in the email.')}</div>
      ${imp.error ? `<p class="callout warn mt-4">${esc(imp.error)}</p>` : ''}
      <div class="mt-4"><button class="btn btn-primary" data-action="imp-read"><i class="fa-solid fa-magnifying-glass"></i> Read statement</button></div>
    </section>
    ${imp.table ? mappingPanel() : ''}
    ${imp.step >= 2 ? previewPanel() : ''}`;
}
function mappingPanel() {
  const opts = [['-1', '—'], ...imp.head.map((h, i) => [String(i), h || `Column ${i + 1}`])];
  const sel = (k, label) => field(label, `<select class="inp" data-map="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(imp.map[k]) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
  return `<section class="panel p-5 mt-6"><div class="panel-head"><h2 class="panel-title">Columns</h2><span class="text-xs text-ink-3">Detected automatically. Fix them if a column is wrong.</span></div>
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">${sel('date', 'Date')}${sel('desc', 'Description')}${sel('debit', 'Money out')}${sel('credit', 'Money in')}${sel('amount', 'Single amount')}${sel('drcr', 'Dr / Cr')}${sel('ref', 'Reference')}</div></section>`;
}
function rowAccountSelect(r, i) {
  const list = db.accounts.filter((a) => MONEY_TYPES.includes(a.type) && !a.archived && a.type !== 'investment');
  return `<select class="inp inp-sm ${r.accountId ? '' : 'need'}" data-imp-acc="${i}"><option value="">Choose…</option>${list.map((a) => `<option value="${a.id}" ${a.id === r.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`;
}
function rowTypeOptions(r) {
  const own = db.accounts.filter((a) => MONEY_TYPES.includes(a.type) && !a.archived && a.id !== r.accountId);
  const ppl = db.accounts.filter((a) => a.type === 'person' && !a.archived);
  const o = r.out
    ? [['expense', 'Expense'], ['home', 'Home expense (take back)'], ...own.map((a) => [`transfer:${a.id}`, `Self transfer to ${a.name}`]), ...ppl.map((a) => [`person:${a.id}`, `Gave to ${a.name}`]), ['skip', 'Skip']]
    : [['income', 'Income'], ...own.map((a) => [`transfer:${a.id}`, `Self transfer from ${a.name}`]), ...ppl.map((a) => [`person:${a.id}`, `Got from ${a.name}`]), ['skip', 'Skip']];
  const cur = r.kind === 'transfer' || r.kind === 'person' ? `${r.kind}:${r.target}` : r.kind;
  return o.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
}
const HOW_PILL = { rule: '<span class="pill blue" title="You chose this before for this payee">Remembered</span>', history: '<span class="pill blue" title="Same as your earlier entries for this payee">From your entries</span>',
  self: '<span class="pill" style="background:var(--violet-tint);color:var(--violet)" title="The other account number is one of yours">Your own account</span>',
  selfname: '<span class="pill" style="background:var(--violet-tint);color:var(--violet)" title="The name matches yours; check the account">Your own account?</span>', person: '', keyword: '', '': '' };
function previewPanel() {
  const rows = imp.rows;
  const chosen = rows.filter((r) => r.include && r.kind !== 'skip');
  const out = chosen.filter((r) => r.out).reduce((s, r) => s + r.amount, 0), inn = chosen.filter((r) => !r.out).reduce((s, r) => s + r.amount, 0);
  const matched = rows.filter((r) => r.match), fixes = matched.filter((r) => r.fix);
  const needAcc = chosen.filter((r) => !r.accountId).length;
  return `<section class="panel p-5 mt-6">
    <div class="panel-head"><div><h2 class="panel-title">2. Check and import</h2>
      <div class="text-xs text-ink-3 mt-0.5">${rows.length} row${rows.length === 1 ? '' : 's'} between ${fmtDate(imp.from)} and ${fmtDate(imp.to)}${imp.outside ? `; ${imp.outside} outside the dates left out` : ''}.
        ${matched.length ? ` ${matched.length} already in the app (matched and unticked)${fixes.length ? `; ${fixes.length} of those will get their account corrected` : ''}.` : ''}</div></div>
      <div class="flex gap-2"><button class="btn btn-sm" data-action="imp-all" data-v="1">Tick new</button><button class="btn btn-sm" data-action="imp-all" data-v="0">Untick all</button></div></div>
    ${rows.length ? `<div class="overflow-x-auto"><table class="sched imp-table"><thead><tr><th></th><th>Date</th><th>Description</th><th>Account</th><th>Type</th><th>Category</th><th>Amount</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.include ? '' : 'off'}">
        <td class="imp-tick"><input type="checkbox" data-imp-inc="${i}" ${r.include ? 'checked' : ''} aria-label="Import this row"></td>
        <td class="whitespace-nowrap imp-date">${fmtDate(r.date)}</td>
        <td class="imp-desc"><div class="font-medium">${esc(r.desc)}</div>
          ${r.match ? `<span class="pill due" title="${esc(r.match.t.description || '')}">In the app already${r.match.t.source ? ` (${esc(r.match.t.source)})` : ''}${r.match.how === 'ref' ? ', same UTR' : ''}</span>${r.fixable ? `<label class="pill blue cursor-pointer"><input type="checkbox" data-imp-fix="${i}" ${r.fix ? 'checked' : ''} style="margin-right:.25rem">Correct its account to ${esc(accountName(r.accountId))}</label>` : ''}` : ''}
          ${r.guessed ? '<span class="pill">Check in / out</span>' : ''}${HOW_PILL[r.how] || ''}
          ${r.tail ? `<span class="pill" title="Account or card number on the statement">${r.tail.length <= 2 ? 'xx' : '…'}${esc(r.tail)}</span>` : ''}</td>
        <td data-label="Account">${rowAccountSelect(r, i)}</td>
        <td data-label="Type"><select class="inp inp-sm" data-imp-kind="${i}">${rowTypeOptions(r)}</select></td>
        <td data-label="Category">${['expense', 'home'].includes(r.kind) ? `<select class="inp inp-sm" data-imp-cat="${i}">${uniq([...db.settings.expenseCategories, r.category]).map((c) => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`
          : r.kind === 'income' ? `<select class="inp inp-sm" data-imp-cat="${i}">${uniq([...db.settings.incomeCategories, r.category]).map((c) => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : '<span class="text-ink-3">—</span>'}</td>
        <td class="whitespace-nowrap imp-amt ${r.out ? 'text-loss' : 'text-gain'}">${r.out ? '−' : '+'}${money(r.amount)}</td></tr>`).join('')}
      </tbody></table></div>
      ${needAcc ? `<p class="callout warn mt-4">${needAcc} row${needAcc === 1 ? '' : 's'} need an account (marked in red). Pick it once; the app remembers that number for next time.</p>` : ''}
      <div class="flex flex-wrap items-center justify-between gap-3 mt-4">
        <div class="text-sm">${chosen.length} new to import: <span class="text-loss num">−${money(out)}</span>, <span class="text-gain num">+${money(inn)}</span></div>
        <div class="flex items-center gap-3">${checkbox('impLearn', imp.learn !== false, 'Remember my choices for these payees')}
          <button class="btn btn-primary" data-action="imp-go" ${chosen.length || fixes.length ? '' : 'disabled'}><i class="fa-solid fa-file-import"></i> ${chosen.length ? `Import ${chosen.length}` : 'Apply corrections'}</button></div>
      </div>`
      : emptyState('fa-magnifying-glass', 'No transactions found in these dates. Check the date range, or the file type.')}
  </section>`;
}
async function importRead() {
  const f = $('#stmtFile')?.files?.[0] || imp.file;
  imp.error = '';
  if (!f) { imp.error = 'Choose a statement file first.'; return render(); }
  imp.file = f;
  imp.accountId = $('[name="impAccount"]')?.value || imp.accountId;
  imp.from = $('#impFrom').value || imp.from; imp.to = $('#impTo').value || imp.to;
  const pass = $('#impPass')?.value || '';
  toast('Reading the statement…');
  try {
    let parsed = [];
    imp.table = null;
    if (/\.pdf$/i.test(f.name)) {
      let lines;
      try { lines = await readPdfLines(f, pass); imp.needPassword = false; }
      catch (e) {
        if (e?.name === 'PasswordException') { imp.needPassword = true; imp.error = pass ? 'That password did not work. Try again.' : 'This PDF is protected. Enter its password below and press Read again.'; return render(); }
        throw e;
      }
      if (isPhonePe(lines)) { imp.kind = 'PhonePe'; parsed = parsePhonePe(lines); }
      else { imp.kind = 'PDF statement'; parsed = parseGenericPdf(lines); }
      if (!parsed.length) imp.error = 'No transactions could be read from this PDF. If it is a bank statement, download it as Excel or CSV instead.';
    } else {
      const rows = await readTable(f);
      const g = guessMapping(rows);
      imp.table = rows; imp.map = g.map; imp.head = g.head; imp.kind = /\.xlsx?$/i.test(f.name) ? 'Excel' : 'CSV';
      parsed = parseTableRows(rows, imp.map);
      if (imp.accountId === AUTO) imp.error = 'A bank or card statement belongs to one account: choose it under "Money went through" so every row goes to it.';
    }
    buildImportRows(parsed);
  } catch (e) { imp.error = e.message || String(e); }
  render();
}
function buildImportRows(parsed) {
  buildHistoryIndex();
  const inRangeRows = parsed.filter((r) => r.date >= imp.from && r.date <= imp.to);
  imp.outside = parsed.length - inRangeRows.length;
  imp.parsed = parsed;
  const used = new Set();
  imp.rows = inRangeRows.sort((a, b) => a.date.localeCompare(b.date)).map((r) => {
    const accountId = imp.accountId !== AUTO ? imp.accountId : accountForTail(r.tail);
    const row = { ...r, accountId };
    Object.assign(row, suggestFor(row));
    row.suggested = { kind: row.kind, category: row.category, target: row.target || '' };
    if (row.kind === 'transfer' && /^[\sXx*•\d-]*$/.test(row.desc)) row.desc = `Self transfer ${r.out ? 'to' : 'from'} ${accountName(row.target)}`;
    const m = findMatch(row, accountId, used);
    if (m) {
      used.add(m.t.id);
      row.match = m;
      const side = r.out ? m.t.fromAccountId : m.t.toAccountId;
      // A statement for a specific account is the best source for which account the money moved through.
      row.fixable = imp.accountId !== AUTO && !!accountId && side !== accountId && accountById(side)?.type !== 'person' && m.how !== 'amount';
      row.fix = row.fixable;
    }
    row.include = !m;
    return row;
  });
  imp.step = 2;
}
function importGo() {
  const learn = $('[name="impLearn"]')?.checked !== false;
  const todo = imp.rows.filter((x) => x.include && x.kind !== 'skip');
  const missing = todo.filter((r) => !r.accountId).length;
  if (missing) { toast(`Choose the account for ${missing} row${missing === 1 ? '' : 's'} first (marked in red).`, 'error'); return; }
  const batch = uid('imp');
  const ops = [];
  const learned = new Map();
  let homeTo = null;
  for (const r of todo) {
    const base = { id: uid('txn'), date: r.date, amount: round2(r.amount), description: r.desc.slice(0, 140), notes: r.raw && r.raw !== r.desc ? `Imported: ${r.raw.slice(0, 200)}` : 'Imported', relatedType: '', relatedId: '', ref: r.ref || '', refs: r.refs || [], importBatch: batch, source: imp.kind };
    if (r.kind === 'expense') ops.push(opUpsert('transactions', { ...base, type: 'expense', category: r.category, fromAccountId: r.accountId, toAccountId: '' }));
    else if (r.kind === 'income') ops.push(opUpsert('transactions', { ...base, type: 'income', category: r.category, fromAccountId: '', toAccountId: r.accountId }));
    else if (r.kind === 'home') {
      homeTo = homeTo || (defaultClaimPerson() !== '__new' ? defaultClaimPerson() : null);
      if (!homeTo) { const p = newPersonRecord('Dad'); ops.push(opUpsert('accounts', p)); homeTo = p.id; }
      ops.push(opUpsert('transactions', { ...base, type: 'transfer', category: r.category, fromAccountId: r.accountId, toAccountId: homeTo, forHome: true, homeSettled: false }));
    } else if (r.kind === 'transfer' || r.kind === 'person') {
      const other = r.target;
      ops.push(opUpsert('transactions', { ...base, type: 'transfer', category: r.kind === 'person' ? (r.out ? 'Lent' : 'Borrowed') : transferCategory(r.out ? r.accountId : other, r.out ? other : r.accountId),
        fromAccountId: r.out ? r.accountId : other, toAccountId: r.out ? other : r.accountId, ...(r.kind === 'person' ? { relatedType: 'person', relatedId: other } : {}) }));
    }
    // Remember every choice for this payee (self transfers are recognised by account number instead).
    if (learn && r.how !== 'self' && r.how !== 'selfname') {
      const op = learnPayee(r.raw || r.desc, r.out ? 'out' : 'in', r.kind, r.category || '', r.kind === 'person' ? r.target : r.kind === 'transfer' ? r.target : '');
      if (op) learned.set(op.rec.match + op.rec.dir, op);
    }
  }
  // Remember which account a statement number belongs to (e.g. card xx50).
  const tails = new Map();
  for (const r of imp.rows) if (r.tail && r.accountId && (r.include || r.match) && accountForTail(r.tail) !== r.accountId) tails.set(r.tail, r.accountId);
  for (const [tail, accountId] of tails) {
    const ex = db.rules.find((x) => x.type === 'acct' && x.tail === tail);
    ops.push(opUpsert('rules', { ...(ex || {}), id: ex?.id || uid('rule'), type: 'acct', tail, accountId }));
  }
  // Rows already in the app: correct the account where this bank's statement says otherwise.
  let fixed = 0;
  for (const r of imp.rows.filter((x) => x.match && x.fix)) {
    const t = r.match.t;
    ops.push(opUpsert('transactions', { ...t, ...(r.out ? { fromAccountId: r.accountId } : { toAccountId: r.accountId }), refs: [...new Set([...(t.refs || []), t.ref, ...(r.refs || [])].filter(Boolean))], notes: `${t.notes || ''} Account confirmed by ${imp.kind} statement.`.trim() }));
    fixed++;
  }
  ops.push(...learned.values());
  const n = todo.length;
  commit(ops, `Import ${n} transactions from ${imp.kind}${fixed ? `, ${fixed} corrected` : ''}`);
  toast(`Imported ${n}${fixed ? `, corrected ${fixed}` : ''}${learned.size ? `; remembered ${learned.size} payee choice${learned.size === 1 ? '' : 's'}` : ''}${tails.size ? ` and ${tails.size} account number${tails.size === 1 ? '' : 's'}` : ''}.`, 'success');
  Object.assign(imp, { step: 1, rows: [], table: null, file: null, kind: '', error: '', parsed: null });
  location.hash = '#transactions';
}
function importUndo(batch) {
  const list = db.transactions.filter((t) => t.importBatch === batch);
  if (!list.length || !confirm(`Remove the ${list.length} transactions from the last import? Your remembered choices are kept.`)) return;
  commit([...learnFromEntries(list), ...list.map((t) => opDelete('transactions', t.id))], `Undo import (${list.length})`);
  toast('Import undone. Remembered choices are kept for next time.');
}
function importRange(r) {
  const acc = $('[name="impAccount"]')?.value || imp.accountId;
  if (r === 'month') { imp.from = `${thisMonth()}-01`; imp.to = todayStr(); }
  if (r === 'last') { imp.from = addMonths(`${thisMonth()}-01`, -1); imp.to = addDays(`${thisMonth()}-01`, -1); }
  if (r === 'since') { const l = acc === AUTO ? sortTxns(db.transactions.filter((t) => t.importBatch))[0]?.date : lastEntryDate(acc); imp.from = l ? addDays(l, 1) : `${thisMonth()}-01`; imp.to = todayStr(); }
  if (r === 'all') { imp.from = '2000-01-01'; imp.to = todayStr(); }
  imp.accountId = acc;
  if (imp.parsed) buildImportRows(imp.parsed);
  render();
}
/** Keep the preview in step with what you change in the table. */
function onImportChange(e) {
  const el = e.target;
  if (el.id === 'impFrom' || el.id === 'impTo') { imp[el.id === 'impFrom' ? 'from' : 'to'] = el.value; if (imp.parsed) { buildImportRows(imp.parsed); render(); } return true; }
  if (el.name === 'impAccount') { imp.accountId = el.value; if (imp.parsed) { imp.error = ''; buildImportRows(imp.parsed); render(); } return true; }
  if (el.dataset.map) { imp.map[el.dataset.map] = int(el.value); buildImportRows(parseTableRows(imp.table, imp.map)); render(); return true; }
  if (el.dataset.impInc !== undefined) { imp.rows[int(el.dataset.impInc)].include = el.checked; render(); return true; }
  if (el.dataset.impFix !== undefined) { imp.rows[int(el.dataset.impFix)].fix = el.checked; render(); return true; }
  if (el.dataset.impAcc !== undefined) {
    const i = int(el.dataset.impAcc), r = imp.rows[i];
    r.accountId = el.value;
    // Apply the same account to other rows showing the same number.
    if (r.tail) imp.rows.forEach((x) => { if (x.tail === r.tail && !x.accountId) x.accountId = el.value; });
    render(); return true;
  }
  if (el.dataset.impKind !== undefined) {
    const r = imp.rows[int(el.dataset.impKind)], [k, id] = el.value.split(':');
    r.kind = k; r.target = id || ''; r.how = r.how === 'self' && k !== 'transfer' ? '' : r.how;
    if (k === 'expense' || k === 'home') r.category = db.settings.expenseCategories.includes(r.category) ? r.category : pickCat('Other', db.settings.expenseCategories);
    if (k === 'income') r.category = db.settings.incomeCategories.includes(r.category) ? r.category : pickCat('Other', db.settings.incomeCategories);
    if (k !== 'skip' && !r.match) r.include = true;
    // Same payee further down: follow this choice too.
    const key = normPayee(r.raw || r.desc);
    imp.rows.forEach((x) => { if (x !== r && !x.match && x.out === r.out && compact(normPayee(x.raw || x.desc)) === compact(key) && x.how !== 'self') { x.kind = r.kind; x.target = r.target; x.category = r.category; } });
    render(); return true;
  }
  if (el.dataset.impCat !== undefined) {
    const r = imp.rows[int(el.dataset.impCat)];
    r.category = el.value;
    const key = normPayee(r.raw || r.desc);
    let n = 0;
    imp.rows.forEach((x) => { if (x !== r && !x.match && x.kind === r.kind && compact(normPayee(x.raw || x.desc)) === compact(key)) { x.category = r.category; n++; } });
    if (n) { toast(`Also set ${n} other ${r.desc} row${n === 1 ? '' : 's'} to ${r.category}.`); render(); }
    return true;
  }
  if (el.name === 'impLearn') { imp.learn = el.checked; return true; }
  if (el.id === 'stmtFile') { imp.file = el.files[0] || null; imp.parsed = null; imp.step = 1; imp.rows = []; imp.table = null; imp.needPassword = false; importRead(); return true; }
  return false;
}

/* ----- Remembered choices ----- */
function openRules() {
  const kindLabel = (x) => ({ expense: 'Expense', income: 'Income', home: 'Home expense', person: `${x.dir === 'out' ? 'Gave to' : 'Got from'} ${accountName(x.target)}`, transfer: `Self transfer ${x.dir === 'out' ? 'to' : 'from'} ${accountName(x.target)}` }[x.kind] || x.kind);
  const pr = payeeRules().slice().sort((a, b) => a.match.localeCompare(b.match));
  const ar = db.rules.filter((x) => x.type === 'acct');
  openModal({
    title: 'Remembered choices',
    wide: true,
    body: `<p class="text-sm text-ink-2">Used when you import a statement. They're learned from your imports, from your existing entries, and from editing a transaction's category, and they stay even if you delete or undo transactions.</p>
      <button type="button" class="btn btn-sm mt-3" data-action="rules-learn"><i class="fa-solid fa-wand-magic-sparkles"></i> Learn from all my entries now</button>
      ${ar.length ? `<h3 class="font-semibold mt-4 mb-2">Account and card numbers</h3><div class="divider">${ar.map((x) => `<div class="row text-sm"><span class="pill">${x.tail.length <= 2 ? 'xx' : '…'}${esc(x.tail)}</span><div class="flex-1">${esc(accountName(x.accountId))}</div>
        <button type="button" class="icon-btn sm" data-action="rule-del" data-id="${x.id}" aria-label="Forget"><i class="fa-regular fa-trash-can"></i></button></div>`).join('')}</div>` : ''}
      <h3 class="font-semibold mt-4 mb-2">Payees (${pr.length})</h3>
      ${pr.length ? `<div class="divider max-h-96 overflow-y-auto">${pr.map((x) => `<div class="row text-sm"><div class="flex-1 min-w-0"><b>${esc(x.match)}</b> <span class="text-ink-3">${x.dir === 'in' ? 'money in' : 'money out'}</span></div>
        <div class="text-ink-2">${esc(kindLabel(x))}${x.category ? `, ${esc(x.category)}` : ''}</div>
        <button type="button" class="icon-btn sm" data-action="rule-del" data-id="${x.id}" aria-label="Forget"><i class="fa-regular fa-trash-can"></i></button></div>`).join('')}</div>`
        : '<p class="text-sm text-ink-3">Nothing yet. Import a statement and your choices appear here.</p>'}`,
    submitLabel: 'Done', cancelLabel: 'Close', onSubmit: () => {},
  });
}

/* ----- Keeping your choices when entries are deleted -----
   Your existing entries are turned into remembered choices (once, and again
   before any entry is deleted), so deleting transactions and re-importing a
   statement brings the same categories back. Newest entry wins per payee;
   choices you already made explicitly are never overwritten. */
function choiceFromTxn(t) {
  if (!t.description || ['sip', 'emi', 'subscription'].includes(t.relatedType) || t.type === 'adjustment') return null;
  if (t.forHome) return { dir: 'out', kind: 'home', category: t.category || '', target: '' };
  if (t.type === 'expense') return { dir: 'out', kind: 'expense', category: t.category || '', target: '' };
  if (t.type === 'income') return { dir: 'in', kind: 'income', category: t.category || '', target: '' };
  if (t.type === 'transfer') {
    const to = accountById(t.toAccountId), from = accountById(t.fromAccountId);
    if (to?.type === 'person') return { dir: 'out', kind: 'person', category: '', target: to.id };
    if (from?.type === 'person') return { dir: 'in', kind: 'person', category: '', target: from.id };
  }
  return null;
}
function learnFromEntries(list = db.transactions) {
  const best = new Map();
  for (const t of sortTxns(list).reverse()) { // oldest first, newest wins
    const c = choiceFromTxn(t);
    const key = c && normPayee(t.description);
    if (!c || !key || key.length < 3) continue;
    best.set(`${c.dir}|${compact(key)}`, { ...c, match: key });
  }
  const ops = [];
  for (const c of best.values()) {
    if (db.rules.some((x) => x.type !== 'acct' && compact(x.match) === compact(c.match) && (x.dir || c.dir) === c.dir)) continue; // keep explicit choices
    ops.push(opUpsert('rules', { id: uid('rule'), type: 'payee', match: c.match, dir: c.dir, kind: c.kind, category: c.category, target: c.target }));
  }
  return ops;
}
function learnFromEntriesOnce() {
  if (db.settings.learnedFromEntries) return;
  const ops = learnFromEntries();
  commit([...ops, opSettings({ learnedFromEntries: true })], `Remember choices from ${ops.length} payees`);
}

/* ===== Tax helper (India, estimate only) =====
   Financial year April to March. From 1 April 2026 the Income-tax Act, 2025
   applies: the old "80C" is Section 123 and "80D" is Section 126, with the same
   limits. Slabs for FY 2025-26 and 2026-27 (unchanged by Budget 2026):
     New regime: 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, above 30%;
                 no tax up to 12L taxable income (rebate), standard deduction 75,000 (salaried).
     Old regime: 0-2.5L nil, 2.5-5L 5%, 5-10L 20%, above 30%; rebate up to 5L;
                 standard deduction 50,000; deductions such as Section 123/80C apply.
   4% cess is added. Surcharge, special rates (capital gains etc.), HRA and
   other exemptions are not modelled. Update TAX_RULES when budgets change. */
const TAX_RULES = {
  new: { slabs: [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]], rebateUpTo: 1200000, stdDed: 75000 },
  old: { slabs: [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]], rebateUpTo: 500000, stdDed: 50000 },
  cess: 0.04,
};
const DEDUCTIONS = [
  { key: '123', label: 'Section 123 (was 80C)', limit: 150000, hint: 'PPF, EPF, ELSS funds, life insurance, 5-year FD, NSC, home-loan principal, tuition fees' },
  { key: 'nps', label: 'Extra NPS (was 80CCD(1B))', limit: 50000, hint: 'Your own NPS contributions above Section 123' },
  { key: '126', label: 'Section 126 (was 80D)', limit: 25000, hint: 'Health insurance for you and family (higher limits apply for senior citizens)' },
  { key: 'other', label: 'Other deductions', limit: null, hint: 'Anything else your CA confirms' },
];
function fyOf(date) { const d = parseDate(date); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; }
const fyRange = (fy) => { const y = +fy.slice(0, 4); return { from: `${y}-04-01`, to: `${y + 1}-03-31` }; };
let taxFy = fyOf(todayStr());
function slabTax(income, regime) {
  const R = TAX_RULES[regime];
  let tax = 0, prev = 0;
  for (const [upto, rate] of R.slabs) { if (income > prev) tax += (Math.min(income, upto) - prev) * rate; prev = upto; }
  if (income <= R.rebateUpTo) tax = 0;
  else if (regime === 'new') tax = Math.min(tax, income - R.rebateUpTo); // marginal relief just above the rebate limit
  return Math.round(tax * (1 + TAX_RULES.cess));
}
function taxData(fy) {
  const r = fyRange(fy), inFy = (t) => t.date >= r.from && t.date <= r.to;
  const income = new Map();
  for (const t of db.transactions) if (t.type === 'income' && inFy(t)) income.set(t.category || 'Other', (income.get(t.category || 'Other') || 0) + num(t.amount));
  const auto = { 123: 0, nps: 0, 126: 0 };
  const autoRows = [];
  for (const t of db.transactions) {
    if (!inFy(t)) continue;
    const to = accountById(t.toAccountId);
    if (t.type === 'transfer' && to?.type === 'investment') {
      const k = to.subtype === 'NPS' ? 'nps' : to.subtype === 'PPF / EPF' || /elss|tax ?saver/i.test(to.name + ' ' + (to.schemeName || '')) ? '123' : null;
      if (k) { auto[k] += num(t.amount); autoRows.push({ k, name: to.name, amount: num(t.amount), date: t.date }); }
    }
  }
  const manual = db.taxItems.filter((x) => x.fy === fy);
  const claimed = Object.fromEntries(DEDUCTIONS.map((d) => [d.key, (auto[d.key] || 0) + manual.filter((m) => m.section === d.key).reduce((s, m) => s + num(m.amount), 0)]));
  const allowed = DEDUCTIONS.reduce((s, d) => s + (d.limit ? Math.min(d.limit, claimed[d.key]) : claimed[d.key]), 0);
  const gross = [...income.values()].reduce((s, v) => s + v, 0);
  const salaried = db.settings.salaried !== false && (income.get('Salary') || 0) > 0;
  const taxableNew = Math.max(0, gross - (salaried ? TAX_RULES.new.stdDed : 0));
  const taxableOld = Math.max(0, gross - (salaried ? TAX_RULES.old.stdDed : 0) - allowed);
  return { r, income, gross, auto, autoRows, manual, claimed, allowed, taxableNew, taxableOld, taxNew: slabTax(taxableNew, 'new'), taxOld: slabTax(taxableOld, 'old'), salaried };
}
function renderTax() {
  const D = taxData(taxFy);
  const fys = [...new Set([fyOf(todayStr()), fyOf(addMonths(todayStr(), -12)), ...db.transactions.map((t) => fyOf(t.date))])].sort().reverse();
  const better = D.taxNew <= D.taxOld ? 'new' : 'old';
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">A rough estimate from the income you log, to plan ahead. Not tax advice: surcharge, capital gains, HRA and other exemptions aren't included. Check with a CA before filing.</p>
      <select class="inp !w-auto !py-1.5 text-sm" data-filter="taxFy" aria-label="Financial year">${fys.map((f) => `<option value="${f}" ${f === taxFy ? 'selected' : ''}>FY ${f}</option>`).join('')}</select>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section class="panel p-5"><div class="panel-head"><h2 class="panel-title">Income in FY ${taxFy}</h2></div>
        <div class="display text-3xl font-semibold num">${money(D.gross)}</div>
        <div class="divider mt-3">${[...D.income.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="row text-sm"><div class="flex-1">${esc(c)}</div><div class="num">${money(v)}</div></div>`).join('') || '<p class="text-sm text-ink-3">No income logged in this year.</p>'}</div></section>
      <section class="panel p-5 lg:col-span-2"><div class="panel-head"><h2 class="panel-title">Estimated tax</h2><span class="text-xs text-ink-3">${D.salaried ? 'Includes the standard deduction for salary' : ''}</span></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          ${['new', 'old'].map((rg) => `<div class="stat-tile ${better === rg ? 'in' : ''}"><div class="stat-label">${rg === 'new' ? 'New regime (default)' : 'Old regime'} ${better === rg && D.gross ? '<span class="pill in">Lower</span>' : ''}</div>
            <div class="stat-value num">${money(rg === 'new' ? D.taxNew : D.taxOld)}</div>
            <div class="text-xs text-ink-3 mt-1">Taxable income ${money(rg === 'new' ? D.taxableNew : D.taxableOld)}${rg === 'old' ? `, after ${money(D.allowed)} of deductions` : ''}</div></div>`).join('')}
        </div>
        <p class="text-sm text-ink-2 mt-4">${D.gross <= 1275000 && D.salaried ? 'Under the new regime, salary up to ₹12.75 lakh a year (₹12 lakh taxable income) has no income tax.' : D.gross <= 1200000 ? 'Under the new regime, taxable income up to ₹12 lakh has no income tax.' : `The ${better} regime looks cheaper for you by about ${money(Math.abs(D.taxNew - D.taxOld))}.`}</p></section>
    </div>
    <section class="panel p-5 mt-6">
      <div class="panel-head"><div><h2 class="panel-title">Deductions (old regime only)</h2><div class="text-xs text-ink-3 mt-0.5">Money into PPF/EPF, NPS and funds named ELSS or tax saver is counted by itself. Add the rest here.</div></div>
        <button class="btn btn-sm" data-action="tax-add"><i class="fa-solid fa-plus"></i> Add deduction</button></div>
      <div class="space-y-4">${DEDUCTIONS.map((d) => { const c = D.claimed[d.key]; return `<div>
        <div class="flex justify-between text-sm mb-1 gap-2"><span class="font-medium">${d.label}</span><span class="num text-ink-2">${money(c)}${d.limit ? ` of ${money(d.limit)}` : ''}</span></div>
        ${d.limit ? `<div class="bar"><span style="width:${Math.min(100, (c / d.limit) * 100)}%;background:${c >= d.limit ? '#12A150' : '#0A6FB0'}"></span></div>` : ''}
        <div class="text-xs text-ink-3 mt-1">${esc(d.hint)}${d.limit && c < d.limit ? `. ${money(d.limit - c)} of room left.` : ''}</div></div>`; }).join('')}</div>
      ${D.manual.length || D.autoRows.length ? `<div class="divider mt-5">${[...D.autoRows.map((x) => `<div class="row text-sm"><div class="flex-1">${esc(x.name)} <span class="text-ink-3">${fmtDate(x.date)}</span> <span class="pill">auto</span></div><div class="num">${money(x.amount)}</div></div>`),
        ...D.manual.map((m) => `<div class="row text-sm"><div class="flex-1">${esc(m.description)} <span class="text-ink-3">${esc(DEDUCTIONS.find((d) => d.key === m.section)?.label || '')}</span></div><div class="num">${money(m.amount)}</div>
          <button class="icon-btn sm" data-action="tax-del" data-id="${m.id}" aria-label="Remove"><i class="fa-regular fa-trash-can"></i></button></div>`)].join('')}</div>` : ''}
    </section>`;
}
function openTaxItem() {
  openModal({
    title: `Add a deduction for FY ${taxFy}`,
    body: `${field('Type', select('section', DEDUCTIONS.map((d) => [d.key, d.label]), '123'))}
      ${twoCol(field('What', input('description', '', 'required maxlength="80" placeholder="e.g. LIC premium, health insurance"')), field('Amount', moneyInput('amount', '', 'required min="1"')))}`,
    submitLabel: 'Add',
    onSubmit: (d) => { commit([opUpsert('taxItems', { id: uid('tax'), fy: taxFy, section: d.section, description: d.description, amount: round2(num(d.amount)) })], 'Add tax deduction'); },
  });
}

/* ===== Reminders and the installable app =====
   A website can't wake your phone on a schedule by itself, so reminders work
   in three ways:
   1. In the app: a banner on the dashboard after 7 pm if nothing is logged.
   2. Calendar: a repeating daily event with an alert, added to your phone's
      calendar from a .ics file. Works everywhere, including iPhone.
   3. Phone notifications: a small scheduled job in your private data repo
      (GitHub Actions, free) checks data.json every evening and sends a push
      through ntfy.sh to the free ntfy app on your phone, only when nothing is
      logged or something is due tomorrow. Notifications contain no amounts. */
const APP_URL = () => location.origin + location.pathname.replace(/index\.html$/, '');
const randomTopic = () => `kosh-${Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')}`;
function istToUtc(hhmm) {
  const [h, m] = String(hhmm || '21:00').split(':').map(Number);
  let mins = h * 60 + m - 330; if (mins < 0) mins += 1440;
  return { h: Math.floor(mins / 60), m: mins % 60 };
}
function downloadReminderIcs(time) {
  const { h, m } = istToUtc(time);
  const start = todayStr().replace(/-/g, '') + `T${pad2(h)}${pad2(m)}00Z`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KOSH//Kundans Finance//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:kosh-daily-${Date.now()}@kosh`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART:${start}`, 'DURATION:PT5M', 'RRULE:FREQ=DAILY',
    "SUMMARY:Log today's expenses", `URL:${APP_URL()}`, `DESCRIPTION:Open Kundan's Finance and add what you spent today: ${APP_URL()}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', "DESCRIPTION:Log today's expenses", 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download('kosh-daily-reminder.ics', ics, 'text/calendar');
  toast('Open the downloaded file and tap "Add" to put the reminder in your calendar.', 'success');
}
async function sendTestNotification(topic) {
  if (!topic) { toast('Create a topic first.', 'error'); return; }
  try {
    await ntfyPublish({ topic, title: "Kundan's Finance", message: 'Test notification. Your notifications will arrive like this.', tags: ['moneybag'], click: APP_URL() });
    toast('Sent. It should appear in the ntfy app within a few seconds.', 'success');
  } catch (e) { toast(`Couldn't send: ${e.message}`, 'error'); }
}
function reminderWorkflow(topic, time) {
  const { h, m } = istToUtc(time);
  const script = `
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.env.DATA_PATH, 'utf8'));
const now = new Date(Date.now() + 5.5 * 3600e3);
const today = now.toISOString().slice(0, 10);
const tomorrow = new Date(now.getTime() + 864e5).toISOString().slice(0, 10);
const logged = (db.transactions || []).filter((t) => t.date === today && !t.relatedType).length;
const when = (d) => (d === today ? 'today' : 'tomorrow');
const due = [];
for (const s of db.subscriptions || []) if (s.active && (s.nextRenewal === today || s.nextRenewal === tomorrow)) due.push(s.name + (s.kind === 'income' ? ' (income) ' : ' ') + when(s.nextRenewal));
for (const x of db.sips || []) if (x.active && (x.nextDate === today || x.nextDate === tomorrow)) due.push(x.name + ' SIP ' + when(x.nextDate));
const home = (db.transactions || []).filter((t) => t.forHome && !t.homeSettled).length;
let title = '', body = '';
if (!logged) { title = "Log today's expenses"; body = 'Nothing logged today yet. It takes a minute.'; }
if (due.length) { title = title || 'Coming up'; body += (body ? ' ' : '') + 'Due: ' + due.join(', ') + '.'; }
if (!title) { console.log('Nothing to remind.'); process.exit(0); }
if (home && now.getDay() === 0) body += ' ' + home + ' home expense(s) still to take back.';
fetch('https://ntfy.sh/' + process.env.TOPIC, { method: 'POST', body, headers: { Title: title, Tags: 'moneybag', Click: process.env.APP_URL } })
  .then((r) => console.log('ntfy', r.status)).catch((e) => { console.error(e); process.exit(1); });`;
  return `# Daily reminder for Kundan's Finance (KOSH). Created by the app.
# Runs every day at ${time} India time (GitHub may run it a few minutes late).
name: KOSH daily reminder
on:
  schedule:
    - cron: '${m} ${h} * * *'
  workflow_dispatch:
permissions:
  contents: read
jobs:
  remind:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Send reminder
        env:
          TOPIC: ${topic}
          APP_URL: ${APP_URL()}
          DATA_PATH: ${config.path || 'data.json'}
        run: |
          node - <<'JS'
${script.split('\n').map((l) => '          ' + l).join('\n')}
          JS
`;
}
const WORKFLOW_PATH = '.github/workflows/kosh-reminder.yml';
async function ghPath(path, method = 'GET', body) {
  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path}${method === 'GET' ? `?ref=${encodeURIComponent(config.branch || 'main')}` : ''}`;
  return fetch(url, { method, cache: 'no-store', headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
}
async function setupPhoneReminders(topic, time) {
  if (!isConfigured()) { toast('Connect GitHub first (Settings above).', 'error'); return; }
  const yml = reminderWorkflow(topic, time);
  try {
    const cur = await ghPath(WORKFLOW_PATH);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const res = await ghPath(WORKFLOW_PATH, 'PUT', { message: 'KOSH: daily reminder', content: toBase64(yml), branch: config.branch || 'main', ...(sha ? { sha } : {}) });
    if (res.status === 403 || res.status === 404) throw Object.assign(new Error('perm'), { perm: true });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    commit([opSettings({ ntfyTopic: topic, reminderTime: time })], 'Turn on phone reminders');
    toast(`Phone reminders are on: every day at ${time}.`, 'success');
  } catch (e) {
    if (e.perm) showWorkflowManual(yml);
    else toast(`Couldn't set it up: ${e.message}`, 'error');
  }
}
function showWorkflowManual(yml) {
  openModal({
    title: 'One more permission needed',
    wide: true,
    body: `<p class="text-sm">Your token can't create the reminder job. Either give it one more permission, or add the file yourself:</p>
      <p class="text-sm mt-3"><b>Option 1:</b> GitHub → Settings → Developer settings → Fine-grained tokens → your token → <b>Repository permissions → Workflows: Read and write</b> → Update. Then press "Turn on" again.</p>
      <p class="text-sm mt-3"><b>Option 2:</b> In your data repository click <b>Add file → Create new file</b>, name it <code>${WORKFLOW_PATH}</code>, paste the text below and commit.</p>
      <textarea class="inp mt-3 font-mono text-xs" rows="12" readonly onclick="this.select()">${esc(yml)}</textarea>`,
    submitLabel: 'Done', cancelLabel: 'Close', onSubmit: () => {},
  });
}
async function removePhoneReminders() {
  try {
    const cur = await ghPath(WORKFLOW_PATH);
    if (cur.ok) {
      const { sha } = await cur.json();
      const res = await ghPath(WORKFLOW_PATH, 'DELETE', { message: 'KOSH: remove daily reminder', sha, branch: config.branch || 'main' });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    }
    commit([opSettings({ ntfyTopic: '' })], 'Turn off phone reminders');
    toast('Phone reminders turned off.');
  } catch (e) { toast(`Couldn't remove it: ${e.message}. Delete ${WORKFLOW_PATH} in your data repository instead.`, 'error'); }
}
function remindersSection(s) {
  return `<section class="space-y-4">
    <h3 class="font-semibold">Reminders</h3>
    ${twoCol(field('Daily calendar reminder at', input('reminderTime', s.reminderTime || '21:00', 'type="time"'), 'India time.'),
      '<div class="pt-6">' + checkbox('remindInApp', s.remindInApp !== false, 'Show a reminder on the dashboard', 'After 7 pm, if nothing is logged today.') + '</div>')}
    <div class="callout"><b>Calendar reminder</b> (works on iPhone without any app): a daily event with an alert in your phone's calendar.
      <div class="mt-2"><button type="button" class="btn btn-sm" data-action="rem-ics"><i class="fa-regular fa-calendar-plus"></i> Add to my calendar</button></div></div>
    <div class="callout"><b>Phone notifications</b>: balances every morning, yesterday's spending, bills due, budget alerts and many more, each at the time you choose.
      <div class="mt-2"><a class="btn btn-sm btn-primary" href="#notifications" data-close><i class="fa-solid fa-bell"></i> Set up notifications</a></div></div>
  </section>`;
}

/* ----- Installable app (PWA) ----- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker', e));
}
function installCard() {
  if (isStandalone() || localStorage.getItem('kosh.installHidden')) return '';
  if (isIOS()) return `<div class="nudge install"><i class="fa-solid fa-mobile-screen"></i><div class="flex-1"><b>Install on your iPhone:</b> in Safari tap <i class="fa-solid fa-arrow-up-from-bracket"></i> Share, then <b>Add to Home Screen</b>. It opens full-screen and works offline.</div>
    <button class="icon-btn sm" data-action="install-hide" aria-label="Hide"><i class="fa-solid fa-xmark"></i></button></div>`;
  if (installPrompt) return `<div class="nudge install"><i class="fa-solid fa-mobile-screen"></i><div class="flex-1"><b>Install the app</b> for a home-screen icon and offline use.</div>
    <button class="btn btn-sm btn-primary" data-action="install-app">Install</button><button class="icon-btn sm" data-action="install-hide" aria-label="Hide"><i class="fa-solid fa-xmark"></i></button></div>`;
  return '';
}

/* ===== Phone notifications (custom) =====
   You choose what to be told and when: balances every morning, yesterday's
   spending, bills due, budget alerts, a weekly summary, your own reminders...
   How it reaches your phone:
   - The list lives in data.json (db.notifications), so it syncs like the rest.
   - A scheduled job in your PRIVATE data repo (GitHub Actions, free) runs
     20 minutes before each chosen time, reads data.json, writes the message
     with koshNotifyEngine() below (the same code the app uses for previews)
     and hands it to ntfy.sh with the exact delivery time. ntfy then delivers
     it on the minute to the ntfy app on your phone. The 20-minute head start
     absorbs GitHub's usual delays in starting scheduled jobs.
   - GitHub's clock is UTC; all times here are India time (UTC+5:30). The job
     works out the India date and time itself, so "yesterday" is always right.
   Messages go through ntfy.sh: anyone who knows your topic name could read
   them, so the topic is long and random. Tick "Hide amounts" on any
   notification to replace rupee amounts with •••. */

/**
 * Builds one notification. Self-contained on purpose: its source code is
 * copied into the GitHub job, so it may not use anything else from app.js.
 * db: the data file; at: the delivery moment as a Date whose UTC fields hold
 * India wall-clock time; n: the notification settings.
 * Returns { title, message, tags, priority } or null when there is nothing to say.
 */
function koshNotifyEngine(db, at, n) {
  const S = db.settings || {};
  const num = (v) => Number(v) || 0;
  const hide = !!n.hideAmounts;
  const fmt = (v) => (hide ? '•••' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: S.currency || 'INR', maximumFractionDigits: 0 }).format(Math.round(num(v))));
  const iso = (d) => d.toISOString().slice(0, 10);
  const dayMs = 864e5;
  const addDays = (s, k) => iso(new Date(Date.parse(s + 'T00:00:00Z') + k * dayMs));
  const addMonths = (s, k) => { const d = new Date(s + 'T00:00:00Z'); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
  const nice = (s) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const today = iso(at), yesterday = addDays(today, -1);
  const acc = db.accounts || [], tx = db.transactions || [];
  const byId = {}; for (const a of acc) byId[a.id] = a;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  function balances(upto) {
    const b = {};
    for (const a of acc) if ((a.openingDate || '') <= upto) b[a.id] = num(a.openingBalance);
    for (const t of tx) {
      if (!t.date || t.date > upto) continue;
      const f = byId[t.fromAccountId], to = byId[t.toAccountId];
      if (f && b[f.id] !== undefined && t.date >= (f.openingDate || '')) b[f.id] -= num(t.amount);
      if (to && b[to.id] !== undefined && t.date >= (to.openingDate || '')) b[to.id] += num(t.amount);
    }
    return b;
  }
  const isInvOut = (t) => t.type === 'transfer' && byId[t.toAccountId] && byId[t.toAccountId].type === 'investment' && byId[t.fromAccountId] && byId[t.fromAccountId].type !== 'investment';
  const spendKey = (t) => (t.type === 'expense' ? t.category || 'Other' : S.sipAsSpending && isInvOut(t) ? 'SIP & investments' : null);
  function spend(from, to) {
    const cats = {}; let total = 0, count = 0; const list = [];
    for (const t of tx) { if (!t.date || t.date < from || t.date > to) continue; const k = spendKey(t); if (!k) continue; cats[k] = (cats[k] || 0) + num(t.amount); total += num(t.amount); count++; list.push(t); }
    return { cats, total, count, list };
  }
  const income = (from, to) => tx.filter((t) => t.type === 'income' && t.date >= from && t.date <= to).reduce((s, t) => s + num(t.amount), 0);
  const invested = (from, to) => tx.filter((t) => isInvOut(t) && t.date >= from && t.date <= to).reduce((s, t) => s + num(t.amount), 0);
  const top = (cats, k = 3) => Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, k).map(([c, v]) => `${c} ${fmt(v)}`).join(', ');
  const emiInfo = (e) => {
    const P = num(e.principal), N = Math.max(0, Math.floor(num(e.tenureMonths))), r = num(e.annualRate) / 1200;
    const emi = num(e.emiAmount) > 0 ? num(e.emiAmount) : N > 0 ? (r > 0 ? (P * r * (1 + r) ** N) / ((1 + r) ** N - 1) : P / N) : 0;
    const paid = Math.min(Math.max(0, Math.floor(num(e.paidInstallments))), N);
    const left = paid >= N ? 0 : Math.max(0, r > 0 ? P * (1 + r) ** paid - (emi * ((1 + r) ** paid - 1)) / r : P - emi * paid);
    return { emi, left, next: !e.closed && paid < N && e.startDate ? addMonths(e.startDate, paid) : null };
  };
  const cardDue = (a, bal) => {
    if (!a.dueDay || (bal[a.id] || 0) >= 0) return null;
    let d = `${today.slice(0, 8)}${String(Math.min(28, num(a.dueDay))).padStart(2, '0')}`;
    if (d < today) d = addMonths(d, 1);
    return { date: d, amount: -(bal[a.id] || 0) };
  };
  const when = (d) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : nice(d));
  const out = (title, lines, tags, priority = 3) => ({ title, message: (Array.isArray(lines) ? lines.filter(Boolean).join('\n') : lines) || title, tags, priority });
  const monthStart = `${today.slice(0, 8)}01`;
  const daysIn = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  const elapsed = +today.slice(8, 10);

  switch (n.type) {
    case 'log_reminder': {
      const logged = tx.filter((t) => t.date === today && !t.relatedType);
      if (n.onlyIfNothing !== false && logged.length) return null;
      return out("Log today's expenses", logged.length ? `${logged.length} entr${logged.length === 1 ? 'y' : 'ies'} so far today (${fmt(logged.filter((t) => spendKey(t)).reduce((s, t) => s + num(t.amount), 0))}). Anything else?` : 'Nothing logged today yet. It takes a minute while you remember.', ['memo']);
    }
    case 'balances': {
      const b = balances(today);
      const live = acc.filter((a) => !a.archived && (a.type === 'cash' || a.type === 'bank'));
      const lines = live.map((a) => `${a.name}: ${fmt(b[a.id] || 0)}`);
      const total = live.reduce((s, a) => s + (b[a.id] || 0), 0);
      if (n.includeCards !== false) { const dues = acc.filter((a) => a.type === 'credit_card' && !a.archived && (b[a.id] || 0) < 0); dues.forEach((a) => lines.push(`${a.name} due: ${fmt(-(b[a.id]))}`)); }
      if (n.includeInvestments) lines.push(`Investments: ${fmt(acc.filter((a) => a.type === 'investment' && !a.archived).reduce((s, a) => s + (b[a.id] || 0), 0))}`);
      return out(`Money with you: ${fmt(total)}`, lines, ['bank']);
    }
    case 'yesterday': {
      const s = spend(yesterday, yesterday);
      const past = spend(addDays(yesterday, -30), addDays(yesterday, -1));
      const avg = past.total / 30;
      if (!s.count) return out("Yesterday's spending: nothing", `No expenses logged for ${nice(yesterday)}. If you did spend, add it now.`, ['receipt']);
      const cmp = avg > 0 ? (s.total > avg * 1.2 ? ` (above your daily average of ${fmt(avg)})` : s.total < avg * 0.8 ? ` (below your daily average of ${fmt(avg)})` : ' (about your usual)') : '';
      return out(`Yesterday you spent ${fmt(s.total)}`, [`${s.count} expense${s.count === 1 ? '' : 's'}${cmp}.`, top(s.cats)], ['receipt']);
    }
    case 'today': {
      const s = spend(today, today);
      return out(`Today so far: ${fmt(s.total)}`, s.count ? [`${s.count} expense${s.count === 1 ? '' : 's'}.`, top(s.cats)] : 'Nothing spent (or logged) today yet.', ['sunny']);
    }
    case 'month_pace': {
      const s = spend(monthStart, today), proj = elapsed ? (s.total / elapsed) * daysIn : 0;
      const inc = income(monthStart, today);
      const bl = (db.budgets || []).map((b) => ({ c: b.category, used: pct(s.cats[b.category] || 0, num(b.monthlyLimit)) })).filter((x) => x.used >= 80);
      return out(`This month so far: ${fmt(s.total)} spent`, [`Day ${elapsed} of ${daysIn}. At this pace about ${fmt(proj)} by month end.`, inc ? `Income ${fmt(inc)}, so ${pct(inc - s.total, inc)}% kept so far.` : '', bl.length ? `Budgets: ${bl.map((x) => `${x.c} ${x.used}%`).join(', ')}.` : '', top(s.cats)], ['hourglass']);
    }
    case 'week': {
      const end = yesterday, start = addDays(end, -6);
      const s = spend(start, end), p = spend(addDays(start, -7), addDays(start, -1));
      const ch = p.total ? Math.round(((s.total - p.total) / p.total) * 100) : null;
      return out(`Last 7 days: ${fmt(s.total)} spent`, [ch === null ? '' : `${ch >= 0 ? 'Up' : 'Down'} ${Math.abs(ch)}% on the week before (${fmt(p.total)}).`, top(s.cats), income(start, end) ? `Income ${fmt(income(start, end))}.` : ''], ['calendar']);
    }
    case 'month_report': {
      const lmEnd = addDays(monthStart, -1), lmStart = `${lmEnd.slice(0, 8)}01`;
      const s = spend(lmStart, lmEnd), inc = income(lmStart, lmEnd), inv = invested(lmStart, lmEnd);
      const pEnd = addDays(lmStart, -1), p = spend(`${pEnd.slice(0, 8)}01`, pEnd);
      const name = new Date(lmStart + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', timeZone: 'UTC' });
      const ch = p.total ? Math.round(((s.total - p.total) / p.total) * 100) : null;
      const chTxt = ch === null ? '' : Math.abs(ch) < 3 ? ' (about the same as the month before)' : ` (${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}% on the month before)`;
      return out(`${name}: kept ${pct(inc - s.total, inc)}% of income`, [`In ${fmt(inc)}, spent ${fmt(s.total)}${chTxt}, invested ${fmt(inv)}.`, `Top: ${top(s.cats)}.`], ['bar_chart']);
    }
    case 'upcoming': {
      const days = Math.max(0, num(n.days ?? 1)), end = addDays(today, days), items = [], b = balances(today);
      for (const s of db.subscriptions || []) if (s.active && s.nextRenewal >= today && s.nextRenewal <= end) items.push([s.nextRenewal, `${s.name} ${fmt(s.amount)}${s.kind === 'income' ? ' (coming in)' : ''}`]);
      for (const x of db.sips || []) if (x.active && x.nextDate >= today && x.nextDate <= end) items.push([x.nextDate, `${x.name} SIP ${fmt(x.amount)}`]);
      for (const e of db.emis || []) { const i = emiInfo(e); if (i.next && i.next >= today && i.next <= end) items.push([i.next, `${e.name} EMI ${fmt(i.emi)}`]); }
      for (const a of acc) if (a.type === 'credit_card' && !a.archived) { const d = cardDue(a, b); if (d && d.date <= end) items.push([d.date, `${a.name} bill ${fmt(d.amount)}`]); }
      if (!items.length) return null;
      items.sort((x, y) => x[0].localeCompare(y[0]));
      return out(`${items.length} payment${items.length === 1 ? '' : 's'} coming up`, items.map(([d, t]) => `${when(d)}: ${t}`), ['calendar']);
    }
    case 'card_due': {
      const b = balances(today), days = Math.max(0, num(n.days ?? 3)), end = addDays(today, days);
      const due = acc.filter((a) => a.type === 'credit_card' && !a.archived).map((a) => ({ a, d: cardDue(a, b) })).filter((x) => x.d && x.d.date <= end);
      if (!due.length) return null;
      return out('Credit card bill due', due.map((x) => `${x.a.name}: ${fmt(x.d.amount)} due ${when(x.d.date)}`), ['credit_card'], 4);
    }
    case 'budgets': {
      const s = spend(monthStart, today), th = num(n.threshold ?? 80);
      const hit = (db.budgets || []).map((b) => ({ c: b.category, spent: s.cats[b.category] || 0, lim: num(b.monthlyLimit) })).filter((x) => x.lim && pct(x.spent, x.lim) >= th).sort((a, b) => b.spent / b.lim - a.spent / a.lim);
      if (!hit.length) return null;
      return out(hit.some((x) => x.spent > x.lim) ? 'Over budget' : 'Budget alert', hit.map((x) => `${x.c}: ${fmt(x.spent)} of ${fmt(x.lim)} (${pct(x.spent, x.lim)}%)`), ['dart'], hit.some((x) => x.spent > x.lim) ? 4 : 3);
    }
    case 'low_balance': {
      const b = balances(today), below = num(n.below ?? 5000);
      const low = acc.filter((a) => !a.archived && (a.type === 'bank' || a.type === 'cash') && (b[a.id] || 0) < below);
      if (!low.length) return null;
      return out('Low balance', low.map((a) => `${a.name}: ${fmt(b[a.id] || 0)}`), ['warning'], 4);
    }
    case 'big_spend': {
      const above = num(n.above ?? 2000);
      const big = tx.filter((t) => t.date === yesterday && t.type === 'expense' && num(t.amount) >= above).sort((a, b) => num(b.amount) - num(a.amount));
      if (!big.length) return null;
      return out(`${big.length} large expense${big.length === 1 ? '' : 's'} yesterday`, big.slice(0, 5).map((t) => `${t.description || t.category}: ${fmt(t.amount)}`), ['money_with_wings']);
    }
    case 'net_worth': {
      const b = balances(today);
      let assets = 0, liab = 0;
      for (const a of acc) { const v = b[a.id] || 0; if (a.type === 'credit_card' || a.type === 'person') { if (v < 0) liab -= v; else assets += v; } else assets += v; }
      for (const e of db.emis || []) liab += emiInfo(e).left;
      return out(`Net worth: ${fmt(assets - liab)}`, [`You own ${fmt(assets)}, you owe ${fmt(liab)}.`], ['moneybag']);
    }
    case 'portfolio': {
      const b = balances(today), inv = acc.filter((a) => a.type === 'investment' && !a.archived);
      if (!inv.length) return null;
      const cost = {}; for (const a of inv) cost[a.id] = num(a.investedAmount ?? a.openingBalance);
      for (const t of tx) { if (t.type === 'adjustment') continue; const to = byId[t.toAccountId], f = byId[t.fromAccountId];
        if (to && cost[to.id] !== undefined && t.date >= (to.openingDate || '')) cost[to.id] += num(t.amount);
        if (f && cost[f.id] !== undefined && t.date >= (f.openingDate || '')) cost[f.id] = Math.max(0, cost[f.id] - num(t.amount)); }
      const value = inv.reduce((s, a) => s + (b[a.id] || 0), 0), put = inv.reduce((s, a) => s + cost[a.id], 0), gain = value - put;
      const best = inv.map((a) => ({ a, g: cost[a.id] ? ((b[a.id] || 0) - cost[a.id]) / cost[a.id] : 0 })).sort((x, y) => y.g - x.g)[0];
      return out(`Portfolio: ${fmt(value)}`, [`${gain >= 0 ? 'Profit' : 'Loss'} ${fmt(Math.abs(gain))} (${put ? (gain >= 0 ? '+' : '−') + Math.abs(Math.round((gain / put) * 1000) / 10) : 0}%) on ${fmt(put)} invested.`, best && best.g ? `Best: ${best.a.name} ${best.g >= 0 ? '+' : ''}${Math.round(best.g * 1000) / 10}%.` : '', 'Values use the latest prices the app saved.'], ['chart_with_upwards_trend']);
    }
    case 'goals': {
      const b = balances(today);
      const list = (db.goals || []).filter((g) => !g.done);
      if (!list.length) return null;
      return out('Your goals', list.slice(0, 5).map((g) => {
        const saved = (g.contributions || []).reduce((s, c) => s + num(c.amount), 0) + (g.linkedAccountIds || []).reduce((s, id) => s + Math.max(0, b[id] || 0), 0);
        const left = Math.max(0, num(g.target) - saved);
        const months = g.targetDate ? Math.max(1, (+g.targetDate.slice(0, 4) - +today.slice(0, 4)) * 12 + (+g.targetDate.slice(5, 7) - +today.slice(5, 7))) : 0;
        return `${g.name}: ${pct(saved, num(g.target))}%${months && left ? `, save ${fmt(left / months)}/month` : ''}`;
      }), ['dart']);
    }
    case 'people': {
      const b = balances(today);
      const ppl = acc.filter((a) => a.type === 'person' && !a.archived && Math.abs(b[a.id] || 0) >= 1);
      const home = tx.filter((t) => t.forHome && !t.homeSettled);
      if (!ppl.length && !home.length) return null;
      return out('Money with people', [...ppl.map((a) => ((b[a.id] || 0) > 0 ? `${a.name} owes you ${fmt(b[a.id])}` : `You owe ${a.name} ${fmt(-(b[a.id]))}`)),
        home.length ? `${home.length} home expense${home.length === 1 ? '' : 's'} to take back: ${fmt(home.reduce((s, t) => s + num(t.amount), 0))}` : ''], ['busts_in_silhouette']);
    }
    case 'units': {
      const linked = acc.filter((a) => a.type === 'investment' && (a.schemeCode || a.ticker));
      const pending = tx.filter((t) => t.type !== 'adjustment' && t.date <= addDays(today, -3) && (t.units === undefined || t.units === null || t.units === '')
        && linked.some((a) => (t.toAccountId === a.id || t.fromAccountId === a.id) && (a.unitsDate ? t.date > a.unitsDate : t.date >= (a.openingDate || ''))));
      if (!pending.length) return null;
      return out('SIP units to confirm', `${pending.length} purchase${pending.length === 1 ? '' : 's'} still need units. Open the Portfolio page to check them.`, ['clipboard']);
    }
    case 'fun_money': {
      const cfg = S.funMoney || {};
      if (!num(cfg.monthly)) return null;
      const cats = cfg.categories || [];
      const spentFun = tx.filter((t) => t.type === 'expense' && t.date >= monthStart && t.date <= today && cats.includes(t.category)).reduce((s, t) => s + num(t.amount), 0);
      const left = num(cfg.monthly) - spentFun, daysLeft = daysIn - elapsed + 1;
      return out(left >= 0 ? `Fun money left: ${fmt(left)}` : 'Fun money used up', left >= 0 ? `About ${fmt(left / daysLeft)} a day for ${daysLeft} days. Enjoy it guilt-free.` : `Over by ${fmt(-left)} this month. It refills on the 1st.`, ['tada']);
    }
    case 'runway': {
      const b = balances(today);
      const liquid = acc.filter((a) => !a.archived && (a.type === 'cash' || a.type === 'bank')).reduce((s, a) => s + Math.max(0, b[a.id] || 0), 0);
      const perMonth = { weekly: 4.33, monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12 };
      const fixed = (db.subscriptions || []).filter((s) => s.active && s.kind === 'bill').reduce((s, x) => s + num(x.amount) * (perMonth[x.frequency] || 1), 0)
        + (db.emis || []).reduce((s, e) => s + (emiInfo(e).next ? emiInfo(e).emi : 0), 0);
      const ess = ['Groceries', 'Utilities', 'Health', 'Transport', 'Fuel', 'Insurance', 'Education'];
      const from3 = addMonths(monthStart, -3);
      const variable = tx.filter((t) => t.type === 'expense' && t.date >= from3 && t.date < monthStart && ess.includes(t.category)).reduce((s, t) => s + num(t.amount), 0) / 3;
      const need = fixed + variable;
      if (!need) return null;
      const months = liquid / need;
      return out(`Emergency runway: ${Math.floor(months)} months ${Math.round((months % 1) * 30)} days`, [`${fmt(liquid)} of cash and bank money covers ${fmt(need)} of essential costs a month.`, months < 3 ? 'Below 3 months: building this up is the priority.' : months >= 6 ? 'Six months or more: a strong safety net.' : 'Aim for 6 months.'], ['shield'], months < 3 ? 4 : 3);
    }
    case 'credit_use': {
      const b = balances(today), th = num(n.threshold ?? 30);
      const cards = acc.filter((a) => a.type === 'credit_card' && !a.archived && num(a.creditLimit) > 0);
      const blocked = (a) => (db.emis || []).filter((e) => e.accountId === a.id && e.kind === 'credit_card').reduce((s, e) => s + emiInfo(e).left, 0);
      const usedOf = (a) => Math.max(0, -(b[a.id] || 0)) + blocked(a);
      const limit = cards.reduce((s, a) => s + num(a.creditLimit), 0), used = cards.reduce((s, a) => s + usedOf(a), 0);
      if (!limit || pct(used, limit) < th) return null;
      return out(`Card usage at ${pct(used, limit)}%`, ['High card usage can dip your credit score for a while. Paying part of the bill before the statement date helps.', ...cards.map((a) => `${a.name}: ${pct(usedOf(a), num(a.creditLimit))}%`)], ['credit_card'], 4);
    }
    case 'cooloff': {
      const ready = (db.wishlist || []).filter((w) => w.status === 'cooling' && w.coolUntil && w.coolUntil.slice(0, 10) <= today);
      if (!ready.length) return null;
      return out('Cool-off over: still want it?', ready.map((w) => `${w.name} (${fmt(w.price)}): skip it for a saving win, or keep it on your wishlist.`), ['hourglass']);
    }
    case 'custom':
      return out(n.title || 'Reminder', n.text || '', ['bell']);
    default:
      return null;
  }
}
/** Does a notification repeat on this India date? (Also copied into the GitHub job.) */
function koshNotifyDay(n, date) {
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  const dom = +date.slice(8, 10);
  const last = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate();
  switch (n.repeat || 'daily') {
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekends': return wd === 0 || wd === 6;
    case 'weekly': return wd === Number(n.weekday ?? 0);
    case 'monthly': return n.monthDay === 'last' ? dom === last : dom === Math.min(Number(n.monthDay) || 1, last);
    default: return true;
  }
}

/* ----- The kinds of notification you can add ----- */
const NOTIFY_TYPES = {
  balances:     { label: 'Balances in all accounts', icon: 'fa-building-columns', desc: 'Every bank account and cash, the total, and card dues.', time: '08:00', opts: [['includeCards', 'check', 'Include credit card dues', true], ['includeInvestments', 'check', 'Include investments', false]] },
  yesterday:    { label: "Yesterday's spending", icon: 'fa-receipt', desc: 'What you spent yesterday, by category, against your daily average.', time: '08:00' },
  log_reminder: { label: "Log today's expenses", icon: 'fa-pen-to-square', desc: 'A nudge to add what you spent today.', time: '21:00', opts: [['onlyIfNothing', 'check', 'Only if nothing is logged yet today', true]] },
  today:        { label: "Today's spending so far", icon: 'fa-sun', desc: 'An evening look at what today cost.', time: '20:00' },
  upcoming:     { label: 'Payments coming up', icon: 'fa-calendar-check', desc: 'Subscriptions, rent, salary, EMIs, SIPs and card bills due soon. Sent only when something is due.', time: '09:00', opts: [['days', 'select', 'Look ahead', [['0', 'Today only'], ['1', 'Today and tomorrow'], ['3', 'Next 3 days'], ['7', 'Next 7 days']], '1']] },
  card_due:     { label: 'Credit card bill due', icon: 'fa-credit-card', desc: 'Reminds you before a card payment is due, with the amount.', time: '10:00', opts: [['days', 'number', 'Days before the due date', 3]] },
  budgets:      { label: 'Budget alerts', icon: 'fa-bullseye', desc: 'When a category passes a share of its monthly budget. Silent otherwise.', time: '20:30', opts: [['threshold', 'number', 'Alert at % of budget', 80]] },
  low_balance:  { label: 'Low balance', icon: 'fa-triangle-exclamation', desc: 'When a bank account or cash drops below an amount.', time: '09:00', opts: [['below', 'number', 'Alert below (amount)', 5000]] },
  big_spend:    { label: 'Large expenses', icon: 'fa-money-bill-trend-up', desc: "Yesterday's expenses above an amount.", time: '08:30', opts: [['above', 'number', 'Above (amount)', 2000]] },
  month_pace:   { label: 'This month so far', icon: 'fa-gauge-high', desc: 'Spent this month, where it is heading, budgets near their limit.', time: '09:00', repeat: 'weekly', weekday: 1 },
  week:         { label: 'Weekly summary', icon: 'fa-calendar-week', desc: 'Last 7 days vs the week before, and where the money went.', time: '19:00', repeat: 'weekly', weekday: 0 },
  month_report: { label: 'Monthly report', icon: 'fa-chart-column', desc: 'Last month: money in, spent, invested, how much you kept, top categories.', time: '09:00', repeat: 'monthly', monthDay: 1 },
  net_worth:    { label: 'Net worth', icon: 'fa-scale-balanced', desc: 'What you own, what you owe, and the difference.', time: '09:00', repeat: 'weekly', weekday: 0 },
  portfolio:    { label: 'Portfolio value', icon: 'fa-chart-line', desc: 'Value, invested and profit, from the latest prices the app saved.', time: '18:00', repeat: 'weekdays' },
  goals:        { label: 'Goals progress', icon: 'fa-flag-checkered', desc: 'How far along each goal is and what to save each month.', time: '10:00', repeat: 'weekly', weekday: 0 },
  people:       { label: 'Money with people', icon: 'fa-user-group', desc: 'Who owes you, what you owe, home expenses to take back.', time: '11:00', repeat: 'weekly', weekday: 0 },
  units:        { label: 'SIP units to confirm', icon: 'fa-clipboard-check', desc: 'Purchases whose units still need checking.', time: '19:00', repeat: 'weekly', weekday: 6 },
  fun_money:    { label: 'Fun money left', icon: 'fa-champagne-glasses', desc: 'How much guilt-free money is left this month, per day.', time: '19:00', repeat: 'weekly', weekday: 5 },
  runway:       { label: 'Emergency runway', icon: 'fa-life-ring', desc: 'How many months your cash and bank money would last on essential costs.', time: '10:00', repeat: 'monthly', monthDay: 1 },
  credit_use:   { label: 'Card usage alert', icon: 'fa-gauge', desc: 'When card spending passes a share of your limits (30% by default), which can dip your credit score.', time: '19:30', opts: [['threshold', 'number', 'Alert at % of limits', 30]] },
  cooloff:      { label: 'Cool-off ready', icon: 'fa-hourglass-end', desc: 'When a cool-off on something you wanted to buy is over.', time: '12:00' },
  custom:       { label: 'Your own reminder', icon: 'fa-bell', desc: 'Any text, e.g. "Pay the maid" on the 1st of every month.', time: '10:00', opts: [['title', 'text', 'Title', 'Reminder'], ['text', 'text', 'Message', '']] },
};
const RECOMMENDED = [
  { type: 'balances', time: '08:00' }, { type: 'yesterday', time: '08:05' }, { type: 'upcoming', time: '09:00', days: 1 },
  { type: 'log_reminder', time: '21:00' }, { type: 'budgets', time: '20:30' }, { type: 'week', time: '19:00', repeat: 'weekly', weekday: 0 },
  { type: 'month_report', time: '09:30', repeat: 'monthly', monthDay: 1 },
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NOTIFY_LEAD_MIN = 20;
function repeatText(n) {
  const at = `at ${fmtTime12(n.time)}`;
  switch (n.repeat || 'daily') {
    case 'weekdays': return `Mon to Fri ${at}`;
    case 'weekends': return `Sat and Sun ${at}`;
    case 'weekly': return `Every ${WEEKDAY_NAMES[Number(n.weekday ?? 0)]} ${at}`;
    case 'monthly': return `${n.monthDay === 'last' ? 'Last day' : `${ordinal(Number(n.monthDay) || 1)}`} of every month ${at}`;
    default: return `Every day ${at}`;
  }
}
function fmtTime12(t) { const [h, m] = String(t || '00:00').split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad2(m)} ${h < 12 ? 'am' : 'pm'}`; }
const istNow = () => new Date(Date.now() + 330 * 60000);
function previewNotification(n) { try { return koshNotifyEngine(db, istNow(), n); } catch (e) { return { title: 'Preview failed', message: e.message }; } }

/* ----- Sending (the app's "Send now" and the test button) ----- */
async function ntfyPublish(payload) {
  const res = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`ntfy answered ${res.status}`);
}
async function sendNotificationNow(n) {
  const topic = db.settings.ntfyTopic;
  if (!topic) { toast('Set up your phone first (step 2 above).', 'error'); return; }
  const msg = previewNotification(n);
  if (!msg) { toast('Nothing to say right now, so this one would stay silent today.'); return; }
  try { await ntfyPublish({ topic, title: msg.title, message: msg.message, tags: msg.tags, priority: msg.priority, click: APP_URL() }); toast('Sent. Check your phone.', 'success'); }
  catch (e) { toast(`Couldn't send: ${e.message}`, 'error'); }
}

/* ----- The GitHub job ----- */
/** Cron lines (UTC, 20 minutes early) mapped to the India times they serve. */
function notifySchedule() {
  const map = {};
  for (const n of db.notifications.filter((x) => x.enabled !== false)) {
    const [h, m] = n.time.split(':').map(Number);
    let mins = h * 60 + m - 330 - NOTIFY_LEAD_MIN;
    mins = ((mins % 1440) + 1440) % 1440;
    const cron = `${mins % 60} ${Math.floor(mins / 60)} * * *`;
    (map[cron] = map[cron] || []).includes(n.time) || map[cron].push(n.time);
  }
  return map;
}
const scheduleSignature = () => JSON.stringify({ v: 2, map: notifySchedule(), topic: db.settings.ntfyTopic, path: config.path, url: APP_URL() });
function notifyWorkflow() {
  const map = notifySchedule();
  const crons = Object.keys(map);
  const script = `
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.env.DATA_PATH, 'utf8'));
const MAP = ${JSON.stringify(map)};
const LEAD_MS = ${NOTIFY_LEAD_MIN} * 60000, IST_MS = 330 * 60000;
const topic = (db.settings && db.settings.ntfyTopic) || process.env.TOPIC;
const schedule = process.env.SCHEDULE || '';
const manual = !schedule;
const engine = ${koshNotifyEngine.toString()};
const onDay = ${koshNotifyDay.toString()};
const nowIst = new Date(Date.now() + IST_MS);
// The India moment a notification is for: today at its time, or tomorrow if the job
// started just before midnight India time.
function target(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  let t = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), h, m);
  if (t - nowIst.getTime() < -12 * 3600e3) t += 864e5;
  if (t - nowIst.getTime() > 12 * 3600e3) t -= 864e5;
  return new Date(t);
}
(async () => {
  const times = manual ? null : MAP[schedule] || [];
  const list = (db.notifications || []).filter((n) => n.enabled !== false && (manual || times.includes(n.time)));
  console.log('India time now', nowIst.toISOString().slice(0, 16).replace('T', ' '), '| schedule', schedule || 'manual', '| notifications', list.length);
  for (const n of list) {
    const at = manual ? nowIst : target(n.time);
    if (!manual && !onDay(n, at.toISOString().slice(0, 10))) { console.log('skip (not today)', n.type); continue; }
    const msg = engine(db, at, n);
    if (!msg) { console.log('nothing to say', n.type); continue; }
    const deliverUtc = Math.round((at.getTime() - IST_MS) / 1000);
    const early = !manual && deliverUtc - Date.now() / 1000 > 15;
    const body = { topic, title: msg.title, message: msg.message, tags: msg.tags, priority: msg.priority, click: process.env.APP_URL };
    if (early) body.delay = String(deliverUtc); // ntfy delivers it at the exact time
    const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log(n.type, n.time, early ? 'scheduled for ' + n.time + ' IST' : 'sent now', r.status);
  }
})().catch((e) => { console.error(e); process.exit(1); });`;
  return `# Phone notifications for Kundan's Finance (KOSH). Created by the app; it rewrites
# this file when you change your notifications. Times below are UTC (India minus 5:30),
# ${NOTIFY_LEAD_MIN} minutes early; ntfy delivers each message at the exact India time.
name: KOSH notifications
on:
  schedule:
${crons.length ? crons.map((c) => `    - cron: '${c}'   # for ${map[c].join(', ')} India time`).join('\n') : "    - cron: '0 0 1 1 *'"}
  workflow_dispatch:
permissions:
  contents: read
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Send notifications
        env:
          SCHEDULE: \${{ github.event.schedule }}
          TOPIC: ${db.settings.ntfyTopic}
          APP_URL: ${APP_URL()}
          DATA_PATH: ${config.path || 'data.json'}
        run: |
          node - <<'JS'
${script.split('\n').map((l) => '          ' + l).join('\n')}
          JS
`;
}
const notifyState = { syncing: false, error: '' };
/** Write (or rewrite) the job in the data repository when the schedule changed. */
async function syncNotifyWorkflow({ quiet = false } = {}) {
  if (!db.settings.ntfyTopic || !isConfigured() || notifyState.syncing) return false;
  if (!navigator.onLine) return false;
  notifyState.syncing = true;
  const sig = scheduleSignature();
  try {
    const yml = notifyWorkflow();
    const cur = await ghPath(WORKFLOW_PATH);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const res = await ghPath(WORKFLOW_PATH, 'PUT', { message: 'KOSH: update notifications', content: toBase64(yml), branch: config.branch || 'main', ...(sha ? { sha } : {}) });
    if (res.status === 403 || res.status === 404) { notifyState.error = 'perm'; if (!quiet) showWorkflowManual(yml); return false; }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    notifyState.error = '';
    commit([opSettings({ notifySchedule: sig })], 'Phone notification schedule updated');
    if (!quiet) toast('Phone schedule updated.', 'success');
    return true;
  } catch (e) {
    notifyState.error = e.message;
    if (!quiet) toast(`Couldn't update the phone schedule: ${e.message}`, 'error');
    return false;
  } finally { notifyState.syncing = false; if (location.hash === '#notifications') render(); }
}
const scheduleUpToDate = () => db.settings.notifySchedule === scheduleSignature();
let notifySyncTimer = null;
function scheduleNotifySync() { clearTimeout(notifySyncTimer); notifySyncTimer = setTimeout(() => syncNotifyWorkflow({ quiet: true }), 1500); }
/** First run of this version: turn the old single daily reminder into a notification, and refresh the job. */
function migrateNotifications() {
  if (db.settings.notificationsMigrated) return;
  const ops = [opSettings({ notificationsMigrated: true })];
  if (db.settings.ntfyTopic && !db.notifications.length) ops.push(opUpsert('notifications', { id: uid('ntf'), type: 'log_reminder', time: db.settings.reminderTime || '21:00', repeat: 'daily', enabled: true, onlyIfNothing: true }));
  commit(ops, 'Set up custom notifications');
}
function notifyOnStart() {
  migrateNotifications();
  if (db.settings.ntfyTopic && !scheduleUpToDate()) setTimeout(() => syncNotifyWorkflow({ quiet: true }), 2000);
}

/* ----- Notifications page ----- */
function renderNotifications() {
  const topic = db.settings.ntfyTopic || '';
  const list = db.notifications.slice().sort((a, b) => a.time.localeCompare(b.time));
  const upToDate = topic && scheduleUpToDate();
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Choose what your phone tells you and when: balances every morning, yesterday's spending, bills due, budget alerts, weekly and monthly summaries, or your own reminders. Times are India time.</p>
      <div class="flex gap-2 flex-wrap">${list.length ? '' : '<button class="btn" data-action="ntf-recommended"><i class="fa-solid fa-wand-magic-sparkles"></i> Add a recommended set</button>'}
        <button class="btn btn-primary" data-action="ntf-add"><i class="fa-solid fa-plus"></i> Add notification</button></div>
    </div>

    <section class="panel p-5 mb-6">
      <div class="panel-head"><h2 class="panel-title">Your phone</h2>
        ${topic ? `<span class="pill ${upToDate ? 'in' : 'due'}">${upToDate ? 'Schedule up to date' : notifyState.syncing ? 'Updating…' : 'Schedule needs updating'}</span>` : ''}</div>
      <ol class="list-decimal ml-5 space-y-3 text-sm">
        <li>Install the free <b>ntfy</b> app (App Store or Play Store) and allow notifications.</li>
        <li>Your private topic: <span class="inline-flex flex-wrap gap-2 align-middle mt-1"><code class="topic-code">${esc(topic || 'not created yet')}</code>
          <button type="button" class="btn btn-sm" data-action="ntf-topic">${topic ? 'Change' : 'Create'}</button>${topic ? '<button type="button" class="btn btn-sm" data-action="ntf-copy">Copy</button>' : ''}</span>
          <div class="hint">In ntfy tap <b>+</b>, paste exactly this name, and subscribe (server: ntfy.sh).</div></li>
        <li><button type="button" class="btn btn-sm" data-action="ntf-test" ${topic ? '' : 'disabled'}>Send a test</button> <span class="hint inline">It should arrive within seconds.</span></li>
        <li><button type="button" class="btn btn-sm btn-primary" data-action="ntf-sync" ${topic ? '' : 'disabled'}>${upToDate ? 'Re-send schedule to GitHub' : 'Send schedule to GitHub'}</button>
          <div class="hint">Creates a small scheduled job in your private data repository. Your token needs <b>Workflows: Read and write</b> (GitHub → Developer settings → your token). After that, changes here update it by themselves.</div>
          ${notifyState.error === 'perm' ? '<p class="callout warn mt-2">GitHub refused: the token is missing the Workflows permission. Add it, or press the button again to see the file to paste by hand.</p>' : notifyState.error ? `<p class="callout warn mt-2">${esc(notifyState.error)}</p>` : ''}</li>
      </ol>
      <p class="hint mt-3">Each message is prepared ${NOTIFY_LEAD_MIN} minutes early and ntfy delivers it at the exact time. Messages pass through ntfy.sh; anyone who knows the topic could read them, so keep it private, or tick <b>Hide amounts</b> on a notification.</p>
    </section>

    ${list.length ? `<section class="panel p-5"><div class="divider">${list.map(notifyRow).join('')}</div></section>`
      : `<section class="panel">${emptyState('fa-bell', 'No notifications yet. Add the ones you want, or start with the recommended set.', '<button class="btn btn-primary" data-action="ntf-recommended">Add the recommended set</button>')}</section>`}`;
}
function notifyRow(n) {
  const T = NOTIFY_TYPES[n.type] || NOTIFY_TYPES.custom;
  const p = previewNotification(n);
  return `<div class="row items-start ${n.enabled === false ? 'opacity-60' : ''}">
    <span class="insight-icon"><i class="fa-solid ${T.icon}"></i></span>
    <div class="min-w-0 flex-1">
      <div class="font-semibold">${esc(n.type === 'custom' ? n.title || T.label : T.label)} ${n.hideAmounts ? '<span class="pill">amounts hidden</span>' : ''}</div>
      <div class="text-xs text-ink-3 mt-0.5">${esc(repeatText(n))}</div>
      <div class="ntf-preview">${p ? `<b>${esc(p.title)}</b><br>${esc(p.message).replace(/\n/g, '<br>')}` : '<span class="text-ink-3">Nothing to say right now, so it would stay silent today.</span>'}</div>
    </div>
    <div class="flex flex-col items-end gap-2 ntf-side">
      <label class="switch" title="${n.enabled === false ? 'Off' : 'On'}"><input type="checkbox" data-ntf-toggle="${n.id}" ${n.enabled === false ? '' : 'checked'}><span></span></label>
      <div class="flex gap-1"><button class="icon-btn sm" data-action="ntf-send" data-id="${n.id}" title="Send now" aria-label="Send now"><i class="fa-solid fa-paper-plane"></i></button>
        <button class="icon-btn sm" data-action="ntf-edit" data-id="${n.id}" title="Edit" aria-label="Edit"><i class="fa-regular fa-pen-to-square"></i></button></div>
    </div>
  </div>`;
}
function openNotifyForm(existing) {
  const isNew = !existing;
  const n = existing ? { ...existing } : { type: 'balances', time: NOTIFY_TYPES.balances.time, repeat: 'daily', enabled: true };
  const tiles = Object.entries(NOTIFY_TYPES).map(([k, t]) => `<input type="radio" name="type" id="nt_${k}" value="${k}" ${n.type === k ? 'checked' : ''}><label for="nt_${k}"><i class="fa-solid ${t.icon}"></i><span>${t.label}</span></label>`).join('');
  const optsHtml = (type, vals) => (NOTIFY_TYPES[type].opts || []).map(([key, kind, label, a, b]) => {
    const v = vals[key] ?? (kind === 'select' ? b : a);
    if (kind === 'check') return checkbox(`o_${key}`, v !== false, label);
    if (kind === 'select') return field(label, select(`o_${key}`, a, String(v)));
    if (kind === 'number') return field(label, input(`o_${key}`, v, 'type="number" min="0" step="1"'));
    return field(label, input(`o_${key}`, v ?? '', 'maxlength="120"'));
  }).join('');
  openModal({
    title: isNew ? 'Add notification' : 'Edit notification',
    wide: true,
    body: `<div><span class="lbl">What should it tell you?</span><div class="type-grid ntf-grid">${tiles}</div><p class="hint mt-2" data-desc></p></div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        ${field('Time (India)', input('time', n.time, 'type="time" required'))}
        ${field('Repeat', select('repeat', [['daily', 'Every day'], ['weekdays', 'Monday to Friday'], ['weekends', 'Saturday and Sunday'], ['weekly', 'Once a week'], ['monthly', 'Once a month']], n.repeat || 'daily'))}
        <div data-wk>${field('Day', select('weekday', WEEKDAY_NAMES.map((d, i) => [String(i), d]), String(n.weekday ?? 0)))}</div>
        <div data-md>${field('Day of the month', select('monthDay', [...Array.from({ length: 28 }, (_, i) => [String(i + 1), ordinal(i + 1)]), ['last', 'Last day']], String(n.monthDay ?? 1)))}</div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4" data-opts>${optsHtml(n.type, n)}</div>
      ${checkbox('hideAmounts', !!n.hideAmounts, 'Hide amounts (show ••• instead)', 'For privacy: the message still tells you what happened, without rupee figures.')}
      <div><span class="lbl">Preview (with today's data)</span><div class="ntf-phone" data-preview></div></div>`,
    submitLabel: isNew ? 'Add' : 'Save',
    onOpen: (form) => {
      const sig = { signal: modalSignal() };
      const read = () => {
        const d = readForm(form);
        const rec = { type: d.type, time: d.time || '09:00', repeat: d.repeat, weekday: int(d.weekday), monthDay: d.monthDay === 'last' ? 'last' : int(d.monthDay), hideAmounts: !!d.hideAmounts };
        for (const [key, kind] of NOTIFY_TYPES[d.type].opts || []) { const v = d[`o_${key}`]; rec[key] = kind === 'check' ? !!v : kind === 'number' ? num(v) : kind === 'select' ? v : v || ''; }
        return rec;
      };
      const refresh = () => {
        const r = read();
        $('[data-desc]', form).textContent = NOTIFY_TYPES[r.type].desc;
        $('[data-wk]', form).hidden = r.repeat !== 'weekly';
        $('[data-md]', form).hidden = r.repeat !== 'monthly';
        const p = previewNotification(r);
        $('[data-preview]', form).innerHTML = p ? `<div class="ntf-app">ntfy · ${esc(fmtTime12(r.time))}</div><b>${esc(p.title)}</b><div>${esc(p.message).replace(/\n/g, '<br>')}</div>` : '<span class="text-ink-3">Nothing to say with today\'s data, so it would stay silent. It will speak up when there is something.</span>';
      };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'type') {
          const T = NOTIFY_TYPES[e.target.value];
          $('[data-opts]', form).innerHTML = optsHtml(e.target.value, {});
          form.elements.time.value = T.time;
          form.elements.repeat.value = T.repeat || 'daily';
          if (T.weekday !== undefined) form.elements.weekday.value = String(T.weekday);
          if (T.monthDay !== undefined) form.elements.monthDay.value = String(T.monthDay);
        }
        refresh();
      }, sig);
      form.addEventListener('input', refresh, sig);
      refresh();
      form._read = read;
    },
    onSubmit: (d, form) => {
      const rec = { ...(existing || {}), ...form._read(), id: existing?.id || uid('ntf'), enabled: existing ? existing.enabled !== false : true };
      commit([opUpsert('notifications', rec)], `${isNew ? 'Add' : 'Edit'} notification ${rec.type}`);
      toast(isNew ? 'Notification added' : 'Saved', 'success');
      scheduleNotifySync();
    },
    onDelete: existing ? () => {
      commit([opDelete('notifications', existing.id)], 'Delete notification');
      scheduleNotifySync();
    } : null,
  });
}
function addRecommendedNotifications() {
  const ops = RECOMMENDED.filter((r) => !db.notifications.some((n) => n.type === r.type)).map((r) => {
    const T = NOTIFY_TYPES[r.type];
    const extra = Object.fromEntries((T.opts || []).map(([k, kind, , a, b]) => [k, kind === 'select' ? b : a]));
    return opUpsert('notifications', { id: uid('ntf'), repeat: T.repeat || 'daily', weekday: T.weekday, monthDay: T.monthDay, ...extra, ...r, enabled: true });
  });
  commit(ops, 'Add recommended notifications');
  toast(`Added ${ops.length} notifications. Edit or switch off any of them.`, 'success');
  scheduleNotifySync();
}
function changeTopic() {
  if (db.settings.ntfyTopic && !confirm('Make a new topic? You will need to subscribe to the new name in the ntfy app.')) return;
  commit([opSettings({ ntfyTopic: randomTopic() })], 'New notification topic');
  scheduleNotifySync();
}

/* ===== Description suggestions =====
   Every description you save is remembered (settings.savedDescriptions, kept
   even if the transaction is deleted). While you type in a transaction's
   description, matching ones appear below the box: words that START with what
   you typed come first, then ones that contain it; more used and more recent
   ones rank higher. Picking one also fills its usual category when you haven't
   chosen one yourself. The × next to a suggestion forgets it (e.g. a typo). */
const DESC_MAX = 400;
const descKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
function descriptionIndex() {
  const idx = new Map();
  const hidden = new Set((db.settings.hiddenDescriptions || []).map(descKey));
  const add = (text, { type, category, date, count = 1 }) => {
    const k = descKey(text);
    if (!k || k.length < 2 || hidden.has(k)) return;
    const e = idx.get(k) || { text: text.trim(), count: 0, last: '', types: {}, cats: {} };
    e.count += count;
    if ((date || '') >= e.last) { e.last = date || e.last; e.text = text.trim(); }
    if (type) e.types[type] = (e.types[type] || 0) + count;
    if (category) e.cats[`${type}|${category}`] = (e.cats[`${type}|${category}`] || 0) + count;
    idx.set(k, e);
  };
  for (const s of db.settings.savedDescriptions || []) add(s.t, { type: s.type, category: s.cat, date: s.last, count: s.n || 1 });
  for (const t of db.transactions) if (t.description && !['sip', 'emi', 'market'].includes(t.relatedType) && t.type !== 'adjustment') add(t.description, { type: t.forHome ? 'expense' : t.type, category: t.category, date: t.date });
  return idx;
}
function descSuggestions(q, type, limit = 6) {
  const k = descKey(q);
  const all = [...descriptionIndex().values()];
  const score = (e) => {
    const t = descKey(e.text);
    let s = 0;
    if (!k) s = 1;
    else if (t.startsWith(k)) s = 3;
    else if (t.split(' ').some((w) => w.startsWith(k))) s = 2;
    else if (k.length >= 3 && t.includes(k)) s = 1;
    if (!s || t === k) return 0;
    const sameType = (e.types[type] || 0) > 0 ? 1.5 : 1;
    const recent = e.last ? Math.max(0, 1 - (parseDate(todayStr()) - parseDate(e.last)) / (180 * 864e5)) : 0;
    return s * 10 + Math.log2(1 + e.count) * sameType + recent * 2;
  };
  return all.map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}
const usualCategory = (e, type) => Object.entries(e.cats).filter(([k]) => k.startsWith(`${type}|`)).sort((a, b) => b[1] - a[1])[0]?.[0].split('|')[1] || '';
/** Remember a description after a transaction is saved (returns a settings op, or null). */
function rememberDescription(rec) {
  const text = String(rec.description || '').trim();
  if (text.length < 2 || ['sip', 'emi', 'market'].includes(rec.relatedType)) return null;
  const type = rec.forHome ? 'expense' : rec.type;
  const list = (db.settings.savedDescriptions || []).slice();
  const i = list.findIndex((x) => descKey(x.t) === descKey(text) && x.type === type);
  const entry = { t: text, type, cat: rec.category || '', n: (i >= 0 ? list[i].n || 1 : 0) + 1, last: rec.date || todayStr() };
  if (i >= 0) list.splice(i, 1);
  list.unshift(entry);
  const hidden = (db.settings.hiddenDescriptions || []).filter((h) => descKey(h) !== descKey(text));
  return opSettings({ savedDescriptions: list.slice(0, DESC_MAX), ...(hidden.length !== (db.settings.hiddenDescriptions || []).length ? { hiddenDescriptions: hidden } : {}) });
}
function forgetDescription(text) {
  const k = descKey(text);
  commit([opSettings({
    savedDescriptions: (db.settings.savedDescriptions || []).filter((x) => descKey(x.t) !== k),
    hiddenDescriptions: [...new Set([...(db.settings.hiddenDescriptions || []), text.trim()])].slice(-500),
  })], 'Forget a description');
}
/** Attach the suggestion list to a form's description box. */
function attachDescriptionSuggest(form) {
  const inp = form.elements.description;
  if (!inp || inp.dataset.suggest) return;
  inp.dataset.suggest = '1';
  inp.setAttribute('autocomplete', 'off');
  inp.setAttribute('role', 'combobox');
  inp.setAttribute('aria-autocomplete', 'list');
  inp.setAttribute('aria-expanded', 'false');
  const wrap = document.createElement('div');
  wrap.className = 'desc-wrap';
  inp.parentNode.insertBefore(wrap, inp);
  wrap.appendChild(inp);
  const box = document.createElement('div');
  box.className = 'desc-list';
  box.id = 'descList';
  box.setAttribute('role', 'listbox');
  box.hidden = true;
  wrap.appendChild(box);
  inp.setAttribute('aria-controls', 'descList');
  let items = [], active = -1, touchedCategory = false;
  const typeNow = () => form.elements.type?.value || 'expense';
  const catSelect = () => $$('select[name="category"]', form).find((el) => !el.disabled);
  form.addEventListener('change', (e) => { if (e.target.name === 'category') touchedCategory = true; }, { signal: modalSignal() });
  const close = () => { box.hidden = true; box.innerHTML = ''; active = -1; inp.setAttribute('aria-expanded', 'false'); };
  const show = () => {
    items = descSuggestions(inp.value, typeNow());
    if (!items.length) return close();
    const k = descKey(inp.value);
    box.innerHTML = items.map((e, i) => {
      const cat = usualCategory(e, typeNow());
      const t = esc(e.text);
      const hi = k && descKey(e.text).startsWith(k) ? `<b>${esc(e.text.slice(0, k.length))}</b>${esc(e.text.slice(k.length))}` : t;
      return `<div class="desc-item ${i === active ? 'on' : ''}" role="option" data-i="${i}" aria-selected="${i === active}">
        <span class="flex-1 min-w-0 truncate">${hi}</span>${cat ? `<span class="pill">${esc(cat)}</span>` : ''}<span class="text-xs text-ink-3">${e.count}×</span>
        <button type="button" class="desc-x" data-forget="${i}" title="Forget this" aria-label="Forget ${t}">×</button></div>`;
    }).join('');
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
  };
  const pick = (i) => {
    const e = items[i];
    if (!e) return;
    inp.value = e.text;
    const cat = usualCategory(e, typeNow()), sel = catSelect();
    if (cat && sel && !touchedCategory && [...sel.options].some((o) => o.value === cat)) { sel.value = cat; sel.dispatchEvent(new Event('change', { bubbles: true })); touchedCategory = false; }
    close();
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };
  const sig = { signal: modalSignal() };
  inp.addEventListener('input', (e) => { if (e.isTrusted !== false) { active = -1; show(); } }, sig);
  inp.addEventListener('focus', show, sig);
  inp.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; show(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; show(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab' && items.length && inp.value.trim()) { if (active < 0 && descKey(items[0].text).startsWith(descKey(inp.value))) { pick(0); } }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }, sig);
  // pointerdown (not click) so the choice lands before the box loses focus
  box.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('[data-forget]');
    if (f) { e.preventDefault(); forgetDescription(items[+f.dataset.forget].text); items.splice(+f.dataset.forget, 1); setTimeout(show, 50); return; }
    const it = e.target.closest('.desc-item');
    if (it) { e.preventDefault(); pick(+it.dataset.i); }
  }, sig);
  inp.addEventListener('blur', () => setTimeout(close, 120), sig);
  form.addEventListener('change', (e) => { if (e.target.name === 'type' && !box.hidden) show(); }, sig);
}

/* ===== Calendar =====
   A month grid: each day shows money spent (red), income (green) and money
   invested (amber), shaded by how much was spent. Days ahead show what is
   scheduled: subscriptions and bills, salary, SIPs, EMIs and card due dates.
   Tap a day to see its transactions and add one on that date. */
let calMonth = thisMonth();
let calView = 'both'; // both | spent | income
const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Money in, out and invested per day of a month, plus the transactions of each day. */
function calendarDays(mk) {
  const days = new Map();
  const get = (d) => { if (!days.has(d)) days.set(d, { spent: 0, income: 0, invested: 0, home: 0, count: 0, list: [] }); return days.get(d); };
  for (const t of db.transactions) {
    if (!t.date?.startsWith(mk) || t.type === 'adjustment' || t.relatedType === 'market') continue;
    const e = get(t.date);
    e.list.push(t);
    if (t.type === 'expense') { e.spent += num(t.amount); e.count++; }
    else if (t.type === 'income') { e.income += num(t.amount); e.count++; }
    else if (t.forHome) { e.home += num(t.amount); e.count++; }
    else if (isInvestmentOutflow(t)) { e.invested += num(t.amount); e.count++; }
    else e.count++;
  }
  return days;
}
/** Everything scheduled in a month from today on (recurring items repeat inside the month). */
function calendarSchedule(mk) {
  const from = `${mk}-01`, to = addDays(addMonths(from, 1), -1), today = todayStr();
  const out = [];
  const push = (date, kind, title, amount, icon) => { if (date >= today && date >= from && date <= to) out.push({ date, kind, title, amount, icon }); };
  for (const s of db.subscriptions) {
    if (!s.active || !s.nextRenewal) continue;
    let d = s.nextRenewal, guard = 0;
    while (d <= to && guard++ < 40) { push(d, recurKind(s) === 'income' ? 'income' : 'bill', s.name, num(s.amount), recurKind(s) === 'income' ? 'fa-briefcase' : 'fa-rotate'); d = advanceDate(d, s.frequency); }
  }
  for (const x of db.sips) {
    if (!x.active || !x.nextDate) continue;
    let d = x.nextDate, guard = 0;
    while (d <= to && !sipEnded(x, d) && guard++ < 40) { push(d, 'sip', `${x.name} SIP`, sipAmountOn(x, d), 'fa-seedling'); d = advanceSip(x, d); }
  }
  for (const { e, c } of M.emis) {
    if (c.status !== 'active' || !c.nextDue) continue;
    let d = c.nextDue, k = 0;
    while (d <= to && k < c.n - c.paid) { push(d, 'emi', `${e.name} EMI`, c.emi, 'fa-calendar-check'); d = addMonths(c.nextDue, ++k); }
  }
  for (const a of db.accounts) {
    if (a.type !== 'credit_card' || a.archived) continue;
    const m = cardMetrics(a);
    if (m.dates.nextDue && m.outstanding > 0) push(m.dates.nextDue, 'card', `${a.name} bill due`, m.outstanding, 'fa-credit-card');
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

function renderCalendar() {
  const mk = calMonth;
  const y = +mk.slice(0, 4), m = +mk.slice(5) - 1, dim = daysInMonth(y, m);
  const days = calendarDays(mk), sched = calendarSchedule(mk);
  const today = todayStr();
  const lead = (parseDate(`${mk}-01`).getDay() + 6) % 7; // blank cells before the 1st (weeks start Monday)
  const maxSpent = Math.max(1, ...[...days.values()].map((d) => d.spent));
  const tot = [...days.values()].reduce((a, d) => ({ spent: a.spent + d.spent, income: a.income + d.income, invested: a.invested + d.invested }), { spent: 0, income: 0, invested: 0 });
  const lastDay = mk === thisMonth() ? parseDate(today).getDate() : mk < thisMonth() ? dim : 0;
  let noSpend = 0, busiest = null;
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${mk}-${pad2(d)}`, e = days.get(ds);
    if (!e || !e.spent) noSpend++;
    if (e && e.spent && (!busiest || e.spent > busiest.spent)) busiest = { date: ds, spent: e.spent };
  }
  const showSpent = calView !== 'income', showIncome = calView !== 'spent';
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell blank" aria-hidden="true"></div>');
  for (let d = 1; d <= dim; d++) {
    const ds = `${mk}-${pad2(d)}`, e = days.get(ds), s = sched.filter((x) => x.date === ds);
    const heat = showSpent && e?.spent ? Math.min(0.32, 0.06 + (e.spent / maxSpent) * 0.26) : 0;
    const bg = heat ? `background:${hexA('#E0306E', heat)}` : showIncome && e?.income && !e?.spent ? `background:${hexA('#12A150', 0.1)}` : '';
    const label = [`${d} ${fmtMonth(mk)}`, e?.spent ? `spent ${money(e.spent)}` : '', e?.income ? `income ${money(e.income)}` : '', e?.invested ? `invested ${money(e.invested)}` : '', s.length ? `${s.length} scheduled` : ''].filter(Boolean).join(', ');
    cells.push(`<button type="button" class="cal-cell ${ds === today ? 'today' : ''} ${ds > today ? 'future' : ''}" style="${bg}" data-action="cal-day" data-date="${ds}" aria-label="${esc(label)}">
      <span class="cal-num">${d}</span>
      ${showSpent && e?.spent ? `<span class="cal-amt out"><span class="sign">−</span>${money(e.spent, { compact: true })}</span>` : ''}
      ${showIncome && e?.income ? `<span class="cal-amt in"><span class="sign">+</span>${money(e.income, { compact: true })}</span>` : ''}
      ${showSpent && e?.invested ? `<span class="cal-amt inv">${money(e.invested, { compact: true })}</span>` : ''}
      ${s.length && !e?.count ? (() => { const out = s.filter((x) => x.kind !== 'income').reduce((t, x) => t + x.amount, 0), inn = s.filter((x) => x.kind === 'income').reduce((t, x) => t + x.amount, 0);
        return `${showSpent && out ? `<span class="cal-amt plan">${money(out, { compact: true })}<span class="due-word"> due</span></span>` : ''}${showIncome && inn ? `<span class="cal-amt plan-in">+${money(inn, { compact: true })}<span class="due-word"> due</span></span>` : ''}`; })() : ''}
      ${s.length ? `<span class="cal-due">${s.slice(0, 3).map((x) => `<i class="fa-solid ${x.icon} k-${x.kind}" title="${esc(x.title)} ${esc(money(x.amount))}"></i>`).join('')}${s.length > 3 ? `<b>+${s.length - 3}</b>` : ''}</span>` : ''}
    </button>`);
  }
  while (cells.length % 7) cells.push('<div class="cal-cell blank" aria-hidden="true"></div>');
  // Weekly totals beside each row
  const weeks = [];
  for (let r = 0; r < cells.length / 7; r++) {
    let spent = 0, income = 0;
    for (let c = 0; c < 7; c++) { const d = r * 7 + c - lead + 1; if (d >= 1 && d <= dim) { const e = days.get(`${mk}-${pad2(d)}`); spent += e?.spent || 0; income += e?.income || 0; } }
    weeks.push({ spent, income });
  }
  const rowsHtml = weeks.map((w, r) => `${cells.slice(r * 7, r * 7 + 7).join('')}<div class="cal-week" aria-label="Week total">${showSpent && w.spent ? `<span class="cal-amt out">−${money(w.spent, { compact: true })}</span>` : ''}${showIncome && w.income ? `<span class="cal-amt in">+${money(w.income, { compact: true })}</span>` : ''}</div>`).join('');
  const upcoming = sched.slice(0, 8);
  const prev = addMonths(`${mk}-01`, -1).slice(0, 7), next = addMonths(`${mk}-01`, 1).slice(0, 7);
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div class="flex items-center gap-2">
        <button class="icon-btn" data-action="cal-go" data-m="${prev}" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
        <h2 class="display text-2xl font-semibold min-w-[11rem] text-center">${fmtMonth(mk)}</h2>
        <button class="icon-btn" data-action="cal-go" data-m="${next}" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
        ${mk !== thisMonth() ? `<button class="btn btn-sm" data-action="cal-go" data-m="${thisMonth()}">Today</button>` : ''}
      </div>
      <div class="seg cal-seg" role="radiogroup" aria-label="Show">
        ${[['both', 'Both'], ['spent', 'Spent'], ['income', 'Income']].map(([v, l]) => `<input type="radio" name="calView" id="cv_${v}" value="${v}" ${calView === v ? 'checked' : ''}><label for="cv_${v}">${l}</label>`).join('')}
      </div>
    </div>

    ${lastDay ? `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="stat-tile out"><div class="stat-label">Spent</div><div class="stat-value num">${money(Math.round(tot.spent))}</div></div>
      <div class="stat-tile in"><div class="stat-label">Income</div><div class="stat-value num">${money(Math.round(tot.income))}</div></div>
      <div class="stat-tile"><div class="stat-label">Average spend per day</div><div class="stat-value num">${money(Math.round(tot.spent / lastDay))}</div></div>
      <div class="stat-tile"><div class="stat-label">No-spend days</div><div class="stat-value num">${noSpend} of ${lastDay}</div></div>
    </div>` : `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="stat-tile out"><div class="stat-label">Scheduled to pay</div><div class="stat-value num">${money(Math.round(sched.filter((x) => x.kind !== 'income').reduce((t, x) => t + x.amount, 0)))}</div></div>
      <div class="stat-tile in"><div class="stat-label">Income expected</div><div class="stat-value num">${money(Math.round(sched.filter((x) => x.kind === 'income').reduce((t, x) => t + x.amount, 0)))}</div></div>
      <div class="stat-tile invest"><div class="stat-label">SIPs</div><div class="stat-value num">${money(Math.round(sched.filter((x) => x.kind === 'sip').reduce((t, x) => t + x.amount, 0)))}</div></div>
      <div class="stat-tile"><div class="stat-label">Bills, EMIs, cards</div><div class="stat-value num">${sched.filter((x) => !['income', 'sip'].includes(x.kind)).length}</div></div>
    </div>`}

    <section class="panel p-3 sm:p-5">
      <div class="cal-grid">
        ${WEEK_LABELS.map((d) => `<div class="cal-head">${d}</div>`).join('')}<div class="cal-head cal-week-head">Week</div>
        ${rowsHtml}
      </div>
      <div class="cal-legend">
        <span><i class="sw" style="background:${hexA('#E0306E', 0.28)}"></i>More spent</span>
        <span class="text-loss">−₹ spent</span><span class="text-gain">+₹ income</span><span style="color:var(--marigold-ink)">₹ invested</span>
        <span><i class="fa-solid fa-rotate k-bill"></i> bill</span><span><i class="fa-solid fa-briefcase k-income"></i> income due</span><span><i class="fa-solid fa-seedling k-sip"></i> SIP</span><span><i class="fa-solid fa-calendar-check k-emi"></i> EMI</span><span><i class="fa-solid fa-credit-card k-card"></i> card bill</span>
      </div>
      ${busiest ? `<p class="text-sm text-ink-2 mt-3">Biggest spending day: <button class="link" data-action="cal-day" data-date="${busiest.date}">${fmtDate(busiest.date)}</button>, ${money(busiest.spent)}.</p>` : ''}
    </section>

    ${upcoming.length ? `<section class="panel p-5 mt-6"><div class="panel-head"><h2 class="panel-title">Coming up this month</h2><span class="text-sm text-ink-3 num">${money(Math.round(upcoming.filter((x) => x.kind !== 'income').reduce((s, x) => s + x.amount, 0)))} to pay</span></div>
      <div class="divider">${upcoming.map((x) => `<div class="row"><span class="date-chip kind-bg-${x.kind === 'bill' ? 'subscription' : x.kind}"><div class="display text-xl font-semibold leading-none num">${parseDate(x.date).getDate()}</div><div class="text-xs">${parseDate(x.date).toLocaleDateString('en-IN', { weekday: 'short' })}</div></span>
        <div class="min-w-0 flex-1"><div class="font-medium truncate"><i class="fa-solid ${x.icon} k-${x.kind} mr-1"></i>${esc(x.title)}</div><div class="text-xs text-ink-3">${relDays(x.date)}</div></div>
        <div class="num font-semibold ${x.kind === 'income' ? 'text-gain' : ''}">${money(x.amount)}</div></div>`).join('')}</div></section>` : ''}`;
}

/** Swipe left or right on the calendar to change month (phones). */
let calSwipe = null;
document.addEventListener('touchstart', (e) => { if (location.hash === '#calendar' && e.target.closest('.cal-grid')) calSwipe = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!calSwipe) return;
  const dx = e.changedTouches[0].clientX - calSwipe.x, dy = e.changedTouches[0].clientY - calSwipe.y;
  calSwipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { calMonth = addMonths(`${calMonth}-01`, dx < 0 ? 1 : -1).slice(0, 7); render(); }
}, { passive: true });

/** One day's transactions and scheduled items. */
function openCalendarDay(date) {
  const mk = date.slice(0, 7);
  const e = calendarDays(mk).get(date) || { spent: 0, income: 0, invested: 0, home: 0, list: [] };
  const s = calendarSchedule(mk).filter((x) => x.date === date);
  const list = sortTxns(e.list);
  openModal({
    title: parseDate(date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    body: `<div class="grid grid-cols-3 gap-2">
        <div class="stat-tile out"><div class="stat-label">Spent</div><div class="stat-value num">${money(e.spent)}</div></div>
        <div class="stat-tile in"><div class="stat-label">Income</div><div class="stat-value num">${money(e.income)}</div></div>
        <div class="stat-tile invest"><div class="stat-label">Invested</div><div class="stat-value num">${money(e.invested)}</div></div>
      </div>
      ${list.length ? `<div class="divider">${list.map((t) => txnRow(t, false)).join('')}</div>` : `<p class="text-sm text-ink-3">${date > todayStr() ? 'Nothing logged yet (this day is ahead).' : 'Nothing logged on this day.'}</p>`}
      ${s.length ? `<div><div class="lbl">Scheduled</div><div class="divider">${s.map((x) => `<div class="row text-sm"><i class="fa-solid ${x.icon} k-${x.kind}"></i><div class="flex-1">${esc(x.title)}</div><div class="num font-semibold">${money(x.amount)}</div></div>`).join('')}</div></div>` : ''}
      ${e.home ? `<p class="text-sm" style="color:var(--violet)"><i class="fa-solid fa-house mr-1"></i>${money(e.home)} of home expenses to take back.</p>` : ''}
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-primary" data-action="cal-add" data-date="${date}" data-type="expense"><i class="fa-solid fa-arrow-up"></i> Add expense</button>
        <button type="button" class="btn btn-sm" data-action="cal-add" data-date="${date}" data-type="income"><i class="fa-solid fa-arrow-down"></i> Add income</button>
      </div>`,
    submitLabel: 'Done', cancelLabel: 'Close', onSubmit: () => {},
  });
}

/* ===== Money health =====
   Everything here is calculated from your own data, in the app:
   - Emergency runway: how long liquid money lasts on essential costs
   - Cash-flow forecast: each bank account's balance until month end
   - Fun money: a guilt-free monthly allowance that counts down
   - Credit health: card usage (the 30% rule) plus a score you log
   - Idle cash: money sitting in savings well above what you need
   - Lifestyle creep: spending growing faster than income
   - Health score: 0 to 100 from five of the above
   Features marked PRO will be part of Premium in the Play Store app; here
   they are all unlocked so you can test them. */
const PRO = '<span class="pro-chip" title="Part of Premium in the Play Store app">PRO</span>';
const ESSENTIAL_CATS = ['Rent', 'Groceries', 'Utilities', 'Health', 'Transport', 'Fuel', 'Insurance', 'Education', 'EMI'];
const DISCRETIONARY_CATS = ['Food & dining', 'Shopping', 'Entertainment', 'Travel', 'Personal care', 'Subscriptions'];
const FUN_DEFAULT = { monthly: 0, categories: ['Shopping', 'Entertainment', 'Food & dining'] };
const fullMonths = (n) => lastMonths(addMonths(`${thisMonth()}-01`, -1).slice(0, 7), n);
const avgOf = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

/** Balance of one account at the end of a day. */
function accountBalanceAt(accId, date) {
  const a = accountById(accId);
  if (!a || (a.openingDate || '') > date) return 0;
  let b = num(a.openingBalance);
  for (const t of db.transactions) {
    if (!t.date || t.date > date || t.date < (a.openingDate || '')) continue;
    if (t.fromAccountId === accId) b -= num(t.amount);
    if (t.toAccountId === accId) b += num(t.amount);
  }
  return round2(b);
}
/** Average of the last n full months (only months that have any data). */
function monthlyAverages(n = 3) {
  const first = [...db.transactions.map((t) => t.date)].filter(Boolean).sort()[0]?.slice(0, 7) || thisMonth();
  const months = fullMonths(n).filter((m) => m >= first);
  const S = months.map(monthSummary);
  const cat = {};
  for (const m of months) for (const t of db.transactions) if (t.type === 'expense' && t.date?.startsWith(m)) cat[t.category || 'Other'] = (cat[t.category || 'Other'] || 0) + num(t.amount) / (months.length || 1);
  return { months, income: avgOf(S.map((s) => s.income)), spent: avgOf(S.map((s) => s.spent)), invested: avgOf(S.map((s) => s.invested)), cat };
}

/* ----- Emergency runway ----- */
function runwayData() {
  const avg = monthlyAverages(3);
  const liquidAcc = db.accounts.filter((a) => !a.archived && (a.type === 'cash' || a.type === 'bank'));
  const deposits = db.settings.runwayIncludeDeposits ? db.accounts.filter((a) => !a.archived && a.type === 'investment' && (isDeposit(a) || /liquid|overnight/i.test(a.name))) : [];
  const liquid = [...liquidAcc, ...deposits].reduce((s, a) => s + Math.max(0, M.balances.get(a.id) || 0), 0);
  const fixed = db.subscriptions.filter((s) => s.active && recurKind(s) === 'bill').reduce((s, x) => s + num(x.amount) * perMonthOf(x.frequency), 0)
    + M.emis.filter(({ c }) => c.status === 'active').reduce((s, { c }) => s + c.emi, 0);
  const variableEssentials = ESSENTIAL_CATS.filter((c) => c !== 'Rent' || !db.subscriptions.some((s) => s.active && recurKind(s) === 'bill' && s.category === 'Rent')).reduce((s, c) => s + (avg.cat[c] || 0), 0);
  const essential = round2(fixed + variableEssentials);
  const months = essential > 0 ? liquid / essential : null;
  return { liquid: round2(liquid), essential, fixed: round2(fixed), variableEssentials: round2(variableEssentials), months, days: months === null ? null : Math.round((months % 1) * 30), whole: months === null ? null : Math.floor(months), deposits: deposits.length };
}

/* ----- Fun money jar ----- */
function funMoney() {
  const cfg = { ...FUN_DEFAULT, ...(db.settings.funMoney || {}) };
  const mk = thisMonth();
  const spent = db.transactions.filter((t) => t.type === 'expense' && t.date?.startsWith(mk) && cfg.categories.includes(t.category)).reduce((s, t) => s + num(t.amount), 0);
  const d = parseDate(todayStr()), dim = daysInMonth(d.getFullYear(), d.getMonth()), daysLeft = dim - d.getDate() + 1;
  const left = round2(num(cfg.monthly) - spent);
  return { ...cfg, spent: round2(spent), left, daysLeft, perDay: left > 0 ? left / daysLeft : 0, pct: num(cfg.monthly) > 0 ? spent / num(cfg.monthly) : 0 };
}

/* ----- Credit health ----- */
function creditHealth() {
  const cards = db.accounts.filter((a) => a.type === 'credit_card' && !a.archived && num(a.creditLimit) > 0).map((a) => ({ a, m: cardMetrics(a) }));
  const limit = cards.reduce((s, c) => s + c.m.limit, 0);
  const used = cards.reduce((s, c) => s + Math.max(0, c.m.outstanding) + c.m.blocked, 0);
  const scores = (db.creditScores || []).slice().sort((x, y) => x.date.localeCompare(y.date));
  return { cards, limit, used, util: limit ? used / limit : 0, scores, latest: scores[scores.length - 1] || null };
}

/* ----- Idle cash ----- */
function idleCash() {
  const avg = monthlyAverages(3);
  const monthlyOut = Math.max(avg.spent + avg.invested, 1);
  const keep = monthlyOut * num(db.settings.idleMonths ?? 3);
  const today = todayStr();
  return db.accounts.filter((a) => a.type === 'bank' && !a.archived).map((a) => {
    const lowest = Math.min(...[0, 10, 20, 30].map((d) => accountBalanceAt(a.id, addDays(today, -d))));
    return { a, lowest, extra: round2(lowest - keep), keep: round2(keep) };
  }).filter((x) => avg.months.length && x.extra > 5000);
}

/* ----- Lifestyle creep ----- */
function lifestyleCreep() {
  const allMonths = [...new Set(db.transactions.map((t) => t.date?.slice(0, 7)).filter(Boolean))].sort().filter((m) => m < thisMonth());
  if (allMonths.length < 6) return { ready: false, have: allMonths.length };
  const recent = allMonths.slice(-3);
  const yearAgo = recent.map((m) => addMonths(`${m}-01`, -12).slice(0, 7));
  const base = yearAgo.every((m) => allMonths.includes(m)) ? yearAgo : allMonths.slice(0, 3);
  const sum = (months, fn) => months.reduce((s, m) => s + db.transactions.filter((t) => t.date?.startsWith(m) && fn(t)).reduce((x, t) => x + num(t.amount), 0), 0) / months.length;
  const g = (a, b) => (b > 0 ? (a - b) / b : null);
  const incNow = sum(recent, (t) => t.type === 'income'), incThen = sum(base, (t) => t.type === 'income');
  const incGrowth = g(incNow, incThen);
  const cats = DISCRETIONARY_CATS.map((c) => { const now = sum(recent, (t) => t.type === 'expense' && t.category === c), then = sum(base, (t) => t.type === 'expense' && t.category === c); return { c, now, then, growth: g(now, then) }; })
    .filter((x) => x.then > 0 || x.now > 0);
  const flagged = cats.filter((x) => x.growth !== null && x.now - x.then > 500 && x.growth > (incGrowth ?? 0) + 0.15);
  return { ready: true, recent, base, incNow, incThen, incGrowth, cats, flagged, yearly: base === yearAgo };
}

/* ----- Cash-flow forecast (each bank / cash account to month end) ----- */
function cashFlowForecast() {
  const today = todayStr(), end = addDays(addMonths(`${thisMonth()}-01`, 1), -1);
  const horizon = end > addDays(today, 10) ? end : addDays(today, 30);
  const accounts = db.accounts.filter((a) => !a.archived && (a.type === 'bank' || a.type === 'cash'));
  const events = new Map(accounts.map((a) => [a.id, []]));
  const add = (acc, date, amount, label) => { if (events.has(acc) && date > today && date <= horizon) events.get(acc).push({ date, amount, label }); };
  for (const s of db.subscriptions) { if (!s.active) continue; let d = s.nextRenewal, g = 0; while (d && d <= horizon && g++ < 40) { add(s.accountId, d, recurKind(s) === 'income' ? num(s.amount) : -num(s.amount), s.name); d = advanceDate(d, s.frequency); } }
  for (const x of db.sips) { if (!x.active) continue; let d = x.nextDate, g = 0; while (d && d <= horizon && !sipEnded(x, d) && g++ < 40) { add(x.fromAccountId, d, -sipAmountOn(x, d), `${x.name} SIP`); d = advanceSip(x, d); } }
  for (const { e, c } of M.emis) if (c.status === 'active' && c.nextDue) { let d = c.nextDue, k = 0; while (d <= horizon && k < c.remainingMonths) { add(e.accountId, d, -c.emi, `${e.name} EMI`); d = addMonths(c.nextDue, ++k); } }
  // Everyday spending: this month's pace, shared between accounts the way they were used in the last 60 days.
  const since = addDays(today, -60), use = new Map();
  for (const t of db.transactions) if (t.type === 'expense' && !t.relatedType && t.date >= since && events.has(t.fromAccountId)) use.set(t.fromAccountId, (use.get(t.fromAccountId) || 0) + num(t.amount));
  const useTotal = [...use.values()].reduce((s, v) => s + v, 0) || 1;
  const monthSpent = db.transactions.filter((t) => t.type === 'expense' && !t.relatedType && t.date?.startsWith(thisMonth())).reduce((s, t) => s + num(t.amount), 0);
  const pace = monthSpent / Math.max(1, parseDate(today).getDate()) || monthlyAverages(3).spent / 30;
  const buffer = num(db.settings.cashBuffer ?? 0);
  const out = accounts.map((a) => {
    const share = (use.get(a.id) || 0) / useTotal, daily = pace * share;
    let bal = M.balances.get(a.id) || 0;
    const series = [{ date: today, bal: round2(bal) }];
    let low = null;
    for (let d = addDays(today, 1); d <= horizon; d = addDays(d, 1)) {
      bal -= daily;
      for (const ev of events.get(a.id).filter((x) => x.date === d)) bal += ev.amount;
      series.push({ date: d, bal: round2(bal) });
      if (!low && bal < buffer) low = { date: d, bal: round2(bal) };
    }
    return { a, series, end: series[series.length - 1].bal, low, events: events.get(a.id).sort((x, y) => x.date.localeCompare(y.date)), daily: round2(daily) };
  });
  const cardDue = db.accounts.filter((a) => a.type === 'credit_card' && !a.archived).map((a) => ({ a, m: cardMetrics(a) })).filter(({ m }) => m.outstanding > 0 && m.dates.nextDue && m.dates.nextDue <= horizon);
  return { horizon, accounts: out, cardDue, pace: round2(pace) };
}

/* ----- Health score (0 to 100) ----- */
function healthScore() {
  const avg = monthlyAverages(3), rw = runwayData(), ch = creditHealth();
  const clamp = (v) => Math.max(0, Math.min(20, v));
  const parts = [];
  parts.push({ key: 'runway', label: 'Emergency runway', v: rw.months === null ? null : clamp((rw.months / 6) * 20), note: rw.months === null ? 'Add expenses to measure' : `${rw.whole} months ${rw.days} days (aim: 6 months)` });
  const kept = avg.income > 0 ? (avg.income - avg.spent) / avg.income : null;
  parts.push({ key: 'savings', label: 'Savings rate', v: kept === null ? null : clamp((kept / 0.3) * 20), note: kept === null ? 'Log income to measure' : `${Math.round(kept * 100)}% of income kept (aim: 30%)` });
  parts.push({ key: 'credit', label: 'Card usage', v: !ch.limit ? 20 : clamp(ch.util <= 0.1 ? 20 : ch.util <= 0.3 ? 20 - ((ch.util - 0.1) / 0.2) * 8 : 12 - ((ch.util - 0.3) / 0.45) * 12), note: ch.limit ? `${Math.round(ch.util * 100)}% of limits used (aim: under 30%)` : 'No credit cards' });
  const emi = M.emis.filter(({ c }) => c.status === 'active').reduce((s, { c }) => s + c.emi, 0);
  const debt = avg.income > 0 ? emi / avg.income : null;
  parts.push({ key: 'debt', label: 'EMIs vs income', v: debt === null ? (emi ? null : 20) : clamp(20 - (debt / 0.5) * 20), note: debt === null ? (emi ? 'Log income to measure' : 'No EMIs') : `${Math.round(debt * 100)}% of income goes to EMIs (aim: under 30%)` });
  const inv = avg.income > 0 ? avg.invested / avg.income : null;
  parts.push({ key: 'invest', label: 'Investing', v: inv === null ? null : clamp((inv / 0.2) * 20), note: inv === null ? 'Log income to measure' : `${Math.round(inv * 100)}% of income invested (aim: 20%)` });
  const known = parts.filter((p) => p.v !== null);
  const score = known.length ? Math.round((known.reduce((s, p) => s + p.v, 0) / (known.length * 20)) * 100) : null;
  const label = score === null ? 'Not enough data yet' : score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs care';
  return { score, label, parts };
}

/* ----- Nudges: features talking to each other (suggestions, never silent changes) ----- */
const NUDGE_KEY = 'kosh.nudgesHidden.v1';
function computeNudges() {
  const hidden = readLS(NUDGE_KEY, {}), now = Date.now();
  const out = [];
  const add = (id, tone, icon, text, action = '') => { if (!hidden[id] || hidden[id] < now) out.push({ id, tone, icon, text, action }); };
  const rw = runwayData(), fm = funMoney(), ch = creditHealth();
  if (rw.months !== null && rw.months < 3 && num(fm.monthly) > 0) {
    const lower = Math.round((num(fm.monthly) * 0.6) / 100) * 100;
    add(`runway-fun-${thisMonth()}`, 'bad', 'fa-life-ring', `Your emergency money covers ${rw.whole} month${rw.whole === 1 ? '' : 's'} ${rw.days} days. Lower fun money to ${money(lower)} this month to rebuild it?`, `<button class="btn btn-sm" data-action="fun-set" data-v="${lower}">Lower to ${money(lower)}</button>`);
  }
  for (const f of cashFlowForecast().accounts) if (f.low) add(`cash-${f.a.id}-${thisMonth()}`, 'bad', 'fa-arrow-trend-down', `${f.a.name} may drop to ${money(f.low.bal)} around ${fmtDate(f.low.date)} at your current pace.`, '<a class="btn btn-sm" href="#health">See forecast</a>');
  if (num(fm.monthly) > 0 && fm.pct >= 0.9 && fm.daysLeft > 7) add(`fun-${thisMonth()}`, 'neutral', 'fa-champagne-glasses', `Fun money is ${Math.round(fm.pct * 100)}% used with ${fm.daysLeft} days to go. Maybe a quiet week?`);
  if (ch.limit && ch.util >= 0.3) add(`credit-${thisMonth()}`, 'bad', 'fa-credit-card', `Card usage is ${Math.round(ch.util * 100)}% of your limits. Paying part of the bill before the statement date keeps your credit score healthier.`);
  for (const x of idleCash().slice(0, 1)) add(`idle-${x.a.id}-${thisMonth()}`, 'neutral', 'fa-sack-dollar', `${money(x.extra)} has sat in ${x.a.name} for a month, beyond ${db.settings.idleMonths ?? 3} months of your spending. It could work harder in a goal, an FD or a liquid fund.`, '<a class="btn btn-sm" href="#goals">Put it in a goal</a>');
  for (const g of db.goals.filter((x) => !x.done)) { const lag = goalLag(g); if (lag && lag.behind > 500) add(`goal-${g.id}-${thisMonth()}`, 'neutral', 'fa-flag', `${g.name} is ${money(lag.behind)} behind plan.${lag.reason ? ` ${lag.reason}` : ''}`, `<button class="btn btn-sm" data-action="goal-add" data-id="${g.id}">Add money</button>`); }
  for (const w of db.wishlist.filter((x) => x.status === 'cooling' && x.coolUntil && x.coolUntil <= new Date().toISOString())) add(`cool-${w.id}`, 'good', 'fa-hourglass-end', `Your cool-off for "${w.name}" is over. Still want it?`, `<button class="btn btn-sm" data-action="cool-decide" data-id="${w.id}">Decide</button>`);
  const salary = salaryToday();
  if (salary && (db.settings.salaryPlan || []).length && db.settings.salaryPlanApplied !== thisMonth()) add(`salary-${thisMonth()}`, 'good', 'fa-briefcase', `Salary of ${money(salary.amount)} arrived. Apply your salary-day plan?`, '<button class="btn btn-sm btn-primary" data-action="salary-apply">Apply plan</button>');
  return out;
}
function hideNudge(id) { const h = readLS(NUDGE_KEY, {}); h[id] = Date.now() + 7 * 864e5; writeLS(NUDGE_KEY, h); }
function nudgeStrip(max = 3, moreLink = false) {
  const all = computeNudges();
  if (window.innerWidth < 640 && moreLink) max = 1;
  const list = all.slice(0, max);
  if (!list.length) return '';
  return `<section class="mb-6 space-y-2" aria-label="Suggestions for you">${list.map((n) => `<div class="nudge-card ${n.tone}"><i class="fa-solid ${n.icon}"></i>
    <div class="flex-1 min-w-0"><div class="text-sm">${esc(n.text)}</div>${n.action ? `<div class="mt-2 flex gap-2 flex-wrap">${n.action}</div>` : ''}</div>
    <button class="icon-btn sm" data-action="nudge-hide" data-id="${n.id}" aria-label="Hide this suggestion for a week" title="Hide"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}
    ${moreLink && all.length > list.length ? `<a href="#health" class="text-sm link block">${all.length - list.length} more suggestion${all.length - list.length === 1 ? '' : 's'} on Money health</a>` : ''}</section>`;
}
/** How far a dated goal is behind a straight-line plan, and a likely reason. */
function goalLag(g) {
  if (!g.targetDate || !g.createdAt) return null;
  const s = goalStats(g), start = g.createdAt.slice(0, 10), total = parseDate(g.targetDate) - parseDate(start);
  if (total <= 0) return null;
  const expected = num(g.target) * Math.min(1, (parseDate(todayStr()) - parseDate(start)) / total);
  const behind = round2(expected - s.saved);
  if (behind <= 0) return null;
  const I = computeInsights(thisMonth());
  const up = I.cats.filter((c) => c.diff > 1000 && DISCRETIONARY_CATS.includes(c.c)).sort((a, b) => b.diff - a.diff)[0];
  return { behind, reason: up ? `${up.c} is ${money(Math.round(up.diff))} above usual this month.` : '' };
}
function salaryToday() {
  const mk = thisMonth();
  return db.transactions.filter((t) => t.type === 'income' && t.category === 'Salary' && t.date?.startsWith(mk)).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

/* ----- The page ----- */
function ring(score, size = 132, onDark = true) {
  const r = size / 2 - 10, c = 2 * Math.PI * r, v = score ?? 0;
  const col = score === null ? '#CBD5E1' : v >= 80 ? '#12A150' : v >= 60 ? '#0A6FB0' : v >= 40 ? '#F59E0B' : '#E0306E';
  return `<svg class="score-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Health score ${score ?? 'not available'} out of 100">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${onDark ? 'rgba(255,255,255,.18)' : '#EAEFF6'}" stroke-width="12"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${size / 3.4}" font-weight="700" font-family="Bricolage Grotesque, sans-serif" fill="${onDark ? '#fff' : '#14213D'}">${score ?? '–'}</text></svg>`;
}
function renderHealth() {
  const hs = healthScore(), rw = runwayData(), fm = funMoney(), ch = creditHealth(), idle = idleCash(), lc = lifestyleCreep(), cf = cashFlowForecast();
  const part = (p) => `<div class="hs-part"><div class="flex justify-between text-sm gap-2"><span class="font-semibold">${p.label}</span><span class="num">${p.v === null ? '–' : `${Math.round(p.v)}/20`}</span></div>
    <div class="bar mt-1.5"><span style="width:${((p.v ?? 0) / 20) * 100}%;background:${p.v === null ? '#CBD5E1' : p.v >= 15 ? '#12A150' : p.v >= 10 ? '#0A6FB0' : p.v >= 6 ? '#F59E0B' : '#E0306E'}"></span></div>
    <div class="text-xs text-ink-3 mt-1">${esc(p.note)}</div></div>`;
  return `
    ${nudgeStrip(5)}
    <section class="hero p-5 sm:p-7">
      <div class="flex flex-col sm:flex-row sm:items-center gap-5">
        ${ring(hs.score)}
        <div class="flex-1"><div class="hero-dim text-sm">Money health score</div>
          <div class="display text-3xl font-semibold">${hs.label}</div>
          <p class="hero-dim text-sm mt-1 max-w-xl">Out of 100, from five things that matter most: how long your savings last, how much you keep, card usage, EMIs and investing. Improve the weakest bar first.</p></div>
      </div>
    </section>
    <section class="panel p-5 mt-6"><div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">${hs.parts.map(part).join('')}</div></section>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title"><i class="fa-solid fa-life-ring mr-1.5 text-royal"></i>Emergency runway</h2>
          <button class="btn btn-sm" data-action="health-settings">Settings</button></div>
        ${rw.months === null ? emptyState('fa-life-ring', 'Log a month of expenses to see how long your money would last.') : `
        <div class="display text-4xl font-semibold num">${rw.whole} <span class="text-xl">month${rw.whole === 1 ? '' : 's'}</span> ${rw.days} <span class="text-xl">day${rw.days === 1 ? '' : 's'}</span></div>
        <p class="text-sm text-ink-2 mt-1">If your income stopped today, your cash and bank money${db.settings.runwayIncludeDeposits ? ', FDs and liquid funds' : ''} would cover essential costs for this long.</p>
        <div class="bar mt-3" style="height:10px"><span style="width:${Math.min(100, (rw.months / 6) * 100)}%;background:${rw.months >= 6 ? '#12A150' : rw.months >= 3 ? '#F59E0B' : '#E0306E'}"></span></div>
        <div class="flex justify-between text-xs text-ink-3 mt-1"><span>0</span><span>3 months</span><span>6 months (safe)</span></div>
        <dl class="kv mt-4"><div><dt>Liquid money</dt><dd>${money(rw.liquid)}</dd></div><div><dt>Essential costs a month</dt><dd>${money(Math.round(rw.essential))}</dd></div>
          <div><dt>Rent, bills, EMIs</dt><dd>${money(Math.round(rw.fixed))}</dd></div><div><dt>Groceries, transport, health…</dt><dd>${money(Math.round(rw.variableEssentials))}</dd></div></dl>`}
      </section>

      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title"><i class="fa-solid fa-champagne-glasses mr-1.5" style="color:var(--marigold)"></i>Fun money</h2>
          <button class="btn btn-sm" data-action="fun-edit">${num(fm.monthly) ? 'Change' : 'Set up'}</button></div>
        ${num(fm.monthly) ? `
          <div class="flex items-baseline justify-between gap-2"><span class="display text-4xl font-semibold num ${fm.left < 0 ? 'text-loss' : ''}">${money(fm.left)}</span><span class="text-sm text-ink-3 num">left of ${money(fm.monthly)}</span></div>
          <div class="jar mt-3" aria-hidden="true"><span style="--w:${Math.max(0, Math.min(100, (1 - fm.pct) * 100))}%"></span></div>
          <p class="text-sm text-ink-2 mt-3">${fm.left > 0 ? `Spend it without guilt: about <b class="num">${money(Math.floor(fm.perDay))}</b> a day for the ${fm.daysLeft} day${fm.daysLeft === 1 ? '' : 's'} left.` : 'This month\'s fun money is used up. It refills on the 1st.'}</p>
          <p class="text-xs text-ink-3 mt-1">Counts: ${fm.categories.map(esc).join(', ')}.</p>`
          : `<p class="text-sm text-ink-2">Set aside an amount each month for things you enjoy (shopping, eating out, hobbies) and spend it without guilt. The jar counts down as you spend and refills every month.</p>`}
      </section>
    </div>

    <section class="panel p-5 mt-6">
      <div class="panel-head"><h2 class="panel-title"><i class="fa-solid fa-chart-line mr-1.5 text-royal"></i>Cash-flow forecast ${PRO}</h2><span class="text-xs text-ink-3">To ${fmtDate(cf.horizon)} · everyday spending ${money(Math.round(cf.pace))}/day</span></div>
      <p class="text-sm text-ink-2 mb-4">Where each account's balance is heading, from today's balance, scheduled salary, bills, EMIs and SIPs, and your everyday spending pace.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${cf.accounts.map((f) => {
        const min = Math.min(...f.series.map((x) => x.bal)), max = Math.max(...f.series.map((x) => x.bal), 1), w = 300, h = 70;
        const lo = min < 0 ? min * 1.1 : min * 0.97, hi = max * 1.01 + 1;
        const X = (i) => (i / Math.max(1, f.series.length - 1)) * w, Y = (v) => 2 + h - ((v - lo) / (hi - lo || 1)) * h;
        const path = f.series.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(x.bal).toFixed(1)}`).join(' ');
        return `<div class="cf-card ${f.low ? 'warn' : ''}"><div class="flex justify-between gap-2"><b class="truncate">${esc(f.a.name)}</b><span class="num text-sm">${money(Math.round(f.series[0].bal))} → <b class="${f.end < 0 ? 'text-loss' : ''}">${money(Math.round(f.end))}</b></span></div>
          <svg viewBox="0 0 ${w} ${h + 4}" class="cf-spark" preserveAspectRatio="none" aria-hidden="true">${min < 0 ? `<line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="#E0306E" stroke-dasharray="4 4"/>` : ''}<path d="${path}" fill="none" stroke="${f.low ? '#E0306E' : '#0A6FB0'}" stroke-width="2.2"/></svg>
          <div class="text-xs ${f.low ? 'text-loss font-semibold' : 'text-ink-3'}">${f.low ? `May go below ${money(num(db.settings.cashBuffer ?? 0))} around ${fmtDate(f.low.date)}` : 'Stays positive'}${f.events.length ? ` · ${f.events.length} scheduled` : ''}</div>
          ${f.events.length ? `<details class="mt-2"><summary class="text-xs link cursor-pointer">Scheduled items</summary><div class="text-xs mt-1 space-y-0.5">${f.events.map((e) => `<div class="flex justify-between gap-2"><span>${fmtDate(e.date)} ${esc(e.label)}</span><span class="num ${e.amount > 0 ? 'text-gain' : ''}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</span></div>`).join('')}</div></details>` : ''}</div>`;
      }).join('') || emptyState('fa-building-columns', 'Add a bank account to see its forecast.')}</div>
      ${cf.cardDue.length ? `<p class="text-sm mt-4"><i class="fa-solid fa-credit-card text-loss mr-1"></i>Also due: ${cf.cardDue.map(({ a, m }) => `${esc(a.name)} ${money(m.outstanding)} on ${fmtDate(m.dates.nextDue)}`).join(', ')}. Pay these from the account with room.</p>` : ''}
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title"><i class="fa-solid fa-gauge mr-1.5 text-royal"></i>Credit health</h2><button class="btn btn-sm" data-action="credit-add">Log my score</button></div>
        <div class="grid grid-cols-2 gap-4">
          <div><div class="stat-label">Latest credit score</div><div class="display text-3xl font-semibold num">${ch.latest ? ch.latest.score : '–'}</div><div class="text-xs text-ink-3">${ch.latest ? `${esc(ch.latest.bureau || 'CIBIL')}, ${fmtDate(ch.latest.date)}` : 'Log it from your bank or bureau app'}</div></div>
          <div><div class="stat-label">Card usage</div><div class="display text-3xl font-semibold num ${ch.util >= 0.3 ? 'text-loss' : 'text-gain'}">${ch.limit ? `${Math.round(ch.util * 100)}%` : '–'}</div><div class="text-xs text-ink-3">${ch.limit ? `${money(Math.round(ch.used))} of ${money(ch.limit)}` : 'No cards with a limit'}</div></div>
        </div>
        ${ch.scores.length > 1 ? `<div class="score-trend mt-4" aria-label="Score history">${ch.scores.slice(-8).map((s) => `<div title="${esc(fmtDate(s.date))}: ${s.score}"><span style="height:${Math.max(8, ((s.score - 300) / 600) * 100)}%"></span><em>${s.score}</em></div>`).join('')}</div>` : ''}
        ${ch.cards.length ? `<div class="space-y-3 mt-4">${ch.cards.map(({ a, m }) => `<div><div class="flex justify-between text-sm gap-2"><span>${esc(a.name)}</span><span class="num ${m.utilization >= 0.3 ? 'text-loss' : ''}">${Math.round(m.utilization * 100)}%</span></div>
          <div class="bar mt-1 util-bar"><span style="width:${Math.min(100, m.utilization * 100)}%;background:${m.utilization >= 0.3 ? '#E0306E' : '#12A150'}"></span><i style="left:30%"></i></div></div>`).join('')}</div>` : ''}
        <p class="text-xs text-ink-3 mt-4">Keeping card usage under 30% of your limits helps your score. You can get one free credit report a year from each credit bureau; log the score here to see its trend. The app can't read your score by itself.</p>
      </section>

      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title"><i class="fa-solid fa-sack-dollar mr-1.5" style="color:var(--marigold)"></i>Idle cash ${PRO}</h2></div>
        ${idle.length ? idle.map((x) => `<div class="callout mb-3"><b class="num">${money(x.extra)}</b> has stayed in <b>${esc(x.a.name)}</b> for at least a month, more than ${db.settings.idleMonths ?? 3} months of your spending (${money(x.keep)}). Money above that could earn more in a goal, a fixed or recurring deposit, or a liquid fund. Keep your runway first.</div>`).join('')
          : `<p class="text-sm text-ink-2">Nothing idle. Your bank accounts don't hold much more than ${db.settings.idleMonths ?? 3} months of spending.</p>`}
        <h3 class="font-semibold mt-5 mb-2">Lifestyle creep ${PRO}</h3>
        ${!lc.ready ? `<p class="text-sm text-ink-2">Needs 6 months of data (you have ${lc.have}). It compares how your spending grows with how your income grows.</p>`
          : `<p class="text-sm text-ink-2 mb-3">Income ${lc.incGrowth === null ? 'not logged earlier' : `${lc.incGrowth >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(lc.incGrowth * 100))}%`} (last 3 months vs ${lc.yearly ? 'a year before' : 'your first 3 months'}).</p>
            ${lc.flagged.length ? lc.flagged.map((x) => `<div class="callout warn mb-2"><b>${esc(x.c)}</b> grew ${x.growth === null ? 'from nothing' : `${Math.round(x.growth * 100)}%`}: ${money(Math.round(x.then))} → ${money(Math.round(x.now))} a month. That's faster than your income.</div>`).join('') : '<p class="text-sm text-gain">No creep: your lifestyle spending is growing slower than your income. Well done.</p>'}`}
      </section>
    </div>`;
}

/* ----- Forms ----- */
function openFunForm() {
  const f = funMoney();
  const cats = db.settings.expenseCategories;
  const avgCat = monthlyAverages(3).cat;
  const suggest = Math.round((DISCRETIONARY_CATS.reduce((s, c) => s + (avgCat[c] || 0), 0) * 0.9) / 100) * 100;
  openModal({
    title: 'Fun money',
    body: `<p class="text-sm text-ink-2">A guilt-free amount for the things you enjoy. Spend it freely; when it's gone, it refills next month.</p>
      ${field('Each month', moneyInput('monthly', f.monthly || '', 'min="0" required'), suggest ? `You usually spend about ${money(Math.round(suggest / 0.9))} on these; ${money(suggest)} would be a gentle start.` : '')}
      <div><span class="lbl">Counts spending in</span><div class="filter-picks">${cats.map((c) => `<label class="check-chip"><input type="checkbox" name="c_${esc(c)}" ${f.categories.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div></div>`,
    submitLabel: 'Save',
    onSubmit: (d) => { commit([opSettings({ funMoney: { monthly: round2(num(d.monthly)), categories: cats.filter((c) => d[`c_${c}`]) } })], 'Set fun money'); toast('Fun money saved', 'success'); },
  });
}
function openCreditForm() {
  openModal({
    title: 'Log my credit score',
    body: `${twoCol(field('Score', input('score', '', 'type="number" min="300" max="900" required placeholder="e.g. 768"')), field('Date', input('date', todayStr(), 'type="date" required')))}
      ${field('From', select('bureau', ['CIBIL', 'Experian', 'Equifax', 'CRIF High Mark', 'Other'], 'CIBIL'))}`,
    submitLabel: 'Save',
    onSubmit: (d) => { commit([opUpsert('creditScores', { id: uid('cs'), score: int(d.score), date: d.date, bureau: d.bureau })], 'Log credit score'); },
  });
}
function openHealthSettings() {
  const s = db.settings;
  openModal({
    title: 'Money health settings',
    body: `${checkbox('runwayIncludeDeposits', !!s.runwayIncludeDeposits, 'Count FDs and liquid funds in the runway', 'They can usually be withdrawn within days.')}
      ${twoCol(field('Idle cash: keep this many months in the bank', input('idleMonths', s.idleMonths ?? 3, 'type="number" min="1" max="24"')), field('Forecast warning below', moneyInput('cashBuffer', s.cashBuffer ?? 0, 'min="0"'), 'Warn when a balance may fall under this.'))}`,
    submitLabel: 'Save',
    onSubmit: (d) => { commit([opSettings({ runwayIncludeDeposits: !!d.runwayIncludeDeposits, idleMonths: int(d.idleMonths) || 3, cashBuffer: round2(num(d.cashBuffer)) })], 'Money health settings'); },
  });
}
/** Small dashboard card: score, runway and fun money. */
function healthMini() {
  const hs = healthScore(), rw = runwayData(), fm = funMoney();
  return `<section class="panel p-5 health-mini">
    <div class="panel-head"><h2 class="panel-title">Money health</h2><a href="#health" class="text-sm link">Open</a></div>
    <div class="flex items-center gap-4"><div class="mini-ring">${ring(hs.score, 84, false)}</div>
      <div class="min-w-0"><div class="font-semibold">${hs.label}</div>
        <div class="text-sm text-ink-2">${rw.months === null ? 'Runway: add expenses' : `Runway ${rw.whole} mo ${rw.days} d`}</div>
        ${num(fm.monthly) ? `<div class="text-sm text-ink-2">Fun money left <b class="num ${fm.left < 0 ? 'text-loss' : ''}">${money(fm.left)}</b></div>` : '<button class="link text-sm" data-action="fun-edit">Set fun money</button>'}</div></div>
  </section>`;
}

/* ===== Planners =====
   Calculators that look ahead. They show numbers and the assumptions behind
   them; they never tell you to buy or sell a particular fund or stock.
   Tax figures use the rules for FY 2026-27: equity long-term gains above
   ₹1.25 lakh a year taxed at 12.5%, short-term equity gains at 20%, plus 4% cess.
   Update CG_RULES if a budget changes them. */
const CG_RULES = { ltcgExempt: 125000, ltcgRate: 0.125, stcgRate: 0.20, cess: 0.04, longAfterDays: 365 };
const PLANNER_TABS = [['fire', 'Financial freedom', 'fa-mountain-sun'], ['loan', 'Loan prepayment', 'fa-house-circle-check'], ['gains', 'Capital gains', 'fa-scale-unbalanced'],
  ['direct', 'Regular vs Direct', 'fa-code-compare'], ['salary', 'Salary-day plan', 'fa-briefcase'], ['review', 'Year in review', 'fa-star']];
let plannerTab = 'fire';
const PLAN_KEY = 'kosh.planners.v1';
let planIn = readLS(PLAN_KEY, {});
const pval = (tool, key, def) => (planIn[tool] && planIn[tool][key] !== undefined ? planIn[tool][key] : def);
const pinput = (tool, key, label, def, attrs = '', hint = '') => field(label, `<input class="inp" data-p="${tool}.${key}" value="${esc(pval(tool, key, def))}" ${attrs}>`, hint);
const pslider = (tool, key, label, def, min, max, step, unit) => `<div class="slider-field"><div class="flex justify-between text-sm"><span class="lbl !mb-0">${label}</span><b class="num" data-pv="${tool}.${key}">${pval(tool, key, def)}${unit}</b></div>
  <input type="range" data-p="${tool}.${key}" min="${min}" max="${max}" step="${step}" value="${pval(tool, key, def)}" aria-label="${esc(label)}"></div>`;
function readPlanInputs(tool) {
  const o = {};
  for (const el of $$(`[data-p^="${tool}."]`)) { const k = el.dataset.p.split('.')[1]; o[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : num(el.value); }
  planIn[tool] = { ...(planIn[tool] || {}), ...o };
  writeLS(PLAN_KEY, planIn);
  return planIn[tool];
}

function renderPlanner() {
  return `<p class="text-sm text-ink-2 mb-4 max-w-3xl">Calculators for the big decisions. Change any number and the result updates. They are estimates based on the assumptions you see, not financial or tax advice.</p>
    <div class="tabs" role="tablist">${PLANNER_TABS.map(([k, l, ic]) => `<button role="tab" class="tab ${plannerTab === k ? 'on' : ''}" aria-selected="${plannerTab === k}" data-action="planner-tab" data-t="${k}"><i class="fa-solid ${ic}"></i><span>${l}</span></button>`).join('')}</div>
    <div class="mt-5">${({ fire: fireTool, loan: loanTool, gains: gainsTool, direct: directTool, salary: salaryTool, review: reviewTool }[plannerTab])()}</div>`;
}
/** Recalculate the open tool without re-rendering its inputs (keeps focus and keyboard). */
function onPlannerInput(e) {
  const k = e.target.dataset?.p;
  if (!k) return;
  const out = $(`[data-pv="${k}"]`); if (out) out.textContent = `${e.target.value}${out.textContent.replace(/^[\d.,-]+/, '')}`;
  const tool = k.split('.')[0];
  const box = $(`#res-${tool}`); if (!box) return;
  readPlanInputs(tool);
  box.innerHTML = ({ fire: fireResult, loan: loanResult, direct: directResult }[tool] || (() => ''))();
}

/* ----- Financial freedom (FIRE) ----- */
function fireDefaults() {
  const avg = monthlyAverages(3);
  return { age: db.settings.birthYear ? new Date().getFullYear() - int(db.settings.birthYear) : 25, expense: Math.round((avg.spent || 30000) / 1000) * 1000,
    corpus: Math.round(M.P.totals.value || 0), invest: Math.round((avg.invested || M.P.totals.sipMonthly || 5000) / 500) * 500 };
}
function fireTool() {
  const d = fireDefaults();
  return `<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
    <section class="panel p-5 lg:col-span-2 space-y-4"><h2 class="panel-title">Your numbers ${PRO}</h2>
      ${twoCol(pinput('fire', 'age', 'Your age', d.age, 'type="number" min="15" max="80"'), pinput('fire', 'expense', 'Monthly spending today', d.expense, 'type="number" min="0" step="1000" inputmode="decimal"'))}
      ${twoCol(pinput('fire', 'corpus', 'Invested so far', d.corpus, 'type="number" min="0" step="1000" inputmode="decimal"', 'From your portfolio'), pinput('fire', 'invest', 'Investing each month', d.invest, 'type="number" min="0" step="500" inputmode="decimal"'))}
      ${pslider('fire', 'step', 'Raise investing each year by', 5, 0, 20, 1, '%')}
      ${pslider('fire', 'ret', 'Expected return (per year)', 10, 4, 16, 0.5, '%')}
      ${pslider('fire', 'inf', 'Inflation (per year)', 6, 3, 10, 0.5, '%')}
      ${pslider('fire', 'swr', 'Safe yearly withdrawal', 3.5, 2.5, 5, 0.25, '%')}
      ${pslider('fire', 'life', 'Spending in freedom vs today', 100, 60, 150, 5, '%')}
    </section>
    <section class="panel p-5 lg:col-span-3 result-first" id="res-fire">${fireResult()}</section></div>`;
}
function fireRun(p, retAdj = 0) {
  const r = (num(p.ret) + retAdj) / 100, inf = num(p.inf) / 100, swr = num(p.swr) / 100, step = num(p.step) / 100, life = num(p.life) / 100;
  let corpus = num(p.corpus);
  const pts = [];
  for (let y = 0; y <= 60; y++) {
    const target = (num(p.expense) * 12 * life * (1 + inf) ** y) / swr;
    pts.push({ y, corpus, target });
    if (corpus >= target && num(p.expense) > 0) return { years: y, pts, target };
    corpus = corpus * (1 + r) + num(p.invest) * 12 * (1 + step) ** y * (1 + r / 2);
  }
  return { years: null, pts, target: null };
}
function fireResult() {
  const p = { ...fireDefaults(), step: 5, ret: 10, inf: 6, swr: 3.5, life: 100, ...(planIn.fire || {}) };
  const mid = fireRun(p), low = fireRun(p, -2), high = fireRun(p, 2), more = fireRun({ ...p, invest: num(p.invest) * 1.2 });
  const age = int(p.age);
  const today = (num(p.expense) * 12 * (num(p.life) / 100)) / (num(p.swr) / 100);
  if (mid.years === null) return `<h2 class="panel-title mb-2">Your result</h2><p class="text-sm text-ink-2">At these numbers you don't reach financial freedom within 60 years. Try investing more each month or raising it each year.</p>`;
  const W = 520, H = 180, pts = mid.pts, maxV = Math.max(...pts.map((x) => Math.max(x.corpus, x.target)));
  const X = (y) => 30 + (y / Math.max(1, pts.length - 1)) * (W - 40), Y = (v) => H - 20 - (v / maxV) * (H - 30);
  const line = (key) => pts.map((x, i) => `${i ? 'L' : 'M'}${X(x.y).toFixed(1)},${Y(x[key]).toFixed(1)}`).join(' ');
  return `<h2 class="panel-title mb-3">Your result</h2>
    <div class="display text-4xl font-semibold">Age ${age + mid.years}</div>
    <p class="text-sm text-ink-2 mt-1">You could be financially independent in about <b>${mid.years} years</b>: between age <b>${age + (high.years ?? mid.years)}</b> and <b>${low.years === null ? '75+' : age + low.years}</b> if returns are 2% better or worse.</p>
    <svg viewBox="0 0 ${W} ${H}" class="w-full mt-4" role="img" aria-label="Projected investments against the amount needed">
      <path d="${line('target')}" fill="none" stroke="#94A3B8" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${line('corpus')}" fill="none" stroke="#12A150" stroke-width="3"/>
      <circle cx="${X(mid.years)}" cy="${Y(pts[mid.years].corpus)}" r="5" fill="#12A150"/>
      <text x="${X(mid.years)}" y="${Y(pts[mid.years].corpus) - 10}" text-anchor="middle" font-size="12" font-weight="700" fill="#0E8F47">Age ${age + mid.years}</text>
      <text x="30" y="${H - 4}" font-size="11" fill="#7B8599">Now (${age})</text><text x="${W - 10}" y="${H - 4}" font-size="11" text-anchor="end" fill="#7B8599">Age ${age + pts.length - 1}</text></svg>
    <div class="flex gap-4 text-xs text-ink-2 mt-1"><span><i class="legend-dot" style="background:#12A150"></i>Your investments</span><span><i class="legend-dot" style="background:#94A3B8"></i>Amount you'd need</span></div>
    <dl class="kv mt-4"><div><dt>Needed in today's money</dt><dd>${money(Math.round(today))}</dd></div><div><dt>Needed at that age</dt><dd>${money(Math.round(mid.target))}</dd></div></dl>
    ${more.years !== null && more.years < mid.years ? `<p class="callout mt-4">Investing <b>${money(Math.round(num(p.invest) * 0.2))}</b> more a month would bring it forward by about <b>${mid.years - more.years} year${mid.years - more.years === 1 ? '' : 's'}</b>.</p>` : ''}
    <p class="text-xs text-ink-3 mt-3">"Financially independent" means your investments could pay for your lifestyle by withdrawing ${p.swr}% a year. Returns are not guaranteed; revisit this once a year.</p>`;
}

/* ----- Loan prepayment ----- */
function loanTool() {
  const loans = M.emis.filter(({ c }) => c.status === 'active');
  const opts = [...loans.map(({ e }) => [e.id, e.name]), ['custom', 'Another loan (type details)']];
  const sel = pval('loan', 'id', loans[0]?.e.id || 'custom');
  const debts = [...loans.map(({ e, c }) => ({ name: e.name, rate: num(e.annualRate), left: c.remaining })),
    ...db.accounts.filter((a) => a.type === 'credit_card' && (M.balances.get(a.id) || 0) < 0).map((a) => ({ name: `${a.name} (unpaid bill)`, rate: 42, left: -(M.balances.get(a.id)) }))].sort((a, b) => b.rate - a.rate);
  return `<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
    <section class="panel p-5 lg:col-span-2 space-y-4"><h2 class="panel-title">Pay a loan off early ${PRO}</h2>
      ${field('Loan', `<select class="inp" data-p="loan.id">${opts.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
      <div data-custom ${sel === 'custom' ? '' : 'hidden'} class="space-y-4">${twoCol(pinput('loan', 'principal', 'Amount still owed', 1000000, 'type="number" min="0" inputmode="decimal"'), pinput('loan', 'rate', 'Interest rate % a year', 8.5, 'type="number" min="0" step="0.05"'))}${pinput('loan', 'months', 'Months left', 180, 'type="number" min="1"')}</div>
      ${twoCol(pinput('loan', 'lump', 'Extra payment now', 50000, 'type="number" min="0" step="1000" inputmode="decimal"'), pinput('loan', 'extra', 'Extra every month', 0, 'type="number" min="0" step="500" inputmode="decimal"'))}
      ${field('After prepaying, keep', `<select class="inp" data-p="loan.mode"><option value="tenure" ${pval('loan', 'mode', 'tenure') === 'tenure' ? 'selected' : ''}>The same EMI, finish sooner (saves more)</option><option value="emi" ${pval('loan', 'mode', 'tenure') === 'emi' ? 'selected' : ''}>The same end date, lower EMI</option></select>`)}
    </section>
    <section class="panel p-5 lg:col-span-3 result-first"><div id="res-loan">${loanResult()}</div>
      ${debts.length > 1 ? `<h3 class="font-semibold mt-6 mb-2">Which debt to pay first?</h3><p class="text-sm text-ink-2 mb-2">Extra money saves the most interest on the highest rate first:</p>
        <ol class="list-decimal ml-5 text-sm space-y-1">${debts.map((d) => `<li>${esc(d.name)}: ${d.rate}% a year, ${money(Math.round(d.left))} left</li>`).join('')}</ol><p class="text-xs text-ink-3 mt-2">Unpaid card bills are shown at about 42% a year, typical for Indian cards.</p>` : ''}
    </section></div>`;
}
function amortize(B, r, emi, extra = 0) {
  let months = 0, interest = 0;
  while (B > 0.5 && months < 1200) { const i = B * r; interest += i; B = B + i - emi - extra; months++; if (emi + extra <= i) return { months: Infinity, interest: Infinity }; }
  return { months, interest };
}
function loanResult() {
  const p = { id: 'custom', principal: 1000000, rate: 8.5, months: 180, lump: 50000, extra: 0, mode: 'tenure', ...(planIn.loan || {}) };
  const L = M.emis.find(({ e }) => e.id === p.id);
  const B = L ? L.c.remaining : num(p.principal), rate = L ? num(L.e.annualRate) : num(p.rate), n = L ? L.c.remainingMonths : int(p.months);
  const r = rate / 1200;
  if (!(B > 0) || !(n > 0)) return '<p class="text-sm text-ink-2">Enter the loan details.</p>';
  const emi = L ? L.c.emi : r > 0 ? (B * r * (1 + r) ** n) / ((1 + r) ** n - 1) : B / n;
  const base = amortize(B, r, emi);
  const B2 = Math.max(0, B - num(p.lump));
  let res, newEmi = emi;
  if (p.mode === 'emi') { newEmi = r > 0 ? (B2 * r * (1 + r) ** n) / ((1 + r) ** n - 1) : B2 / n; res = amortize(B2, r, newEmi, num(p.extra)); }
  else res = amortize(B2, r, emi, num(p.extra));
  const saved = base.interest - res.interest, monthsSaved = base.months - res.months;
  const end = addMonths(`${thisMonth()}-01`, res.months).slice(0, 7);
  return `<h2 class="panel-title mb-3">What you save</h2>
    <div class="grid grid-cols-2 gap-3"><div class="stat-tile in"><div class="stat-label">Interest saved</div><div class="stat-value num">${money(Math.round(saved))}</div></div>
      <div class="stat-tile"><div class="stat-label">${p.mode === 'emi' ? 'New EMI' : 'Finishes sooner by'}</div><div class="stat-value num">${p.mode === 'emi' ? money(Math.round(newEmi)) : `${Math.floor(monthsSaved / 12)} yr ${monthsSaved % 12} mo`}</div></div></div>
    <p class="text-sm text-ink-2 mt-3">Owed now ${money(Math.round(B))} at ${rate}% · EMI ${money(Math.round(emi))} · ${n} months left. With your prepayment it ends around <b>${fmtMonth(end)}</b> and total interest drops from ${money(Math.round(base.interest))} to ${money(Math.round(res.interest))}.</p>
    <p class="text-xs text-ink-3 mt-2">Check your lender's prepayment rules; home loans on a floating rate usually have no prepayment charge for individuals.</p>`;
}

/* ----- Capital gains planner ----- */
const isEquityHolding = (a) => ['Stocks', 'ETF'].includes(a.subtype) || (a.subtype === 'Mutual fund' && !/debt|liquid|gilt|bond|overnight|money market|credit risk|banking and psu/i.test(`${a.name} ${a.schemeName || ''}`));
function holdingLots(a) {
  const lots = [];
  if (num(a.units) > 0) lots.push({ date: a.unitsDate || a.openingDate, units: num(a.units), cost: num(a.investedAmount ?? a.openingBalance) });
  const since = a.unitsDate || '';
  const moves = db.transactions.filter((t) => t.type !== 'adjustment' && (t.toAccountId === a.id || t.fromAccountId === a.id) && t.units !== undefined && t.units !== null && t.units !== '' && (since ? t.date > since : t.date >= (a.openingDate || ''))).sort((x, y) => x.date.localeCompare(y.date));
  const sales = [];
  for (const t of moves) {
    if (t.toAccountId === a.id) { lots.push({ date: t.date, units: num(t.units), cost: num(t.amount) }); continue; }
    let left = num(t.units), costOut = 0, lt = 0, st = 0;
    while (left > 1e-6 && lots.length) {
      const l = lots[0], take = Math.min(left, l.units), c = (l.cost / l.units) * take;
      const g = (num(t.amount) * take) / num(t.units) - c;
      if ((parseDate(t.date) - parseDate(l.date)) / 864e5 > CG_RULES.longAfterDays) lt += g; else st += g;
      l.cost -= c; l.units -= take; costOut += c; left -= take;
      if (l.units <= 1e-6) lots.shift();
    }
    sales.push({ date: t.date, lt, st });
  }
  return { lots, sales };
}
function gainsData() {
  const fy = fyRange(fyOf(todayStr())), today = todayStr();
  let realizedLT = 0, realizedST = 0;
  const rows = [];
  for (const a of db.accounts.filter((x) => x.type === 'investment' && !x.archived && isEquityHolding(x))) {
    const { lots, sales } = holdingLots(a);
    for (const s of sales) if (s.date >= fy.from && s.date <= fy.to) { realizedLT += s.lt; realizedST += s.st; }
    const units = lots.reduce((s, l) => s + l.units, 0);
    const price = num(a.unitPrice) || (units ? (M.balances.get(a.id) || 0) / units : 0);
    if (!units || !price) continue;
    let lt = 0, st = 0, ltUnits = 0;
    for (const l of lots) { const g = l.units * price - l.cost; if ((parseDate(today) - parseDate(l.date)) / 864e5 > CG_RULES.longAfterDays) { lt += g; ltUnits += l.units; } else st += g; }
    rows.push({ a, lt: round2(lt), st: round2(st), ltUnits, price });
  }
  const exemptLeft = Math.max(0, CG_RULES.ltcgExempt - Math.max(0, realizedLT));
  const taxST = Math.max(0, realizedST) * CG_RULES.stcgRate * (1 + CG_RULES.cess);
  const taxLT = Math.max(0, realizedLT - CG_RULES.ltcgExempt) * CG_RULES.ltcgRate * (1 + CG_RULES.cess);
  return { fy, rows, realizedLT: round2(realizedLT), realizedST: round2(realizedST), exemptLeft, tax: round2(taxST + taxLT),
    ltGains: rows.filter((r) => r.lt > 0), losses: rows.filter((r) => r.lt < 0 || r.st < 0) };
}
function gainsTool() {
  const g = gainsData();
  const harvest = g.ltGains.reduce((s, r) => s + r.lt, 0);
  const daysToMarch = Math.round((parseDate(`${g.fy.to.slice(0, 4)}-03-28`) - parseDate(todayStr())) / 864e5);
  return `<section class="panel p-5">
      <div class="panel-head"><h2 class="panel-title">Capital gains this financial year ${PRO}</h2><span class="text-sm text-ink-3">FY ${fyOf(todayStr())}${daysToMarch > 0 ? `, ${daysToMarch} days to the March deadline` : ''}</span></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="stat-tile"><div class="stat-label">Long-term gains booked</div><div class="stat-value num">${money(g.realizedLT)}</div></div>
        <div class="stat-tile"><div class="stat-label">Short-term gains booked</div><div class="stat-value num">${money(g.realizedST)}</div></div>
        <div class="stat-tile in"><div class="stat-label">Tax-free limit left</div><div class="stat-value num">${money(g.exemptLeft)}</div></div>
        <div class="stat-tile out"><div class="stat-label">Estimated tax so far</div><div class="stat-value num">${money(g.tax)}</div></div>
      </div>
    </section>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <section class="panel p-5"><h2 class="panel-title mb-2"><i class="fa-solid fa-seedling text-gain mr-1.5"></i>Tax-free gains available</h2>
        <p class="text-sm text-ink-2 mb-3">Each year the first ${money(CG_RULES.ltcgExempt)} of long-term equity gains is tax-free. Booking gains within that limit and reinvesting resets your purchase price higher, which can lower tax later ("gain harvesting").</p>
        ${g.ltGains.length ? `<div class="divider">${g.ltGains.map((r) => `<div class="row text-sm"><div class="flex-1 min-w-0"><b>${esc(r.a.name)}</b><div class="text-xs text-ink-3">${r.ltUnits.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units held over a year</div></div><div class="num text-gain font-semibold">+${money(r.lt)}</div></div>`).join('')}</div>
          <p class="callout mt-3">Unbooked long-term gains: <b class="num">${money(harvest)}</b>. Tax-free room left this year: <b class="num">${money(g.exemptLeft)}</b>.</p>` : '<p class="text-sm text-ink-3">No long-term gains yet (units held over a year with a profit). Units bought through SIPs count once they are a year old.</p>'}
      </section>
      <section class="panel p-5"><h2 class="panel-title mb-2"><i class="fa-solid fa-arrow-trend-down text-loss mr-1.5"></i>Losses that could offset gains</h2>
        <p class="text-sm text-ink-2 mb-3">Booking a loss can reduce tax on gains in the same year. Short-term losses can offset short- and long-term gains; long-term losses only long-term gains.</p>
        ${g.losses.length ? `<div class="divider">${g.losses.map((r) => `<div class="row text-sm"><div class="flex-1 min-w-0"><b>${esc(r.a.name)}</b></div><div class="text-right num"><div class="${r.st < 0 ? 'text-loss' : 'text-ink-3'}">Short-term ${money(r.st)}</div><div class="${r.lt < 0 ? 'text-loss' : 'text-ink-3'}">Long-term ${money(r.lt)}</div></div></div>`).join('')}</div>` : '<p class="text-sm text-ink-3">No holdings are at a loss right now.</p>'}
      </section>
    </div>
    <p class="text-xs text-ink-3 mt-4">Covers equity funds, stocks and ETFs whose units the app knows (from SIP units and the units you entered); debt funds are taxed at your slab rate and are left out. Sell before about 28 March so trades settle inside the financial year. Figures are estimates: confirm with your CA before acting.</p>`;
}

/* ----- Regular vs Direct ----- */
function directTool() {
  const regs = M.P.holdings.filter((h) => h.a.subtype === 'Mutual fund' && /regular/i.test(`${h.a.name} ${h.a.schemeName || ''}`));
  return `<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
    <section class="panel p-5 lg:col-span-2 space-y-4"><h2 class="panel-title">Assumptions ${PRO}</h2>
      <p class="text-sm text-ink-2">Regular plans pay a commission to a distributor out of your money every year; Direct plans of the same fund don't, so they cost less.</p>
      ${pslider('direct', 'gap', 'Extra yearly cost of Regular', 0.8, 0.2, 1.5, 0.05, '%')}
      ${pslider('direct', 'ret', 'Expected return', 12, 6, 16, 0.5, '%')}
      ${pslider('direct', 'load', 'Exit load on units under 1 year', 1, 0, 2, 0.25, '%')}
      <p class="text-xs text-ink-3">Enter the fund's real expense ratio on the holding for exact numbers; Direct plans typically cost 0.5% to 1.5% a year less.</p>
    </section>
    <section class="panel p-5 lg:col-span-3 result-first" id="res-direct">${directResult(regs)}</section></div>`;
}
function directResult(regs = M.P.holdings.filter((h) => h.a.subtype === 'Mutual fund' && /regular/i.test(`${h.a.name} ${h.a.schemeName || ''}`))) {
  const p = { gap: 0.8, ret: 12, load: 1, ...(planIn.direct || {}) };
  if (!regs.length) return `<h2 class="panel-title mb-2">Your funds</h2><p class="text-sm text-ink-2">None of your funds is a Regular plan (going by their names). Nothing to compare.</p>`;
  const g = gainsData();
  return `<h2 class="panel-title mb-3">Your Regular plans</h2>${regs.map((h) => {
    const gap = num(p.gap) / 100, r = num(p.ret) / 100;
    const yearly = h.value * gap, ten = h.value * ((1 + r) ** 10 - (1 + r - gap) ** 10);
    const { lots } = holdingLots(h.a);
    const price = num(h.a.unitPrice) || 0;
    let st = 0, lt = 0, young = 0;
    for (const l of lots) { const v = l.units * price, gain = v - l.cost; if ((parseDate(todayStr()) - parseDate(l.date)) / 864e5 > CG_RULES.longAfterDays) lt += gain; else { st += gain; young += v; } }
    const tax = Math.max(0, st) * CG_RULES.stcgRate * (1 + CG_RULES.cess) + Math.max(0, Math.max(0, lt) - g.exemptLeft) * CG_RULES.ltcgRate * (1 + CG_RULES.cess);
    const load = young * (num(p.load) / 100), cost = tax + load;
    const breakeven = yearly > 0 ? Math.ceil(cost / (yearly / 12)) : null;
    return `<div class="cf-card mb-3"><b>${esc(h.a.name)}</b><div class="text-xs text-ink-3 mb-2">Same fund, Direct plan: ${esc(h.a.name.replace(/regular/i, 'Direct'))}</div>
      <dl class="kv"><div><dt>Extra cost each year</dt><dd class="text-loss">${money(Math.round(yearly))}</dd></div><div><dt>Over 10 years (with growth)</dt><dd class="text-loss">${money(Math.round(ten))}</dd></div>
        <div><dt>Cost of switching now</dt><dd>${money(Math.round(cost))}</dd></div><div><dt>Pays for itself in</dt><dd>${breakeven === null ? '–' : breakeven <= 0 ? 'Right away' : `${breakeven} months`}</dd></div></dl>
      <p class="text-xs text-ink-3 mt-2">A switch is a sale: tax ${money(Math.round(tax))} (short-term ${money(Math.round(Math.max(0, st)))}, long-term ${money(Math.round(Math.max(0, lt)))}) and exit load ${money(Math.round(load))}. Waiting until units are over a year old usually lowers the cost; new SIPs can go to the Direct plan straight away.</p></div>`;
  }).join('')}<p class="text-xs text-ink-3">Estimates only; check the fund's actual expense ratio and exit load, and ask a tax adviser before switching.</p>`;
}

/* ----- Salary-day plan ----- */
function salaryTool() {
  const plan = db.settings.salaryPlan || [];
  const sal = db.subscriptions.find((s) => s.active && recurKind(s) === 'income' && /salary/i.test(`${s.name} ${s.category}`));
  const avgSal = sal ? num(sal.amount) : monthlyAverages(3).income;
  const total = plan.reduce((s, x) => s + num(x.amount), 0);
  const kindLabel = (x) => (x.kind === 'goal' ? `To goal: ${goalName(x.goalId)}` : x.kind === 'transfer' ? `Move to ${accountName(x.toAccountId)}` : 'Reminder');
  return `<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
    <section class="panel p-5 lg:col-span-3"><div class="panel-head"><h2 class="panel-title">Pay yourself first</h2><button class="btn btn-sm btn-primary" data-action="salary-item">Add a step</button></div>
      <p class="text-sm text-ink-2 mb-4">Decide once where your salary goes. When salary arrives the dashboard offers to apply it with one tap: money is put towards goals and moved to savings or investment accounts.</p>
      ${plan.length ? `<div class="divider">${plan.map((x, i) => `<div class="row"><span class="row-icon ${x.kind === 'goal' ? 'invest' : x.kind === 'transfer' ? 'move' : ''}"><i class="fa-solid ${x.kind === 'goal' ? 'fa-flag-checkered' : x.kind === 'transfer' ? 'fa-right-left' : 'fa-bell'}"></i></span>
        <div class="flex-1 min-w-0"><div class="font-medium">${esc(x.label || kindLabel(x))}</div><div class="text-xs text-ink-3">${esc(kindLabel(x))}</div></div>
        <div class="num font-semibold">${money(x.amount)}</div><div class="row-actions"><button class="icon-btn sm" data-action="salary-del" data-i="${i}" title="Remove" aria-label="Remove step"><i class="fa-regular fa-trash-can"></i></button></div></div>`).join('')}</div>
        <div class="flex justify-between mt-4 font-semibold"><span>Planned</span><span class="num">${money(total)}${avgSal ? ` of ${money(Math.round(avgSal))} (${Math.round((total / avgSal) * 100)}%)` : ''}</span></div>
        <div class="flex gap-2 mt-4 flex-wrap"><button class="btn btn-primary" data-action="salary-apply"><i class="fa-solid fa-check"></i> Apply now</button>${db.settings.salaryPlanApplied === thisMonth() ? '<span class="pill in self-center">Applied this month</span>' : ''}</div>`
        : emptyState('fa-briefcase', 'No steps yet. Add where salary money should go: a goal, a savings account, an investment account.')}
    </section>
    <section class="panel p-5 lg:col-span-2"><h2 class="panel-title mb-2">A simple starting split</h2>
      <p class="text-sm text-ink-2">A common rule of thumb is 50/30/20: about half for needs (rent, bills, groceries), 30% for wants, and 20% for saving and investing. Adjust it to your life.</p>
      ${avgSal ? `<dl class="kv mt-3"><div><dt>Needs (50%)</dt><dd>${money(Math.round(avgSal * 0.5))}</dd></div><div><dt>Wants (30%)</dt><dd>${money(Math.round(avgSal * 0.3))}</dd></div><div><dt>Save and invest (20%)</dt><dd>${money(Math.round(avgSal * 0.2))}</dd></div></dl>` : ''}
    </section></div>`;
}
const goalName = (id) => db.goals.find((g) => g.id === id)?.name || 'a goal';
function openSalaryItem() {
  const goals = db.goals.filter((g) => !g.done);
  openModal({
    title: 'Add a salary-day step',
    body: `<div class="seg">${[['goal', 'Put towards a goal'], ['transfer', 'Move to an account'], ['note', 'Just a reminder']].map(([v, l], i) => `<input type="radio" name="kind" id="sk_${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="sk_${v}">${l}</label>`).join('')}</div>
      ${twoCol(field('Amount', moneyInput('amount', '', 'required min="1"')), field('Name (optional)', input('label', '', 'maxlength="60" placeholder="e.g. Emergency fund"')))}
      ${showFor('goal', goals.length ? field('Goal', select('goalId', goals.map((g) => [g.id, g.name]))) : '<p class="hint">Create a goal first on the Goals page.</p>')}
      ${showFor('transfer', twoCol(field('From', accountSelect('fromAccountId', firstAccountOf(['bank']), { types: ['bank'] })), field('To', accountSelect('toAccountId', '', { types: ['bank', 'investment'] }))))}`,
    submitLabel: 'Add',
    onOpen: (form) => bindShowHide(form, 'kind'),
    onSubmit: (d) => {
      if (d.kind === 'transfer' && (!d.toAccountId || d.toAccountId === d.fromAccountId)) { toast('Choose a different account to move money to.', 'error'); return false; }
      const item = { kind: d.kind, amount: round2(num(d.amount)), label: d.label || '', goalId: d.goalId || '', fromAccountId: d.fromAccountId || '', toAccountId: d.toAccountId || '' };
      commit([opSettings({ salaryPlan: [...(db.settings.salaryPlan || []), item] })], 'Add salary-day step');
    },
  });
}
function applySalaryPlan() {
  const plan = db.settings.salaryPlan || [];
  if (!plan.length) { toast('Add steps to the salary-day plan first.'); plannerTab = 'salary'; location.hash = '#planner'; return; }
  const ops = [], today = todayStr();
  for (const x of plan) {
    if (x.kind === 'goal') { const g = db.goals.find((y) => y.id === x.goalId); if (g) ops.push(opUpsert('goals', { ...g, contributions: [...(g.contributions || []), { date: today, amount: num(x.amount), note: 'Salary-day plan' }] })); }
    if (x.kind === 'transfer' && x.toAccountId) ops.push(opUpsert('transactions', { id: uid('txn'), date: today, type: 'transfer', amount: num(x.amount), category: transferCategory(x.fromAccountId, x.toAccountId), description: x.label || 'Salary-day plan', fromAccountId: x.fromAccountId, toAccountId: x.toAccountId, relatedType: '', relatedId: '', notes: 'Salary-day plan' }));
  }
  ops.push(opSettings({ salaryPlanApplied: thisMonth() }));
  commit(ops, 'Apply salary-day plan');
  const notes = plan.filter((x) => x.kind === 'note').map((x) => x.label).filter(Boolean);
  toast(`Salary plan applied.${notes.length ? ` Reminders: ${notes.join(', ')}.` : ''}`, 'success');
}

/* ----- Year in review ----- */
function reviewTool() {
  const years = [...new Set(db.transactions.map((t) => t.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const y = pval('review', 'year', years[0] || String(new Date().getFullYear()));
  const from = `${y}-01-01`, to = `${y}-12-31` < todayStr() ? `${y}-12-31` : todayStr();
  const tx = db.transactions.filter((t) => t.date >= from && t.date <= to);
  const spent = tx.filter((t) => t.type === 'expense'), income = tx.filter((t) => t.type === 'income').reduce((s, t) => s + num(t.amount), 0);
  const total = spent.reduce((s, t) => s + num(t.amount), 0), inv = tx.filter(isInvestmentOutflow).reduce((s, t) => s + num(t.amount), 0);
  const cats = {}; for (const t of spent) cats[t.category || 'Other'] = (cats[t.category || 'Other'] || 0) + num(t.amount);
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const mer = {}; for (const t of spent) { const k = (t.description || t.category || '').trim(); if (k) mer[k] = (mer[k] || 0) + 1; }
  const topMer = Object.entries(mer).sort((a, b) => b[1] - a[1])[0];
  const biggest = spent.slice().sort((a, b) => num(b.amount) - num(a.amount))[0];
  const days = new Set(spent.map((t) => t.date)); const span = Math.max(1, Math.round((parseDate(to) - parseDate(from)) / 864e5) + 1);
  // Net worth from when tracking began that year (accounts added later aren't counted as a jump)
  const firstOpen = db.accounts.map((a) => a.openingDate).filter(Boolean).sort()[0] || from;
  const startDay = firstOpen > from ? firstOpen : addDays(from, -1);
  const nwStart = snapshotAt(startDay).net, nwEnd = snapshotAt(to).net;
  const wins = db.wishlist.filter((w) => w.status === 'skipped' && (w.skippedOn || '').startsWith(y)).reduce((s, w) => s + num(w.price), 0);
  const goalsDone = db.goals.filter((g) => g.done).length;
  const kept = income > 0 ? Math.round(((income - total) / income) * 100) : null;
  const tile = (label, value, sub = '') => `<div class="wrap-tile"><div class="wrap-label">${label}</div><div class="wrap-value num">${value}</div>${sub ? `<div class="wrap-sub">${sub}</div>` : ''}</div>`;
  return `<div class="flex items-center gap-3 mb-4"><label class="lbl !mb-0" for="ry">Year</label><select id="ry" class="inp !w-auto" data-p="review.year" data-rerender>${(years.length ? years : [y]).map((v) => `<option ${v === y ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn btn-sm" data-action="review-share"><i class="fa-solid fa-share-nodes"></i> Share</button></div>
    <section class="wrapped" id="wrapped">
      <div class="wrap-head"><div class="display text-3xl font-semibold">${esc(db.settings.ownerName || 'Your')}'s ${y}</div><div class="hero-dim text-sm">in money, with KOSH</div></div>
      <div class="wrap-grid">
        ${tile('Money in', money(Math.round(income)))}${tile('Spent', money(Math.round(total)))}${tile('Invested', money(Math.round(inv)))}
        ${tile('Kept', kept === null ? '–' : `${kept}%`, 'of what came in')}
        ${tile('Net worth', `${nwEnd - nwStart >= 0 ? '+' : '−'}${money(Math.abs(Math.round(nwEnd - nwStart)))}`, `${money(Math.round(nwStart))} → ${money(Math.round(nwEnd))}`)}
        ${tile('No-spend days', `${span - days.size}`, `of ${span}`)}
        ${tile('Top category', topCats[0] ? esc(topCats[0][0]) : '–', topCats.slice(0, 3).map(([c, v]) => `${esc(c)} ${money(Math.round(v))}`).join(' · '))}
        ${tile('Favourite place', topMer ? esc(topMer[0]) : '–', topMer ? `${topMer[1]} visits` : '')}
        ${tile('Biggest spend', biggest ? money(Math.round(num(biggest.amount))) : '–', biggest ? esc(biggest.description || biggest.category) : '')}
        ${tile('Saving wins', money(Math.round(wins)), 'from skipped impulse buys')}${tile('Goals reached', `${goalsDone}`)}
      </div></section>`;
}
function shareReview() {
  const el = $('#wrapped'); if (!el) return;
  const text = [...el.querySelectorAll('.wrap-tile')].map((t) => `${t.querySelector('.wrap-label').textContent}: ${t.querySelector('.wrap-value').textContent}`).join('\n');
  const msg = `${el.querySelector('.wrap-head .display').textContent}\n${text}\n\nTracked with KOSH`;
  if (navigator.share) navigator.share({ text: msg }).catch(() => {});
  else navigator.clipboard?.writeText(msg).then(() => toast('Copied. Paste it anywhere to share.', 'success'));
}

/* ===== Split a bill (Splitwise style) =====
   One bill, shared between you and people on the People page.
   - You paid: your share is your expense; everyone else's share is money they
     now owe you (a transfer to that person, like home expenses).
   - Someone else paid: your share is an expense paid by them, so you owe them.
   Everything is tagged with the same splitId so it shows and deletes as one. */
function openSplitForm() {
  const ppl = db.accounts.filter((a) => a.type === 'person' && !a.archived);
  const cats = db.settings.expenseCategories;
  openModal({
    title: 'Split a bill',
    wide: true,
    body: `${twoCol(field('What was it?', input('description', '', 'required maxlength="100" placeholder="e.g. Dinner at Vaishali, Goa villa"')), field('Total bill', moneyInput('total', '', 'required min="1" data-big')))}
      ${twoCol(field('Date', input('date', todayStr(), 'type="date" required')), field('Category', select('category', cats, cats.includes('Food & dining') ? 'Food & dining' : cats[0])))}
      ${twoCol(field('Who paid?', select('payer', [['me', 'I paid'], ...ppl.map((p) => [p.id, `${p.name} paid`])], 'me')), `<div data-myacc>${field('Paid from', accountSelect('fromAccountId', firstAccountOf(['credit_card', 'bank']), { types: ['cash', 'bank', 'credit_card'] }))}</div>`)}
      <div><span class="lbl">Split between</span><div class="filter-picks">
        <label class="check-chip"><input type="checkbox" name="with_me" checked> Me</label>
        ${ppl.map((p) => `<label class="check-chip"><input type="checkbox" name="with_${p.id}"> ${esc(p.name)}</label>`).join('')}</div>
        ${field('Add someone new (optional)', input('newPeople', '', 'placeholder="Names, separated by commas"'), 'They are added to your People page.')}</div>
      <div><span class="lbl">How to split</span><div class="seg">${[['equal', 'Equally'], ['amount', 'By amounts'], ['percent', 'By %']].map(([v, l], i) => `<input type="radio" name="method" id="sm_${v}" value="${v}" ${i === 0 ? 'checked' : ''}><label for="sm_${v}">${l}</label>`).join('')}</div></div>
      <div data-shares class="space-y-2"></div>
      <p class="callout" data-split-summary></p>`,
    submitLabel: 'Save split',
    onOpen: (form) => {
      const sig = { signal: modalSignal() };
      const people = () => {
        const list = [];
        if (form.elements.with_me.checked) list.push({ id: 'me', name: 'Me' });
        for (const p of ppl) if (form.elements[`with_${p.id}`]?.checked) list.push({ id: p.id, name: p.name });
        String(form.elements.newPeople.value || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((n, i) => list.push({ id: `new${i}`, name: n, isNew: true }));
        return list;
      };
      const draw = () => {
        const list = people(), method = form.elements.method.value, total = num(form.elements.total.value);
        $('[data-myacc]', form).hidden = form.elements.payer.value !== 'me';
        const box = $('[data-shares]', form);
        const prev = Object.fromEntries($$('[data-share]', box).map((el) => [el.dataset.share, el.value]));
        box.innerHTML = method === 'equal' ? '' : list.map((p) => `<div class="flex items-center gap-3"><span class="flex-1">${esc(p.name)}</span><input class="inp !w-32" type="number" step="0.01" min="0" inputmode="decimal" data-share="${p.id}" value="${esc(prev[p.id] ?? '')}" placeholder="${method === 'percent' ? '%' : '₹'}"></div>`).join('');
        summary();
      };
      const summary = () => {
        const s = splitShares(form, people());
        $('[data-split-summary]', form).innerHTML = s.error ? `<span class="text-loss">${esc(s.error)}</span>` : s.shares.map((x) => `${esc(x.name)}: <b class="num">${money(x.amount)}</b>`).join(' · ');
      };
      form.addEventListener('change', (e) => { if (['payer', 'method', 'newPeople'].includes(e.target.name) || e.target.name?.startsWith('with_')) draw(); else summary(); }, sig);
      form.addEventListener('input', (e) => { if (e.target.name === 'newPeople') draw(); else summary(); }, sig);
      form._people = people;
      draw();
    },
    onSubmit: (d, form) => {
      const list = form._people();
      const s = splitShares(form, list);
      if (s.error) { toast(s.error, 'error'); return false; }
      const ops = [], idOf = {};
      for (const p of list) if (p.isNew) { const rec = newPersonRecord(p.name); ops.push(opUpsert('accounts', rec)); idOf[p.id] = rec.id; }
      const pid = (id) => idOf[id] || id;
      const splitId = uid('split'), payer = d.payer;
      const base = (amount, extra) => ({ id: uid('txn'), date: d.date, amount: round2(amount), category: d.category, description: `${d.description} (split)`, relatedType: 'split', relatedId: splitId, splitTotal: round2(num(d.total)), notes: `Split ${s.shares.map((x) => `${x.name} ${x.amount}`).join(', ')}`, ...extra });
      if (payer === 'me') {
        for (const x of s.shares) {
          if (x.id === 'me') ops.push(opUpsert('transactions', base(x.amount, { type: 'expense', fromAccountId: d.fromAccountId, toAccountId: '' })));
          else ops.push(opUpsert('transactions', base(x.amount, { type: 'transfer', fromAccountId: d.fromAccountId, toAccountId: pid(x.id) })));
        }
      } else {
        const mine = s.shares.find((x) => x.id === 'me');
        if (!mine) { toast('You are not in this split, so nothing changes for you.', 'error'); return false; }
        ops.push(opUpsert('transactions', base(mine.amount, { type: 'expense', fromAccountId: payer, toAccountId: '' })));
      }
      commit(ops, `Split ${d.description}`);
      toast(payer === 'me' ? `Split saved. Others owe you ${money(round2(num(d.total) - (s.shares.find((x) => x.id === 'me')?.amount || 0)))}.` : `Split saved. You owe ${accountName(payer)} ${money(s.shares.find((x) => x.id === 'me').amount)}.`, 'success');
    },
  });
}
/** Work out each person's share; the last person absorbs rounding so shares add up exactly. */
function splitShares(form, list) {
  const total = round2(num(form.elements.total.value)), method = form.elements.method.value;
  if (!total) return { error: 'Enter the total bill.' };
  if (list.length < 2) return { error: 'Pick at least two people, including whoever else shared it.' };
  let shares;
  if (method === 'equal') { const each = Math.floor((total / list.length) * 100) / 100; shares = list.map((p, i) => ({ ...p, amount: i === list.length - 1 ? round2(total - each * (list.length - 1)) : each })); }
  else {
    const vals = list.map((p) => num($(`[data-share="${p.id}"]`, form)?.value));
    const sum = vals.reduce((s, v) => s + v, 0);
    if (method === 'percent') {
      if (Math.abs(sum - 100) > 0.01) return { error: `Percentages add up to ${round2(sum)}%, not 100%.` };
      let used = 0; shares = list.map((p, i) => { const a = i === list.length - 1 ? round2(total - used) : round2((total * vals[i]) / 100); used += a; return { ...p, amount: a }; });
    } else {
      if (Math.abs(sum - total) > 0.01) return { error: `Shares add up to ${money(sum)}, not ${money(total)}.` };
      shares = list.map((p, i) => ({ ...p, amount: round2(vals[i]) }));
    }
  }
  return { shares };
}
/** Recent splits for the People page. */
function splitsSection() {
  const groups = new Map();
  for (const t of db.transactions.filter((x) => x.relatedType === 'split')) { if (!groups.has(t.relatedId)) groups.set(t.relatedId, []); groups.get(t.relatedId).push(t); }
  const list = [...groups.entries()].map(([id, items]) => ({ id, items, date: items[0].date, desc: items[0].description.replace(/ \(split\)$/, ''), total: items[0].splitTotal || items.reduce((s, t) => s + num(t.amount), 0) })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  return `<section class="panel p-5 mt-6"><div class="panel-head"><div><h2 class="panel-title"><i class="fa-solid fa-people-arrows mr-1.5 text-royal"></i>Split bills</h2><div class="text-xs text-ink-3 mt-0.5">Share a bill with friends or family; balances above update by themselves.</div></div>
    <button class="btn btn-sm btn-primary" data-action="split-new"><i class="fa-solid fa-plus"></i> Split a bill</button></div>
    ${list.length ? `<div class="divider">${list.map((g) => {
      const mine = g.items.find((t) => t.type === 'expense'), paidByMe = g.items.some((t) => MONEY_TYPES.includes(accountById(t.fromAccountId)?.type));
      const others = g.items.filter((t) => t.type === 'transfer');
      return `<div class="row"><span class="row-icon move"><i class="fa-solid fa-people-arrows"></i></span>
        <div class="flex-1 min-w-0"><div class="font-medium">${esc(g.desc)}</div><div class="text-xs text-ink-3">${fmtDate(g.date)} · total ${money(g.total)} · ${paidByMe ? 'you paid' : `${esc(accountName(mine?.fromAccountId))} paid`}</div>
          <div class="text-xs mt-1">${mine ? `Your share <b class="num">${money(mine.amount)}</b>` : ''}${others.map((t) => ` · ${esc(accountName(t.toAccountId))} owes <b class="num text-gain">${money(t.amount)}</b>`).join('')}${!paidByMe && mine ? ` · you owe <b class="num text-loss">${money(mine.amount)}</b>` : ''}</div></div>
        <div class="row-actions"><button class="icon-btn sm" data-action="split-del" data-id="${g.id}" title="Delete split" aria-label="Delete split"><i class="fa-regular fa-trash-can"></i></button></div></div>`;
    }).join('')}</div>` : emptyState('fa-people-arrows', 'No splits yet. Had dinner with friends? Split it here and see who owes whom.')}
  </section>`;
}
function deleteSplit(id) {
  const items = db.transactions.filter((t) => t.relatedType === 'split' && t.relatedId === id);
  if (!items.length || !confirm('Delete this split and all its entries?')) return;
  commit(items.map((t) => opDelete('transactions', t.id)), 'Delete split');
}

/* ===== Cool-off list ("I want to buy this") =====
   Log a tempting purchase instead of buying it. After the cool-off (48 hours
   by default) you decide: still want it (it stays on the wishlist) or skip it
   (a "saving win"). The illustration shows what the money could become if
   invested, at a stated assumed return; it is not a promise. */
const COOL_RETURN = 0.12;
function investIllustration(price) {
  const age = db.settings.birthYear ? new Date().getFullYear() - int(db.settings.birthYear) : null;
  const years = age && age < 58 ? 60 - age : 20;
  return { years, value: Math.round(num(price) * (1 + COOL_RETURN) ** years), toAge: age && age < 58 };
}
function openCoolOff() {
  openModal({
    title: 'I want to buy this',
    body: `<p class="text-sm text-ink-2">Log it instead of checking out. Wait for the cool-off to end, then decide. Most urges fade.</p>
      ${field('What is it?', input('name', '', 'required maxlength="80" placeholder="e.g. Smartwatch"'))}
      ${twoCol(field('Price', moneyInput('price', '', 'required min="1" data-big')), field('Cool-off', select('hours', [['24', '24 hours'], ['48', '48 hours'], ['72', '3 days'], ['168', '1 week']], '48')))}
      ${field('Link (optional)', input('link', '', 'type="url" placeholder="https://"'))}
      <p class="callout" data-illus>Enter the price to see what it could become if invested.</p>`,
    submitLabel: 'Start cool-off',
    onOpen: (form) => form.addEventListener('input', () => { const p = num(form.elements.price.value); if (p > 0) { const i = investIllustration(p); $('[data-illus]', form).innerHTML = `If you invested <b class="num">${money(p)}</b> instead, it could grow to about <b class="num">${money(i.value)}</b> in ${i.years} years${i.toAge ? ' (by age 60)' : ''}, assuming ${COOL_RETURN * 100}% a year.`; } }, { signal: modalSignal() }),
    onSubmit: (d) => {
      const until = new Date(Date.now() + int(d.hours) * 3600e3).toISOString();
      commit([opUpsert('wishlist', { id: uid('wish'), name: d.name.trim(), price: round2(num(d.price)), priority: 'medium', link: d.link || '', status: 'cooling', coolUntil: until, coolStarted: new Date().toISOString() })], `Cool-off: ${d.name}`);
      toast(`Cool-off started. We'll ask you again in ${int(d.hours) >= 48 ? `${int(d.hours) / 24} days` : '24 hours'}.`, 'success');
    },
  });
}
function coolLeft(w) { const ms = new Date(w.coolUntil) - Date.now(); if (ms <= 0) return null; const h = Math.ceil(ms / 3600e3); return h >= 48 ? `${Math.ceil(h / 24)} days` : `${h} h`; }
function openCoolDecide(id) {
  const w = db.wishlist.find((x) => x.id === id);
  if (!w) return;
  const i = investIllustration(w.price);
  openModal({
    title: `Still want the ${w.name}?`,
    body: `<p class="text-sm">Cool-off is over. Take a breath: ${money(w.price)} invested could be about <b class="num">${money(i.value)}</b> in ${i.years} years (assuming ${COOL_RETURN * 100}% a year).</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button type="button" class="btn btn-primary" data-action="cool-skip" data-id="${w.id}"><i class="fa-solid fa-trophy"></i> Skip it: a saving win</button>
        <button type="button" class="btn" data-action="cool-keep" data-id="${w.id}"><i class="fa-solid fa-cart-shopping"></i> I still want it</button></div>`,
    submitLabel: 'Later', cancelLabel: 'Close', onSubmit: () => {},
  });
}
function coolSkip(id) {
  const w = db.wishlist.find((x) => x.id === id); if (!w) return;
  commit([opUpsert('wishlist', { ...w, status: 'skipped', skippedOn: todayStr() })], `Saving win: ${w.name}`);
  closeModal();
  const total = db.wishlist.filter((x) => x.status === 'skipped').reduce((s, x) => s + num(x.price), 0);
  toast(`Saving win! You kept ${money(w.price)}. Total saving wins: ${money(total)}.`, 'success');
}
function coolKeep(id) {
  const w = db.wishlist.find((x) => x.id === id); if (!w) return;
  commit([opUpsert('wishlist', { ...w, status: 'wanted' })], `Keep ${w.name} on wishlist`);
  closeModal();
  toast('Moved to your wishlist. Mark it bought when you buy it, or start saving for it.');
}
const savingWins = () => db.wishlist.filter((x) => x.status === 'skipped').reduce((s, x) => s + num(x.price), 0);

/* ---------------------------------------------------------------------
   9. FORMS & ACTIONS
   --------------------------------------------------------------------- */
const LAST_ACCOUNT_KEY = 'kosh.lastAccount.v1';
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const firstAccountOf = (types) => db.accounts.find((a) => types.includes(a.type) && !a.archived)?.id || '';

function transferCategory(fromId, toId) {
  const f = accountById(fromId)?.type, t = accountById(toId)?.type;
  if (t === 'credit_card') return 'Credit card payment';
  if (t === 'investment') return 'Investment';
  if (f === 'investment') return 'Investment withdrawal';
  if (f === 'bank' && t === 'cash') return 'Cash withdrawal';
  if (f === 'cash' && t === 'bank') return 'Cash deposit';
  return 'Transfer';
}

/* ===== Transactions ===== */
/** Your 5 most-used categories of a type (last 90 days), as one-tap chips under the category box. */
function quickCategoryChips(type) {
  const since = addDays(todayStr(), -90), count = new Map();
  for (const t of db.transactions) if (t.type === type && t.date >= since && t.category) count.set(t.category, (count.get(t.category) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  return top.length ? `<div class="cat-chips">${top.map((c) => `<button type="button" class="chip" data-setcat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
}
function openTxnForm(existing, preset = {}) {
  if (existing?.type === 'adjustment') return openAdjustmentEdit(existing);
  if (!db.accounts.length) { toast('Add an account first.', 'error'); location.hash = '#accounts'; return; }
  // A home expense is stored as a transfer to the person who pays it back; it is edited as an expense.
  if (existing?.forHome) existing = { ...existing, type: 'expense', claimPersonId: existing.toAccountId, toAccountId: '' };
  const isNew = !existing || !db.transactions.some((x) => x.id === existing.id);
  const last = localStorage.getItem(LAST_ACCOUNT_KEY);
  const lastOk = last && accountById(last) && !accountById(last).archived ? last : '';
  const t = existing ? { ...existing } : {
    type: preset.type || 'expense', date: preset.date || todayStr(), amount: preset.amount ?? '',
    description: preset.description || '', category: preset.category || '', notes: '',
    fromAccountId: preset.fromAccountId || '', toAccountId: preset.toAccountId || '', forHome: !!preset.forHome,
  };
  const expCats = uniq([...db.settings.expenseCategories, t.type === 'expense' ? t.category : '']);
  const incCats = uniq([...db.settings.incomeCategories, t.type === 'income' ? t.category : '']);
  const defFrom = t.fromAccountId || (t.type === 'transfer' ? firstAccountOf(['bank']) : lastOk) || firstAccountOf(['cash', 'bank', 'credit_card']);
  const defTo = t.toAccountId || firstAccountOf(['bank', 'cash']);
  const types = [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']];

  const body = `
    <div class="seg" role="radiogroup" aria-label="Transaction type">
      ${types.map(([v, l]) => `<input type="radio" name="type" id="tt_${v}" value="${v}" ${t.type === v ? 'checked' : ''}><label for="tt_${v}">${l}</label>`).join('')}
    </div>
    ${twoCol(field('Amount', moneyInput('amount', t.amount, `required min="0.01" placeholder="0" data-big ${isNew ? 'autofocus' : ''}`)),
      field('Date', input('date', t.date, 'type="date" required') + `<div class="date-chips">${[['Today', todayStr()], ['Yesterday', addDays(todayStr(), -1)]].map(([l, d]) => `<button type="button" class="chip ${t.date === d ? 'on' : ''}" data-setdate="${d}">${l}</button>`).join('')}</div>`))}
    ${showFor('expense', twoCol(
      field('Category', select('category', expCats, t.type === 'expense' ? t.category : expCats[0]) + quickCategoryChips('expense')),
      field('Paid from', accountSelect('fromAccountId', defFrom, { types: MONEY_TYPES }))) +
      `<div class="home-claim">${checkbox('forHome', !!t.forHome, 'Paid for home: I\'ll take it back', 'It shows under People → Home expenses until it\'s paid back, and doesn\'t count as your own spending.')}
        <div data-claim ${t.forHome ? '' : 'hidden'} class="mt-3">${twoCol(field('Take it back from', select('claimPersonId', [...db.accounts.filter((a) => a.type === 'person' && !a.archived).map((a) => [a.id, a.name]), ['__new', '+ Someone new']], t.claimPersonId || defaultClaimPerson())),
          `<div data-newperson ${db.accounts.some((a) => a.type === 'person') ? 'hidden' : ''}>${field('Their name', input('newPersonName', '', 'placeholder="e.g. Dad"'))}</div>`)}</div></div>`)}
    ${showFor('income', twoCol(
      field('Source', select('category', incCats, t.type === 'income' ? t.category : incCats[0]) + quickCategoryChips('income')),
      field('Received in', accountSelect('toAccountId', t.type === 'income' ? (t.toAccountId || defTo) : defTo, { types: MONEY_TYPES }))))}
    ${showFor('transfer', twoCol(
      field('From', accountSelect('fromAccountId', t.type === 'transfer' ? t.fromAccountId || defFrom : firstAccountOf(['bank']))),
      field('To', accountSelect('toAccountId', t.type === 'transfer' ? t.toAccountId : ''))) +
      '<p class="hint">Use a transfer for ATM withdrawals, paying a credit card bill, or moving money into an FD or SIP. Transfers are not counted as income or spending.</p>')}
    ${field('Description', input('description', t.description, 'placeholder="What was it for?" maxlength="140"'))}
    ${field('Notes (optional)', textarea('notes', t.notes, 'rows="2"'))}
    ${existing?.relatedType === 'emi' ? '<p class="callout">This payment belongs to an EMI. Deleting it does not change the EMI\'s paid count; edit the EMI for that.</p>' : ''}`;

  openModal({
    title: isNew ? 'Add transaction' : 'Edit transaction',
    body,
    submitLabel: isNew ? 'Add transaction' : 'Save changes',
    onOpen: (form) => {
      bindShowHide(form, 'type');
      attachDescriptionSuggest(form); // suggestions from descriptions you've used before
      // Quick picks: Today / Yesterday and your most-used categories
      form.addEventListener('click', (e) => {
        const d = e.target.closest('[data-setdate]');
        if (d) { form.elements.date.value = d.dataset.setdate; $$('[data-setdate]', form).forEach((b) => b.classList.toggle('on', b === d)); return; }
        const c = e.target.closest('[data-setcat]');
        if (c) { const sel = $$('select[name="category"]', form).find((x) => !x.disabled); if (sel) { sel.value = c.dataset.setcat; sel.dispatchEvent(new Event('change', { bubbles: true })); } $$('[data-setcat]', c.parentNode).forEach((b) => b.classList.toggle('on', b === c)); }
      }, { signal: modalSignal() });
      const markCats = () => { const sel = $$('select[name="category"]', form).find((x) => !x.disabled); $$('[data-setcat]', form).forEach((b) => b.classList.toggle('on', !!sel && b.dataset.setcat === sel.value && !b.closest('[hidden]'))); };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'date') $$('[data-setdate]', form).forEach((b) => b.classList.toggle('on', b.dataset.setdate === e.target.value));
        if (e.target.name === 'category' || e.target.name === 'type') markCats();
      }, { signal: modalSignal() });
      markCats();
      if (isNew && window.innerWidth >= 640) setTimeout(() => form.elements.amount?.focus(), 50);
      const sig = { signal: modalSignal() };
      const claim = $('[data-claim]', form), newP = $('[data-newperson]', form);
      form.addEventListener('change', (e) => {
        if (e.target.name === 'forHome') claim.hidden = !e.target.checked;
        if (e.target.name === 'claimPersonId') newP.hidden = e.target.value !== '__new';
      }, sig);
      if (form.elements.claimPersonId && form.elements.claimPersonId.value === '__new') newP.hidden = false;
    },
    onSubmit: (d) => {
      const amount = round2(num(d.amount));
      if (amount <= 0) { toast('Enter an amount above zero.', 'error'); return false; }
      if (d.type === 'transfer' && d.fromAccountId === d.toAccountId) { toast('Choose two different accounts for a transfer.', 'error'); return false; }
      const extraOps = [];
      let claimTo = '';
      if (d.type === 'expense' && d.forHome) {
        claimTo = d.claimPersonId;
        if (!claimTo || claimTo === '__new') {
          const name = (d.newPersonName || '').trim();
          if (!name) { toast('Enter who will pay it back.', 'error'); return false; }
          const p = newPersonRecord(name);
          extraOps.push(opUpsert('accounts', p));
          claimTo = p.id;
        }
      }
      const rec = {
        ...(existing || {}),
        id: existing?.id || uid('txn'),
        date: d.date, type: d.type, amount,
        category: d.type === 'transfer' ? (existing?.relatedType === 'sip' && d.toAccountId === existing.toAccountId ? existing.category : transferCategory(d.fromAccountId, d.toAccountId)) : d.category,
        description: d.description || '',
        fromAccountId: d.type === 'income' ? '' : d.fromAccountId,
        toAccountId: d.type === 'expense' ? '' : d.toAccountId,
        relatedType: existing?.relatedType || '', relatedId: existing?.relatedId || '',
        notes: d.notes || '',
      };
      delete rec.claimPersonId;
      if (claimTo) Object.assign(rec, { type: 'transfer', toAccountId: claimTo, forHome: true, homeSettled: existing?.homeSettled || false });
      else { delete rec.forHome; delete rec.homeSettled; }
      // Units bought/sold were worked out from the old amount or date; let the next price refresh redo them.
      if (existing && existing.units != null && (rec.amount !== existing.amount || rec.date !== existing.date || rec.toAccountId !== existing.toAccountId || rec.fromAccountId !== existing.fromAccountId)) { delete rec.units; delete rec.unitNav; }
      if (d.type === 'expense') localStorage.setItem(LAST_ACCOUNT_KEY, rec.fromAccountId);
      // Changing the category of a transaction teaches the importer for next time.
      if (existing && rec.description && (existing.category !== rec.category || !!existing.forHome !== !!rec.forHome)) {
        const kind = rec.forHome ? 'home' : rec.type;
        const op = learnPayee(rec.description, rec.type === 'income' ? 'in' : 'out', kind, rec.category || '');
        if (op) extraOps.push(op);
      }
      const remembered = rememberDescription(rec);
      if (remembered) extraOps.push(remembered);
      commit([...extraOps, opUpsert('transactions', rec)], `${isNew ? 'Add' : 'Edit'} ${rec.forHome ? 'home expense' : rec.type} ${money(amount)}${rec.description ? ` (${rec.description})` : ''}`);
      toast(isNew ? (rec.forHome ? `Home expense added. ${accountName(claimTo)} owes you ${money(amount)} more.` : `${cap(rec.type)} added`) : 'Transaction saved', 'success');
    },
    onDelete: existing ? () => deleteTxn(existing.id) : null,
  });
}

function deleteTxn(id) {
  const t = db.transactions.find((x) => x.id === id);
  if (!t) return;
  if (!confirm(`Delete this ${t.type} of ${money(t.amount)}${t.description ? ` (${t.description})` : ''}? Balances will be recalculated.`)) return false;
  commit([...learnFromEntries([t]), opDelete('transactions', id)], `Delete ${t.type} ${money(t.amount)}`); // its category stays remembered
  toast('Transaction deleted');
}

function openAdjustmentEdit(t) {
  const accId = t.toAccountId || t.fromAccountId;
  openModal({
    title: 'Edit balance update',
    body: `<p class="callout">Balance updates correct an account's balance without counting as income or spending. Account: <b>${esc(accountName(accId))}</b></p>
      ${twoCol(field('Amount', moneyInput('amount', t.amount, 'required min="0.01"')), field('Date', input('date', t.date, 'type="date" required')))}
      ${field('Direction', select('dir', [['up', 'Increase the balance'], ['down', 'Decrease the balance']], t.toAccountId ? 'up' : 'down'))}
      ${field('Note', input('description', t.description))}`,
    submitLabel: 'Save changes',
    onSubmit: (d) => {
      const rec = { ...t, amount: round2(num(d.amount)), date: d.date, description: d.description,
        toAccountId: d.dir === 'up' ? accId : '', fromAccountId: d.dir === 'down' ? accId : '' };
      commit([opUpsert('transactions', rec)], `Edit balance update for ${accountName(accId)}`);
      toast('Balance update saved', 'success');
    },
    onDelete: () => deleteTxn(t.id),
  });
}

/* ===== Accounts ===== */
/** Shows [data-sub="Mutual fund"] / [data-sub="Stocks ETF"] blocks for the chosen investment kind. */
function bindSubtypeBlocks(form) {
  const update = () => {
    const sub = $$('select[name="subtype"]', form).find((el) => !el.disabled)?.value || '';
    const isInv = (form.elements.type?.value || '') === 'investment';
    $$('[data-sub]', form).forEach((block) => {
      const on = isInv && block.dataset.sub.split(' ').some((w) => sub.startsWith(w) || sub === w);
      block.hidden = !on;
      $$('input, select', block).forEach((i) => { if (i.name) i.disabled = !on; });
    });
  };
  form.addEventListener('change', (e) => { if (['subtype', 'type'].includes(e.target.name)) update(); }, { signal: modalSignal() });
  update();
}

function openAccountForm(existing, presetType = 'bank') {
  const isNew = !existing;
  const a = existing ? { ...existing } : { type: presetType, openingDate: todayStr(), subtype: '' };
  const typeOpts = Object.entries(ACCOUNT_TYPES).filter(([k]) => k !== 'person').map(([k, v]) => [k, v.single]);
  const body = `
    ${isNew ? field('Account type', select('type', typeOpts, a.type))
      : `<input type="hidden" name="type" value="${a.type}"><p class="text-sm text-ink-3">${ACCOUNT_TYPES[a.type].single}</p>`}
    ${field('Name', input('name', a.name, 'required maxlength="60" placeholder="e.g. HDFC Savings, Axis Ace card, Wallet cash"'))}
    ${showFor('cash', field('Kind', select('subtype', CASH_KINDS, a.subtype)))}
    ${showFor('bank', twoCol(field('Bank', input('institution', a.institution, 'placeholder="e.g. HDFC Bank"')), field('Account kind', select('subtype', BANK_KINDS, a.subtype))) +
      field('Last 4 digits (optional)', input('last4', a.last4, 'maxlength="4" inputmode="numeric" pattern="[0-9]{0,4}"')))}
    ${showFor('credit_card', twoCol(field('Issuer', input('institution', a.institution, 'placeholder="e.g. SBI Card"')), field('Last 4 digits (optional)', input('last4', a.last4, 'maxlength="4" inputmode="numeric" pattern="[0-9]{0,4}"'))) +
      twoCol(field('Current outstanding', moneyInput('cardOutstanding', a.type === 'credit_card' && existing ? -num(a.openingBalance) : '', 'placeholder="0"'), 'Everything you owe on the card today, billed and unbilled.'),
        field('Credit limit', moneyInput('creditLimit', a.creditLimit, 'min="0" placeholder="e.g. 200000"'))) +
      twoCol(field('Statement date (day of month)', input('statementDay', a.statementDay, 'type="number" min="1" max="31" placeholder="e.g. 15"')),
        field('Payment due date (day of month)', input('dueDay', a.dueDay, 'type="number" min="1" max="31" placeholder="e.g. 5"'))))}
    ${showFor('investment', twoCol(field('Kind', select('subtype', INVESTMENT_KINDS, a.subtype || 'Mutual fund')), field('Platform or institution', input('institution', a.institution, 'placeholder="e.g. Groww, Zerodha, SBI"'))) +
      `<div data-sub="Mutual Stocks ETF">${instrumentPicker(a)}</div>` +
      `<div data-sub="Mutual Stocks ETF Gold Crypto">${twoCol(
        field('Units you hold', input('units', a.units ?? '', 'type="number" step="any" min="0" placeholder="e.g. 152.347"'), existing && num(a.units) ? `As on ${fmtDate(a.unitsDate || a.openingDate)}. Units from later SIPs you review are added on top.` : 'From your statement or the Groww / Zerodha / fund app.'),
        field('Average cost per unit', moneyInput('avgCost', existing && num(a.units) > 0 ? round2(num(a.investedAmount ?? a.openingBalance) / num(a.units)) : '', 'min="0" placeholder="e.g. 64.20"'), 'Shown as "avg. NAV" or "avg. price" in most apps.'))}</div>` +
      `<div data-sub="Mutual">${field('Expense ratio % (optional)', input('expenseRatio', a.expenseRatio ?? '', 'type="number" step="0.01" min="0" max="5" placeholder="e.g. 0.63"'), 'From the fund\'s factsheet (TER). It is already taken out of the NAV, so the app shows it as a yearly cost and does not subtract it again.')}</div>` +
      `<div data-sub="Fixed Recurring PPF Bonds NPS Gold Other" class="space-y-4">${twoCol(field('Interest rate % (optional)', input('interestRate', a.interestRate, 'type="number" step="0.01" min="0"'), 'For FDs, RDs, PPF and bonds.'),
        field('Maturity date (optional)', input('maturityDate', a.maturityDate, 'type="date"')))}</div>` +
      `<div data-sub="Fixed">${field('FD start date (optional)', input('depositDate', a.depositDate, 'type="date"'), 'The day the deposit was made. Used with the rate and maturity date to estimate its value.')}</div>`)}
    ${showFor('cash bank', field('Balance', moneyInput('openingBalance', a.type !== 'credit_card' && existing ? a.openingBalance : '', 'placeholder="0"'), 'The balance on the date below.'))}
    ${showFor('investment', twoCol(field('Amount invested', moneyInput('investedAmount', a.type === 'investment' && existing ? (a.investedAmount ?? a.openingBalance) : '', 'min="0" placeholder="Units x average cost"'), 'What you paid in total. Fills in from units and average cost.'),
      field('Current value', moneyInput('openingBalance', a.type === 'investment' && existing ? a.openingBalance : '', 'placeholder="0"'), 'Fills in from units x the latest NAV or price once linked. Type it for FDs, PPF and the like.')))}
    ${field('Balance as on', input('openingDate', a.openingDate || todayStr(), 'type="date" required'), 'Transactions dated before this day do not change the balance, because it already includes them.')}
    ${field('Notes (optional)', textarea('notes', a.notes, 'rows="2"'))}
    ${isNew ? '' : checkbox('archived', a.archived, 'Archive this account', 'Hides it from pickers. Its balance still counts in net worth.')}`;

  openModal({
    title: isNew ? 'Add account' : `Edit ${a.name}`,
    body,
    submitLabel: isNew ? 'Add account' : 'Save changes',
    onOpen: (form) => {
      bindShowHide(form, 'type');
      bindSubtypeBlocks(form);
      // units x average cost -> amount invested; units x latest price -> current value
      const el = (n) => $$(`[name="${n}"]`, form).find((x) => !x.disabled);
      const sync = (src) => {
        const u = num(el('units')?.value), c = num(el('avgCost')?.value), inv = el('investedAmount'), val = el('openingBalance'), lp = num(el('latestPrice')?.value);
        if (src === 'investedAmount') { if (u > 0 && num(inv?.value) > 0 && el('avgCost')) el('avgCost').value = Math.round((num(inv.value) / u) * 10000) / 10000; }
        else if (u > 0 && c > 0 && inv) inv.value = round2(u * c);
        if (u > 0 && lp > 0 && val) val.value = round2(u * lp);
      };
      form.addEventListener('input', (e) => { if (['units', 'avgCost', 'investedAmount'].includes(e.target.name)) sync(e.target.name); }, { signal: modalSignal() });
      bindInstrumentPicker(form, { onPick: () => sync('pick') });
    },
    onSubmit: (d) => {
      const type = d.type;
      const rec = {
        ...(existing || {}),
        id: existing?.id || uid('acc'),
        name: d.name, type,
        subtype: d.subtype || '', institution: d.institution || '', last4: d.last4 || '',
        openingBalance: type === 'credit_card' ? round2(-num(d.cardOutstanding)) : round2(num(d.openingBalance)),
        openingDate: d.openingDate,
        creditLimit: type === 'credit_card' ? round2(num(d.creditLimit)) : null,
        statementDay: type === 'credit_card' && d.statementDay ? int(d.statementDay) : null,
        dueDay: type === 'credit_card' && d.dueDay ? int(d.dueDay) : null,
        interestRate: type === 'investment' && d.interestRate ? num(d.interestRate) : null,
        maturityDate: type === 'investment' ? d.maturityDate || '' : '',
        ...(type === 'investment' ? {
          investedAmount: d.investedAmount === '' ? round2(num(d.openingBalance)) : round2(num(d.investedAmount)),
          units: d.units === '' || d.units === undefined ? null : num(d.units),
          unitPrice: num(d.latestPrice) || (d.schemeCode || d.ticker ? existing?.unitPrice ?? null : null),
          priceDate: num(d.latestPrice) ? d.latestDate || todayStr() : (d.schemeCode || d.ticker ? existing?.priceDate || '' : ''),
          depositDate: d.depositDate || '',
          expenseRatio: d.subtype === 'Mutual fund' && d.expenseRatio !== '' && d.expenseRatio !== undefined ? num(d.expenseRatio) : null,
          // Units entered here are "as on" the balance date for a new holding, or today when edited.
          unitsDate: d.units === '' || d.units === undefined ? (existing?.unitsDate ?? '') : num(d.units) === num(existing?.units) && existing?.unitsDate !== undefined ? existing.unitsDate : (isNew ? d.openingDate : todayStr()),
          schemeCode: d.subtype === 'Mutual fund' ? d.schemeCode || '' : '',
          schemeName: d.subtype === 'Mutual fund' && d.schemeCode ? d.schemeName || '' : '',
          ticker: ['Stocks', 'ETF'].includes(d.subtype) ? String(d.ticker || '').trim().toUpperCase() : '',
        } : {}),
        notes: d.notes || '',
        archived: !!d.archived,
      };
      commit([opUpsert('accounts', rec)], `${isNew ? 'Add' : 'Edit'} account ${rec.name}`);
      toast(isNew ? 'Account added' : 'Account saved', 'success');
      if (type === 'investment' && hasLivePrice(rec) && navigator.onLine) setTimeout(() => refreshPrices({ onlyId: rec.id }), 60);
    },
    onDelete: existing ? () => deleteAccount(existing) : null,
  });
}

function deleteAccount(a) {
  const used = db.transactions.filter((t) => t.fromAccountId === a.id || t.toAccountId === a.id).length
    + db.emis.filter((e) => e.accountId === a.id).length + db.subscriptions.filter((s) => s.accountId === a.id).length
    + db.sips.filter((x) => x.fundAccountId === a.id || x.fromAccountId === a.id).length;
  if (used) {
    alert(`${a.name} is used by ${used} transaction(s), EMI(s), subscription(s) or SIP(s), so it can't be deleted without breaking your history.\n\nTick "Archive this account" instead to hide it.`);
    return false;
  }
  if (!confirm(`Delete ${a.name}? This can't be undone.`)) return false;
  commit([opDelete('accounts', a.id)], `Delete account ${a.name}`);
  toast('Account deleted');
}

function openAdjust(a) {
  if (!a) return;
  const bal = M.balances.get(a.id) || 0;
  const isCard = a.type === 'credit_card', isInv = a.type === 'investment';
  const current = isCard ? -bal : bal;
  const what = isCard ? 'outstanding' : isInv ? 'current value' : 'balance';
  openModal({
    title: isInv ? `Update value of ${a.name}` : `Update ${what} of ${a.name}`,
    body: `<p class="callout">The app shows the ${what} as <b class="num">${money(current)}</b>. Enter the real figure from your ${isInv ? 'statement or app' : 'bank app or statement'}. The difference is saved as a balance update, which doesn't count as income or spending.</p>
      ${isInv ? twoCol(field('Units or shares (optional)', input('units', a.units ?? '', 'type="number" step="any" min="0"')), field('Today\'s price or NAV (optional)', moneyInput('unitPrice', '', 'min="0"'))) : ''}
      ${isInv && M.P.holdings.find((h) => h.a.id === a.id)?.fd ? `<p class="hint">Estimated FD value today: <b class="num">${money(M.P.holdings.find((h) => h.a.id === a.id).fd.estimatedToday)}</b></p>` : ''}
      ${twoCol(field(`Actual ${what}`, moneyInput('value', '', 'required placeholder="0"')), field('As on', input('date', todayStr(), `type="date" required min="${a.openingDate || ''}"`)))}
      ${field('Note (optional)', input('description', '', `placeholder="${isInv ? 'e.g. NAV update' : 'e.g. Bank charges, interest credited'}"`))}`,
    submitLabel: 'Update',
    onOpen: (form) => {
      if (!isInv) return;
      form.addEventListener('input', (e) => {
        if (!['units', 'unitPrice'].includes(e.target.name)) return;
        const u = num(form.elements.units.value), p = num(form.elements.unitPrice.value);
        if (u > 0 && p > 0) form.elements.value.value = round2(u * p);
      }, { signal: modalSignal() });
    },
    onSubmit: (d) => {
      const target = isCard ? -num(d.value) : num(d.value);
      const diff = round2(target - bal);
      const unitOps = isInv && (d.units !== '' || d.unitPrice !== '') && (num(d.units) !== num(a.units) || (d.unitPrice !== '' && num(d.unitPrice) !== num(a.unitPrice)))
        ? [opUpsert('accounts', { ...a, units: d.units === '' ? a.units ?? null : num(d.units), unitsDate: d.units === '' ? a.unitsDate ?? '' : d.date, unitPrice: d.unitPrice === '' ? a.unitPrice ?? null : num(d.unitPrice) })] : [];
      if (diff === 0) {
        if (unitOps.length) { commit(unitOps, `Update units of ${a.name}`); toast('Units updated', 'success'); }
        else toast(`The ${what} already matches.`);
        return;
      }
      const rec = {
        id: uid('txn'), date: d.date, type: 'adjustment', amount: Math.abs(diff),
        category: isInv ? 'Value change' : 'Balance correction',
        description: d.description || (isInv ? 'Value update' : 'Balance correction'),
        fromAccountId: diff < 0 ? a.id : '', toAccountId: diff > 0 ? a.id : '',
        relatedType: '', relatedId: '', notes: '',
      };
      commit([opUpsert('transactions', rec), ...unitOps], `Update ${what} of ${a.name}`);
      toast(`${cap(what)} updated`, 'success');
    },
  });
}

function payCard(id) {
  const a = accountById(id);
  if (!a) return;
  const out = Math.max(0, -(M.balances.get(id) || 0));
  openTxnForm(null, { type: 'transfer', toAccountId: id, fromAccountId: firstAccountOf(['bank']), amount: out || '', description: `${a.name} bill payment` });
}

/* ===== EMIs ===== */
function openEmiForm(existing) {
  const isNew = !existing;
  const e = existing ? { ...existing } : { kind: 'credit_card', startDate: addMonths(todayStr(), 1), paidInstallments: 0, autoLog: false };
  const kinds = [['credit_card', 'Credit card EMI'], ['loan', 'Loan']];
  const body = `
    <div class="seg" role="radiogroup" aria-label="EMI type">
      ${kinds.map(([v, l]) => `<input type="radio" name="kind" id="ek_${v}" value="${v}" ${e.kind === v ? 'checked' : ''}><label for="ek_${v}">${l}</label>`).join('')}
    </div>
    ${field('Name', input('name', e.name, 'required maxlength="80" placeholder="e.g. iPhone on HDFC card, Home loan"'))}
    ${showFor('credit_card', field('Credit card', accountSelect('accountId', e.kind === 'credit_card' ? e.accountId : firstAccountOf(['credit_card']), { types: ['credit_card'], placeholder: 'Choose a card' }), 'Add the card under Accounts first if it is not listed.') +
      '<p class="callout">Don\'t also log the original purchase as an expense. Each monthly installment is recorded as an expense on the card instead, and the unpaid principal is blocked from the card\'s limit.</p>')}
    ${showFor('loan', twoCol(field('Loan type', select('subtype', LOAN_KINDS, e.subtype)), field('Lender', input('lender', e.lender, 'placeholder="e.g. SBI, Bajaj Finance"'))) +
      field('EMI paid from', accountSelect('accountId', e.kind === 'loan' ? e.accountId : firstAccountOf(['bank']), { types: ['bank', 'cash'], placeholder: 'Choose an account' })))}
    ${twoCol(field('Loan amount (principal)', moneyInput('principal', e.principal, 'required min="1"')), field('Interest rate (% per year)', input('annualRate', e.annualRate ?? '', 'type="number" step="0.01" min="0" placeholder="0 for no-cost EMI"')))}
    ${twoCol(field('Tenure (months)', input('tenureMonths', e.tenureMonths, 'type="number" min="1" max="600" required')), field('First EMI date', input('startDate', e.startDate, 'type="date" required')))}
    ${twoCol(field('Monthly EMI (optional)', moneyInput('emiAmount', e.emiAmount, 'min="0"'), 'Leave empty to calculate it. Enter the exact figure from your lender if it differs.'),
      field('EMIs already paid', input('paidInstallments', e.paidInstallments ?? 0, 'type="number" min="0"'), 'For loans that started before you began using KOSH.'))}
    <div id="emiPreview" class="callout" aria-live="polite"></div>
    ${checkbox('autoLog', e.autoLog, 'Record each EMI automatically on its due date', 'The app adds the expense when you open the app on or after the due date.')}
    ${isNew ? '' : checkbox('closed', e.closed, 'Closed early', 'Tick if you prepaid or foreclosed it. It stops counting as a liability.')}
    ${field('Notes (optional)', textarea('notes', e.notes, 'rows="2"'))}`;

  const preview = (form) => {
    const d = readForm(form);
    const c = emiCalc({ principal: d.principal, annualRate: d.annualRate, tenureMonths: d.tenureMonths, emiAmount: d.emiAmount, paidInstallments: d.paidInstallments, startDate: d.startDate });
    const box = $('#emiPreview');
    if (!box) return;
    if (!c.n || !num(d.principal)) { box.textContent = 'Enter the amount and tenure to see the EMI.'; return; }
    box.innerHTML = `Monthly EMI <b class="num">${money(c.emi)}</b> for ${c.n} months, total interest <b class="num">${money(c.totalInterest)}</b>${c.endDate ? `, last EMI on ${fmtDate(c.endDate)}` : ''}.`
      + (d.kind === 'credit_card' ? ` <b class="num">${money(c.remaining)}</b> of the card's limit is blocked right now.` : ` Principal left: <b class="num">${money(c.remaining)}</b>.`);
  };

  openModal({
    title: isNew ? 'Add EMI or loan' : `Edit ${e.name}`,
    body,
    submitLabel: isNew ? 'Add EMI' : 'Save changes',
    onOpen: (form) => { bindShowHide(form, 'kind'); preview(form); form.addEventListener('input', () => preview(form), { signal: modalSignal() }); form.addEventListener('change', () => preview(form), { signal: modalSignal() }); },
    onSubmit: (d) => {
      const n = int(d.tenureMonths);
      if (int(d.paidInstallments) > n) { toast('EMIs already paid cannot be more than the tenure.', 'error'); return false; }
      const card = d.kind === 'credit_card' ? accountById(d.accountId) : null;
      const rec = {
        ...(existing || {}),
        id: existing?.id || uid('emi'),
        name: d.name, kind: d.kind,
        subtype: d.kind === 'loan' ? d.subtype : 'Credit card EMI',
        lender: d.kind === 'loan' ? d.lender || '' : card?.institution || '',
        accountId: d.accountId,
        principal: round2(num(d.principal)), annualRate: num(d.annualRate), tenureMonths: n,
        startDate: d.startDate, emiAmount: d.emiAmount ? round2(num(d.emiAmount)) : null,
        paidInstallments: int(d.paidInstallments),
        autoLog: !!d.autoLog, closed: !!d.closed, notes: d.notes || '',
      };
      commit([opUpsert('emis', rec)], `${isNew ? 'Add' : 'Edit'} EMI ${rec.name}`);
      toast(isNew ? 'EMI added' : 'EMI saved', 'success');
      if (rec.autoLog) setTimeout(processAutoPayments, 50);
    },
    onDelete: existing ? () => {
      if (!confirm(`Delete ${e.name}? Payments already recorded stay in your transactions.`)) return false;
      commit([opDelete('emis', e.id)], `Delete EMI ${e.name}`);
      toast('EMI deleted');
    } : null,
  });
}

function payEmi(id) {
  const e = db.emis.find((x) => x.id === id);
  if (!e) return;
  const c = emiCalc(e);
  if (c.status !== 'active') { toast('This EMI is already complete.'); return; }
  const k = c.paid + 1;
  const txn = emiTxn(e, k, c);
  openModal({
    title: `Record EMI ${k} of ${c.n}`,
    body: `<p class="text-sm text-ink-2">${esc(e.name)}, paid from <b>${esc(accountName(e.accountId))}</b>.</p>
      ${twoCol(field('Amount', moneyInput('amount', txn.amount, 'required min="0.01"')), field('Date', input('date', txn.date, 'type="date" required')))}`,
    submitLabel: 'Record payment',
    onSubmit: (d) => {
      commit([
        opUpsert('transactions', { ...txn, amount: round2(num(d.amount)), date: d.date }),
        opUpsert('emis', { ...e, paidInstallments: k }),
      ], `Record EMI ${k}/${c.n} for ${e.name}`);
      toast(`EMI ${k} of ${c.n} recorded`, 'success');
    },
  });
}

function showSchedule(id) {
  const e = db.emis.find((x) => x.id === id);
  if (!e) return;
  const rows = emiSchedule(e);
  openModal({
    title: `${e.name}: repayment schedule`,
    wide: true,
    body: `<div class="overflow-x-auto max-h-[60vh]"><table class="sched">
      <thead><tr><th>#</th><th>Due date</th><th>EMI</th><th>Principal</th><th>Interest</th><th>Balance after</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.paid ? 'done' : ''}"><td>${r.installment}${r.paid ? ' <i class="fa-solid fa-check text-gain"></i>' : ''}</td><td>${fmtDate(r.dueDate)}</td>
        <td>${money(r.emi)}</td><td>${money(r.principal)}</td><td>${money(r.interest)}</td><td>${money(r.balance)}</td></tr>`).join('')}</tbody>
    </table></div><p class="hint">Calculated on a reducing balance. Your lender's figures may differ by a few rupees due to rounding.</p>`,
  });
}

/* ===== Subscriptions ===== */
function openSubForm(existing) {
  const isNew = !existing;
  const kind0 = existing ? recurKind(existing) : openSubForm.presetKind || 'subscription';
  openSubForm.presetKind = null;
  const pv = openSubForm.presetValues || {};
  openSubForm.presetValues = null;
  const s = existing ? { ...existing } : { kind: kind0, frequency: 'monthly', nextRenewal: todayStr(), active: true, autoLog: kind0 !== 'subscription', category: kind0 === 'income' ? 'Salary' : kind0 === 'bill' ? 'Rent' : 'Subscriptions', ...pv };
  const expCats = uniq([...db.settings.expenseCategories, recurKind(s) !== 'income' ? s.category : '']);
  const incCats = uniq([...db.settings.incomeCategories, recurKind(s) === 'income' ? s.category : '']);
  const body = `
    <div class="seg" role="radiogroup" aria-label="Kind">
      ${[['subscription', 'Subscription'], ['bill', 'Bill (rent etc.)'], ['income', 'Income (salary etc.)']].map(([v, l]) => `<input type="radio" name="kind" id="rk_${v}" value="${v}" ${recurKind(s) === v ? 'checked' : ''}><label for="rk_${v}">${l}</label>`).join('')}
    </div>
    ${field('Name', input('name', s.name, 'required maxlength="80" placeholder="e.g. Netflix, Flat rent, Salary"'))}
    ${twoCol(field('Amount', moneyInput('amount', s.amount, 'required min="0.01"')), field('How often', select('frequency', Object.entries(FREQUENCIES).map(([k, v]) => [k, v.label]), s.frequency)))}
    ${twoCol(field('Next date', input('nextRenewal', s.nextRenewal, 'type="date" required')),
      showFor('subscription bill', field('Category', select('category', expCats, recurKind(s) !== 'income' ? s.category : 'Rent'))) + showFor('income', field('Source', select('category', incCats, recurKind(s) === 'income' ? s.category : 'Salary'))))}
    ${showFor('subscription bill', field('Paid from', accountSelect('accountId', s.accountId || firstAccountOf(['credit_card', 'bank']), { types: MONEY_TYPES })))}
    ${showFor('income', field('Received in', accountSelect('accountId', s.accountId || firstAccountOf(['bank']), { types: ['bank', 'cash'] })))}
    ${checkbox('autoLog', s.autoLog, 'Record it automatically on the date', 'The app adds it to your transactions when you open the app on or after the date.')}
    ${isNew ? '' : checkbox('active', s.active, 'Active', 'Untick to pause without deleting.')}
    ${field('Notes (optional)', textarea('notes', s.notes, 'rows="2"'))}`;
  openModal({
    title: isNew ? 'Add recurring payment or income' : `Edit ${s.name}`,
    body,
    submitLabel: isNew ? 'Add' : 'Save changes',
    onOpen: (form) => bindShowHide(form, 'kind'),
    onSubmit: (d) => {
      const rec = {
        ...(existing || {}), id: existing?.id || uid('sub'), kind: d.kind,
        name: d.name, amount: round2(num(d.amount)), frequency: d.frequency, nextRenewal: d.nextRenewal,
        category: d.category, accountId: d.accountId, active: isNew ? true : !!d.active,
        autoLog: !!d.autoLog, notes: d.notes || '',
      };
      commit([opUpsert('subscriptions', rec)], `${isNew ? 'Add' : 'Edit'} subscription ${rec.name}`);
      toast(isNew ? `${rec.name} added` : 'Saved', 'success');
      if (rec.autoLog) setTimeout(processAutoPayments, 50);
    },
    onDelete: existing ? () => {
      if (!confirm(`Delete ${s.name}? Payments already recorded stay in your transactions.`)) return false;
      commit([opDelete('subscriptions', s.id)], `Delete subscription ${s.name}`);
      toast('Subscription deleted');
    } : null,
  });
}

function paySub(id) {
  const s = db.subscriptions.find((x) => x.id === id);
  if (!s) return;
  const txn = subscriptionTxn(s, s.nextRenewal || todayStr());
  openModal({
    title: `Record ${recurKind(s) === 'income' ? '' : 'payment for '}${s.name}`,
    body: `${twoCol(field('Amount', moneyInput('amount', txn.amount, 'required min="0.01"')), field('Date', input('date', txn.date, 'type="date" required')))}
      ${field(recurKind(s) === 'income' ? 'Received in' : 'Paid from', accountSelect('accountId', s.accountId))}
      <p class="hint">The next renewal moves to ${fmtDate(advanceDate(s.nextRenewal || todayStr(), s.frequency))}.</p>`,
    submitLabel: 'Record payment',
    onSubmit: (d) => {
      commit([
        opUpsert('transactions', { ...txn, amount: round2(num(d.amount)), date: d.date, ...(recurKind(s) === 'income' ? { toAccountId: d.accountId } : { fromAccountId: d.accountId }) }),
        opUpsert('subscriptions', { ...s, nextRenewal: advanceDate(s.nextRenewal || todayStr(), s.frequency) }),
      ], `Record payment for ${s.name}`);
      toast('Payment recorded', 'success');
    },
  });
}

function toggleSub(id) {
  const s = db.subscriptions.find((x) => x.id === id);
  if (!s) return;
  commit([opUpsert('subscriptions', { ...s, active: !s.active })], `${s.active ? 'Pause' : 'Resume'} subscription ${s.name}`);
  toast(s.active ? `${s.name} paused` : `${s.name} resumed`);
}

/* ===== Budgets ===== */
function openBudgetForm(existing, presetCategory) {
  const isNew = !existing;
  const taken = new Set(db.budgets.filter((b) => b.id !== existing?.id).map((b) => b.category));
  const cats = uniq([...db.settings.expenseCategories, presetCategory, existing?.category]).filter((c) => !taken.has(c));
  if (!cats.length) { toast('Every category already has a budget.'); return; }
  openModal({
    title: isNew ? 'Add budget' : `Edit ${existing.category} budget`,
    body: `${field('Category', select('category', cats, existing?.category || presetCategory || cats[0]))}
      ${field('Monthly limit', moneyInput('monthlyLimit', existing?.monthlyLimit, 'required min="1"'))}`,
    submitLabel: isNew ? 'Add budget' : 'Save changes',
    onSubmit: (d) => {
      const rec = { ...(existing || {}), id: existing?.id || uid('bud'), category: d.category, monthlyLimit: round2(num(d.monthlyLimit)) };
      commit([opUpsert('budgets', rec)], `${isNew ? 'Add' : 'Edit'} budget ${rec.category}`);
      toast(isNew ? 'Budget added' : 'Budget saved', 'success');
    },
    onDelete: existing ? () => {
      if (!confirm(`Delete the ${existing.category} budget?`)) return false;
      commit([opDelete('budgets', existing.id)], `Delete budget ${existing.category}`);
      toast('Budget deleted');
    } : null,
  });
}

/* ---------------------------------------------------------------------
   10. EXPORT / IMPORT
   ---------------------------------------------------------------------
   CSV tables are flat (one row per record, no nested fields) and use
   stable id columns so they can be related in Power BI:
     transactions.from_account_id / to_account_id  -> accounts.account_id
     ledger.account_id                             -> accounts.account_id
     emis.account_id                               -> accounts.account_id
     emi_schedule.emi_id                           -> emis.emi_id
     subscriptions.account_id                      -> accounts.account_id
     sips.fund_account_id / from_account_id        -> accounts.account_id
   --------------------------------------------------------------------- */
function exportTables() {
  const holding = new Map(M.P.holdings.map((h) => [h.a.id, h]));
  const accounts = db.accounts.map((a) => {
    const card = a.type === 'credit_card' ? cardMetrics(a) : null;
    const h = holding.get(a.id);
    return {
      account_id: a.id, name: a.name, type: a.type, subtype: a.subtype || '', institution: a.institution || '', last4: a.last4 || '',
      opening_balance: num(a.openingBalance), opening_date: a.openingDate || '', current_balance: M.balances.get(a.id) || 0,
      outstanding: card ? card.outstanding : '', credit_limit: card ? card.limit : '', emi_blocked: card ? card.blocked : '',
      available_limit: card ? card.available : '', statement_day: a.statementDay ?? '', due_day: a.dueDay ?? '',
      interest_rate: a.interestRate ?? '', maturity_date: a.maturityDate || '',
      scheme_code: a.schemeCode || '', scheme_name: a.schemeName || '', ticker: a.ticker || '', price_date: a.priceDate || '',
      investment_group: h ? h.group : '', invested_amount: h ? h.invested : '', gain: h ? h.gain : '',
      gain_percent: h ? round2(h.gainPct * 100) : '', units: a.units ?? '', unit_price: a.unitPrice ?? '',
      fd_maturity_value: h?.fd ? h.fd.maturityValue : '',
      archived: !!a.archived, notes: a.notes || '',
      created_at: a.createdAt || '', updated_at: a.updatedAt || '',
    };
  });
  const sips = db.sips.map((x) => ({
    sip_id: x.id, name: x.name, fund_account_id: x.fundAccountId || '', fund_name: accountName(x.fundAccountId),
    from_account_id: x.fromAccountId || '', from_account_name: accountName(x.fromAccountId),
    amount: num(x.amount), current_amount: sipAmountOn(x, x.nextDate || todayStr()), frequency: x.frequency, day_of_month: x.day ?? '',
    monthly_equivalent: round2(sipAmountOn(x, todayStr()) * (FREQUENCIES[x.frequency]?.perMonth || 1)),
    start_date: x.startDate || '', next_date: x.nextDate || '', end_date: x.endDate || '', step_up_percent: num(x.stepUpPercent),
    active: !!x.active, auto_record: !!x.autoLog,
    instalments_recorded: db.transactions.filter((t) => t.relatedType === 'sip' && t.relatedId === x.id).length,
    amount_invested: round2(db.transactions.filter((t) => t.relatedType === 'sip' && t.relatedId === x.id).reduce((sum, t) => sum + num(t.amount), 0)),
    notes: x.notes || '', created_at: x.createdAt || '', updated_at: x.updatedAt || '',
  }));
  const signed = (t) => (t.type === 'income' ? num(t.amount) : t.type === 'expense' ? -num(t.amount)
    : t.type === 'adjustment' ? (t.toAccountId ? num(t.amount) : -num(t.amount)) : 0);
  const txns = sortTxns(db.transactions).reverse();
  const transactions = txns.map((t) => ({
    transaction_id: t.id, date: t.date, year: (t.date || '').slice(0, 4), month: (t.date || '').slice(0, 7),
    type: t.type, category: t.category || '', description: t.description || '', amount: num(t.amount), signed_amount: signed(t),
    from_account_id: t.fromAccountId || '', from_account_name: accountName(t.fromAccountId),
    to_account_id: t.toAccountId || '', to_account_name: accountName(t.toAccountId),
    related_type: t.relatedType || '', related_id: t.relatedId || '', units: t.units ?? '', unit_nav: t.unitNav ?? '', for_home: !!t.forHome, home_taken_back: !!t.homeSettled, notes: t.notes || '',
    created_at: t.createdAt || '', updated_at: t.updatedAt || '',
  }));
  // Ledger: one row per account movement. SUM(amount) WHERE affects_balance = current balance.
  const ledger = [];
  for (const a of db.accounts) {
    ledger.push({ entry_id: `open_${a.id}`, date: a.openingDate || '', account_id: a.id, account_name: a.name, account_type: a.type,
      transaction_id: '', type: 'opening_balance', category: '', description: 'Opening balance', amount: num(a.openingBalance), affects_balance: true });
  }
  for (const t of txns) {
    for (const [side, accId, sign] of [['out', t.fromAccountId, -1], ['in', t.toAccountId, 1]]) {
      const a = accId && accountById(accId);
      if (!a) continue;
      ledger.push({ entry_id: `${t.id}_${side}`, date: t.date, account_id: a.id, account_name: a.name, account_type: a.type,
        transaction_id: t.id, type: t.type, category: t.category || '', description: t.description || '',
        amount: sign * num(t.amount), affects_balance: (t.date || '') >= (a.openingDate || '') });
    }
  }
  const emis = M.emis.map(({ e, c }) => ({
    emi_id: e.id, name: e.name, kind: e.kind, loan_type: e.subtype || '', lender: e.lender || '', account_id: e.accountId || '',
    account_name: accountName(e.accountId), principal: num(e.principal), annual_rate: num(e.annualRate), tenure_months: c.n,
    start_date: e.startDate || '', emi_amount: c.emi, installments_paid: c.paid, installments_left: c.remainingMonths,
    principal_remaining: c.remaining, total_interest: c.totalInterest, interest_remaining: c.interestLeft,
    next_due_date: c.nextDue || '', end_date: c.endDate || '', status: c.status, auto_record: !!e.autoLog, notes: e.notes || '',
    created_at: e.createdAt || '', updated_at: e.updatedAt || '',
  }));
  const emi_schedule = db.emis.flatMap((e) => emiSchedule(e).map((r) => ({
    emi_id: e.id, emi_name: e.name, installment: r.installment, due_date: r.dueDate, emi: r.emi,
    principal: r.principal, interest: r.interest, balance_after: r.balance, paid: r.paid,
  })));
  const subscriptions = db.subscriptions.map((s) => {
    const pm = FREQUENCIES[s.frequency]?.perMonth || 1;
    return {
      subscription_id: s.id, name: s.name, amount: num(s.amount), frequency: s.frequency,
      monthly_equivalent: round2(num(s.amount) * pm), yearly_equivalent: round2(num(s.amount) * pm * 12),
      next_renewal: s.nextRenewal || '', account_id: s.accountId || '', account_name: accountName(s.accountId),
      category: s.category || '', active: !!s.active, auto_record: !!s.autoLog, notes: s.notes || '',
      created_at: s.createdAt || '', updated_at: s.updatedAt || '',
    };
  });
  const budgets = db.budgets.map((b) => ({ budget_id: b.id, category: b.category, monthly_limit: num(b.monthlyLimit), created_at: b.createdAt || '', updated_at: b.updatedAt || '' }));
  const categories = [
    ...db.settings.expenseCategories.map((n) => ({ kind: 'expense', name: n })),
    ...db.settings.incomeCategories.map((n) => ({ kind: 'income', name: n })),
  ];
  const goals = db.goals.map((g) => { const st = goalStats(g); return { goal_id: g.id, name: g.name, target: num(g.target), target_date: g.targetDate || '', saved: st.saved, percent: Math.round(st.pct * 100), per_month_needed: st.perMonth ?? '', status: st.status }; });
  const wishlist = db.wishlist.map((w) => ({ item_id: w.id, name: w.name, price: num(w.price), priority: w.priority || '', want_by: w.wantBy || '', status: w.status || 'wanted', bought_on: w.boughtOn || '', goal_id: w.goalId || '', link: w.link || '' }));
  return { accounts, transactions, ledger, emis, emi_schedule, subscriptions, sips, budgets, categories, goals, wishlist };
}

/* Column headers, so even empty tables export with the right columns. */
const TABLE_COLUMNS = {
  accounts: ['account_id', 'name', 'type', 'subtype', 'institution', 'last4', 'opening_balance', 'opening_date', 'current_balance', 'outstanding', 'credit_limit', 'emi_blocked', 'available_limit', 'statement_day', 'due_day', 'interest_rate', 'maturity_date', 'investment_group', 'invested_amount', 'gain', 'gain_percent', 'units', 'unit_price', 'price_date', 'scheme_code', 'scheme_name', 'ticker', 'fd_maturity_value', 'archived', 'notes', 'created_at', 'updated_at'],
  transactions: ['transaction_id', 'date', 'year', 'month', 'type', 'category', 'description', 'amount', 'signed_amount', 'from_account_id', 'from_account_name', 'to_account_id', 'to_account_name', 'related_type', 'related_id', 'units', 'unit_nav', 'for_home', 'home_taken_back', 'notes', 'created_at', 'updated_at'],
  ledger: ['entry_id', 'date', 'account_id', 'account_name', 'account_type', 'transaction_id', 'type', 'category', 'description', 'amount', 'affects_balance'],
  emis: ['emi_id', 'name', 'kind', 'loan_type', 'lender', 'account_id', 'account_name', 'principal', 'annual_rate', 'tenure_months', 'start_date', 'emi_amount', 'installments_paid', 'installments_left', 'principal_remaining', 'total_interest', 'interest_remaining', 'next_due_date', 'end_date', 'status', 'auto_record', 'notes', 'created_at', 'updated_at'],
  emi_schedule: ['emi_id', 'emi_name', 'installment', 'due_date', 'emi', 'principal', 'interest', 'balance_after', 'paid'],
  subscriptions: ['subscription_id', 'name', 'amount', 'frequency', 'monthly_equivalent', 'yearly_equivalent', 'next_renewal', 'account_id', 'account_name', 'category', 'active', 'auto_record', 'notes', 'created_at', 'updated_at'],
  sips: ['sip_id', 'name', 'fund_account_id', 'fund_name', 'from_account_id', 'from_account_name', 'amount', 'current_amount', 'frequency', 'day_of_month', 'monthly_equivalent', 'start_date', 'next_date', 'end_date', 'step_up_percent', 'active', 'auto_record', 'instalments_recorded', 'amount_invested', 'notes', 'created_at', 'updated_at'],
  budgets: ['budget_id', 'category', 'monthly_limit', 'created_at', 'updated_at'],
  goals: ['goal_id', 'name', 'target', 'target_date', 'saved', 'percent', 'per_month_needed', 'status'],
  wishlist: ['item_id', 'name', 'price', 'priority', 'want_by', 'status', 'bought_on', 'goal_id', 'link'],
  categories: ['kind', 'name'],
};

function toCSV(rows, cols) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    let s = String(v);
    // Stop spreadsheet apps from treating text like "=SUM(...)" as a formula.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => todayStr();

function exportJSON() {
  download(`kosh-backup-${stamp()}.json`, JSON.stringify(db, null, 2), 'application/json');
  toast('JSON backup downloaded', 'success');
}
function exportOne(table) {
  const tables = exportTables();
  download(`kosh-${table}-${stamp()}.csv`, toCSV(tables[table], TABLE_COLUMNS[table]), 'text/csv;charset=utf-8');
}
async function exportZip() {
  const tables = exportTables();
  if (typeof JSZip === 'undefined') {
    toast('ZIP library not loaded; downloading files one by one.');
    for (const t of Object.keys(TABLE_COLUMNS)) { exportOne(t); await sleep(400); }
    return;
  }
  const zip = new JSZip();
  const folder = zip.folder(`kosh-export-${stamp()}`);
  for (const [t, cols] of Object.entries(TABLE_COLUMNS)) folder.file(`${t}.csv`, toCSV(tables[t], cols));
  folder.file('kosh-data.json', JSON.stringify(db, null, 2));
  folder.file('README.txt', [
    "KOSH export (Kundan On Savings Hustle)", `Created ${new Date().toString()}`, '',
    'All CSV files are UTF-8, comma separated, one header row, dates as YYYY-MM-DD.',
    'Relationships (for Power BI model view):',
    '  transactions.from_account_id / to_account_id -> accounts.account_id',
    '  ledger.account_id -> accounts.account_id   (SUM of amount where affects_balance = TRUE gives the balance)',
    '  emis.account_id -> accounts.account_id',
    '  emi_schedule.emi_id -> emis.emi_id',
    '  subscriptions.account_id -> accounts.account_id',
    '  sips.fund_account_id and sips.from_account_id -> accounts.account_id',
    'SIP instalments are transfers (bank -> fund) with related_type = sip; related_id = sips.sip_id.',
    'accounts.invested_amount / gain describe investment holdings (gain = current_balance - invested_amount).',
    'signed_amount in transactions: income positive, expense negative, transfers 0.',
    'Credit card balances are negative when you owe money.',
  ].join('\r\n'));
  const blob = await zip.generateAsync({ type: 'blob' });
  download(`kosh-export-${stamp()}.zip`, blob);
  toast('Export downloaded', 'success');
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('That file is not valid JSON.', 'error'); return; }
  if (!data || typeof data !== 'object' || !COLLECTIONS.some((c) => Array.isArray(data[c]))) {
    toast('That file does not look like a KOSH backup.', 'error'); return;
  }
  const d = normalizeDB(data);
  if (!confirm(`Replace ALL current data with this backup?\n\n${d.accounts.length} accounts, ${d.transactions.length} transactions, ${d.emis.length} EMIs, ${d.subscriptions.length} subscriptions, ${d.sips.length} SIPs.\n\nYour current data will be overwritten${isConfigured() ? ' on GitHub too (older versions stay in the repository history)' : ''}.`)) return;
  commit([opReplace(d)], `Restore backup from ${file.name}`);
  toast('Backup restored', 'success');
}

/* ===== Export & backup page ===== */
function renderData() {
  const last = readLS(STORAGE_KEYS.lastSync, null);
  const tableBtns = Object.keys(TABLE_COLUMNS).map((t) =>
    `<button class="btn btn-sm" data-action="export-one" data-table="${t}"><i class="fa-solid fa-file-csv"></i> ${t}.csv</button>`).join('');
  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <section class="panel p-5">
        <h2 class="panel-title mb-1">Download your data</h2>
        <p class="text-sm text-ink-2 mb-4 max-w-prose">The ZIP holds one CSV per table plus the full JSON, ready for Excel, Power BI or Google Sheets.</p>
        <div class="flex flex-wrap gap-2 mb-4">
          <button class="btn btn-primary" data-action="export-zip"><i class="fa-solid fa-file-zipper"></i> Download all (ZIP)</button>
          <button class="btn" data-action="export-json"><i class="fa-solid fa-file-code"></i> Download JSON</button>
        </div>
        <div class="text-sm text-ink-3 mb-2">Or a single table:</div>
        <div class="flex flex-wrap gap-2">${tableBtns}</div>
      </section>

      <section class="panel p-5">
        <h2 class="panel-title mb-1">GitHub sync</h2>
        ${isConfigured() ? `
          <p class="text-sm text-ink-2 mb-3">Saving to <a class="text-royal underline break-all" href="${esc(gh().webUrl)}" target="_blank" rel="noopener">${esc(config.owner)}/${esc(config.repo)}/${esc(config.path)}</a> on branch <b>${esc(config.branch)}</b>.</p>
          <dl class="kv mb-4">
            <div><dt>Last synced</dt><dd>${last ? new Date(last).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'}</dd></div>
            <div><dt>Waiting to upload</dt><dd>${pending.length} change${pending.length === 1 ? '' : 's'}</dd></div>
          </dl>
          <div class="flex flex-wrap gap-2">
            <button class="btn" data-action="sync-now"><i class="fa-solid fa-arrows-rotate"></i> Sync now</button>
            <button class="btn btn-danger" data-action="reload-remote"><i class="fa-solid fa-cloud-arrow-down"></i> Reload from GitHub</button>
          </div>
          <p class="hint">Every save is a commit, so the repository's history is a full version history. You can restore any older version of the file from GitHub.</p>`
        : `<p class="text-sm text-ink-2 mb-4">Not connected. Your data lives only in this browser until you connect a GitHub repository.</p>
          <button class="btn btn-primary" data-action="open-settings"><i class="fa-brands fa-github"></i> Connect GitHub</button>`}
      </section>

      <section class="panel p-5">
        <h2 class="panel-title mb-1">Restore from a backup</h2>
        <p class="text-sm text-ink-2 mb-4 max-w-prose">Load a JSON file downloaded from this app. It replaces everything currently in the app.</p>
        <button class="btn" data-action="import-json"><i class="fa-solid fa-upload"></i> Choose backup file</button>
      </section>

      <section class="panel p-5">
        <h2 class="panel-title mb-1">Using the data in Power BI or Power Automate</h2>
        <div class="text-sm text-ink-2 space-y-2 max-w-prose">
          <p>In Power BI, use Get data, then Folder, and point it at the unzipped export. Load <b>transactions</b>, <b>accounts</b> and <b>ledger</b>, then link <code>account_id</code> columns in the model view.</p>
          <p>For balances over time, use the <b>ledger</b> table: a running sum of <code>amount</code> where <code>affects_balance</code> is TRUE, per account.</p>
          <p>Power Automate can read <code>${esc(config.path || 'data.json')}</code> straight from the repository with the GitHub connector or an HTTP action using your token. Every array in the file (accounts, transactions, emis, subscriptions, budgets) is a flat list of records.</p>
        </div>
      </section>
    </div>`;
}

/* ---------------------------------------------------------------------
   11. SETTINGS
   --------------------------------------------------------------------- */
function parseRepoInput(owner, repo) {
  // Accepts "repo", "owner/repo" or a full https://github.com/owner/repo URL.
  let r = String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  let o = String(owner || '').trim();
  if (r.includes('/')) { const parts = r.split('/'); o = parts[0]; r = parts[1]; }
  return { owner: o, repo: r };
}
const splitLines = (s) => uniq(String(s || '').split(/\r?\n|,/).map((x) => x.trim()));

function openSettings() {
  const s = db.settings;
  const body = `
    <section class="space-y-4">
      <div>
        <h3 class="font-semibold">GitHub storage</h3>
        <p class="text-sm text-ink-2 mt-1">The app saves your data as a JSON file in a GitHub repository you own. Use a <b>private</b> repository for it.</p>
      </div>
      ${twoCol(field('GitHub username', input('owner', config.owner, 'autocomplete="off" spellcheck="false" placeholder="your-username"')),
        field('Data repository name', input('repo', config.repo, 'autocomplete="off" spellcheck="false" placeholder="kosh-data"')))}
      ${twoCol(field('Branch', input('branch', config.branch || 'main', 'spellcheck="false"')),
        field('File path', input('path', config.path || 'data.json', 'spellcheck="false"'), 'Folders work too, e.g. finance/data.json'))}
      ${field('Personal access token', `<div class="flex gap-2">${input('token', config.token, 'type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"')}<button type="button" class="btn" id="toggleToken">Show</button></div>`,
        'Kept only in this browser. Needs "Contents: Read and write" on the data repository.')}
      <div class="flex items-center gap-3 flex-wrap">
        <button type="button" class="btn btn-sm" id="testConn"><i class="fa-solid fa-plug"></i> Test connection</button>
        <span id="testResult" class="text-sm" aria-live="polite"></span>
      </div>
    </section>
    <hr class="border-line">
    ${remindersSection(s)}
    <hr class="border-line">
    <section class="space-y-4">
      <h3 class="font-semibold">Preferences</h3>
      ${twoCol(field('Your name', input('ownerName', s.ownerName, 'maxlength="30" placeholder="Kundan"'), 'Shown in the app heading and greeting.'),
        field('Currency', select('currency', Object.keys(CURRENCIES), s.currency)))}
      ${checkbox('autoPrices', s.autoPrices !== false, 'Update fund and stock prices when the app opens', 'Mutual fund NAVs come from MFapi.in (free, AMFI data). Checked at most every 3 hours.')}
      ${field('Stock price key (optional)', input('stockApiKey', s.stockApiKey, 'autocomplete="off" spellcheck="false" placeholder="Alpha Vantage free key"'), 'Only needed for live stock and ETF prices. Get a free key at alphavantage.co (25 price checks a day).')}
      ${Object.keys(s.colors || {}).length ? `<p class="text-sm">You have picked your own colours for ${Object.keys(s.colors).length} chart item(s). <button type="button" class="link" data-action="reset-colors">Reset chart colours</button></p>` : ''}
      ${twoCol(field('Units are allotted at the NAV of', select('navLagDays', [['0', 'The same day'], ['1', '1 working day later'], ['2', '2 working days later'], ['3', '3 working days later']], String(s.navLagDays ?? 1)), 'Default for lump sums and new SIPs. Each SIP can have its own.'),
        '<div class="pt-6">' + checkbox('stampDuty', s.stampDuty !== false, 'Deduct 0.005% stamp duty', 'Mutual fund purchases in India lose 0.005% to stamp duty, so a few fewer units are allotted.') + '</div>')}
      ${field('Year of birth (optional)', input('birthYear', s.birthYear || '', 'type="number" min="1940" max="2015" placeholder="e.g. 2001"'), 'Used by the financial freedom planner and the cool-off list to show ages.')}
      ${checkbox('showNwToggles', s.showNwToggles !== false, 'Show the net worth switches on the dashboard', 'Small switches on the net worth card to leave out investments or credit card dues.')}
      ${checkbox('sipAsSpending', s.sipAsSpending, 'Count SIPs as money going out', 'Shows SIPs and other money you invest in the spending chart and monthly totals. Net worth is not affected, because the money is still yours in the fund.')}
      ${field('Expense categories', textarea('expenseCategories', s.expenseCategories.join('\n'), 'rows="6"'), 'One per line. Renaming a category here does not change past transactions.')}
      ${field('Income sources', textarea('incomeCategories', s.incomeCategories.join('\n'), 'rows="4"'), 'One per line.')}
    </section>
    <hr class="border-line">
    <section class="space-y-3">
      <h3 class="font-semibold">This device</h3>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm" id="forgetToken"><i class="fa-solid fa-key"></i> Forget token</button>
        <button type="button" class="btn btn-sm btn-danger" id="clearLocal"><i class="fa-solid fa-broom"></i> Clear data on this device</button>
      </div>
      <p class="hint">Use these on a shared computer. Clearing this device doesn't touch the copy on GitHub.</p>
    </section>`;

  openModal({
    title: 'Settings',
    body,
    submitLabel: 'Save settings',
    onOpen: (form) => {
      $('#toggleToken', form).addEventListener('click', (ev) => {
        const t = form.elements.token;
        t.type = t.type === 'password' ? 'text' : 'password';
        ev.currentTarget.textContent = t.type === 'password' ? 'Show' : 'Hide';
      });
      $('#testConn', form).addEventListener('click', async () => {
        const d = readForm(form);
        const out = $('#testResult');
        const cfg = { ...parseRepoInput(d.owner, d.repo), branch: d.branch || 'main', path: d.path || 'data.json', token: d.token };
        if (!cfg.owner || !cfg.repo || !cfg.token) { out.className = 'text-sm text-loss'; out.textContent = 'Fill in username, repository and token first.'; return; }
        out.className = 'text-sm text-ink-3'; out.textContent = 'Checking…';
        try {
          const api = gh(cfg);
          const repo = await api.checkRepo();
          if (!(await api.checkBranch())) throw new Error(`Branch "${cfg.branch}" not found. This repository's default branch is "${repo.default_branch}".`);
          const file = await api.getFile();
          out.className = 'text-sm text-gain';
          out.textContent = `Connected${repo.private ? '' : ' (warning: this repository is PUBLIC)'}. ` +
            (file.data ? `Found ${cfg.path} with ${(file.data.transactions || []).length} transactions.` : `${cfg.path} will be created on first save.`);
          if (!repo.private) out.className = 'text-sm text-[#8A5E00]';
        } catch (err) { out.className = 'text-sm text-loss'; out.textContent = err.message; }
      });
      $('#forgetToken', form).addEventListener('click', () => {
        config.token = ''; writeLS(STORAGE_KEYS.config, config);
        form.elements.token.value = '';
        setSyncStatus('local'); toast('Token removed from this browser');
      });
      $('#clearLocal', form).addEventListener('click', () => {
        const warn = isConfigured()
          ? `Remove all KOSH data from this browser?${pending.length ? `\n\n${pending.length} change(s) have NOT reached GitHub yet and will be lost.` : ''}\n\nThe copy on GitHub stays; it will download again next time you connect.`
          : 'Remove all KOSH data from this browser?\n\nYou are not connected to GitHub, so this deletes your data permanently. Download a backup first if unsure.';
        if (!confirm(warn)) return;
        Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
        localStorage.removeItem(LAST_ACCOUNT_KEY);
        location.reload();
      });
    },
    onSubmit: (d) => {
      const { owner, repo } = parseRepoInput(d.owner, d.repo);
      const next = { owner, repo, branch: d.branch || 'main', path: (d.path || 'data.json').replace(/^\/+/, ''), token: d.token };
      const anyGit = next.owner || next.repo || next.token;
      if (anyGit && !(next.owner && next.repo && next.token)) {
        toast('To connect GitHub, fill in username, repository and token (or clear all three).', 'error');
        return false;
      }
      const repoChanged = JSON.stringify(next) !== JSON.stringify(config);
      config = next;
      writeLS(STORAGE_KEYS.config, config);
      if (repoChanged && isConfigured()) { sync.hold = true; clearTimeout(sync.timer); }

      const newSettings = {
        ownerName: d.ownerName || '',
        sipAsSpending: !!d.sipAsSpending,
        autoPrices: !!d.autoPrices,
        showNwToggles: !!d.showNwToggles,
        birthYear: d.birthYear ? int(d.birthYear) : '',
        navLagDays: int(d.navLagDays),
        stampDuty: !!d.stampDuty,
        remindInApp: !!d.remindInApp,
        reminderTime: d.reminderTime || '21:00',
        ntfyTopic: d.ntfyTopic ?? s.ntfyTopic ?? '',
        stockApiKey: d.stockApiKey || '',
        currency: d.currency,
        expenseCategories: splitLines(d.expenseCategories),
        incomeCategories: splitLines(d.incomeCategories),
      };
      if (!newSettings.expenseCategories.length) newSettings.expenseCategories = clone(DEFAULT_SETTINGS.expenseCategories);
      if (!newSettings.incomeCategories.length) newSettings.incomeCategories = clone(DEFAULT_SETTINGS.incomeCategories);
      if (Object.keys(newSettings).some((k) => JSON.stringify(newSettings[k]) !== JSON.stringify(db.settings[k]))) {
        _fmtCache.clear();
        commit([opSettings(newSettings)], 'Update settings');
      } else render();

      toast('Settings saved', 'success');
      if (repoChanged && isConfigured()) connectAndSync();
    },
  });
}

/**
 * First connection to a repository (or switching repositories).
 * If GitHub already has data AND this device has unsynced changes,
 * ask whether to merge them or throw the local ones away.
 */
async function connectAndSync() {
  sync.hold = true;
  clearTimeout(sync.timer);
  setSyncStatus('syncing');
  try {
    const api = gh();
    const repo = await api.checkRepo();
    if (!(await api.checkBranch())) throw new Error(`Branch "${config.branch}" doesn't exist. This repository's default branch is "${repo.default_branch}". Change it in Settings.`);
    const remote = await api.getFile();
    const meaningful = pending.some((b) => b.ops.some((o) => !o.ifMissing));
    if (remote.data && meaningful) {
      const merge = confirm(`GitHub already has data in ${config.path}, and this device has ${pending.length} change(s) that are not on GitHub.\n\nOK: add this device's changes to the GitHub data.\nCancel: discard this device's changes and use the GitHub data.`);
      if (!merge) { pending = []; db = normalizeDB(remote.data); persist(); render(); }
    }
  } catch (e) {
    sync.hold = false;
    setSyncStatus('error', e.message);
    toast(e.message, 'error');
    return;
  }
  sync.hold = false;
  if (await runSync()) { toast('Connected to GitHub. Your data is synced.', 'success'); processAutoPayments(); }
}

async function reloadFromGitHub() {
  if (!isConfigured()) return openSettings();
  if (pending.length && !confirm(`Discard ${pending.length} change(s) on this device that haven't reached GitHub, and reload?`)) return;
  pending = [];
  persist();
  await runSync();
  render();
  toast('Reloaded from GitHub');
}

/* ---------------------------------------------------------------------
   12. STARTUP & EVENT WIRING
   --------------------------------------------------------------------- */
const ACTIONS = {
  'open-settings': () => openSettings(),
  'sync-now': () => (isConfigured() ? runSync() : openSettings()),
  'reload-remote': () => reloadFromGitHub(),
  'add-txn': (d) => openTxnForm(null, { type: d.type || 'expense', forHome: !!d.home }),
  'person-add': () => openPersonForm(null),
  'goal-new': () => openGoalForm(null),
  'rem-ics': () => downloadReminderIcs($('#modalForm [name="reminderTime"]')?.value || db.settings.reminderTime),
  'rem-topic': () => { const el = $('#modalForm [name="ntfyTopic"]'); if (el) el.value = randomTopic(); },
  'rem-copy': () => { const v = $('#modalForm [name="ntfyTopic"]')?.value; if (v) navigator.clipboard?.writeText(v).then(() => toast('Topic copied')); },
  'rem-test': () => sendTestNotification($('#modalForm [name="ntfyTopic"]')?.value),
  'rem-on': () => { const f = $('#modalForm'); const topic = f.querySelector('[name="ntfyTopic"]').value || randomTopic(); f.querySelector('[name="ntfyTopic"]').value = topic; setupPhoneReminders(topic, f.querySelector('[name="reminderTime"]').value || '21:00'); },
  'rem-off': () => removePhoneReminders(),
  'install-hide': (d, el) => { localStorage.setItem('kosh.installHidden', '1'); el.closest('.nudge')?.remove(); },
  'install-app': async (d, el) => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; el.closest('.nudge')?.remove(); },
  'tax-add': () => openTaxItem(),
  'tax-del': (d) => commit([opDelete('taxItems', d.id)], 'Remove tax deduction'),
  'imp-read': () => importRead(),
  'imp-range': (d) => importRange(d.r),
  'imp-all': (d) => { imp.rows.forEach((r) => { r.include = d.v === '1' && !r.match && r.kind !== 'skip'; }); render(); },
  'rules-open': () => openRules(),
  'nav-more': () => toggleNav(true),
  'fun-edit': () => openFunForm(),
  'fun-set': (d) => { commit([opSettings({ funMoney: { ...FUN_DEFAULT, ...(db.settings.funMoney || {}), monthly: num(d.v) } })], 'Lower fun money'); toast(`Fun money set to ${money(num(d.v))} this month.`, 'success'); },
  'credit-add': () => openCreditForm(),
  'health-settings': () => openHealthSettings(),
  'nudge-hide': (d, el) => { hideNudge(d.id); el.closest('.nudge-card')?.remove(); },
  'planner-tab': (d) => { plannerTab = d.t; render(); },
  'salary-item': () => openSalaryItem(),
  'salary-del': (d) => { const p = (db.settings.salaryPlan || []).slice(); p.splice(int(d.i), 1); commit([opSettings({ salaryPlan: p })], 'Remove salary-day step'); },
  'salary-apply': () => applySalaryPlan(),
  'review-share': () => shareReview(),
  'split-new': () => openSplitForm(),
  'split-del': (d) => deleteSplit(d.id),
  'cool-new': () => openCoolOff(),
  'cool-decide': (d) => openCoolDecide(d.id),
  'cool-skip': (d) => coolSkip(d.id),
  'cool-keep': (d) => coolKeep(d.id),
  'setup-hide': (d, el) => { localStorage.setItem('kosh.setupHidden', '1'); el.closest('section')?.remove(); toast('Hidden. The steps are also in the README.'); },
  'cal-go': (d) => { calMonth = d.m; render(); },
  'cal-day': (d) => openCalendarDay(d.date),
  'cal-add': (d) => { closeModal(); openTxnForm(null, { type: d.type, date: d.date }); },
  'ntf-add': () => openNotifyForm(null),
  'ntf-edit': (d) => openNotifyForm(db.notifications.find((x) => x.id === d.id)),
  'ntf-send': (d) => sendNotificationNow(db.notifications.find((x) => x.id === d.id)),
  'ntf-recommended': () => addRecommendedNotifications(),
  'ntf-topic': () => changeTopic(),
  'ntf-copy': () => { navigator.clipboard?.writeText(db.settings.ntfyTopic || '').then(() => toast('Topic copied')); },
  'ntf-test': () => sendTestNotification(db.settings.ntfyTopic),
  'ntf-sync': () => syncNotifyWorkflow(),
  'rules-learn': () => { const ops = learnFromEntries(); if (ops.length) commit(ops, `Remember choices from ${ops.length} payees`); toast(ops.length ? `Remembered ${ops.length} more payee${ops.length === 1 ? '' : 's'} from your entries.` : 'Everything is already remembered.', 'success'); openRules(); },
  'rule-del': (d, el) => { commit([opDelete('rules', d.id)], 'Forget a remembered choice'); el.closest('.row')?.remove(); },
  'imp-go': () => importGo(),
  'import-undo': (d) => importUndo(d.batch),
  'recurring-from': (d) => { openSubForm.presetKind = 'subscription'; openSubForm.presetValues = { name: d.name, amount: num(d.amount), category: d.category }; openSubForm(null); },
  'goal-edit': (d) => openGoalForm(db.goals.find((x) => x.id === d.id)),
  'goal-add': (d) => openGoalMoney(d.id, !!d.take),
  'wish-add': () => openWishForm(null),
  'wish-edit': (d) => openWishForm(db.wishlist.find((x) => x.id === d.id)),
  'wish-goal': (d) => wishToGoal(d.id),
  'wish-buy': (d) => wishBought(d.id),
  'person-edit': (d) => openPersonForm(accountById(d.id)),
  'person-money': (d) => openPersonMoney(d.id, d.dir),
  'person-history': (d) => openPersonHistory(d.id),
  'home-settle': () => settleHomeExpenses(),
  'home-unsettle': (d) => unsettleHome(d.id),
  'edit-txn': (d) => openTxnForm(db.transactions.find((t) => t.id === d.id)),
  'delete-txn': (d) => deleteTxn(d.id),
  'txn-more': () => { txFilter.limit += 100; $('#txnResults').innerHTML = txnResults(); },
  'add-account': (d) => openAccountForm(null, d.type || 'bank'),
  'edit-account': (d) => openAccountForm(accountById(d.id)),
  'adjust-balance': (d) => openAdjust(accountById(d.id)),
  'pay-card': (d) => payCard(d.id),
  'add-emi': () => openEmiForm(null),
  'edit-emi': (d) => openEmiForm(db.emis.find((e) => e.id === d.id)),
  'pay-emi': (d) => payEmi(d.id),
  'emi-schedule': (d) => showSchedule(d.id),
  'add-sub': (d) => { openSubForm.presetKind = d.kind || 'subscription'; openSubForm(null); },
  'edit-sub': (d) => openSubForm(db.subscriptions.find((s) => s.id === d.id)),
  'pay-sub': (d) => paySub(d.id),
  'toggle-sub': (d) => toggleSub(d.id),
  'add-sip': (d) => openSipForm(null, d.fund),
  'edit-sip': (d) => openSipForm(db.sips.find((x) => x.id === d.id)),
  'pay-sip': (d) => paySip(d.id),
  'toggle-sip': (d) => toggleSip(d.id),
  'invest-more': (d) => investMore(d.id),
  'refresh-prices': () => refreshPrices(),
  'review-units': (d) => openReview(d.id),
  'units-history': (d) => openUnitsHistory(d.id),
  'chart-new': () => openChartBuilder(null),
  'reset-colors': (d, el) => {
    if (!confirm('Go back to the standard colours in all charts?')) return;
    commit([opSettings({ colors: {} })], 'Reset chart colours');
    el.closest('p')?.remove();
    toast('Chart colours reset');
  },
  'chart-edit': (d) => openChartBuilder(db.charts.find((x) => x.id === d.id)),
  'chart-pin': (d) => toggleChartPin(d.id),
  'chart-move': (d) => moveChart(d.id, d.dir),
  'add-budget': (d) => openBudgetForm(null, d.category),
  'edit-budget': (d) => openBudgetForm(db.budgets.find((b) => b.id === d.id)),
  'export-zip': () => exportZip(),
  'export-json': () => exportJSON(),
  'export-one': (d) => exportOne(d.table),
  'import-json': () => $('#importFile').click(),
};

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function init() {
  registerServiceWorker();
  bindModal();

  // One click handler for every [data-action] button in the app.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !ACTIONS[el.dataset.action]) return;
    e.preventDefault();
    ACTIONS[el.dataset.action](el.dataset, el);
  });

  // Planners: recalculate as you type or slide
  const plannerListen = (e) => {
    if (location.hash !== '#planner' || !e.target.dataset?.p) return;
    if (e.target.dataset.rerender !== undefined) { readPlanInputs(e.target.dataset.p.split('.')[0]); render(); return; }
    if (e.target.dataset.p === 'loan.id') { const c = $('[data-custom]'); if (c) c.hidden = e.target.value !== 'custom'; }
    onPlannerInput(e);
  };
  document.addEventListener('input', plannerListen);
  document.addEventListener('change', plannerListen);

  // Calendar: Both / Spent / Income
  document.addEventListener('change', (e) => { if (e.target.name === 'calView' && location.hash === '#calendar') { calView = e.target.value; render(); } });

  // Rows that act as buttons (a transaction row opens it): Enter or Space
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-action]')) { e.preventDefault(); e.target.click(); }
  });

  // Statement import page
  document.addEventListener('change', (e) => { if (location.hash === '#import') onImportChange(e); });

  // Notification on/off switches
  document.addEventListener('change', (e) => {
    const id = e.target.dataset?.ntfToggle;
    if (!id) return;
    const n = db.notifications.find((x) => x.id === id);
    if (n) { commit([opUpsert('notifications', { ...n, enabled: e.target.checked })], `${e.target.checked ? 'Turn on' : 'Turn off'} notification`); scheduleNotifySync(); }
  });

  // Filters shown on a chart (top right)
  document.addEventListener('change', (e) => { if (e.target.dataset?.chartFilter) onChartFilter(e.target); });

  // Net worth switches on the dashboard (saved with your settings, so every device matches).
  document.addEventListener('change', (e) => {
    const k = e.target.dataset?.nw;
    if (!k) return;
    commit([opSettings({ [k]: e.target.checked })], `Net worth ${e.target.checked ? 'includes' : 'leaves out'} ${k === 'nwInvestments' ? 'investments' : 'card dues'}`);
  });

  // Filters (month pickers, transaction filters).
  document.addEventListener('change', (e) => {
    const f = e.target.dataset?.filter;
    if (!f || f === 'q') return;
    if (f === 'dashMonth') dashMonth = e.target.value;
    if (f === 'insightMonth') insightMonth = e.target.value;
    if (f === 'taxFy') taxFy = e.target.value;
    else if (f === 'budgetMonth') budgetMonth = e.target.value;
    else { txFilter[f] = e.target.value; txFilter.limit = 100; }
    render();
  });
  document.addEventListener('input', debounce((e) => {
    if (e.target.dataset?.filter !== 'q') return;
    txFilter.q = e.target.value; txFilter.limit = 100;
    $('#txnResults').innerHTML = txnResults();
  }, 200));

  $('#navToggle').addEventListener('click', () => toggleNav(true));
  $('#navBackdrop').addEventListener('click', () => toggleNav(false));
  window.addEventListener('hashchange', () => { toggleNav(false); render(); window.scrollTo(0, 0); });
  window.addEventListener('online', () => scheduleSync(100));
  window.addEventListener('offline', () => setSyncStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    // Pick up changes made on another device when you come back to this tab.
    if (document.visibilityState === 'visible' && isConfigured() && Date.now() - sync.lastPull > 60000) runSync();
  });
  $('#importFile').addEventListener('change', handleImport);

  if (isFirstRun && !db.accounts.length) {
    // A starting cash account. 'ifMissing' means it never overwrites one already on GitHub.
    commit([opUpsert('accounts', { id: 'acc_cash', name: 'Cash in hand', type: 'cash', subtype: 'Cash', institution: '', last4: '',
      openingBalance: 0, openingDate: todayStr(), creditLimit: null, statementDay: null, dueDay: null, interestRate: null,
      maturityDate: '', notes: '', archived: false }, { ifMissing: true })], 'Create cash account');
  } else {
    render();
  }

  // Order on start: pull the latest data from GitHub, record anything that fell due
  // (SIPs, EMIs, subscriptions), then refresh fund and stock prices.
  const afterStart = () => {
    processAutoPayments();
    learnFromEntriesOnce(); // turn your existing entries into remembered import choices (first run only)
    notifyOnStart(); // custom notifications: first-run setup and keeping the phone schedule up to date
    // Units for SIP instalments whose NAV is out, then (if due) fresh prices.
    setTimeout(async () => { await autoAllotUnits(); refreshPrices({ auto: true }); }, 300);
  };
  if (isConfigured()) runSync().then(afterStart);
  else { setSyncStatus('local'); afterStart(); }
}

document.addEventListener('DOMContentLoaded', init);
