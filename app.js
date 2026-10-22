(() => {
"use strict";

/* ================= helpers ================= */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); };
const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "2-digit" });
const fmtFull = ts => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return String(u || ""); } };

/* ================= toasts ================= */
function toast(title, desc) {
  const wrap = $("#toasts");
  if (!wrap) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = '<div class="toast-title">' + esc(title) + "</div>" + (desc ? '<div class="toast-desc">' + esc(desc) + "</div>" : "");
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 320); }, 3400);
}

/* ================= modal confirm ================= */
let modalCb = null;
function confirmBox(title, body, okLabel, cb) {
  $("#modal-title").textContent = title;
  $("#modal-body").textContent = body;
  $("#modal-ok").textContent = okLabel || "Confirm";
  modalCb = cb;
  $("#modal-mask").classList.add("open");
}

/* ================= storage / db ================= */
const K = { users: "unfo_users", sites: "unfo_sites", msgs: "unfo_msgs", sess: "unfo_sess", ver: "unfo_db_ver" };
/* DB v2: ALL IDs are free — no account is pre-registered. Whoever claims
   the ID "Devanshu" (any letter case) gets the owner role automatically. */
const DB_VER = 2;
const read = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? f : v; } catch (e) { return f; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

async function hashPw(pw, salt) {
  const text = salt + "::" + pw;
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) { /* fall through */ }
  }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

const validId = id => /^[A-Za-z0-9]{8,24}$/.test(id);

async function seed() {
  const ver = Number(read(K.ver, 0));
  if (ver === DB_VER && localStorage.getItem(K.users)) return;
  /* v1 → v2 migration: free every pre-registered ID (old builds seeded an
     owner account that made "Devanshu" appear taken). Fresh start: zero
     accounts, the Splid website only. */
  const now = Date.now();
  write(K.users, []);
  write(K.sites, [{
    id: "splid",
    name: "Splid",
    url: "https://splid.unfo.workers.dev/",
    description: "The first member of the UNFOTABLE network — a live app running on Cloudflare Workers.",
    createdAt: now - 14 * 864e5
  }]);
  write(K.msgs, []);
  localStorage.removeItem(K.sess);
  write(K.ver, DB_VER);
}

const allUsers = () => read(K.users, []);
const allSites = () => read(K.sites, []).slice().sort((a, b) => a.createdAt - b.createdAt);
const allMsgs  = () => read(K.msgs, []);
const me = () => {
  const id = read(K.sess, null);
  return id ? (allUsers().find(u => u.id === id) || null) : null;
};
const saveUsers = u => write(K.users, u);
const saveSites = s => write(K.sites, s);
const saveMsgs  = m => write(K.msgs, m);

/* ================= anime.js glue ================= */
const AN = window.anime || null;
const canAnime = !!(AN && typeof AN.animate === "function");
const stg = canAnime && AN.stagger ? AN.stagger : null;
function an(targets, params) {
  if (canAnime) {
    try { AN.animate(targets, params); } catch (e) { hardShow(targets); }
  } else {
    hardShow(targets);
  }
}
function hardShow(targets) {
  let els = [];
  try { els = typeof targets === "string" ? $$(targets) : Array.prototype.slice.call(targets.nodeType ? [targets] : (targets || [])); } catch (e) {}
  els.forEach(el => {
    el.style.opacity = "1";
    el.style.transform = "none";
  });
}
function safetyShow(root) {
  setTimeout(() => {
    $$(".a-h, .a-rise, .rv, .hero-title span", root || document).forEach(el => {
      if (!el.classList.contains("rv")) { el.style.opacity = "1"; el.style.transform = "none"; }
    });
  }, 2600);
}

/* ================= state ================= */
let screen = "public";
let authTab = "login";
let dashTab = "portfolio";
let editingSiteId = null;
let msgTargetId = null;
let inboxTimer = null;

function stopTimers() { if (inboxTimer) { clearInterval(inboxTimer); inboxTimer = null; } }

/* ================= header ================= */
function renderHeader(u) {
  const box = $("#hd-actions");
  if (u === undefined) { box.innerHTML = ""; return; }
  if (!u) {
    box.innerHTML =
      '<button class="btn btn-ghost" onclick="A.openAuth(\'login\')">Sign in</button>' +
      '<button class="btn btn-primary" onclick="A.openAuth(\'register\')">Create ID</button>';
  } else {
    const isOwner = u.role === "owner";
    box.innerHTML =
      '<span class="badge" style="font-size:12.5px">' + esc(u.id) +
      (isOwner ? ' <span class="owner-tag">· OWNER</span>' : "") + "</span>" +
      (screen !== "dash"
        ? '<button class="btn btn-primary" onclick="A.go(\'dash\')">' + (isOwner ? "Owner console" : "Dashboard") + "</button>"
        : "") +
      '<button class="btn btn-outline btn-icon" title="Sign out" aria-label="Sign out" onclick="A.signOut()">⎋</button>';
  }
}

/* ================= public view ================= */
const HERO_WORD = "UNFOTABLE";
const TILES = [
  "linear-gradient(135deg, #1c1c1a 0%, #000000 100%)",
  "linear-gradient(135deg, #4a4a47 0%, #1c1c1a 100%)",
  "linear-gradient(135deg, #8a8778 0%, #56544a 100%)",
  "linear-gradient(135deg, #33332f 0%, #0f0f0e 100%)"
];
const tileOf = i => TILES[i % TILES.length];

function siteCardHTML(s, i) {
  return (
    '<a class="site-card" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" aria-label="Visit ' + esc(s.name) + '">' +
      '<div class="site-card-top">' +
        '<div class="tile serif" style="background:' + tileOf(i) + '">' + esc((s.name || "?").charAt(0).toUpperCase()) + "</div>" +
        '<span class="go-ring">↗</span>' +
      "</div>" +
      '<h3 class="site-name serif">' + esc(s.name) + "</h3>" +
      '<p class="site-desc">' + esc(s.description || "A member of the UNFOTABLE network.") + "</p>" +
      '<div class="site-foot">' +
        '<span class="badge host-badge">' + esc(hostOf(s.url)) + "</span>" +
        '<span class="visit-hint">Visit site</span>' +
      "</div>" +
    "</a>"
  );
}

function PublicView(u) {
  const list = allSites();
  const letters = HERO_WORD.split("").map(ch => '<span aria-hidden="true">' + esc(ch) + "</span>").join("");
  return (
  '<section class="hero">' +
    '<div class="dots" aria-hidden="true"></div>' +
    '<div class="glow a-h" aria-hidden="true"></div>' +
    '<div class="wrap" style="position:relative">' +
      '<div class="hero-badge a-h"><span class="live-dot"></span>THE UNFO NETWORK · LIVE</div>' +
      '<h1 class="hero-title serif" aria-label="UNFOTABLE">' + letters + "</h1>" +
      '<p class="hero-sub a-rise">One ID. Many worlds. UNFOTABLE ties a whole group of websites into a single front door — claim your ID once, and every connected place is one click away.</p>' +
      '<div class="hero-cta a-rise">' +
        (u ? '<button class="btn btn-primary btn-lg" onclick="A.go(\'dash\')">Open your dashboard →</button>' +
             '<button class="btn btn-outline btn-lg" onclick="A.scrollGrid()">See the network</button>'
           : '<button class="btn btn-primary btn-lg" onclick="A.openAuth(\'register\')">Claim your UNFO ID</button>' +
             '<button class="btn btn-outline btn-lg" onclick="A.openAuth(\'login\')">Sign in with your ID →</button>') +
      "</div>" +
      '<div class="hero-stats a-rise">' +
        '<div class="stat-box"><div class="stat-num serif" id="stat-sites">0</div><div class="stat-label">Sites connected</div></div>' +
        '<div class="stat-box"><div class="stat-num serif">8+</div><div class="stat-label">Characters per ID</div></div>' +
      "</div>" +
    "</div>" +
    '<div class="pulse-line" aria-hidden="true"><span class="pulse-dot"></span></div>' +
  "</section>" +

  '<section class="section" id="network-grid">' +
    '<div class="wrap">' +
      '<div class="rv" style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px">' +
        "<div>" +
          '<span class="sec-badge">🌐 The network</span>' +
          '<h2 class="sec-title serif">Every website, one grid</h2>' +
        "</div>" +
        '<p style="max-width:380px;color:var(--muted);font-size:14.5px">Curated by the owner. Click any card to open that world in a new tab.</p>' +
      "</div>" +
      '<div class="site-grid">' +
        (list.length
          ? list.map((s, i) => '<div class="rv">' + siteCardHTML(s, i) + "</div>").join("")
          : '<div class="empty rv" style="grid-column:1/-1">No websites in the network yet — the owner will curate them soon.</div>') +
      "</div>" +
    "</div>" +
  "</section>" +

  '<section class="section" style="padding-top:0" id="how">' +
    '<div class="wrap">' +
      '<div class="rv" style="text-align:center">' +
        '<span class="sec-badge">✦ How UNFOTABLE works</span>' +
        '<h2 class="sec-title serif">A tiny internet with one front door</h2>' +
        '<p class="sec-sub">Three steps. No emails, no spam — just an ID and a password.</p>' +
      "</div>" +
      '<div class="grid grid-3">' +
        [
          ["☝", "Get your UNFO ID", "Every ID is free to claim. Pick 8 or more letters and digits, pair it with a password, and it is yours — sign back in anytime. The ID Devanshu unlocks the owner console."],
          ["🖱", "Step inside the network", "Your ID works across the whole group. Sign in once and the entire collection of websites opens up from one dashboard."],
          ["🌍", "Watch it grow", "New websites are curated into the grid by the owner. Every addition appears here live — no re-registering, no new accounts, ever."]
        ].map((s, i) =>
          '<div class="rv"><div class="step-card">' +
            '<div class="step-icon">' + s[0] + "</div>" +
            '<div class="step-kicker">Step ' + (i + 1) + "</div>" +
            '<h3 class="step-title serif">' + s[1] + "</h3>" +
            '<p class="step-body">' + s[2] + "</p>" +
          "</div></div>"
        ).join("") +
      "</div>" +
    "</div>" +
  "</section>" +

  '<section style="padding-bottom:96px">' +
    '<div class="wrap">' +
      '<div class="cta-banner rv">' +
        '<div class="cta-glow" style="background:radial-gradient(circle, rgba(255,255,255,.10) 0%, transparent 70%);right:-96px;top:-96px"></div>' +
        '<div class="cta-glow" style="background:radial-gradient(circle, rgba(255,255,255,.06) 0%, transparent 70%);left:-96px;bottom:-96px"></div>' +
        '<h2 class="cta-title serif">Your seat in the network is waiting</h2>' +
        '<p class="cta-sub">Ten seconds to create. Yours to keep. The whole group of websites, always within reach.</p>' +
        '<button class="btn btn-white btn-lg" style="margin-top:30px" onclick="A.openAuth(\'register\')">Create your UNFO ID →</button>' +
      "</div>" +
    "</div>" +
  "</section>"
  );
}

function countUp(elm, target) {
  const t0 = performance.now(), dur = 1100;
  function step(now) {
    const p = Math.min(1, (now - t0) / dur);
    elm.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function runPublicAnims() {
  const letters = $$(".hero-title span");
  letters.forEach(l => { l.style.opacity = "0"; l.style.transform = "translateY(60px) rotate(4deg)"; });
  an(letters, {
    opacity: [0, 1], translateY: [60, 0], rotate: [4, 0],
    duration: 900, delay: stg ? stg(45) : (el, i) => i * 45, ease: "outExpo"
  });
  an(".hero-badge", { opacity: [0, 1], translateY: [-10, 0], duration: 700, ease: "outCubic" });
  an(".hero-sub, .hero-cta, .hero-stats", { opacity: [0, 1], translateY: [26, 0], duration: 850, delay: stg ? stg(120) : (el, i) => i * 120, ease: "outExpo" });
  an(".glow", { opacity: [0, 0.6], duration: 1600, ease: "outQuad" });
  const sEl = $("#stat-sites");
  if (sEl) countUp(sEl, allSites().length);

  /* scroll reveals */
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        const els = $$(".rv", en.target).length ? [en.target] : [];
        (els.length ? els : [en.target]).forEach(el => el.classList.add("rv-in"));
        obs.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  $$(".rv").forEach((el, i) => { el.style.transitionDelay = (i % 3) * 90 + "ms"; obs.observe(el); });
  safetyShow();
}

/* ================= auth view ================= */
function AuthView() {
  const isLogin = authTab === "login";
  return (
  '<main class="auth-page">' +
    '<div class="dots" aria-hidden="true"></div>' +
    '<div class="auth-glow" aria-hidden="true"></div>' +
    '<div class="auth-box">' +
      '<div style="text-align:center" class="a-h">' +
        '<button class="back-link" onclick="A.go(\'public\')">← Back to UNFOTABLE</button>' +
        '<h1 class="auth-title serif">' + (isLogin ? "Welcome back" : "Claim your ID") + "</h1>" +
        '<p class="auth-sub">' + (isLogin
          ? "Sign in with your UNFO ID and password to open the network."
          : "Every ID is free. 8+ letters and digits — pick it once, keep it forever. The ID Devanshu unlocks the owner console.") + "</p>" +
      "</div>" +
      '<div class="card auth-card a-rise">' +
        '<div class="tabbar" role="tablist">' +
          '<button class="tab ' + (isLogin ? "active" : "") + '" onclick="A.authMode(\'login\')">Sign in</button>' +
          '<button class="tab ' + (isLogin ? "" : "active") + '" onclick="A.authMode(\'register\')">Create ID</button>' +
        "</div>" +
        '<form style="margin-top:20px" onsubmit="return A.submitAuth(event)">' +
          '<div class="field">' +
            '<label class="label" for="f-id">UNFO ID</label>' +
            '<input class="input" id="f-id" autocomplete="username" placeholder="' + (isLogin ? "e.g. Devanshu" : "e.g. Stellar2026") + '" maxlength="24" />' +
            (isLogin ? "" : '<div class="hint">8–24 characters · letters and digits only</div>') +
          "</div>" +
          '<div class="field">' +
            '<label class="label" for="f-pw">Password</label>' +
            '<input class="input" id="f-pw" type="password" autocomplete="' + (isLogin ? "current-password" : "new-password") + '" placeholder="Your password" />' +
            (isLogin ? "" : '<div class="hint">At least 6 characters — you will need it to sign back in.</div>') +
          "</div>" +
          '<button class="btn btn-primary" type="submit" style="width:100%;height:46px;margin-top:6px">' +
            (isLogin ? "Enter the network" : "Create my ID") +
          "</button>" +
        "</form>" +
        '<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:13px;color:var(--muted)">' +
          (isLogin
            ? 'No ID yet? <button style="font-weight:600;color:#000" onclick="A.authMode(\'register\')">Create one in ten seconds</button>'
            : 'Already have an ID? <button style="font-weight:600;color:#000" onclick="A.authMode(\'login\')">Sign in instead</button>') +
        "</div>" +
      "</div>" +
      '<p style="text-align:center;margin-top:18px;font-size:13px;color:var(--muted)">Your ID works across every website in the UNFOTABLE group.</p>' +
    "</div>" +
  "</main>"
  );
}

function runAuthAnims() {
  an(".auth-page .a-h", { opacity: [0, 1], translateY: [-8, 0], duration: 600, ease: "outCubic" });
  an(".auth-page .a-rise", { opacity: [0, 1], translateY: [26, 0], duration: 800, delay: 120, ease: "outExpo" });
  safetyShow();
}

/* ================= dashboard shells ================= */
function dashHead(badge, title, sub) {
  return (
    '<div class="dash-head a-rise">' +
      '<span class="badge badge-ink">' + badge + "</span>" +
      '<h1 class="dash-title serif">' + title + "</h1>" +
      '<p class="dash-sub">' + sub + "</p>" +
    "</div>"
  );
}

function statCard(ico, label, num, cap) {
  return (
    '<div class="card stat-card a-rise">' +
      '<div class="stat-ico">' + ico + " " + esc(label) + "</div>" +
      '<div class="num serif">' + num + "</div>" +
      '<div class="cap">' + esc(cap) + "</div>" +
    "</div>"
  );
}

function rowItemHTML(s, i, opts) {
  opts = opts || {};
  return (
    '<div class="row-item">' +
      '<span class="row-tile serif" style="background:' + tileOf(i) + '">' + esc((s.name || "?").charAt(0).toUpperCase()) + "</span>" +
      '<span class="row-main">' +
        '<span class="row-name">' + esc(s.name) + '<span class="row-idx">#' + (i + 1) + "</span></span>" +
        '<span class="row-meta">' + esc(s.url) + "</span>" +
      "</span>" +
      (opts.extra || "") +
    "</div>"
  );
}

function siteRowHTML(s, i) {
  const editing = editingSiteId === s.id;
  if (editing) {
    return (
      '<div class="card card-pad" style="border-color:rgba(0,0,0,.4)">' +
        '<div class="action-row" style="justify-content:space-between">' +
          '<span class="badge badge-soft">Editing #' + (i + 1) + " · changes go live instantly</span>" +
        "</div>" +
        '<div class="edit-grid">' +
          '<div><label class="label">Name</label><input class="input" id="ed-name" value="' + esc(s.name) + '" maxlength="40" /></div>' +
          '<div><label class="label">URL</label><input class="input" id="ed-url" value="' + esc(s.url) + '" placeholder="https://…" /></div>' +
          '<div class="full"><label class="label">Description</label><textarea class="textarea" id="ed-desc" style="min-height:64px" maxlength="220">' + esc(s.description || "") + "</textarea></div>" +
        "</div>" +
        '<div class="action-row" style="margin-top:12px">' +
          '<button class="btn btn-primary btn-sm" onclick="A.saveSite(\'' + s.id + '\')">Save & publish</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="A.cancelEdit()">Cancel</button>' +
        "</div>" +
      "</div>"
    );
  }
  return (
    '<div class="card card-pad">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<span class="row-tile serif" style="background:' + tileOf(i) + ';height:40px;width:40px">' + esc((s.name || "?").charAt(0).toUpperCase()) + "</span>" +
        '<span class="row-main">' +
          '<span class="row-name">' + esc(s.name) + '<span class="row-idx">#' + (i + 1) + "</span></span>" +
          '<span class="row-meta">' + esc(s.url) + "</span>" +
        "</span>" +
        '<span class="action-row">' +
          '<a class="btn btn-outline btn-sm" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>' +
          '<button class="btn btn-outline btn-sm" onclick="A.editSite(\'' + s.id + '\')">Edit</button>' +
          '<button class="btn btn-danger btn-sm" onclick="A.delSite(\'' + s.id + '\')">Remove</button>' +
        "</span>" +
      "</div>" +
      (s.description ? '<p style="margin-top:10px;font-size:13.5px;color:var(--muted)">' + esc(s.description) + "</p>" : "") +
    "</div>"
  );
}

function pwFormHTML(prefix) {
  return (
    '<form onsubmit="return A.changePw(event, \'' + prefix + '\')">' +
      '<div class="field"><label class="label">Current password</label><input class="input" id="' + prefix + '-cur" type="password" autocomplete="current-password" /></div>' +
      '<div class="field"><label class="label">New password</label><input class="input" id="' + prefix + '-new" type="password" autocomplete="new-password" placeholder="At least 6 characters" /></div>' +
      '<button class="btn btn-primary btn-sm" type="submit">Update password</button>' +
    "</form>"
  );
}

/* ================= user dashboard ================= */
function inboxHTML(u) {
  const list = allMsgs().filter(m => m.to === u.id).sort((a, b) => b.ts - a.ts);
  const unread = list.filter(m => !m.read).length;
  let inner;
  if (!list.length) {
    inner = '<div class="empty">No messages yet — the owner can reach you here, straight to your ID.</div>';
  } else {
    inner = list.map(m =>
      '<div class="msg-item ' + (m.read ? "" : "unread") + '">' +
        '<div class="msg-top">' +
          '<span class="msg-from">✉ ' + esc(m.from) + (m.read ? "" : ' <span class="badge badge-ink" style="font-size:9px;padding:2px 7px;margin-left:6px">NEW</span>') + "</span>" +
          '<span class="msg-time">' + esc(fmtFull(m.ts)) + "</span>" +
        "</div>" +
        '<div class="msg-body">' + esc(m.content) + "</div>" +
        (m.read ? "" : '<div class="msg-actions"><button class="btn btn-ghost btn-sm" onclick="A.msgRead(\'' + m.id + '\')">Mark as read</button></div>') +
      "</div>"
    ).join("");
  }
  return (
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
      '<div><div class="card-title serif">Inbox</div><div class="card-sub">Messages delivered to your ID</div></div>' +
      (unread ? '<span class="badge">' + unread + " unread</span>" : "") +
    "</div>" +
    '<div style="display:grid;gap:10px;margin-top:14px">' + inner + "</div>" +
    (list.length && unread
      ? '<div class="msg-actions"><button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="A.markAllRead()">Mark all as read</button></div>'
      : "")
  );
}

function UserView(u) {
  const list = allSites();
  const unread = allMsgs().filter(m => m.to === u.id && !m.read).length;
  return (
    '<main class="dash">' +
      '<div class="wrap">' +
        dashHead("UNFO MEMBER", "Dashboard", "Signed in as <b>" + esc(u.id) + "</b> — one ID for the whole network.") +
        '<div class="stats-row">' +
          statCard("🆔", "Your ID", esc(u.id), "yours to keep, forever") +
          statCard("🌐", "Sites unlocked", list.length, "open with this one ID") +
          statCard("✉", "Unread messages", unread, "waiting in your inbox") +
          statCard("📅", "Member since", esc(fmtFull(u.createdAt)), "day you claimed it") +
        "</div>" +
        '<div class="dash-grid dash-grid-3 mt-16">' +
          '<div style="display:grid;gap:16px;align-content:start">' +
            '<div class="card card-pad a-rise"><div id="inbox">' + inboxHTML(u) + "</div></div>" +
            '<div class="card card-pad a-rise">' +
              '<div class="card-title serif">The network</div><div class="card-sub">Every connected website — one click away</div>' +
              '<div style="display:grid;gap:10px;margin-top:14px">' +
                (list.length
                  ? list.map((s, i) => rowItemHTML(s, i, {
                      extra: '<a class="btn btn-outline btn-sm" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">Open ↗</a>'
                    })).join("")
                  : '<div class="empty">No websites yet — the owner curates this grid.</div>') +
              "</div>" +
            "</div>" +
          "</div>" +
          '<div style="display:grid;gap:16px;align-content:start">' +
            '<div class="card card-pad a-rise" style="background:linear-gradient(160deg,#fff 0%,#f5efe7 130%)">' +
              '<span class="badge badge-ink">YOUR UNFO ID</span>' +
              '<div class="serif" style="font-size:34px;font-weight:600;margin-top:12px;letter-spacing:-.01em;word-break:break-all">' + esc(u.id) + "</div>" +
              '<p style="margin-top:8px;font-size:13.5px;color:var(--muted)">Use this ID with your password to sign back in from any device. It unlocks every website in the UNFOTABLE group.</p>' +
              '<div class="action-row" style="margin-top:14px">' +
                '<button class="btn btn-outline btn-sm" onclick="A.copyId()">Copy ID</button>' +
                '<span class="badge badge-soft">Member since ' + esc(fmtFull(u.createdAt)) + "</span>" +
              "</div>" +
            "</div>" +
            '<div class="card card-pad a-rise">' +
              '<div class="card-title serif">Security</div><div class="card-sub">Change your password anytime</div>' +
              '<div style="margin-top:14px">' + pwFormHTML("upw") + "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</main>"
  );
}

function startInboxPolling(u) {
  stopTimers();
  inboxTimer = setInterval(() => {
    if (screen !== "dash") return stopTimers();
    const cur = me();
    if (!cur || cur.role === "owner") return stopTimers();
    const box = $("#inbox");
    if (box) box.innerHTML = inboxHTML(cur);
  }, 4000);
}

/* ================= owner console ================= */
function growthData() {
  const days = [];
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 864e5);
    days.push({ key: dayKey(d.getTime()), label: fmtDay(d.getTime()), count: 0 });
  }
  allUsers().forEach(u => {
    const k = dayKey(u.createdAt);
    const hit = days.find(x => x.key === k);
    if (hit) hit.count++;
  });
  return days;
}

function chartHTML() {
  const data = growthData();
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    '<div class="chart">' +
      data.map(d =>
        '<div class="chart-col">' +
          '<div class="growth-bar" style="height:' + Math.max(3, Math.round((d.count / max) * 148)) + 'px" title="' + d.label + ": " + d.count + ' new ID(s)"></div>' +
          '<span class="chart-day">' + d.label + "</span>" +
        "</div>"
      ).join("") +
    "</div>"
  );
}

function OwnerView(u) {
  const others = allUsers().filter(x => x.id !== u.id);
  const list = allSites();
  const sent = allMsgs().filter(m => m.from === u.id).sort((a, b) => b.ts - a.ts);
  const unreadForMembers = allMsgs().filter(m => !m.read && m.to !== u.id).length;

  let tabContent = "";
  if (dashTab === "portfolio") {
    const recent = sent.slice(0, 5);
    tabContent =
      '<div class="dash-grid dash-grid-3 mt-16">' +
        '<div class="card card-pad a-rise">' +
          '<div class="card-title serif">New IDs — last 14 days</div><div class="card-sub">How fast the network is growing.</div>' +
          chartHTML() +
        "</div>" +
        '<div style="display:grid;gap:16px;align-content:start">' +
          '<div class="card card-pad a-rise">' +
            '<div class="card-title serif">Network overview</div><div class="card-sub">Every connected website.</div>' +
            '<div style="display:grid;gap:10px;margin-top:14px">' +
              (list.length ? list.map((s, i) => rowItemHTML(s, i, { extra: '<a class="btn btn-outline btn-sm" href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">↗</a>' })).join("")
                : '<div class="empty">No websites yet — add one from the Websites tab.</div>') +
            "</div>" +
          "</div>" +
          '<div class="card card-pad a-rise">' +
            '<div class="card-title serif">Recent messages</div><div class="card-sub">The latest things you sent.</div>' +
            '<div style="display:grid;gap:10px;margin-top:14px">' +
              (recent.length
                ? recent.map(m =>
                    '<div class="msg-item"><div class="msg-top"><span class="msg-from">→ ' + esc(m.to) + (m.broadcast ? ' <span class="badge badge-soft" style="font-size:9px;padding:2px 7px">BROADCAST</span>' : "") + '</span><span class="msg-time">' + esc(fmtFull(m.ts)) + "</span></div>" +
                    '<div class="msg-body">' + esc(m.content.length > 120 ? m.content.slice(0, 120) + "…" : m.content) + "</div></div>"
                  ).join("")
                : '<div class="empty">Nothing sent yet — write to a member from the Members tab.</div>') +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
  } else if (dashTab === "websites") {
    tabContent =
      '<div class="card card-pad a-rise mt-16">' +
        '<div class="card-title serif">Add a website</div><div class="card-sub">It goes live on the public grid the moment you save.</div>' +
        '<div class="edit-grid" style="margin-top:14px">' +
          '<div><label class="label">Name</label><input class="input" id="ns-name" placeholder="e.g. Pulse" maxlength="40" /></div>' +
          '<div><label class="label">URL</label><input class="input" id="ns-url" placeholder="https://…" /></div>' +
          '<div class="full"><label class="label">Description <span style="text-transform:none;letter-spacing:0">(optional)</span></label><input class="input" id="ns-desc" placeholder="One line about this world" maxlength="220" /></div>' +
        "</div>" +
        '<button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="A.addSite()">+ Add website</button>' +
      "</div>" +
      '<div style="display:grid;gap:12px;margin-top:16px">' +
        (list.length
          ? list.map((s, i) => '<div class="a-rise">' + siteRowHTML(s, i) + "</div>").join("")
          : '<div class="empty">The grid is empty — add your first website above.</div>') +
      "</div>";
  } else if (dashTab === "members") {
    const compose = msgTargetId
      ? '<div class="card card-pad a-rise" style="border-color:rgba(0,0,0,.45)">' +
          '<div class="card-title serif">Message → ' + esc(msgTargetId) + "</div>" +
          '<textarea class="textarea" id="dm-text" style="margin-top:10px" placeholder="Write something for ' + esc(msgTargetId) + '…"></textarea>' +
          '<div class="action-row" style="margin-top:12px">' +
            '<button class="btn btn-primary btn-sm" onclick="A.sendCompose()">Send message</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="A.cancelCompose()">Cancel</button>' +
          "</div>" +
        "</div>"
      : "";
    tabContent =
      compose +
      '<div class="card card-pad a-rise mt-16">' +
        '<div class="card-title serif">Broadcast</div><div class="card-sub">One message, delivered to every member ID.</div>' +
        '<textarea class="textarea" id="bc-text" style="margin-top:10px" placeholder="Network announcement…"></textarea>' +
        '<div class="action-row" style="margin-top:12px">' +
          '<button class="btn btn-primary btn-sm" onclick="A.broadcast()" ' + (others.length ? "" : "disabled") + ">Broadcast to " + others.length + " member" + (others.length === 1 ? "" : "s") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="card card-pad a-rise mt-16">' +
        '<div class="card-title serif">Member IDs</div><div class="card-sub">' + others.length + ' registered' + (others.length ? " — remove an ID or write to it directly" : "") + '</div>' +
        '<div class="table-wrap" style="margin-top:12px">' +
          (others.length
            ? '<table class="data"><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Unread</th><th style="text-align:right">Actions</th></tr></thead><tbody>' +
              others.map(x => {
                const un = allMsgs().filter(m => m.to === x.id && !m.read).length;
                return (
                  "<tr>" +
                    '<td><span style="display:inline-flex;align-items:center;gap:10px">' +
                      '<span class="avatar serif" style="background:linear-gradient(135deg,#3d3d3a,#000)">' + esc(x.id.charAt(0).toUpperCase()) + "</span>" +
                      "<b>" + esc(x.id) + "</b></span></td>" +
                    '<td><span class="badge badge-soft">' + esc(x.role) + "</span></td>" +
                    "<td>" + esc(fmtFull(x.createdAt)) + "</td>" +
                    "<td>" + (un ? '<span class="badge badge-ink" style="font-size:10px;padding:2px 8px">' + un + "</span>" : "—") + "</td>" +
                    '<td style="text-align:right"><span class="action-row" style="justify-content:flex-end">' +
                      '<button class="btn btn-outline btn-sm" onclick="A.msgMember(\'' + x.id + '\')">Message</button>' +
                      '<button class="btn btn-danger btn-sm" onclick="A.removeMember(\'' + x.id + '\')">Remove</button>' +
                    "</span></td>" +
                  "</tr>"
                );
              }).join("") +
              "</tbody></table>"
            : '<div class="empty" style="margin-top:6px">No member IDs yet. When someone creates one, it appears here.</div>') +
        "</div>" +
      "</div>";
  } else {
    tabContent =
      '<div class="dash-grid dash-grid-2 mt-16">' +
        '<div class="card card-pad a-rise">' +
          '<div class="card-title serif">Owner password</div><div class="card-sub">Keep the console locked down.</div>' +
          '<div style="margin-top:14px">' + pwFormHTML("opw") + "</div>" +
        "</div>" +
        '<div class="card card-pad a-rise">' +
          '<div class="card-title serif">How this edition stores data</div>' +
          '<p style="margin-top:10px;font-size:14px;color:var(--muted)">This standalone edition of UNFOTABLE keeps every ID, password hash, website and message in this browser\'s local storage — nothing leaves your machine. Clearing the browser\'s site data resets the network to its original state: zero registered IDs + the Splid website — every ID is free to claim, and <b>Devanshu</b> unlocks the owner console.</p>' +
          '<div class="action-row" style="margin-top:14px">' +
            '<span class="badge badge-soft">ID · ' + esc(u.id) + "</span>" +
            '<span class="badge badge-soft">Members · ' + others.length + "</span>" +
            '<span class="badge badge-soft">Websites · ' + list.length + "</span>" +
          "</div>" +
        "</div>" +
      "</div>";
  }

  return (
    '<main class="dash">' +
      '<div class="wrap">' +
        dashHead("👑 OWNER · Full permissions", "Owner console", "Signed in as <b>" + esc(u.id) + "</b> — see every ID, curate the network, and reach any member directly.") +
        '<div class="stats-row">' +
          statCard("👥", "Member IDs", others.length, "excluding you") +
          statCard("🌐", "Websites", list.length, "in the network") +
          statCard("✉", "Messages sent", sent.length, "all time") +
          statCard("📣", "Undelivered", unreadForMembers, "awaiting members") +
        "</div>" +
        '<div class="tabbar mt-24" style="max-width:640px">' +
          [["portfolio", "Portfolio"], ["websites", "Websites"], ["members", "Members"], ["settings", "Settings"]]
            .map(t => '<button class="tab ' + (dashTab === t[0] ? "active" : "") + '" onclick="A.dashTab(\'' + t[0] + '\')">' + t[1] + "</button>")
            .join("") +
        "</div>" +
        tabContent +
      "</div>" +
    "</main>"
  );
}

function runDashAnims(isOwner) {
  an(".dash .a-rise", { opacity: [0, 1], translateY: [24, 0], duration: 750, delay: stg ? stg(70) : (el, i) => i * 70, ease: "outExpo" });
  if (canAnime) {
    const bars = $$(".growth-bar");
    bars.forEach(b => { b.style.transform = "scaleY(0)"; });
    an(bars, { scaleY: [0, 1], duration: 800, delay: stg ? stg(35) : (el, i) => i * 35, ease: "outExpo" });
  }
  safetyShow();
}

/* ================= actions ================= */
const A = {

  /* navigation */
  go(s) { screen = s; render(); window.scrollTo({ top: 0, behavior: "auto" }); },
  openAuth(tab) { authTab = tab; screen = "auth"; render(); window.scrollTo({ top: 0 }); },
  authMode(tab) { authTab = tab; render(); },
  dashTab(t) { dashTab = t; editingSiteId = null; msgTargetId = null; render(); },
  scrollGrid() { const el = $("#network-grid"); if (el) el.scrollIntoView({ behavior: "smooth" }); },
  footerDash() { const u = me(); if (u) A.go("dash"); else A.openAuth("login"); },

  /* auth */
  async submitAuth(e) {
    e.preventDefault();
    const idEl = $("#f-id"), pwEl = $("#f-pw");
    const id = (idEl.value || "").trim();
    const pw = pwEl.value || "";
    if (!id || !pw) return toast("Missing details", "Enter both your ID and password.");
    if (authTab === "login") {
      const u = allUsers().find(x => x.id === id);
      if (!u) return toast("No such ID", "Check the spelling — IDs are 8–24 letters and digits.");
      const h = await hashPw(pw, u.salt);
      if (h !== u.hash) return toast("Wrong password", "Try again — you can reset nothing here, passwords matter.");
      /* Safety: the Devanshu ID always carries owner permissions. */
      if (u.id.toLowerCase() === "devanshu" && u.role !== "owner") {
        u.role = "owner";
        saveUsers(allUsers().map(x => (x.id === u.id ? u : x)));
      }
      write(K.sess, u.id);
      toast("Signed in as " + u.id, u.role === "owner" ? "Welcome back — the owner console is ready." : "Welcome to UNFOTABLE.");
      A.go("dash");
    } else {
      if (!validId(id)) return toast("Invalid ID", "Use 8–24 characters — letters and digits only.");
      if (allUsers().some(x => x.id.toLowerCase() === id.toLowerCase())) return toast("ID already taken", "Pick another 8+ character ID.");
      if (pw.length < 6) return toast("Weak password", "Use at least 6 characters — you will need it to sign back in.");
      const salt = "unfo-" + Math.random().toString(36).slice(2, 8);
      /* Every ID is free — and the ID "Devanshu" (any letter case) carries full owner permissions. */
      const isOwner = id.toLowerCase() === "devanshu";
      const user = { id, salt, hash: await hashPw(pw, salt), role: isOwner ? "owner" : "user", createdAt: Date.now() };
      saveUsers(allUsers().concat([user]));
      write(K.sess, user.id);
      toast(isOwner ? "Owner ID claimed" : "Welcome to UNFOTABLE", isOwner ? id + " now holds full owner access." : "Your ID " + id + " is live across the network.");
      A.go("dash");
    }
    return false;
  },
  signOut() {
    localStorage.removeItem(K.sess);
    toast("Signed out", "Your ID will be here when you come back.");
    A.go("public");
  },
  async changePw(e, prefix) {
    e.preventDefault();
    const u = me();
    if (!u) return false;
    const cur = $("#" + prefix + "-cur").value || "";
    const nw = $("#" + prefix + "-new").value || "";
    const h = await hashPw(cur, u.salt);
    if (h !== u.hash) return toast("Wrong current password", "The console stays locked without it.");
    if (nw.length < 6) return toast("Too short", "New password needs at least 6 characters.");
    const users = allUsers();
    const hit = users.find(x => x.id === u.id);
    hit.salt = "unfo-" + Math.random().toString(36).slice(2, 8);
    hit.hash = await hashPw(nw, hit.salt);
    saveUsers(users);
    toast("Password updated", "Use the new one next time you sign in.");
    e.target.reset();
    return false;
  },

  /* user dash */
  copyId() {
    const u = me();
    if (!u) return;
    const done = () => toast("Copied", u.id + " is on your clipboard.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u.id).then(done, () => toast("Copy failed", "Select and copy it manually: " + u.id));
    else toast("Your ID", u.id);
  },
  msgRead(id) {
    const msgs = allMsgs();
    const m = msgs.find(x => x.id === id);
    if (m) { m.read = true; saveMsgs(msgs); }
    const box = $("#inbox");
    const u = me();
    if (box && u) box.innerHTML = inboxHTML(u);
  },
  markAllRead() {
    const u = me();
    if (!u) return;
    const msgs = allMsgs().map(m => (m.to === u.id ? Object.assign({}, m, { read: true }) : m));
    saveMsgs(msgs);
    toast("Inbox cleared", "All messages marked as read.");
    render();
  },

  /* owner — websites (live editing) */
  addSite() {
    const name = ($("#ns-name").value || "").trim();
    const url = ($("#ns-url").value || "").trim();
    const desc = ($("#ns-desc").value || "").trim();
    if (!name) return toast("Name required", "Give the website a short name.");
    if (!/^https?:\/\/.+\..+/.test(url)) return toast("Invalid URL", "Use a full address like https://example.com");
    const sites = read(K.sites, []);
    sites.push({ id: uid(), name, url, description: desc, createdAt: Date.now() });
    saveSites(sites);
    toast("Website published", name + " is live on the public grid.");
    render();
  },
  editSite(id) { editingSiteId = id; render(); window.scrollTo({ top: $("#app").scrollHeight, behavior: "smooth" }); },
  cancelEdit() { editingSiteId = null; render(); },
  saveSite(id) {
    const name = ($("#ed-name").value || "").trim();
    const url = ($("#ed-url").value || "").trim();
    const desc = ($("#ed-desc").value || "").trim();
    if (!name) return toast("Name required", "The tile needs a name.");
    if (!/^https?:\/\/.+\..+/.test(url)) return toast("Invalid URL", "Use a full address like https://example.com");
    const sites = read(K.sites, []);
    const s = sites.find(x => x.id === id);
    if (s) { s.name = name; s.url = url; s.description = desc; saveSites(sites); }
    editingSiteId = null;
    toast("Saved & live", name + " has been updated everywhere.");
    render();
  },
  delSite(id) {
    const sites = read(K.sites, []);
    const s = sites.find(x => x.id === id);
    confirmBox("Remove website?", (s ? s.name : "This site") + " will disappear from the public grid immediately.", "Remove", () => {
      saveSites(sites.filter(x => x.id !== id));
      toast("Website removed", "The grid updates for everyone right away.");
      render();
    });
  },

  /* owner — members & messages */
  msgMember(id) { msgTargetId = id; dashTab = "members"; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
  cancelCompose() { msgTargetId = null; render(); },
  sendCompose() {
    const u = me();
    const txt = ($("#dm-text").value || "").trim();
    if (!u || !msgTargetId) return;
    if (!txt) return toast("Empty message", "Write something first.");
    const msgs = allMsgs();
    msgs.push({ id: uid(), to: msgTargetId, from: u.id, content: txt, read: false, broadcast: false, ts: Date.now() });
    saveMsgs(msgs);
    msgTargetId = null;
    toast("Message sent", "Delivered to " + msgTargetId + "'s inbox.");
    render();
  },
  broadcast() {
    const u = me();
    const txt = ($("#bc-text").value || "").trim();
    if (!u) return;
    if (!txt) return toast("Empty broadcast", "Write the announcement first.");
    const targets = allUsers().filter(x => x.role !== "owner");
    if (!targets.length) return toast("No members yet", "Nobody to broadcast to right now.");
    const msgs = allMsgs();
    const ts = Date.now();
    targets.forEach(t => msgs.push({ id: uid(), to: t.id, from: u.id, content: txt, read: false, broadcast: true, ts }));
    saveMsgs(msgs);
    toast("Broadcast sent", "Delivered to " + targets.length + " member" + (targets.length === 1 ? "" : "s") + ".");
    render();
  },
  removeMember(id) {
    const target = allUsers().find(x => x.id === id);
    if (!target) return;
    if (target.role === "owner") return toast("Not allowed", "The owner ID cannot be removed.");
    confirmBox("Remove ID " + id + "?", "They will lose access to the network, and their messages will be erased. This cannot be undone.", "Remove ID", () => {
      saveUsers(allUsers().filter(x => x.id !== id));
      saveMsgs(allMsgs().filter(m => m.to !== id && m.from !== id));
      if (msgTargetId === id) msgTargetId = null;
      toast("ID removed", id + " is no longer part of UNFOTABLE.");
      render();
    });
  },

  /* modal */
  modalCancel() { $("#modal-mask").classList.remove("open"); modalCb = null; },
  modalOk() { const cb = modalCb; A.modalCancel(); if (cb) cb(); }
};
window.A = A;

/* ================= render + init ================= */
function render() {
  stopTimers();
  const u = me();
  renderHeader(u);
  const app = $("#app");
  if (screen === "auth") {
    app.innerHTML = AuthView();
    runAuthAnims();
  } else if (screen === "dash" && u) {
    app.innerHTML = u.role === "owner" ? OwnerView(u) : UserView(u);
    runDashAnims(u.role === "owner");
    if (u.role !== "owner") startInboxPolling(u);
  } else {
    app.innerHTML = PublicView(u);
    runPublicAnims();
  }
}

async function init() {
  $("#ft-year").textContent = String(new Date().getFullYear());
  await seed();
  $("#modal-mask").addEventListener("click", e => { if (e.target.id === "modal-mask") A.modalCancel(); });
  $("#modal-ok").addEventListener("click", () => A.modalOk());
  render();
}

init();

})();
