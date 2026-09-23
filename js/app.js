/* gumdroprepo.com — single-page app.
 *
 * core.js  : every fetch (core.be.*), every template/clone render (core.pk / core.ux), validation (core.sv)
 *            and storage (core.cr). See CORE.md.
 * zzzap.io : auth + zen storage (ZZZAP.ZEN.md), forms via microFormat (ZZZAP.FORMS.md),
 *            contact email relay (ZZZAP.EMAIL.md), short links (ZZZAP.SHORTLINK.md).
 */
(() => {
  'use strict';

  if (typeof core === 'undefined') {
    document.getElementById('view').innerHTML =
      '<div class="page"><div class="center-msg"><i class="fa-solid fa-triangle-exclamation"></i>' +
      '<p>core.js failed to load, so the app cannot start.</p></div></div>';
    return;
  }

  /* ───────────────────────── settings ───────────────────────── */

  // The stored/submitted value is always the slug (key) — label/detail are display-only, spliced into the
  // rendered <select> client-side, since the Forms API's microFormat select widget has no way to give an
  // option its own display text (ZZZAP.FORMS.md §3.2 — value and shown text are always the same string).
  const TYPE_INFO = {
    doc: { label: 'Doc', detail: 'General documentation or reference material' },
    readme: { label: 'Readme', detail: 'A project overview or getting-started guide' },
    skill: { label: 'Skill', detail: 'A reusable Claude or agent skill definition' },
    agent: { label: 'Agent', detail: 'An agent or subagent persona/definition' },
    prompt: { label: 'Prompt', detail: 'A reusable prompt or prompt template' },
    rules: { label: 'Rules', detail: 'House rules, conventions or guidelines' },
    spec: { label: 'Spec', detail: 'A technical specification or design note' },
    other: { label: 'Other', detail: "Anything that doesn't fit the categories above" },
  };

  const SETTINGS = {
    group: 'gumdroprepo.com',             // zen group for every record
    viewDomainAs: 'gumdroprepo.com',      // sent on signIn + signUp
    api: 'https://zzzap.io',
    contactSubdomain: '5a8495eadf9463b113d69d049ff7ad16',
    contactTo: null, // relay recipient ("cc") — confirm this mailbox
    shortBaseUrl: 'https://0sp.in/', //'https://gumdroprepo.com/', // domain the short links are minted under
    types: Object.keys(TYPE_INFO),
  };
  // keep local dev data out of the real production collection
  if (['localhost', '127.0.0.1'].includes(location.hostname)) SETTINGS.group += '-sandbox';
  SETTINGS.mdBase = 'https://md.' + SETTINGS.viewDomainAs;
  SETTINGS.formsUrl = SETTINGS.api + '/Forms/dynamic';

  const PUBLIC_AUTH_CD_NAME = '85ad6f95-aed610e06a6db0612-fefa6ae';
  const SESSION_KEY = 'gdrSession';   // core.cr tier 3 (localStorage)
  const SHORT_KEY = 'gdrShort';
  const THEME_KEY = 'gdrTheme';
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;   // no leading "_" — core.js treats "/_" in a link as a route
  const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
  const RESERVED_NAMES = ['add', 'edit'];

  core.useDebugger = 0;
  core.useRouting = 0;   // this app owns the URL hash

  /* ───────────────────────── helpers ───────────────────────── */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // core.js injects with innerHTML and replaceAll(), so escape markup, braces and "$" (replacement patterns)
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '$': '&#36;', '{': '&#123;', '}': '&#125;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"'`${}]/g, (c) => ESC[c]);

  // characters safe to embed in a microFormat default (which zzzap renders into a value="" attribute)
  const safeDefault = (s) => String(s ?? '').replace(/[^\w.@+ -]/g, '').slice(0, 120);

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : core.hf.uuid());

  // A one-way, deterministic 12-char id for a user, derived from their email + server-assigned user id.
  // Client-side SHA-256 (not the undocumented Utilities/formatting/hash endpoint) so it's guaranteed
  // reproducible and needs no network round trip. It's not a secret — just a stable label for that user's
  // records, embedded in the public search index so "my gumdrops" can be found without trusting zenGet's
  // own auth-scoping to filter a group-wide fetch (unverified — see loadLibrary below).
  async function userHashOf(user, userId) {
    if (!crypto?.subtle) return String(userId || user || '').replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase() || 'anon';
    const bytes = new TextEncoder().encode(String(user).trim().toLowerCase() + '::' + userId);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  }
  const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const flatten = (obj) => Object.values(obj || {}).filter(Array.isArray).flat();
  const messagesOf = (d) => [...flatten(d?.messages), ...flatten(d?.errors), ...flatten(d?.response?.messages), ...flatten(d?.response?.errors)];
  const errMsg = (e) => (e && e.name === 'TypeError') ? 'Network error. Check your connection and try again.' : (e?.message || 'Something went wrong.');

  const store = {
    get(key) { try { return core.cr.getData(key, null, 3); } catch (e) { return undefined; } },
    set(key, val) { try { core.cr.setData(key, val, null, 3); } catch (e) { /* storage blocked */ } },
    del(key) { try { core.cr.delData(key, null, 3); } catch (e) { /* storage blocked */ } },
  };

  function maskUser(user) {
    const u = String(user || '').trim();
    const at = u.indexOf('@');
    if (at > 0) {
      const host = u.slice(at + 1);
      const dot = host.lastIndexOf('.');
      const name = dot > 0 ? host.slice(0, dot) : host;
      return `${u[0]}***@${name[0] || ''}***${dot > 0 ? host.slice(dot) : ''}`;
    }
    return (u.length > 2 ? u.slice(0, 2) : u.slice(0, 1)) + '***';
  }

  // zen records may come back flat, or with the payload under json / zzzap; accept all three
  function flat(rec) {
    if (!rec || typeof rec !== 'object') return null;
    let out = { ...rec };
    for (let pass = 0; pass < 2; pass++) {
      for (const key of ['json', 'zzzap']) {
        let inner = out[key];
        if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch (e) { inner = null; } }
        if (inner && typeof inner === 'object') out = { ...out, ...inner };
      }
    }
    return out;
  }

  function cmpVersion(a, b) {
    const pa = String(a).split('.');
    const pb = String(b).split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] ?? '', y = pb[i] ?? '';
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      const c = (nx && ny) ? (+x - +y) : x.localeCompare(y);
      if (c) return c;
    }
    return 0;
  }

  // zts (and, once the backend starts writing it, hitTs) comes back as "YYYY-MM-DD HH:MM:SS" (assumed UTC),
  // not a unix epoch — +rec.zts is always NaN.
  const parseZDate = (raw) => { const t = Date.parse(String(raw || '').replace(' ', 'T') + 'Z'); return isNaN(t) ? 0 : t; };
  const zTs = (rec) => parseZDate(rec?.zts);

  // hitCount/hitTs live only on the public gdrq- record (saveGumdrop), defaulting to 0/null until the backend
  // starts updating them on access.
  function hitsLabel(r) {
    const count = Number(r?.hitCount) || 0;
    if (!count) return 'No hits yet';
    const ts = parseZDate(r?.hitTs);
    return `${count} hit${count === 1 ? '' : 's'}` + (ts ? ` &middot; last ${new Date(ts).toLocaleDateString()}` : '');
  }

  function dateOf(rec) {
    const m = String(rec.version || '').match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const t = zTs(rec);
    if (t) return new Date(t).toISOString().slice(0, 10);
    return '—';
  }

  const mdUrlOf = (name, mdId) => `${SETTINGS.mdBase}/${encodeURIComponent(mdId)}/${encodeURIComponent(name)}`;

  // Toasts stack in #toastContainer. Text only: zzzap.io messages are server-supplied (ZZZAP.TOAST.md).
  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind === 'err' ? 'err' : 'ok');
    el.textContent = String(msg);
    const box = $('#toastContainer');
    box.appendChild(el);
    // a modal <dialog> lives in the browser's top layer, which z-index cannot beat; re-showing this popover
    // puts it on top of whatever is open
    try { box.hidePopover(); box.showPopover(); } catch (e) { /* no Popover API: falls back to plain fixed positioning */ }
    setTimeout(() => el.remove(), 5000);
  }

  // every zzzap.io response carries top-level messages / errors; show them all, success or not
  let serverToastAt = 0;
  function showResponseToasts(data) {
    if (!data || typeof data !== 'object') return;
    const oks = flatten(data.messages);
    const errs = flatten(data.errors);
    // messages are not only for successes: zzzap.io reports e.g. "User not found!" there, so a response that
    // says it failed (flat or nested envelope) gets its messages styled as errors too
    const failed = data.success === false || data.response?.success === false;
    oks.forEach((m) => toast(m, failed ? 'err' : 'ok'));
    errs.forEach((m) => toast(m, 'err'));
    if (oks.length || errs.length) serverToastAt = Date.now();
  }

  // an Error carrying the server's own text; `toasted` means the user already saw it as a toast
  function fail(data, fallback) {
    const e = new Error(messagesOf(data)[0] || fallback);
    e.toasted = flatten(data?.messages).length + flatten(data?.errors).length > 0;
    return e;
  }

  // our own success confirmation; skipped when the server just said something itself
  const notify = (msg) => { if (Date.now() - serverToastAt > 2000) toast(msg, 'ok'); };

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      core.hf.copy(text);
    }
  }

  /* ───────────────────────── state ───────────────────────── */

  const state = {
    session: null,     // { user, authCd, userId, userhash }
    library: [],       // the signed-in user's private gumdrop records (flat)
    groups: [],        // library grouped by name, newest first
    libLoaded: false,
    token: 0,          // navigation counter, used to drop stale async results
    current: null,     // record on the detail view
    draft: null,       // seed for the add form when Edit is used on a search result that is not the user's
  };

  /* ───────────────────────── zzzap.io API (via core.be) ───────────────────────── */

  /**
   * One helper fronts every zzzap.io endpoint (ZZZAP.ZEN.md): POST bodies are wrapped as { zzzap: … },
   * publicAuthCd rides the query string and is attached whenever a session is held (auth:false withholds it).
   * core.be.getData stores each response in the registry (a data-* attribute), so it is deleted right away.
   */
  async function zz(ref, path, { query = {}, body, auth = true } = {}) {
    const q = new URLSearchParams(query);
    if (auth && state.session?.authCd) q.set('publicAuthCd', state.session.authCd);
    const qs = q.toString();
    const url = `${SETTINGS.api}/${path}${qs ? '?' + qs : ''}`;
    const settings = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { zzzap: body } }
      : {};
    try {
      const d = await core.be.getData(ref, url, settings);
      showResponseToasts(d);
      return d;
    } finally {
      core.cr.delData(ref);
    }
  }

  async function encryptPassword(text) {
    const d = await zz('zzCode', 'Utilities/codes/zzzapIt', { body: { text } });
    if (!d?.success || typeof d.response !== 'string') throw fail(d, 'Could not secure the password.');
    return d.response;
  }

  async function signIn(user, pass) {
    const zc = await encryptPassword(pass);
    const d = await zz('zzSignIn', 'Auth/remote/signIn', {
      query: { viewDomainAs: SETTINGS.viewDomainAs }, body: { user, pass: zc }, auth: false,
    });
    const r = d?.response;
    if (!r?.success) throw fail(d, 'Sign in failed. Check your username and password.');
    const cd = r.entities?.user?.configs?.find((c) => c?.name === PUBLIC_AUTH_CD_NAME)?.zcd;
    if (!cd) throw new Error('Signed in, but no session code came back. Please try again.');
    const userId = r.entities.user.id;
    return { user, authCd: cd, userId, userhash: await userHashOf(user, userId) };
  }

  async function signUp(user, pass) {
    const zc = await encryptPassword(pass);
    const d = await zz('zzSignUp', 'Auth/remote/signUp', {
      query: { viewDomainAs: SETTINGS.viewDomainAs }, body: { user, pass: zc }, auth: false,
    });
    if (!d?.response?.success) throw fail(d, 'Sign up failed. That username may already be taken.');
    return signIn(user, pass);   // fresh password code; same viewDomainAs
  }

  async function startSession(session) {
    state.session = session;
    store.set(SESSION_KEY, session);
    state.libLoaded = false;
    renderAuth();
    startHeartbeat();
    try { await ensureLibrary(true); } catch (e) { toast(errMsg(e), 'err'); }
    route();
  }

  // Heartbeat (ZZZAP.LOGIN.md): sessions die silently, so poll whoAmI. Only an explicit "not live" answer ends
  // the session; a network blip or 5xx keeps it.
  const HEARTBEAT_MS = 5 * 60 * 1000;
  let heartbeat = null;
  const stopHeartbeat = () => { clearInterval(heartbeat); heartbeat = null; };
  function startHeartbeat() {
    stopHeartbeat();
    if (state.session) heartbeat = setInterval(checkSession, HEARTBEAT_MS);
  }

  async function checkSession() {
    if (!state.session) return;
    try {
      const d = await zz('zzWho', 'Admin/whoAmI');
      if (d && d.success === false && !d.error) sessionExpired();
    } catch (e) { /* keep the session */ }
  }

  function sessionExpired() {
    stopHeartbeat();
    clearCaches();
    state.session = null;
    state.library = [];
    state.groups = [];
    state.libLoaded = false;
    renderAuth();
    toast('Your session expired. Please log in again.', 'err');
    const needsAuth = location.hash.startsWith('#/gumdrops') && !/^#\/gumdrops\/add\/?$/.test(location.hash);
    route();   // an open add form re-renders with its signed-out notice
    if (needsAuth) openLogin();
  }

  function clearCaches() {
    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    store.del(SESSION_KEY);
    store.del(SHORT_KEY);
    for (const key of Object.keys(core.section.dataset)) delete core.section.dataset[key];   // core's data registry
  }

  async function logout() {
    try { await zz('zzSignOut', 'Auth/remote/signOut', { body: {} }); } catch (e) { /* still clear locally */ }
    stopHeartbeat();
    clearCaches();
    state.session = null;
    state.library = [];
    state.groups = [];
    state.libLoaded = false;
    renderAuth();
    notify('Logged out');
    if (location.hash === '#/' || !location.hash) route(); else location.hash = '#/';
  }

  /* ───────────────────────── library (the user's private gumdrops) ───────────────────────── */

  /**
   * Discovery: which gumdrops are mine. A group-only zenGet has no documented guarantee it filters to just this
   * session's records (Collections addresses by group+name, not "everything this user ever posted"), so instead
   * this searches by our userhash — every save names its private record gdrapp-{mdId}-{userhash} (saveGumdrop).
   * Confirmed against the real API: with publicAuthCd attached, zenSearch matches that name-embedded userhash
   * and returns the FULL private record directly (type, name, md, version, mdId, author) — not a masked stub,
   * and not something that then needs a separate per-record zenGet.
   */
  async function loadLibrary() {
    if (!state.session?.userhash) { state.library = []; state.groups = []; state.libLoaded = true; return; }
    const d = await zz('zzLibrarySearch', 'Collections/zenSearch', { query: { q: state.session.userhash } });
    if (!d?.success) throw fail(d, 'Could not load your gumdrops.');
    const rows = Array.isArray(d.response) ? d.response : [];   // no hits comes back as a message string
    state.library = rows.map(flat).filter((r) => r && r.mdId && r.name && r.version && typeof r.md === 'string');
    state.groups = groupLibrary(state.library);
    state.libLoaded = true;
  }

  const ensureLibrary = async (force) => { if (force || !state.libLoaded) await loadLibrary(); };

  function groupLibrary(recs) {
    const map = new Map();
    for (const r of recs) {
      if (!map.has(r.name)) map.set(r.name, { name: r.name, versions: [] });
      map.get(r.name).versions.push(r);
    }
    const groups = [...map.values()];
    for (const g of groups) {
      g.versions.sort((a, b) => cmpVersion(b.version, a.version) || zTs(b) - zTs(a));
      g.latest = g.versions[0];
    }
    groups.sort((a, b) => cmpVersion(b.latest.version, a.latest.version) || a.name.localeCompare(b.name));
    return groups;
  }

  // YYYYMMDD.n, where n counts up from 0 — the first version of a name on a given day is .0, not .1
  function nextVersion(name) {
    const day = ymd();
    let n = -1;
    for (const r of state.library) {
      if (r.name !== name) continue;
      const m = String(r.version).match(new RegExp('^' + day + '\\.(\\d+)$'));
      if (m) n = Math.max(n, +m[1]);
    }
    return `${day}.${n + 1}`;
  }

  /**
   * Look a file up by its zen name. Signed-in saves are named gdrapp-{mdId}-{userhash} (see saveGumdrop);
   * signed-out saves have no userhash and are named gdrapp-{mdId}, and stay public — no code, no owner.
   * Auth-scoped, the lookup only comes back for its owner regardless of the exact name.
   */
  async function findMd(mdId, auth, name) {
    const zenName = auth && state.session?.userhash ? `gdrapp-${mdId}-${state.session.userhash}` : `gdrapp-${mdId}`;
    const d = await zz('zzGetMd', 'Collections/zenGet', { query: { group: SETTINGS.group, name: zenName, limit: 1 }, auth });
    const rec = (Array.isArray(d?.response) ? d.response : []).map(flat).find((r) => r && typeof r.md === 'string');
    return rec ? { ...rec, mdId, name: rec.name || name, version: rec.version || '' } : null;
  }

  function goto(hash) {
    closeModal();
    if (location.hash === hash) route(); else location.hash = hash;
  }

  /**
   * Global collision guard: the public gdrq-{name}-{version}-{mdId} index isn't scoped to one user (ZZZAP.ZEN.md),
   * so two different sessions can independently pick the same name + version. zenGet only does exact-name
   * lookups and the public record's zen name always ends in a fresh mdId, so the only way to ask "does this
   * name+version combination already exist, under any mdId" is to search the public index and filter the hits.
   * Best-effort: if the search itself fails, this returns null rather than blocking the save.
   */
  async function findCollision(name, version) {
    let d;
    try { d = await zz('zzDup', 'Collections/zenSearch', { query: { q: name } }); } catch (e) { return null; }   // sends publicAuthCd when logged in
    if (!d?.success) return null;
    const rows = (Array.isArray(d.response) ? d.response : []).map(flat);   // no hits comes back as a message string
    return rows.find((r) => r && r.name === name && r.version === version) || null;
  }

  /**
   * hitCount/hitTs live only on the public gdrq- record — the private file itself never carries them. A gumdrop
   * saved as private never had one posted, so there's nothing to find; that's an expected outcome, not an error.
   */
  async function findPublicStats(name, version, mdId) {
    const d = await zz('zzGetQ', 'Collections/zenGet', {
      query: { group: SETTINGS.group, name: `gdrq-${name}-${version}-${mdId}`, limit: 1 }, auth: false,
    });
    const rec = (Array.isArray(d?.response) ? d.response : []).map(flat).find((r) => r && r.mdId === mdId);
    return rec ? { hitCount: rec.hitCount ?? 0, hitTs: rec.hitTs ?? null } : null;
  }

  // Saves a gumdrop and returns the saved private record, exactly as zenPost handed it back — no re-fetch needed.
  async function saveGumdrop(v) {
    const priv = { type: v.type, name: v.name, md: v.md, version: v.version, mdId: v.mdId, author: v.author };
    const userhash = state.session?.userhash;

    // 1) the file itself — posted with publicAuthCd when signed in, named gdrapp-{mdId}-{userhash} so this
    // user's own records can be found again later (see loadLibrary/findMd). Anonymous saves have no userhash
    // and stay gdrapp-{mdId}.
    const a = await zz('zzPostMd', 'Collections/zenPost', {
      query: { group: SETTINGS.group, name: userhash ? `gdrapp-${v.mdId}-${userhash}` : `gdrapp-${v.mdId}` }, body: { json: priv },
    });
    if (!a?.success) throw fail(a, 'Could not save the gumdrop.');
    const saved = flat(a.response?.[0]) || priv;

    // 2) the searchable entry — skipped entirely for a private save. Still public when it IS posted (never
    // sends publicAuthCd): the point of the toggle is to opt out of the index, not to make this entry auth-scoped.
    if (!v.isPrivate) {
      // hitTs/hitCount start at null/0; the backend updates them on access, this app never writes to them again
      const pub = { author: maskUser(v.author), type: v.type, name: v.name, version: v.version, mdId: v.mdId, hitTs: null, hitCount: 0 };
      const b = await zz('zzPostQ', 'Collections/zenPost', {
        query: { group: SETTINGS.group, name: `gdrq-${v.name}-${v.version}-${v.mdId}` }, body: { json: pub }, auth: false,
      });
      if (!b?.success) {
        if (saved.zen) { try { await zz('zzDelMd', 'Collections/zenDelete', { query: { zen: saved.zen } }); } catch (e) { /* best effort */ } }
        throw fail(b, 'Could not add the gumdrop to search, so nothing was saved. Please try again.');
      }
    }
    return saved;
  }

  // Adds or replaces a record in the in-memory library (keyed by mdId) and regroups, without a re-fetch.
  function rememberRecord(rec) {
    const i = state.library.findIndex((r) => r.mdId === rec.mdId);
    if (i === -1) state.library.push(rec); else state.library[i] = rec;
    state.groups = groupLibrary(state.library);
    state.libLoaded = true;
  }

  async function makeShortlink(url) {
    if (core.sv.scrubSimple('temp', url, ['url']).errors.length) throw new Error('That URL is not valid.');
    // anonymous call; body-only, no Content-Type header (ZZZAP.SHORTLINK.md)
    const settings = { data: { zzzap: { alias: url, maxViewCount: null, expireDate: null, baseUrl: SETTINGS.shortBaseUrl, inline: null } } };
    let d;
    try {
      d = await core.be.getData('zzShort', `${SETTINGS.api}/Url/link`, settings);
      showResponseToasts(d);
    } finally {
      core.cr.delData('zzShort');
    }
    const short = d?.response?.short;
    if (!short) throw new Error('Could not create a short link right now.');
    return short;
  }

  /* ───────────────────────── rendering (core pockets) ───────────────────────── */

  let paintQueue = Promise.resolve();

  /**
   * Render a core template into `target`. Data is put in core's registry first so the clones find it
   * (a clone whose ref has no data would make core fetch the ref as a URL). Paints are serialised because
   * concurrent core.pk.soc() passes would clone rows twice.
   */
  function paint(target, tpl, data = {}) {
    paintQueue = paintQueue.catch(() => { }).then(async () => {
      for (const [ref, val] of Object.entries(data)) core.cr.setData(ref, val);
      core.ux.insertPocket(target, tpl, [], false);
      await core.pk.soc();   // eoc (hydrate/format) has run by the time this resolves
    });
    return paintQueue;
  }

  const showError = (msg) => {
    $('#view').innerHTML = `<div class="page"><div class="center-msg"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(msg)}</p></div></div>`;
  };

  function renderAuth() {
    const s = state.session;
    $('#auth').innerHTML = s
      ? `<span class="who" title="${esc(s.user)}"><i class="fa-solid fa-circle-user"></i><span>${esc(s.user)}</span></span>` +
        `<button class="btn" type="button" data-act="logout"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>`
      : `<button class="btn" type="button" data-act="login"><i class="fa-solid fa-right-to-bracket"></i> Login</button>` +
        `<button class="btn primary" type="button" data-act="signup"><i class="fa-solid fa-user-plus"></i> Sign up</button>`;
  }

  /* ───────────────────────── forms (zzzap Forms API + microFormat) ───────────────────────── */

  let formSeq = 0;
  const formHandlers = {};

  /**
   * Fetch a dynamic form for `lines` (microFormat, one field per line), cache it as a uniquely named core
   * template, render it into `target` and wire it. See ZZZAP.FORMS.md §2.2 and §7.
   */
  async function mountForm(target, key, lines, { submit = 'Submit', onSubmit, ready } = {}) {
    const host = $(target);
    if (!host) return null;
    host.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading form&hellip;</div>';

    const tpl = `form${key}${++formSeq}`;   // unique per open, so defaults are never served stale
    let html = '';
    try {
      html = await core.be.getTemplate(tpl, SETTINGS.formsUrl, { data: { zzzap: { microFormat: lines.join('\r') } } });
    } catch (e) { /* handled below */ }
    if (!/<form[\s>]/i.test(html || '')) {
      core.cr.delTemplate(tpl);
      host.innerHTML = '<div class="alert err">Could not load the form. Please close this and try again.</div>';
      return null;
    }
    if (!$(target)) { core.cr.delTemplate(tpl); return null; }   // navigated away meanwhile

    await paint(target, tpl);
    core.cr.delTemplate(tpl);

    const form = $('form', host);
    if (!form) return null;
    host.dataset.form = key;
    formHandlers[key] = onSubmit;

    form.noValidate = true;
    form.removeAttribute('action');   // submission is handled here, not by the form's own action
    form.removeAttribute('method');
    const btn = $('button[type=submit]', form);
    if (btn) { btn.className = 'btn primary action-submit'; btn.dataset.label = submit; btn.innerHTML = submit; }
    const autocomplete = { user: 'username', email: 'email', pass: key === 'login' ? 'current-password' : 'new-password', pass2: 'new-password' };
    for (const [name, value] of Object.entries(autocomplete)) $(`[name=${name}]`, form)?.setAttribute('autocomplete', value);
    if (ready) ready(form, host);
    return form;
  }

  document.addEventListener('submit', (e) => {
    const host = e.target.closest?.('[data-form]');
    if (!host) return;
    e.preventDefault();
    const handler = formHandlers[host.dataset.form];
    if (handler) handler(e.target, host);
  });

  /** Validate a rendered form with core.sv.scrub, using the data-scrubs the Forms API put on each field. */
  function readForm(form) {
    const arr = $$('input[name],select[name],textarea[name]', form).map((el) => {
      if (el.type === 'checkbox') return { name: el.name, value: el.checked ? '1' : '', scrubs: [], el };
      let value = String(el.value ?? '');
      if (el.type !== 'password') value = el.name === 'md' ? value.replace(/\s+$/, '') : value.trim();
      const scrubs = (el.dataset.scrubs || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (el.name === 'pass2') scrubs.push('match:pass');
      return { name: el.name, value, scrubs, el };
    });
    const res = core.sv.scrub(arr);
    for (const s of res.scrubs) fieldError(form, s.name, s.success ? '' : s.errors.join(' '));
    if (!res.success) {
      $('.is-invalid', form)?.focus();
      return null;
    }
    return Object.fromEntries(res.scrubs.map((s) => [s.name, s.value]));
  }

  function fieldError(form, name, msg) {
    const el = $(`[name=${name}]`, form);
    if (!el) return;
    el.classList.toggle('is-invalid', !!msg);
    const fb = el.closest('.input-group')?.querySelector('.invalid-feedback');
    if (fb) fb.textContent = msg;
  }

  const setMsg = (host, msg, kind = 'err') => {
    const box = $('.form-messages', host);
    if (box) box.innerHTML = msg ? `<div class="alert ${kind}">${msg}</div>` : '';
  };

  function setBusy(form, on) {
    const btn = $('button[type=submit]', form);
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on ? '<i class="fa-solid fa-spinner fa-spin"></i> Working&hellip;' : btn.dataset.label;
  }

  /* ───────────────────────── modal ───────────────────────── */

  const dlg = $('#modal');

  function openModal(title, wide = false) {
    $('#modalTitle').textContent = title;
    dlg.classList.toggle('wide', wide);
    $('#modalBody').innerHTML = '<div id="mForm"></div><div id="mOut"></div>';
    closeNav();
    if (!dlg.open) dlg.showModal();
  }
  const closeModal = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('click', (e) => { if (e.target === dlg) closeModal(); });   // backdrop click
  dlg.addEventListener('close', () => { $('#modalBody').innerHTML = ''; });

  const focusFirst = (form) => form?.querySelector('input:not([type=hidden]),textarea,select')?.focus();

  /* ── login ── */
  async function openLogin() {
    openModal('Log in');
    await mountForm('#mForm', 'login', [
      'Username (your email){{user}}>req|email|nohtml',
      'Password{{pass}}>req|min:8>>password',
    ], {
      submit: '<i class="fa-solid fa-right-to-bracket"></i> Log in',
      ready: (form) => focusFirst(form),
      onSubmit: async (form, host) => {
        const v = readForm(form);
        if (!v) return;
        setMsg(host, '');
        setBusy(form, true);
        try {
          const session = await signIn(v.user, v.pass);
          closeModal();
          notify('Logged in');
          await startSession(session);
        } catch (e) {
          if (!e.toasted) setMsg(host, esc(errMsg(e)));
          setBusy(form, false);
        }
      },
    });
    $('#mOut').innerHTML = '<p class="form-foot">New here? <button class="link" type="button" data-act="signup">Create an account</button></p>';
  }

  /* ── signup ── */
  async function openSignup() {
    openModal('Sign up');
    await mountForm('#mForm', 'signup', [
      'Username (your email){{user}}>req|email|nohtml',
      'Password{{pass}}>req|min:8>>password',
      'Confirm password{{pass2}}>req|min:8>>password',
    ], {
      submit: '<i class="fa-solid fa-user-plus"></i> Create account',
      ready: (form) => focusFirst(form),
      onSubmit: async (form, host) => {
        const v = readForm(form);
        if (!v) return;
        setMsg(host, '');
        setBusy(form, true);
        try {
          const session = await signUp(v.user, v.pass);
          closeModal();
          notify('Welcome to gumdroprepo!');
          await startSession(session);
        } catch (e) {
          if (!e.toasted) setMsg(host, esc(errMsg(e)));
          setBusy(form, false);
        }
      },
    });
    $('#mOut').innerHTML = '<p class="form-foot">Already have an account? <button class="link" type="button" data-act="login">Log in</button></p>';
  }

  /* ── contact ── */
  async function openContact() {
    openModal('Contact us');
    const email = state.session?.user;
    await mountForm('#mForm', 'contact', [
      'Your name{{name}}>req|max:80|nohtml',
      'Your email{{email}}>req|email|nohtml' + (email ? `>{{${safeDefault(email)}}}` : ''),
      'Subject{{subject}}>req|max:120|nohtml',
      'Message{{message}}>req|min:10|max:4000|nohtml>>textarea',
    ], {
      submit: '<i class="fa-solid fa-paper-plane"></i> Send message',
      ready: (form) => focusFirst(form),
      onSubmit: async (form, host) => {
        const v = readForm(form);
        if (!v) return;
        setMsg(host, '');
        setBusy(form, true);
        try {
          await sendContact(v);
          closeModal();
          notify('Message sent. Thank you!');
        } catch (e) {
          if (!e.toasted) setMsg(host, esc(errMsg(e)));
          setBusy(form, false);
        }
      },
    });
  }

  // email relay (ZZZAP.EMAIL.md): its own host; recipient is "cc"; publicAuthCd goes in the body
  async function sendContact(v) {
    const body = {
      subject: `[gumdroprepo] ${v.subject}`,
      name: v.name,
      plain: `From: ${v.name} <${v.email}>\n\n${v.message}`,
      markup: `<p><b>From:</b> ${esc(v.name)} &lt;${esc(v.email)}&gt;</p><p>${esc(v.message).replace(/\n/g, '<br>')}</p>`,
      message: null,
      url: location.href,
      cc: SETTINGS.contactTo,
    };
    if (state.session?.authCd) body.publicAuthCd = state.session.authCd;
    let d;
    try {
      d = await core.be.getData('zzRelay', `https://${SETTINGS.contactSubdomain}.zzzap.io/Relay/send/sendgrid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { zzzap: body },
      });
      showResponseToasts(d);
    } finally {
      core.cr.delData('zzRelay');
    }
    if (!d?.success) throw fail(d, 'The message could not be sent. Please try again.');
  }

  /* ── search ── */
  async function openSearch() {
    openModal('Search gumdrops', true);
    await mountForm('#mForm', 'search', ['Search{{q}}>req|min:2|max:100|nohtml'], {
      submit: '<i class="fa-solid fa-magnifying-glass"></i> Search',
      ready: (form) => focusFirst(form),
      onSubmit: runSearch,
    });
  }

  async function runSearch(form, host) {
    const v = readForm(form);
    if (!v) return;
    const out = $('#mOut');
    setMsg(host, '');
    setBusy(form, true);
    try {
      // sends publicAuthCd when logged in — required for a search to surface the caller's own gdrapp- records
      const d = await zz('zzSearch', 'Collections/zenSearch', { query: { q: v.q } });
      if (!d?.success) throw fail(d, 'Search failed. Please try again.');
      const seen = new Set();
      const rows = (Array.isArray(d.response) ? d.response : [])   // no hits comes back as a message string
        .map(flat).filter((r) => r && r.mdId && r.name && r.version && !seen.has(r.mdId) && seen.add(r.mdId))
        .map((r) => ({
          name: esc(r.name), version: esc(r.version), type: esc(r.type || '—'), author: esc(r.author || '—'),
          mdId: esc(r.mdId), mdIdShort: esc(String(r.mdId).slice(0, 8)), mdUrl: esc(mdUrlOf(r.name, r.mdId)),
          hits: esc(hitsLabel(r)),
        }));
      if (!rows.length) {
        out.innerHTML = `<div class="empty"><i class="fa-regular fa-face-meh"></i><p>No gumdrops matched &ldquo;${esc(v.q)}&rdquo;.</p></div>`;
      } else {
        await paint('#mOut', 'tplSearchResults', { searchRows: rows });
        $('#mOut')?.insertAdjacentHTML('afterbegin', `<p class="hint">${rows.length} result${rows.length === 1 ? '' : 's'}</p>`);
      }
    } catch (e) {
      if (!e.toasted) setMsg(host, esc(errMsg(e)));
    }
    setBusy(form, false);
  }

  /* ───────────────────────── views / router ───────────────────────── */

  const routes = [
    [/^#?\/?$/, () => viewHome()],
    [/^#\/gumdrops\/?$/, () => viewList()],
    [/^#\/gumdrops\/add\/?$/, () => viewForm('add')],
    [/^#\/gumdrops\/([^/]+)\/([^/]+)\/edit\/?$/, (name, id) => viewForm('edit', name, id)],
    [/^#\/gumdrops\/([^/]+)\/([^/]+)\/?$/, (name, id) => viewDetail(name, id)],
    [/^#\/gumdrops\/([^/]+)\/?$/, (name) => viewHistory(name)],
  ];

  function route() {
    const token = ++state.token;
    closeMenu();
    closeNav();
    closeModal();
    const hash = location.hash || '#/';
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (!m) continue;
      let args;
      try { args = m.slice(1).map(decodeURIComponent); } catch (e) { break; }
      window.scrollTo(0, 0);
      return fn(...args).catch((e) => { if (token === state.token) showError(errMsg(e)); });
    }
    return viewNotFound();
  }

  const stale = (token) => token !== state.token;
  const setTitle = (t) => { document.title = t ? `${t} · gumdroprepo` : 'gumdroprepo — a home for markdown gumdrops'; };

  async function viewHome() {
    setTitle('');
    await paint('#view', 'tplHome');
    loadHomeGumdrops();   // secondary content — doesn't block the route or the hero
  }

  // The most recent public entries, across every gumdroprepo user — "gdrq-" is the shared prefix every public
  // record's zen name carries, so it matches the whole index; sort=desc orders newest first. Always public: the
  // homepage shows the same feed whether or not the viewer is signed in (still sends publicAuthCd when they are,
  // since every search call does now — it just doesn't change what this particular query matches).
  async function fetchPublicRecent() {
    const d = await zz('zzHomeRecent', 'Collections/zenSearch', { query: { q: 'gdrq-', sort: 'desc' } });
    if (!d?.success) return [];
    const seen = new Set();
    const hits = (Array.isArray(d.response) ? d.response : [])
      .map(flat).filter((r) => r && r.mdId && r.name && r.version && !seen.has(r.mdId) && seen.add(r.mdId));
    return hits.slice(0, 8).map((r) => ({
      name: esc(r.name), type: esc(r.type || '—'), version: esc(r.version), author: esc(r.author || '—'),
      mdId: esc(r.mdId), mdUrl: esc(mdUrlOf(r.name, r.mdId)), hits: esc(hitsLabel(r)),
    }));
  }

  async function loadHomeGumdrops() {
    const token = state.token;
    const body = $('#homeGumdropsBody');
    if (!body) return;   // navigated away before this ran
    try {
      const rows = await fetchPublicRecent();
      if (stale(token)) return;
      if (!rows.length) {
        body.innerHTML = '<div class="empty"><i class="fa-regular fa-compass"></i><p>No public gumdrops yet. <a href="#/gumdrops/add">Be the first to add one</a>.</p></div>';
        return;
      }
      await paint('#homeGumdropsBody', 'tplHomeGumdrops', { homeRows: rows });
    } catch (e) {
      if (!stale(token)) body.innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load gumdrops right now.</p></div>';
    }
  }

  async function viewNotFound() {
    setTitle('Not found');
    await paint('#view', 'tplNotFound');
  }

  // resolves to true when the signed-in library is ready, otherwise paints why not
  async function needLibrary(token) {
    if (!state.session) { setTitle('Log in'); await paint('#view', 'tplNeedLogin'); return false; }
    if (!state.libLoaded) {
      await paint('#view', 'tplLoading');
      await ensureLibrary();
    }
    return !stale(token);
  }

  async function viewList() {
    const token = state.token;
    if (!(await needLibrary(token))) return;
    setTitle('Your gumdrops');
    const rows = state.groups.map((g) => ({
      name: esc(g.name), nameUrl: encodeURIComponent(g.name), mdId: esc(g.latest.mdId), type: esc(g.latest.type || '—'),
      latest: esc(g.latest.version), countLabel: `${g.versions.length} version${g.versions.length === 1 ? '' : 's'}`,
      updated: esc(dateOf(g.latest)), author: esc(g.latest.author || '—'), mdUrl: esc(mdUrlOf(g.latest.name, g.latest.mdId)),
    }));
    await paint('#view', 'tplList', { gumdropRows: rows });
    $('#listEmpty').hidden = rows.length > 0;
  }

  async function viewHistory(name) {
    const token = state.token;
    if (!(await needLibrary(token))) return;
    const g = state.groups.find((x) => x.name === name);
    if (!g) return viewNotFound();
    setTitle(name);
    const nameUrl = encodeURIComponent(name);
    const count = `${g.versions.length} version${g.versions.length === 1 ? '' : 's'}`;
    await paint('#view', 'tplHistory', {
      historyHead: [{ name: esc(name), nameUrl, type: esc(g.latest.type || '—'), mdId: esc(g.latest.mdId), countLabel: count }],
      historyRows: g.versions.map((v, i) => ({
        version: esc(v.version), href: `#/gumdrops/${nameUrl}/${encodeURIComponent(v.mdId)}`, updated: esc(dateOf(v)),
        author: esc(v.author || '—'), mdIdShort: esc(String(v.mdId).slice(0, 8)),
        latestBadge: i === 0 ? '<span class="badge ok">latest</span>' : '',
      })),
    });
  }

  async function viewDetail(name, mdId) {
    const token = state.token;
    if (!(await needLibrary(token))) return;
    const rec = state.library.find((r) => r.name === name && r.mdId === mdId);
    if (!rec) return viewNotFound();
    state.current = rec;
    setTitle(`${name} v${rec.version}`);
    const url = mdUrlOf(rec.name, rec.mdId);
    await paint('#view', 'tplDetail', {
      detailRows: [{
        name: esc(rec.name), nameUrl: encodeURIComponent(rec.name), type: esc(rec.type || '—'), version: esc(rec.version),
        author: esc(rec.author || '—'), updated: esc(dateOf(rec)), mdId: esc(rec.mdId), mdUrl: esc(url),
      }],
    });
    $('#mdText').textContent = rec.md;   // the file body is never run through innerHTML
    const short = (store.get(SHORT_KEY) || {})[rec.mdId];
    if (short) { $('#shortUrl').value = short; $('#shortBtn').innerHTML = '<i class="fa-regular fa-copy"></i> Copy'; }
    loadDetailStats(token, rec);   // secondary — doesn't block the main render
  }

  // Fills in the public hit-tracking stats after the main detail render, since they live on a separate record
  // (findPublicStats) that a private gumdrop never had posted in the first place.
  async function loadDetailStats(token, rec) {
    const el = $('#detailHits');
    if (!el) return;
    try {
      const stats = await findPublicStats(rec.name, rec.version, rec.mdId);
      if (stale(token) || !$('#detailHits')) return;
      $('#detailHits').textContent = stats ? hitsLabel(stats) : 'Not tracked — kept private';
    } catch (e) {
      if (!stale(token) && $('#detailHits')) $('#detailHits').textContent = '—';
    }
  }

  function gumdropLines({ mdId, author, type, version }) {
    return [
      `{{mdId}}>>{{${mdId}}}>hidden`,
      `Author{{author}}>req|max:80|nohtml` + (author ? `>{{${safeDefault(author)}}}` : ''),
      `Type{{type}}>req>${SETTINGS.types.join('|')}{{${SETTINGS.types.includes(type) ? type : 'doc'}}}>select`,
      `Name{{name}}>req|max:64|nohtml`,
      `Markdown file{{md}}>req|max:200000>>textarea`,
      `Version{{version}}>req|max:32|nohtml>{{${safeDefault(version)}}}`,
    ];
  }

  // add + edit share one form; an edit is just an add that starts from an existing version
  async function viewForm(mode, name, mdId) {
    const token = state.token;
    let rec = null;
    if (mode === 'edit') {
      if (!state.session) { setTitle('Log in'); await paint('#view', 'tplNeedLogin'); return; }
      if (!state.libLoaded) { try { await ensureLibrary(); } catch (e) { /* the direct lookup below still works */ } }
      // the library first; otherwise ask for gdrapp-{mdId}-{userhash} directly (it only comes back if it is this user's)
      rec = state.library.find((r) => r.name === name && r.mdId === mdId) || await findMd(mdId, true, name);
      if (stale(token)) return;
      if (!rec) return viewNotFound();
    }
    const isEdit = mode === 'edit';
    const draft = isEdit ? null : state.draft;   // set by "Edit" on a search result that is not the user's
    state.draft = null;
    if (!isEdit && state.session && !state.libLoaded) {   // version numbering + duplicate checks need the library
      try { await ensureLibrary(); } catch (e) { /* not fatal for adding */ }
    }
    setTitle(isEdit ? `Edit ${name}` : 'Add a gumdrop');
    const version = isEdit ? nextVersion(name) : draft ? nextVersion(draft.name) : `${ymd()}.0`;
    const note = isEdit
      // the version bump, and which version it's copied from, called out explicitly rather than left implicit
      ? `Editing <b>${esc(name)}</b> v${esc(rec.version)}. Saving will create <b>v${esc(version)}</b> with its own id &mdash; v${esc(rec.version)} stays in the history unchanged.`
      : draft
        ? `<b>${esc(draft.name)}</b> v${esc(draft.from)} is not in your library, so this starts a new gumdrop of your own` +
          (draft.md ? ' from its public file.' : ' (its file is not public, so start the markdown fresh).')
      : state.session
        ? 'Saved to your library. Its name, type and version go in the public search index; the file itself is only retrievable by its id.'
        : 'You are not signed in. This gumdrop is saved without an owner, so it will not show up in a library and anyone with its link can open it. Log in or sign up to keep your gumdrops together.';
    await paint('#view', 'tplForm', {
      formHead: [{
        crumb: isEdit ? `Edit ${esc(name)}` : 'Add', icon: isEdit ? 'fa-pen' : 'fa-plus',
        title: isEdit ? `Edit ${esc(name)}` : 'Add a gumdrop', note,
      }],
    });
    if (stale(token)) return;

    // signed in, the author is always the session's own user — not editable, and not the original author on a draft
    await mountForm('#gumdropForm', 'gumdrop', gumdropLines({
      mdId: uuid(), author: state.session?.user || rec?.author || '', type: rec?.type || draft?.type || 'doc', version,
    }), {
      submit: '<i class="fa-solid fa-floppy-disk"></i> Save gumdrop',
      onSubmit: submitGumdrop,
      ready: (form) => {
        const nameEl = $('[name=name]', form);
        const authorEl = $('[name=author]', form);
        const typeEl = $('[name=type]', form);
        const mdEl = $('[name=md]', form);
        const verEl = $('[name=version]', form);
        mdEl.rows = 16;
        mdEl.placeholder = '# My gumdrop\n\nWrite or paste markdown here…';
        // the option's value (what actually gets submitted) is left untouched — only its displayed text and
        // the hint below the field change, since the Forms API select has no separate label per option
        for (const opt of typeEl.options) {
          const info = TYPE_INFO[opt.value];
          if (!info) continue;
          opt.textContent = `${info.label} — ${info.detail}`;
          opt.title = info.detail;
        }
        typeEl.closest('.col-12')?.insertAdjacentHTML('afterend', '<div class="col-12"><p class="hint" id="typeHint"></p></div>');
        const typeHint = $('#typeHint', form);
        const showTypeHint = () => { typeHint.textContent = TYPE_INFO[typeEl.value]?.detail || ''; };
        typeEl.addEventListener('change', showTypeHint);
        showTypeHint();
        if (state.session) {
          authorEl.value = state.session.user;
          authorEl.readOnly = true;
          authorEl.title = 'Signed in as ' + state.session.user;
        }
        if (isEdit) {
          nameEl.value = rec.name;
          nameEl.readOnly = true;   // keeps every version under one history
          mdEl.value = rec.md;
        } else if (draft) {
          nameEl.value = draft.name;
          mdEl.value = draft.md;
        }
        // version defaults to YYYYMMDD.n; follow the name until the user edits it themselves
        verEl.addEventListener('input', () => { verEl.dataset.touched = '1'; });
        if (!isEdit) nameEl.addEventListener('input', () => { if (!verEl.dataset.touched) verEl.value = nextVersion(nameEl.value.trim()); });
        mdEl.closest('.col-12')?.insertAdjacentHTML('beforeend',
          '<div class="form-tools"><span class="hint">Markdown only &mdash; it is stored and shown as plain text.</span>' +
          '<button class="btn sm" type="button" data-act="pickfile"><i class="fa-solid fa-file-import"></i> Load from a file</button>' +
          '<input type="file" id="mdFile" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden></div>');
        // client-side only — simply skips the public gdrq- post below, so it's independent of sign-in state
        // and (deliberately) doesn't try to remember a past version's own choice
        verEl.closest('.col-12')?.insertAdjacentHTML('afterend',
          '<div class="col-12 mt-2 form-check">' +
          '<label class="form-check-label"><input type="checkbox" class="form-check-input" name="isPrivate">' +
          ' Keep this version private &mdash; don&rsquo;t add it to the public search index</label></div>');
        (isEdit || draft ? mdEl : nameEl).focus();
      },
    });
  }

  async function submitGumdrop(form, host) {
    const v = readForm(form);
    if (!v) return;
    let bad = false;
    if (!NAME_RE.test(v.name) || RESERVED_NAMES.includes(v.name.toLowerCase())) {
      fieldError(form, 'name', 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number (not "add" or "edit").');
      bad = true;
    }
    if (!VERSION_RE.test(v.version)) {
      fieldError(form, 'version', 'Use letters, numbers, dots, dashes or underscores, e.g. ' + ymd() + '.0');
      bad = true;
    }
    if (!bad && state.library.some((r) => r.name === v.name && r.version === v.version)) {
      fieldError(form, 'version', 'That version already exists for this gumdrop. Pick a new one.');
      bad = true;
    }
    if (bad) return;

    setMsg(host, '');
    setBusy(form, true);
    try {
      // the check above only covers this session's own library; names aren't scoped per user, so also check
      // the public index for the same name + version under a different mdId (a different author, or another tab).
      // Skipped for a private save — it never touches that index, so there's nothing there to collide with.
      const dupe = v.isPrivate ? null : await findCollision(v.name, v.version);
      if (dupe) {
        fieldError(form, 'version', `v${v.version} of "${v.name}" already exists` + (dupe.author ? ` (by ${dupe.author})` : '') + '. Choose a different version.');
        setBusy(form, false);
        return;
      }
      const saved = await saveGumdrop(v);
      if (state.session) {
        rememberRecord(saved);
        notify(v.isPrivate ? 'Gumdrop saved privately' : 'Gumdrop saved');
        location.hash = `#/gumdrops/${encodeURIComponent(saved.name)}/${encodeURIComponent(saved.mdId)}`;
      } else {
        const url = mdUrlOf(v.name, v.mdId);
        host.innerHTML = `<div class="alert ok"><i class="fa-solid fa-circle-check"></i> Saved <b>${esc(v.name)}</b> v${esc(v.version)}.<br>` +
          `Its link: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` +
          (v.isPrivate ? '<br><span class="hint">Kept private &mdash; not added to the public search index.</span>' : '') + '</div>' +
          '<a class="btn" href="#/gumdrops/add"><i class="fa-solid fa-plus"></i> Add another</a>';
        delete host.dataset.form;
      }
    } catch (e) {
      if (!e.toasted) setMsg(host, esc(errMsg(e)));
      setBusy(form, false);
    }
  }

  /* ───────────────────────── chrome: menus, theme, events ───────────────────────── */

  function closeMenu() {
    const dd = $('#ddGumdrops');
    dd.classList.remove('open');
    $('[data-act=toggleMenu]', dd).setAttribute('aria-expanded', 'false');
  }
  function closeNav() {
    $('#nav').classList.remove('open');
    $('[data-act=toggleNav]').setAttribute('aria-expanded', 'false');
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
  }

  const actions = {
    login: openLogin,
    signup: openSignup,
    logout,
    search: openSearch,
    contact: openContact,
    close: closeModal,
    theme: () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'),
    toggleNav: (el) => { const open = $('#nav').classList.toggle('open'); el.setAttribute('aria-expanded', String(open)); },
    toggleMenu: (el) => { const open = el.parentElement.classList.toggle('open'); el.setAttribute('aria-expanded', String(open)); },
    pickfile: () => $('#mdFile')?.click(),
    // search result → short link. Anyone can share any result; the call is anonymous.
    async searchShare(el) {
      const { mdid, name } = el.dataset;
      el.disabled = true;
      try {
        const cache = store.get(SHORT_KEY) || {};
        if (!cache[mdid]) {
          cache[mdid] = await makeShortlink(mdUrlOf(name, mdid));
          store.set(SHORT_KEY, cache);
        }
        await copyText(cache[mdid]);
        toast(`Short link copied: ${cache[mdid]}`);
      } catch (e) {
        toast(errMsg(e), 'err');
      }
      el.disabled = false;
    },
    // search result → edit. If gdrapp-{mdId}-{userhash} comes back for this user it is theirs and opens for editing;
    // otherwise they start a new record of their own.
    async searchEdit(el) {
      const { mdid, name, type, version } = el.dataset;
      el.disabled = true;
      try {
        if (state.session && await findMd(mdid, true, name)) {
          goto(`#/gumdrops/${encodeURIComponent(name)}/${encodeURIComponent(mdid)}/edit`);
          return;
        }
        const pub = await findMd(mdid, false, name);   // posted while signed out: public, so its file can seed the copy
        state.draft = { name, type, from: version, md: pub?.md || '' };
        toast('That gumdrop is not in your library, so this starts a new one.');
        goto('#/gumdrops/add');
      } catch (e) {
        toast(errMsg(e), 'err');
      }
      el.disabled = false;
    },
    async copy(el) {
      const src = $(el.dataset.from);
      if (!src) return;
      await copyText(src.value ?? src.textContent);
      toast('Copied to clipboard');
    },
    download() {
      const r = state.current;
      if (!r) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.md], { type: 'text/markdown' }));
      a.download = `${r.name}-${r.version}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async shortlink(el) {
      const r = state.current;
      if (!r) return;
      const cache = store.get(SHORT_KEY) || {};
      const input = $('#shortUrl');
      if (cache[r.mdId]) {
        await copyText(cache[r.mdId]);
        toast('Short link copied');
        return;
      }
      el.disabled = true;
      try {
        const short = await makeShortlink(mdUrlOf(r.name, r.mdId));
        cache[r.mdId] = short;
        store.set(SHORT_KEY, cache);
        input.value = short;
        el.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        await copyText(short);
        notify('Short link created and copied');
      } catch (e) {
        toast(errMsg(e), 'err');
      }
      el.disabled = false;
    },
  };

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!target.closest('.dd') || target.closest('.dd-menu')) closeMenu();   // outside click, or a menu item was picked
      const el = target.closest('[data-act]');
      if (!el) { if (target.closest('#nav a')) closeNav(); return; }
      const act = el.dataset.act;
      if (act !== 'toggleNav' && act !== 'toggleMenu' && el.closest('#nav')) closeNav();
      const fn = actions[act];
      if (fn) fn(el, e);
    });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeNav(); } });

    document.addEventListener('input', (e) => {
      if (e.target.id !== 'listFilter') return;
      const q = e.target.value.trim().toLowerCase();
      let shown = 0;
      for (const li of $$('#listItems .repo-item')) {
        const hit = !q || li.textContent.toLowerCase().includes(q);
        li.hidden = !hit;
        if (hit) shown++;
      }
      const empty = $('#listEmpty');
      $('p', empty).textContent = state.groups.length ? 'No gumdrops match your filter.' : 'Nothing here yet. Add your first gumdrop.';
      empty.hidden = shown > 0;
    });

    document.addEventListener('change', (e) => {
      if (e.target.id !== 'mdFile') return;
      const file = e.target.files?.[0];
      const mdEl = $('#gumdropForm [name=md]');
      if (!file || !mdEl) return;
      if (file.size > 500000) { toast('That file is too large (500 KB max).', 'err'); return; }
      file.text().then((text) => { mdEl.value = text; mdEl.focus(); });
    });

    window.addEventListener('hashchange', route);
  }

  /* ───────────────────────── boot ───────────────────────── */

  async function boot() {
    bindEvents();
    $('#year').textContent = new Date().getFullYear();
    state.session = store.get(SESSION_KEY) || null;
    // a userhash is now load-bearing for the library; a session stored before this existed just re-logs in
    if (state.session && (!state.session.authCd || !state.session.userhash)) state.session = null;
    renderAuth();
    route();
    if (state.session) { checkSession(); startHeartbeat(); }
  }

  // Start once core's own first render pass (which runs on idle) has finished, so the two never overlap.
  let started = false;
  const start = () => { if (!started) { started = true; boot(); } };
  core.ud.eoc = start;
  setTimeout(start, 3000);   // fallback if that pass never reports
})();
