/* =====================================================================
   Kosh | Expense Tracker & Fund Manager
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
     8. PAGES (dashboard, accounts, transactions, EMIs, subscriptions,
        budgets, export)
     9. FORMS & ACTIONS
    10. EXPORT / IMPORT
    11. SETTINGS
    12. STARTUP
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   1. CONSTANTS & DEFAULTS
   --------------------------------------------------------------------- */
const STORAGE_KEYS = {
  db: 'kosh.db.v1',             // cached copy of the whole database
  pending: 'kosh.pending.v1',   // changes made here but not yet on GitHub
  config: 'kosh.config.v1',     // GitHub connection details (incl. token)
  lastSync: 'kosh.lastSync.v1', // time of last successful sync
};
const SCHEMA_VERSION = 1;
const COLLECTIONS = ['accounts', 'transactions', 'emis', 'subscriptions', 'budgets'];

const ACCOUNT_TYPES = {
  cash:        { label: 'Cash & wallets',        single: 'Cash or wallet', icon: 'fa-wallet' },
  bank:        { label: 'Bank accounts',         single: 'Bank account',   icon: 'fa-building-columns' },
  credit_card: { label: 'Credit cards',          single: 'Credit card',    icon: 'fa-credit-card' },
  investment:  { label: 'Investments & savings', single: 'Investment',     icon: 'fa-seedling' },
};
const CASH_KINDS = ['Cash', 'UPI wallet', 'Prepaid card', 'Other'];
const BANK_KINDS = ['Savings', 'Current', 'Salary', 'NRE / NRO', 'Other'];
const INVESTMENT_KINDS = ['Mutual fund', 'Fixed deposit', 'Recurring deposit', 'Stocks', 'PPF / EPF', 'NPS', 'Gold', 'Bonds', 'Crypto', 'Other'];
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
  currency: 'INR',
  expenseCategories: ['Food & dining', 'Groceries', 'Transport', 'Fuel', 'Utilities', 'Rent', 'Shopping',
    'Health', 'Education', 'Entertainment', 'Travel', 'Subscriptions', 'EMI', 'Insurance',
    'Personal care', 'Family', 'Gifts & donations', 'Fees & charges', 'Other'],
  incomeCategories: ['Salary', 'Business', 'Freelance', 'Interest', 'Dividends', 'Refund',
    'Cashback', 'Gift', 'Rental income', 'Other'],
};
const CHART_COLORS = ['#27408B', '#1E7A52', '#E8A317', '#B4323A', '#5B7BD5', '#6FA88A',
  '#8C6A3F', '#7A3E8F', '#2E8C99', '#9AA3BD', '#C0616A', '#3F4A6B'];

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
    accounts: [], transactions: [], emis: [], subscriptions: [], budgets: [],
  };
}
/** Makes sure any loaded JSON has every expected key (safe against old/partial files). */
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
  if (msgs.length <= 1) return `Kosh: ${msgs[0] || 'Update data'}`;
  return `Kosh: ${msgs.length} changes (${msgs.slice(0, 3).join('; ')}${msgs.length > 3 ? '; …' : ''})`;
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
        await api.putFile(merged, remote.sha, batches.length ? commitMessage(batches) : 'Kosh: create data file'); // (c)
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
  el.innerHTML = `<span class="dot"></span><span class="txt">${esc(text)}</span>`;
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
  const T = { cash: 0, bank: 0, investment: 0, cardCredit: 0, cardDebt: 0, loans: 0, cardEmis: 0 };
  for (const a of db.accounts) {
    const b = balances.get(a.id) || 0;
    if (a.type === 'credit_card') { if (b < 0) T.cardDebt += -b; else T.cardCredit += b; }
    else if (T[a.type] !== undefined) T[a.type] += b;
  }
  for (const { e, c } of emis) {
    if (c.status !== 'active') continue;
    if (e.kind === 'loan') T.loans += c.remaining; else T.cardEmis += c.remaining;
  }
  T.assets = T.cash + T.bank + T.investment + T.cardCredit;
  T.liabilities = T.cardDebt + T.loans + T.cardEmis;
  T.netWorth = T.assets - T.liabilities;
  return { balances, emis, emiBlocked, T };
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

function monthSummary(mk) {
  let income = 0, expense = 0;
  for (const t of db.transactions) {
    if (!t.date || !t.date.startsWith(mk)) continue;
    if (t.type === 'income') income += num(t.amount);
    else if (t.type === 'expense') expense += num(t.amount);
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}
function spendByCategory(mk) {
  const m = new Map();
  for (const t of db.transactions) {
    if (t.type !== 'expense' || !t.date?.startsWith(mk)) continue;
    const k = t.category || 'Other';
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
      items.push({ date: s.nextRenewal, kind: 'subscription', id: s.id, title: s.name, sub: `${FREQUENCIES[s.frequency]?.label || ''} renewal, ${accountName(s.accountId)}`, amount: num(s.amount) });
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
function subscriptionTxn(s, date) {
  return {
    id: `txn_sub_${s.id}_${date}`, date, type: 'expense', amount: round2(num(s.amount)),
    category: s.category || 'Subscriptions', description: s.name,
    fromAccountId: s.accountId || '', toAccountId: '', relatedType: 'subscription', relatedId: s.id,
    notes: `${FREQUENCIES[s.frequency]?.label || ''} subscription renewal`,
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

/** Records subscription renewals and EMIs marked "record automatically" that are now due. */
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
  accounts:      { title: 'Accounts',         icon: 'fa-building-columns' },
  transactions:  { title: 'Transactions',     icon: 'fa-list' },
  emis:          { title: 'EMIs & loans',     icon: 'fa-calendar-check' },
  subscriptions: { title: 'Subscriptions',    icon: 'fa-rotate' },
  budgets:       { title: 'Budgets',          icon: 'fa-bullseye' },
  data:          { title: 'Export & backup',  icon: 'fa-file-export' },
};
const currentPage = () => { const h = location.hash.replace(/^#\/?/, ''); return PAGES[h] ? h : 'dashboard'; };

let charts = [];
function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

function renderNav() {
  const cur = currentPage();
  $('#nav').innerHTML = Object.entries(PAGES).map(([k, p]) =>
    `<a href="#${k}" class="nav-link ${k === cur ? 'active' : ''}" ${k === cur ? 'aria-current="page"' : ''}><i class="fa-solid ${p.icon}"></i>${p.title}</a>`).join('');
}

/** Redraws the current page from `db`. Called after every change. */
function render() {
  M = buildModel();
  const page = currentPage();
  destroyCharts();
  renderNav();
  $('#pageTitle').textContent = PAGES[page].title;
  document.title = `${PAGES[page].title} | Kosh`;
  const view = $('#view');
  const fn = {
    dashboard: renderDashboard, accounts: renderAccounts, transactions: renderTransactions,
    emis: renderEmis, subscriptions: renderSubscriptions, budgets: renderBudgets, data: renderData,
  }[page];
  view.innerHTML = fn();
  if (page === 'dashboard') drawDashboardCharts();
  setSyncStatus(sync.state, sync.detail);
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
    transfer:   { icon: 'fa-right-left', cls: 'move', label: 'Transfer' },
    adjustment: { icon: 'fa-scale-balanced', cls: '', label: 'Balance update' },
  }[t.type] || { icon: 'fa-circle', cls: '', label: t.type };
  const amt = num(t.amount);
  let amountHtml, flow;
  if (t.type === 'expense') { amountHtml = `<span class="text-loss">−${money(amt)}</span>`; flow = accountName(t.fromAccountId); }
  else if (t.type === 'income') { amountHtml = `<span class="text-gain">+${money(amt)}</span>`; flow = accountName(t.toAccountId); }
  else if (t.type === 'transfer') { amountHtml = money(amt); flow = `${accountName(t.fromAccountId)} to ${accountName(t.toAccountId)}`; }
  else { const up = !!t.toAccountId; amountHtml = `<span class="${up ? 'text-gain' : 'text-loss'}">${up ? '+' : '−'}${money(amt)}</span>`; flow = accountName(t.toAccountId || t.fromAccountId); }
  return `<div class="row">
    <div class="row-icon ${kind.cls}" title="${kind.label}"><i class="fa-solid ${kind.icon}"></i></div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(t.description || t.category || kind.label)}</div>
      <div class="text-xs text-ink-3 flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
        <span>${fmtDate(t.date)}</span>
        ${t.category ? `<span class="pill">${esc(t.category)}</span>` : ''}
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
  const saveRate = s.income > 0 ? Math.round((s.net / s.income) * 100) : null;
  const upcoming = upcomingItems(30);
  const recent = sortTxns(db.transactions).slice(0, 6);
  return `
    ${gettingStarted()}
    ${netWorthPanel(T)}

    <section class="panel p-5 mt-6">
      <div class="panel-head">
        <h2 class="panel-title">${dashMonth === thisMonth() ? 'This month' : fmtMonth(dashMonth)}</h2>
        ${monthSelect('dashMonth', dashMonth)}
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div><div class="stat-label">Money in</div><div class="stat-value num text-gain">${money(s.income)}</div></div>
        <div><div class="stat-label">Money out</div><div class="stat-value num text-loss">${money(s.expense)}</div></div>
        <div><div class="stat-label">Saved</div><div class="stat-value num">${money(s.net)}</div>
          ${saveRate !== null ? `<div class="text-xs text-ink-3 mt-0.5">${saveRate}% of income</div>` : ''}</div>
      </div>
    </section>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title">Spending by category</h2><span class="text-sm text-ink-3">${fmtMonth(dashMonth)}</span></div>
        <div class="relative h-72" id="catChartBox"><canvas id="catChart" aria-label="Spending by category chart" role="img"></canvas></div>
      </section>
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title">Income and expenses, last 6 months</h2></div>
        <div class="relative h-72"><canvas id="trendChart" aria-label="Income and expenses chart" role="img"></canvas></div>
      </section>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
      <section class="panel p-5 lg:col-span-2">
        <div class="panel-head"><h2 class="panel-title">Due in the next 30 days</h2>
          <span class="text-sm text-ink-3 num">${upcoming.length ? money(upcoming.reduce((a, i) => a + i.amount, 0)) + ' total' : ''}</span></div>
        ${upcoming.length ? `<div class="divider">${upcoming.map(upcomingRow).join('')}</div>`
          : emptyState('fa-calendar-check', 'Nothing due. EMIs, subscriptions and card bills will show up here.')}
      </section>
      <section class="panel p-5">
        <div class="panel-head"><h2 class="panel-title">Budgets</h2><a href="#budgets" class="text-sm text-royal">Manage</a></div>
        ${budgetMini()}
      </section>
    </div>

    <section class="panel p-5 mt-6">
      <div class="panel-head"><h2 class="panel-title">Recent transactions</h2><a href="#transactions" class="text-sm text-royal">See all</a></div>
      ${recent.length ? `<div class="divider">${recent.map((t) => txnRow(t)).join('')}</div>`
        : emptyState('fa-receipt', 'No transactions yet.', `<button class="btn btn-primary" data-action="add-txn" data-type="expense"><i class="fa-solid fa-plus"></i> Add your first expense</button>`)}
    </section>`;
}

function gettingStarted() {
  const steps = [
    { done: isConfigured(), text: 'Connect your GitHub repository so your data is backed up and synced.', action: '<button class="btn btn-sm" data-action="open-settings">Open settings</button>' },
    { done: db.accounts.some((a) => a.type !== 'cash' || num(a.openingBalance) !== 0), text: 'Add your bank accounts, credit cards and investments with today\'s balances.', action: '<a class="btn btn-sm" href="#accounts">Add accounts</a>' },
    { done: db.transactions.length > 0, text: 'Log an expense or income. Balances update on their own from then on.', action: '<button class="btn btn-sm" data-action="add-txn" data-type="expense">Add transaction</button>' },
  ];
  if (steps.every((s) => s.done)) return '';
  return `<section class="panel p-5 mb-6">
    <h2 class="panel-title mb-3">Set up Kosh in three steps</h2>
    <ol class="space-y-3">
      ${steps.map((s, i) => `<li class="flex items-center gap-3 flex-wrap">
        <span class="row-icon ${s.done ? 'in' : ''}" style="width:1.75rem;height:1.75rem;font-size:.8rem">${s.done ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
        <span class="flex-1 min-w-[12rem] ${s.done ? 'text-ink-3 line-through' : ''}">${s.text}</span>
        ${s.done ? '' : s.action}
      </li>`).join('')}
    </ol>
  </section>`;
}

/** The net worth "equation": assets minus liabilities, drawn to scale. */
function netWorthPanel(T) {
  const assets = [['Cash', T.cash, '#6FA88A'], ['Bank', T.bank, '#1E7A52'], ['Investments', T.investment, '#27408B']];
  if (T.cardCredit > 0) assets.push(['Card credit', T.cardCredit, '#9AA3BD']);
  const liabs = [['Card dues', T.cardDebt, '#B4323A']];
  if (T.loans > 0) liabs.push(['Loans', T.loans, '#7E2229']);
  if (T.cardEmis > 0) liabs.push(['Card EMIs', T.cardEmis, '#D98A90']);
  const assetSum = assets.reduce((a, [, v]) => a + Math.max(0, v), 0);
  const liabSum = liabs.reduce((a, [, v]) => a + v, 0);
  const scale = Math.max(assetSum, liabSum, 1);
  const track = (parts) => parts.filter(([, v]) => v > 0)
    .map(([k, v, c]) => `<span style="width:${(v / scale) * 100}%;background:${c}" title="${esc(k)}: ${money(v)}"></span>`).join('');
  const term = ([k, v, c]) => `<span class="term"><span class="sw" style="background:${c}"></span><span class="t-label">${k}</span><span class="t-val num">${money(v)}</span></span>`;
  return `<section class="panel p-5 sm:p-7">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div class="text-sm text-ink-2 mb-2">Net worth</div>
        <div class="display nw-figure num ${T.netWorth < 0 ? 'text-loss' : ''}">${money(T.netWorth)}</div>
      </div>
      <div class="text-sm text-ink-3">As on ${fmtDate(todayStr())}</div>
    </div>
    <div class="mt-6 space-y-2" aria-hidden="true">
      <div class="nw-track">${track(assets)}</div>
      <div class="nw-track">${track(liabs)}</div>
    </div>
    <div class="equation mt-5">
      ${assets.map(term).join('<span class="op">+</span>')}
      ${liabs.map((l) => `<span class="op">−</span>${term(l)}`).join('')}
      <span class="op">=</span><span class="t-val num font-semibold">${money(T.netWorth)}</span>
    </div>
  </section>`;
}

function upcomingRow(it) {
  const d = parseDate(it.date);
  const days = daysUntil(it.date);
  const pill = days < 0 ? 'out' : days <= 3 ? 'due' : '';
  const action = { emi: 'pay-emi', subscription: 'pay-sub', card: 'pay-card' }[it.kind];
  const label = it.kind === 'card' ? 'Pay bill' : 'Record payment';
  const icon = { emi: 'fa-calendar-check', subscription: 'fa-rotate', card: 'fa-credit-card' }[it.kind];
  return `<div class="row">
    <div class="w-11 text-center flex-none">
      <div class="display text-xl font-semibold leading-none num">${d.getDate()}</div>
      <div class="text-xs text-ink-3">${d.toLocaleDateString(locale(), { month: 'short' })}</div>
    </div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate"><i class="fa-solid ${icon} text-ink-3 text-xs mr-1"></i>${esc(it.title)}</div>
      <div class="text-xs text-ink-3 truncate mt-0.5">${esc(it.sub)}</div>
    </div>
    <div class="text-right">
      <div class="num font-semibold">${money(it.amount)}</div>
      <span class="pill ${pill} mt-1">${relDays(it.date)}</span>
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
  Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  Chart.defaults.color = '#4A5170';
  const tooltipMoney = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(ctx.parsed.y ?? ctx.parsed)}` } };

  const cats = spendByCategory(dashMonth);
  if (!cats.length) {
    $('#catChartBox').innerHTML = emptyState('fa-chart-pie', `No expenses recorded in ${fmtMonth(dashMonth)}.`);
  } else {
    const top = cats.slice(0, 9);
    const rest = cats.slice(9).reduce((a, c) => a + c.amount, 0);
    if (rest > 0) top.push({ category: 'Everything else', amount: rest });
    charts.push(new Chart($('#catChart'), {
      type: 'doughnut',
      data: { labels: top.map((c) => c.category), datasets: [{ data: top.map((c) => c.amount), backgroundColor: CHART_COLORS, borderColor: '#fff', borderWidth: 2 }] },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: window.innerWidth < 640 ? 'bottom' : 'right', labels: { boxWidth: 10, boxHeight: 10, padding: 10 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}` } },
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
        { label: 'Income', data: sums.map((s) => s.income), backgroundColor: '#1E7A52', borderRadius: 4, maxBarThickness: 28 },
        { label: 'Expenses', data: sums.map((s) => s.expense), backgroundColor: '#B4323A', borderRadius: 4, maxBarThickness: 28 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#EDF1EE' }, ticks: { callback: (v) => money(v, { compact: true }) } },
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: tooltipMoney },
    },
  }));
}

/* ===== Accounts ===== */
function renderAccounts() {
  const sections = Object.entries(ACCOUNT_TYPES).map(([type, meta]) => {
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
        <button class="btn btn-sm" data-action="add-account" data-type="${type}"><i class="fa-solid fa-plus"></i> Add ${meta.single.toLowerCase()}</button>
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
    const change = db.transactions.filter((t) => t.type === 'adjustment' && (t.toAccountId === a.id || t.fromAccountId === a.id))
      .reduce((s, t) => s + (t.toAccountId === a.id ? num(t.amount) : -num(t.amount)), 0);
    const bits = [];
    if (change) bits.push(`<span class="${change > 0 ? 'text-gain' : 'text-loss'}">${money(change, { sign: true })} from value updates</span>`);
    if (a.maturityDate) bits.push(`matures ${fmtDate(a.maturityDate)}`);
    if (num(a.interestRate)) bits.push(`${num(a.interestRate)}% p.a.`);
    extra = bits.length ? `<div class="text-xs text-ink-3 mt-0.5">${bits.join(', ')}</div>` : '';
  }
  return `<div class="row ${a.archived ? 'opacity-60' : ''}">
    <div class="row-icon"><i class="fa-solid ${ACCOUNT_TYPES[a.type].icon}"></i></div>
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
      <button class="btn btn-primary" data-action="add-txn" data-type="expense"><i class="fa-solid fa-arrow-up"></i> Add expense</button>
      <button class="btn" data-action="add-txn" data-type="income"><i class="fa-solid fa-arrow-down"></i> Add income</button>
      <button class="btn" data-action="add-txn" data-type="transfer"><i class="fa-solid fa-right-left"></i> Transfer money</button>
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
    ${shown.length ? `<div class="divider">${shown.map((t) => txnRow(t)).join('')}</div>`
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
  const list = db.subscriptions.slice().sort((a, b) => (b.active - a.active) || (a.nextRenewal || '').localeCompare(b.nextRenewal || ''));
  const active = list.filter((s) => s.active);
  const monthly = active.reduce((sum, s) => sum + num(s.amount) * (FREQUENCIES[s.frequency]?.perMonth || 1), 0);
  return `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <p class="text-sm text-ink-2 max-w-2xl">Streaming, software, gym, insurance premiums: anything that renews on a schedule.</p>
      <button class="btn btn-primary" data-action="add-sub"><i class="fa-solid fa-plus"></i> Add subscription</button>
    </div>
    ${list.length ? `
    <section class="panel p-5 mb-6"><dl class="kv">
      <div><dt>Per month</dt><dd class="text-lg">${money(monthly)}</dd></div>
      <div><dt>Per year</dt><dd class="text-lg">${money(monthly * 12)}</dd></div>
      <div><dt>Active</dt><dd class="text-lg">${active.length} of ${list.length}</dd></div>
    </dl></section>
    <section class="panel p-5"><div class="divider">${list.map(subRow).join('')}</div></section>`
    : `<section class="panel">${emptyState('fa-rotate', 'No subscriptions yet.', '<button class="btn btn-primary" data-action="add-sub"><i class="fa-solid fa-plus"></i> Add subscription</button>')}</section>`}`;
}

function subRow(s) {
  const f = FREQUENCIES[s.frequency] || FREQUENCIES.monthly;
  const days = s.nextRenewal ? daysUntil(s.nextRenewal) : null;
  const pill = !s.active ? '<span class="pill">Paused</span>'
    : `<span class="pill ${days < 0 ? 'out' : days <= 7 ? 'due' : ''}">${relDays(s.nextRenewal)}</span>`;
  return `<div class="row ${s.active ? '' : 'opacity-60'}">
    <div class="row-icon"><i class="fa-solid fa-rotate"></i></div>
    <div class="min-w-0 flex-1">
      <div class="font-medium truncate">${esc(s.name)} ${s.autoLog && s.active ? '<span class="pill" title="Recorded automatically on the renewal date">Auto</span>' : ''}</div>
      <div class="text-xs text-ink-3 truncate mt-0.5">${esc([f.label, accountName(s.accountId), s.nextRenewal ? `renews ${fmtDate(s.nextRenewal)}` : ''].filter(Boolean).join(', '))}</div>
    </div>
    <div class="text-right">
      <div class="num font-semibold">${money(s.amount)}</div>
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
function openTxnForm(existing, preset = {}) {
  if (existing?.type === 'adjustment') return openAdjustmentEdit(existing);
  if (!db.accounts.length) { toast('Add an account first.', 'error'); location.hash = '#accounts'; return; }
  const isNew = !existing;
  const last = localStorage.getItem(LAST_ACCOUNT_KEY);
  const lastOk = last && accountById(last) && !accountById(last).archived ? last : '';
  const t = existing ? { ...existing } : {
    type: preset.type || 'expense', date: todayStr(), amount: preset.amount ?? '',
    description: preset.description || '', category: preset.category || '', notes: '',
    fromAccountId: preset.fromAccountId || '', toAccountId: preset.toAccountId || '',
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
    ${twoCol(field('Amount', moneyInput('amount', t.amount, 'required min="0.01" placeholder="0"')), field('Date', input('date', t.date, 'type="date" required')))}
    ${showFor('expense', twoCol(
      field('Category', select('category', expCats, t.type === 'expense' ? t.category : expCats[0])),
      field('Paid from', accountSelect('fromAccountId', defFrom))))}
    ${showFor('income', twoCol(
      field('Source', select('category', incCats, t.type === 'income' ? t.category : incCats[0])),
      field('Received in', accountSelect('toAccountId', t.type === 'income' ? (t.toAccountId || defTo) : defTo))))}
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
    onOpen: (form) => bindShowHide(form, 'type'),
    onSubmit: (d) => {
      const amount = round2(num(d.amount));
      if (amount <= 0) { toast('Enter an amount above zero.', 'error'); return false; }
      if (d.type === 'transfer' && d.fromAccountId === d.toAccountId) { toast('Choose two different accounts for a transfer.', 'error'); return false; }
      const rec = {
        ...(existing || {}),
        id: existing?.id || uid('txn'),
        date: d.date, type: d.type, amount,
        category: d.type === 'transfer' ? transferCategory(d.fromAccountId, d.toAccountId) : d.category,
        description: d.description || '',
        fromAccountId: d.type === 'income' ? '' : d.fromAccountId,
        toAccountId: d.type === 'expense' ? '' : d.toAccountId,
        relatedType: existing?.relatedType || '', relatedId: existing?.relatedId || '',
        notes: d.notes || '',
      };
      if (d.type === 'expense') localStorage.setItem(LAST_ACCOUNT_KEY, rec.fromAccountId);
      commit([opUpsert('transactions', rec)], `${isNew ? 'Add' : 'Edit'} ${rec.type} ${money(amount)}${rec.description ? ` (${rec.description})` : ''}`);
      toast(isNew ? `${cap(rec.type)} added` : 'Transaction saved', 'success');
    },
    onDelete: existing ? () => deleteTxn(existing.id) : null,
  });
}

function deleteTxn(id) {
  const t = db.transactions.find((x) => x.id === id);
  if (!t) return;
  if (!confirm(`Delete this ${t.type} of ${money(t.amount)}${t.description ? ` (${t.description})` : ''}? Balances will be recalculated.`)) return false;
  commit([opDelete('transactions', id)], `Delete ${t.type} ${money(t.amount)}`);
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
function openAccountForm(existing, presetType = 'bank') {
  const isNew = !existing;
  const a = existing ? { ...existing } : { type: presetType, openingDate: todayStr(), subtype: '' };
  const typeOpts = Object.entries(ACCOUNT_TYPES).map(([k, v]) => [k, v.single]);
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
    ${showFor('investment', twoCol(field('Kind', select('subtype', INVESTMENT_KINDS, a.subtype)), field('Platform or institution', input('institution', a.institution, 'placeholder="e.g. Zerodha, SBI"'))) +
      twoCol(field('Interest rate % (optional)', input('interestRate', a.interestRate, 'type="number" step="0.01" min="0"'), 'For FDs, RDs, PPF and bonds.'),
        field('Maturity date (optional)', input('maturityDate', a.maturityDate, 'type="date"'))))}
    ${showFor('cash bank', field('Balance', moneyInput('openingBalance', a.type !== 'credit_card' && existing ? a.openingBalance : '', 'placeholder="0"'), 'The balance on the date below.'))}
    ${showFor('investment', field('Current value', moneyInput('openingBalance', a.type === 'investment' && existing ? a.openingBalance : '', 'placeholder="0"'), 'The value on the date below. Use "Update value" later as markets move.'))}
    ${field('Balance as on', input('openingDate', a.openingDate || todayStr(), 'type="date" required'), 'Transactions dated before this day do not change the balance, because it already includes them.')}
    ${field('Notes (optional)', textarea('notes', a.notes, 'rows="2"'))}
    ${isNew ? '' : checkbox('archived', a.archived, 'Archive this account', 'Hides it from pickers. Its balance still counts in net worth.')}`;

  openModal({
    title: isNew ? 'Add account' : `Edit ${a.name}`,
    body,
    submitLabel: isNew ? 'Add account' : 'Save changes',
    onOpen: (form) => bindShowHide(form, 'type'),
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
        notes: d.notes || '',
        archived: !!d.archived,
      };
      commit([opUpsert('accounts', rec)], `${isNew ? 'Add' : 'Edit'} account ${rec.name}`);
      toast(isNew ? 'Account added' : 'Account saved', 'success');
    },
    onDelete: existing ? () => deleteAccount(existing) : null,
  });
}

function deleteAccount(a) {
  const used = db.transactions.filter((t) => t.fromAccountId === a.id || t.toAccountId === a.id).length
    + db.emis.filter((e) => e.accountId === a.id).length + db.subscriptions.filter((s) => s.accountId === a.id).length;
  if (used) {
    alert(`${a.name} is used by ${used} transaction(s), EMI(s) or subscription(s), so it can't be deleted without breaking your history.\n\nTick "Archive this account" instead to hide it.`);
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
    body: `<p class="callout">Kosh shows the ${what} as <b class="num">${money(current)}</b>. Enter the real figure from your ${isInv ? 'statement or app' : 'bank app or statement'}. The difference is saved as a balance update, which doesn't count as income or spending.</p>
      ${twoCol(field(`Actual ${what}`, moneyInput('value', '', 'required placeholder="0"')), field('As on', input('date', todayStr(), `type="date" required min="${a.openingDate || ''}"`)))}
      ${field('Note (optional)', input('description', '', `placeholder="${isInv ? 'e.g. NAV update' : 'e.g. Bank charges, interest credited'}"`))}`,
    submitLabel: 'Update',
    onSubmit: (d) => {
      const target = isCard ? -num(d.value) : num(d.value);
      const diff = round2(target - bal);
      if (diff === 0) { toast(`The ${what} already matches.`); return; }
      const rec = {
        id: uid('txn'), date: d.date, type: 'adjustment', amount: Math.abs(diff),
        category: isInv ? 'Value change' : 'Balance correction',
        description: d.description || (isInv ? 'Value update' : 'Balance correction'),
        fromAccountId: diff < 0 ? a.id : '', toAccountId: diff > 0 ? a.id : '',
        relatedType: '', relatedId: '', notes: '',
      };
      commit([opUpsert('transactions', rec)], `Update ${what} of ${a.name}`);
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
      field('EMIs already paid', input('paidInstallments', e.paidInstallments ?? 0, 'type="number" min="0"'), 'For loans that started before you began using Kosh.'))}
    <div id="emiPreview" class="callout" aria-live="polite"></div>
    ${checkbox('autoLog', e.autoLog, 'Record each EMI automatically on its due date', 'Kosh adds the expense when you open the app on or after the due date.')}
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
  const s = existing ? { ...existing } : { frequency: 'monthly', nextRenewal: todayStr(), active: true, category: 'Subscriptions', autoLog: false };
  const cats = uniq([...db.settings.expenseCategories, s.category]);
  const body = `
    ${field('Name', input('name', s.name, 'required maxlength="80" placeholder="e.g. Netflix, Gym, Google One"'))}
    ${twoCol(field('Amount', moneyInput('amount', s.amount, 'required min="0.01"')), field('Billing frequency', select('frequency', Object.entries(FREQUENCIES).map(([k, v]) => [k, v.label]), s.frequency)))}
    ${twoCol(field('Next renewal', input('nextRenewal', s.nextRenewal, 'type="date" required')), field('Category', select('category', cats, s.category)))}
    ${field('Charged to', accountSelect('accountId', s.accountId || firstAccountOf(['credit_card', 'bank'])))}
    ${checkbox('autoLog', s.autoLog, 'Record each renewal automatically', 'Kosh adds the expense when you open the app on or after the renewal date.')}
    ${isNew ? '' : checkbox('active', s.active, 'Active', 'Untick to pause without deleting.')}
    ${field('Notes (optional)', textarea('notes', s.notes, 'rows="2"'))}`;
  openModal({
    title: isNew ? 'Add subscription' : `Edit ${s.name}`,
    body,
    submitLabel: isNew ? 'Add subscription' : 'Save changes',
    onSubmit: (d) => {
      const rec = {
        ...(existing || {}), id: existing?.id || uid('sub'),
        name: d.name, amount: round2(num(d.amount)), frequency: d.frequency, nextRenewal: d.nextRenewal,
        category: d.category, accountId: d.accountId, active: isNew ? true : !!d.active,
        autoLog: !!d.autoLog, notes: d.notes || '',
      };
      commit([opUpsert('subscriptions', rec)], `${isNew ? 'Add' : 'Edit'} subscription ${rec.name}`);
      toast(isNew ? 'Subscription added' : 'Subscription saved', 'success');
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
    title: `Record payment for ${s.name}`,
    body: `${twoCol(field('Amount', moneyInput('amount', txn.amount, 'required min="0.01"')), field('Date', input('date', txn.date, 'type="date" required')))}
      ${field('Paid from', accountSelect('accountId', s.accountId))}
      <p class="hint">The next renewal moves to ${fmtDate(advanceDate(s.nextRenewal || todayStr(), s.frequency))}.</p>`,
    submitLabel: 'Record payment',
    onSubmit: (d) => {
      commit([
        opUpsert('transactions', { ...txn, amount: round2(num(d.amount)), date: d.date, fromAccountId: d.accountId }),
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
   --------------------------------------------------------------------- */
function exportTables() {
  const accounts = db.accounts.map((a) => {
    const card = a.type === 'credit_card' ? cardMetrics(a) : null;
    return {
      account_id: a.id, name: a.name, type: a.type, subtype: a.subtype || '', institution: a.institution || '', last4: a.last4 || '',
      opening_balance: num(a.openingBalance), opening_date: a.openingDate || '', current_balance: M.balances.get(a.id) || 0,
      outstanding: card ? card.outstanding : '', credit_limit: card ? card.limit : '', emi_blocked: card ? card.blocked : '',
      available_limit: card ? card.available : '', statement_day: a.statementDay ?? '', due_day: a.dueDay ?? '',
      interest_rate: a.interestRate ?? '', maturity_date: a.maturityDate || '', archived: !!a.archived, notes: a.notes || '',
      created_at: a.createdAt || '', updated_at: a.updatedAt || '',
    };
  });
  const signed = (t) => (t.type === 'income' ? num(t.amount) : t.type === 'expense' ? -num(t.amount)
    : t.type === 'adjustment' ? (t.toAccountId ? num(t.amount) : -num(t.amount)) : 0);
  const txns = sortTxns(db.transactions).reverse();
  const transactions = txns.map((t) => ({
    transaction_id: t.id, date: t.date, year: (t.date || '').slice(0, 4), month: (t.date || '').slice(0, 7),
    type: t.type, category: t.category || '', description: t.description || '', amount: num(t.amount), signed_amount: signed(t),
    from_account_id: t.fromAccountId || '', from_account_name: accountName(t.fromAccountId),
    to_account_id: t.toAccountId || '', to_account_name: accountName(t.toAccountId),
    related_type: t.relatedType || '', related_id: t.relatedId || '', notes: t.notes || '',
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
  return { accounts, transactions, ledger, emis, emi_schedule, subscriptions, budgets, categories };
}

/* Column headers, so even empty tables export with the right columns. */
const TABLE_COLUMNS = {
  accounts: ['account_id', 'name', 'type', 'subtype', 'institution', 'last4', 'opening_balance', 'opening_date', 'current_balance', 'outstanding', 'credit_limit', 'emi_blocked', 'available_limit', 'statement_day', 'due_day', 'interest_rate', 'maturity_date', 'archived', 'notes', 'created_at', 'updated_at'],
  transactions: ['transaction_id', 'date', 'year', 'month', 'type', 'category', 'description', 'amount', 'signed_amount', 'from_account_id', 'from_account_name', 'to_account_id', 'to_account_name', 'related_type', 'related_id', 'notes', 'created_at', 'updated_at'],
  ledger: ['entry_id', 'date', 'account_id', 'account_name', 'account_type', 'transaction_id', 'type', 'category', 'description', 'amount', 'affects_balance'],
  emis: ['emi_id', 'name', 'kind', 'loan_type', 'lender', 'account_id', 'account_name', 'principal', 'annual_rate', 'tenure_months', 'start_date', 'emi_amount', 'installments_paid', 'installments_left', 'principal_remaining', 'total_interest', 'interest_remaining', 'next_due_date', 'end_date', 'status', 'auto_record', 'notes', 'created_at', 'updated_at'],
  emi_schedule: ['emi_id', 'emi_name', 'installment', 'due_date', 'emi', 'principal', 'interest', 'balance_after', 'paid'],
  subscriptions: ['subscription_id', 'name', 'amount', 'frequency', 'monthly_equivalent', 'yearly_equivalent', 'next_renewal', 'account_id', 'account_name', 'category', 'active', 'auto_record', 'notes', 'created_at', 'updated_at'],
  budgets: ['budget_id', 'category', 'monthly_limit', 'created_at', 'updated_at'],
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
    'Kosh export', `Created ${new Date().toString()}`, '',
    'All CSV files are UTF-8, comma separated, one header row, dates as YYYY-MM-DD.',
    'Relationships (for Power BI model view):',
    '  transactions.from_account_id / to_account_id -> accounts.account_id',
    '  ledger.account_id -> accounts.account_id   (SUM of amount where affects_balance = TRUE gives the balance)',
    '  emis.account_id -> accounts.account_id',
    '  emi_schedule.emi_id -> emis.emi_id',
    '  subscriptions.account_id -> accounts.account_id',
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
    toast('That file does not look like a Kosh backup.', 'error'); return;
  }
  const d = normalizeDB(data);
  if (!confirm(`Replace ALL current data with this backup?\n\n${d.accounts.length} accounts, ${d.transactions.length} transactions, ${d.emis.length} EMIs, ${d.subscriptions.length} subscriptions.\n\nYour current data will be overwritten${isConfigured() ? ' on GitHub too (older versions stay in the repository history)' : ''}.`)) return;
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
        <p class="text-sm text-ink-2 mb-4 max-w-prose">Load a JSON file downloaded from Kosh. It replaces everything currently in the app.</p>
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
        <p class="text-sm text-ink-2 mt-1">Kosh saves your data as a JSON file in a GitHub repository you own. Use a <b>private</b> repository for it.</p>
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
    <section class="space-y-4">
      <h3 class="font-semibold">Preferences</h3>
      ${field('Currency', select('currency', Object.keys(CURRENCIES), s.currency))}
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
          ? `Remove all Kosh data from this browser?${pending.length ? `\n\n${pending.length} change(s) have NOT reached GitHub yet and will be lost.` : ''}\n\nThe copy on GitHub stays; it will download again next time you connect.`
          : 'Remove all Kosh data from this browser?\n\nYou are not connected to GitHub, so this deletes your data permanently. Download a backup first if unsure.';
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
        currency: d.currency,
        expenseCategories: splitLines(d.expenseCategories),
        incomeCategories: splitLines(d.incomeCategories),
      };
      if (!newSettings.expenseCategories.length) newSettings.expenseCategories = clone(DEFAULT_SETTINGS.expenseCategories);
      if (!newSettings.incomeCategories.length) newSettings.incomeCategories = clone(DEFAULT_SETTINGS.incomeCategories);
      if (JSON.stringify(newSettings) !== JSON.stringify({ currency: db.settings.currency, expenseCategories: db.settings.expenseCategories, incomeCategories: db.settings.incomeCategories })) {
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
  'add-txn': (d) => openTxnForm(null, { type: d.type || 'expense' }),
  'edit-txn': (d) => openTxnForm(db.transactions.find((t) => t.id === d.id)),
  'delete-txn': (d) => deleteTxn(d.id),
  'txn-more': () => { txFilter.limit += 100; $('#txnResults').innerHTML = txnResults(); },
  'add-account': (d) => openAccountForm(null, d.type),
  'edit-account': (d) => openAccountForm(accountById(d.id)),
  'adjust-balance': (d) => openAdjust(accountById(d.id)),
  'pay-card': (d) => payCard(d.id),
  'add-emi': () => openEmiForm(null),
  'edit-emi': (d) => openEmiForm(db.emis.find((e) => e.id === d.id)),
  'pay-emi': (d) => payEmi(d.id),
  'emi-schedule': (d) => showSchedule(d.id),
  'add-sub': () => openSubForm(null),
  'edit-sub': (d) => openSubForm(db.subscriptions.find((s) => s.id === d.id)),
  'pay-sub': (d) => paySub(d.id),
  'toggle-sub': (d) => toggleSub(d.id),
  'add-budget': (d) => openBudgetForm(null, d.category),
  'edit-budget': (d) => openBudgetForm(db.budgets.find((b) => b.id === d.id)),
  'export-zip': () => exportZip(),
  'export-json': () => exportJSON(),
  'export-one': (d) => exportOne(d.table),
  'import-json': () => $('#importFile').click(),
};

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function init() {
  bindModal();

  // One click handler for every [data-action] button in the app.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !ACTIONS[el.dataset.action]) return;
    e.preventDefault();
    ACTIONS[el.dataset.action](el.dataset, el);
  });

  // Filters (month pickers, transaction filters).
  document.addEventListener('change', (e) => {
    const f = e.target.dataset?.filter;
    if (!f || f === 'q') return;
    if (f === 'dashMonth') dashMonth = e.target.value;
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

  if (isConfigured()) runSync().then(processAutoPayments);
  else { setSyncStatus('local'); processAutoPayments(); }
}

document.addEventListener('DOMContentLoaded', init);
