/* ════════════════════════════════════════════════════════════════════════════
   Configuration — the only lines to edit.
   The publishable key is meant for the browser: Row Level Security (see
   supabase/schema.sql) keeps every user to their own rows. NEVER put the
   secret key (sb_secret_…) in this file.
   If the project URL changes, change it in index.html's Content-Security-Policy
   too, or the page will be blocked from reaching it.
   ════════════════════════════════════════════════════════════════════════════ */
const SUPABASE_URL = "https://uwlwvrpcpzohgaazwudy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5ycm4mrjLSvAqFu8fdYvkQ_b1k7-X3H";

// Never run inside another site's frame (stops click-jacking tricks; GitHub
// Pages can't send the header that would normally do this).
if (window.top !== window.self) { document.documentElement.innerHTML = ""; throw new Error("framed"); }

/* ── constants ── */
const DEBIT_CATEGORIES = [
  { name: "Groceries & Provisions", icon: "🛒", short: "Groceries" },
  { name: "Food & Dining Out", icon: "🍔", short: "Food" },
  { name: "Electricity & Utilities", icon: "⚡", short: "Bills" },
  { name: "House Rent & Maintenance", icon: "🏠", short: "Rent" },
  { name: "Transport, Petrol & Cab", icon: "🚗", short: "Travel" },
  { name: "Shopping & Clothes", icon: "🛍️", short: "Shopping" },
  { name: "Health, Medicine & Doctor", icon: "💊", short: "Health" },
  { name: "Movies & Subscriptions", icon: "🎬", short: "Fun" },
  { name: "Education & Courses", icon: "📚", short: "Education" },
  { name: "Loan EMI / Debt Paid", icon: "💳", short: "EMI" },
  { name: "Personal & Miscellaneous", icon: "💼", short: "Other" },
];
const CREDIT_CATEGORIES = [
  { name: "Salary & Professional Fee", icon: "💰", short: "Salary" },
  { name: "Freelance & Business", icon: "💻", short: "Business" },
  { name: "Investment / Dividends", icon: "📈", short: "Invest" },
  { name: "Rental Inflow", icon: "🏠", short: "Rent in" },
  { name: "Credit / Borrowed / Loan", icon: "🔄", short: "Borrowed" },
  { name: "Gifts & Cashback", icon: "🎁", short: "Gifts" },
  { name: "Other Income", icon: "➕", short: "Other" },
];
const OLD_STORAGE_KEY = "fintrack_personal_expenses_v1"; // the browser-only version's data
const THEME_KEY = "fintrack_theme";
const IMPORTED_KEY = "fintrack_imported_to"; // which account the device entries went to

/* ── state ── */
const state = {
  user: null,
  tx: [],              // every entry of this user, newest first
  loaded: false,
  currency: "₹",
  day: todayStr(),
  month: todayStr().slice(0, 7),
  year: new Date().getFullYear(),
  filter: "all",
  view: "viewHome",
  sheet: { editId: null, type: "debit", category: null },
};
let sb = null;
let channel = null;
// The other sections (loans.js, invest.js, vault.js) plug in here.
const renderHooks = [];   // run on every render()
const loadHooks = [];     // async, run after sign-in
const resetHooks = [];    // run on sign-out
const fabHooks = {};      // view id → what the ＋ button does there

/* ── small helpers ── */
const $ = (id) => document.getElementById(id);
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function shiftDate(str, days) { const d = new Date(str + "T00:00:00"); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function shiftMonth(str, n) { const [y, m] = str.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function fmt(n) { const v = Math.abs(Number(n) || 0); const s = v.toLocaleString("en-IN", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); return `${state.currency}${s}`; }
function signed(n) { return (n < 0 ? "−" : "") + fmt(n); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function dayLabel(str) {
  const t = todayStr();
  if (str === t) return "Today";
  if (str === shiftDate(t, -1)) return "Yesterday";
  return new Date(str + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
function longDate(str) { return new Date(str + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
function monthLabel(str) { const [y, m] = str.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); }
function catOf(t) { const pool = t.type === "credit" ? CREDIT_CATEGORIES : DEBIT_CATEGORIES; return pool.find((c) => c.name.toLowerCase() === (t.category || "").toLowerCase()) || { icon: t.type === "credit" ? "🟢" : "🔴", name: t.category, short: t.category }; }
function totals(list) { let i = 0, o = 0; for (const t of list) t.type === "credit" ? (i += +t.amount) : (o += +t.amount); return { i, o, n: i - o }; }
function nowTime() { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind === "err" ? " err" : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function friendly(err) {
  const m = (err && (err.message || err.error_description)) || String(err || "");
  if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox.";
  if (/User already registered/i.test(m)) return "An account with this email already exists. Sign in instead.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "No connection. Check your internet and try again.";
  if (/relation .* does not exist|Could not find the table|schema cache/i.test(m)) return "The database isn't fully set up — run the latest supabase/schema.sql in Supabase.";
  if (/Entry limit reached/i.test(m)) return "You've reached the maximum number of entries for this section.";
  return m || "Something went wrong. Please try again.";
}
function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label || ""}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

/* ── theme ── */
function applyTheme(v) {
  if (v) document.documentElement.setAttribute("data-theme", v); else document.documentElement.removeAttribute("data-theme");
  try { v ? localStorage.setItem(THEME_KEY, v) : localStorage.removeItem(THEME_KEY); } catch (e) {}
}
try { applyTheme(localStorage.getItem(THEME_KEY) || ""); } catch (e) {}

/* ════════════════ screens ════════════════ */
function show(screen) {
  for (const id of ["setupScreen", "authScreen", "resetScreen", "app"]) $(id).hidden = id !== screen;
}

/* ── sign in / create account / reset ── */
let authMode = "in";
function setAuthMode(m) {
  authMode = m;
  $("modeIn").setAttribute("aria-pressed", m === "in");
  $("modeUp").setAttribute("aria-pressed", m === "up");
  $("authSubmit").textContent = m === "in" ? "Sign in" : "Create account";
  $("authPass").autocomplete = m === "in" ? "current-password" : "new-password";
  $("forgot").hidden = m !== "in";
  authMsg("");
}
function authMsg(text, ok) { const el = $("authMsg"); el.hidden = !text; el.textContent = text; el.className = "msg " + (ok ? "ok" : "err"); }
$("modeIn").onclick = () => setAuthMode("in");
$("modeUp").onclick = () => setAuthMode("up");
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("authEmail").value.trim(), password = $("authPass").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg("Enter a valid email address.");
  if (password.length < 8) return authMsg("Password must be at least 8 characters.");
  const btn = $("authSubmit"); busy(btn, true); authMsg("");
  try {
    if (authMode === "in") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) { setAuthMode("in"); authMsg("Account created. Check your email and tap the link to confirm, then sign in.", true); }
    }
  } catch (err) { authMsg(friendly(err)); }
  finally { busy(btn, false); }
};
$("forgot").onclick = async () => {
  const email = $("authEmail").value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg("Type your email above first, then tap “Forgot password?”.");
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    authMsg("We've emailed you a link to set a new password.", true);
  } catch (err) { authMsg(friendly(err)); }
};
$("resetForm").onsubmit = async (e) => {
  e.preventDefault();
  const pw = $("newPass").value, el = $("resetMsg");
  if (pw.length < 8) { el.hidden = false; el.className = "msg err"; el.textContent = "Password must be at least 8 characters."; return; }
  const { error } = await sb.auth.updateUser({ password: pw });
  el.hidden = false;
  if (error) { el.className = "msg err"; el.textContent = friendly(error); return; }
  el.className = "msg ok"; el.textContent = "Password saved.";
  setTimeout(() => enterApp(state.user), 800);
};

/* ════════════════ data ════════════════ */
function fromRow(r) {
  return { id: r.id, type: r.type, amount: Number(r.amount), category: r.category, desc: r.description || "", paymentMode: r.payment_mode || "UPI", date: r.tx_date, time: r.tx_time || "", createdAt: r.created_at };
}
function toRow(t) {
  const time = String(t.time || "").slice(0, 5);
  return {
    type: t.type, amount: Math.round(Number(t.amount) * 100) / 100,
    category: String(t.category || "Personal & Miscellaneous").slice(0, 60),
    description: String(t.desc || "").slice(0, 500),
    payment_mode: String(t.paymentMode || "UPI").slice(0, 30),
    tx_date: t.date, tx_time: /^[0-2]\d:[0-5]\d$/.test(time) ? time : null,
  };
}
function sortTx() { state.tx.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || "") > (a.createdAt || "") ? 1 : -1)); }

async function loadAll() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("transactions").select("*").order("tx_date", { ascending: false }).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  state.tx = all.map(fromRow);
  state.loaded = true;
}

function listen() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("tx-" + state.user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${state.user.id}` }, (p) => {
      if (p.eventType === "DELETE") state.tx = state.tx.filter((t) => t.id !== p.old.id);
      else {
        const t = fromRow(p.new), i = state.tx.findIndex((x) => x.id === t.id);
        i >= 0 ? (state.tx[i] = t) : state.tx.push(t);
        sortTx();
      }
      render();
    })
    .subscribe((status) => { $("syncDot").classList.toggle("off", status !== "SUBSCRIBED"); });
}

async function saveTx(t, editId) {
  if (editId) {
    const { data, error } = await sb.from("transactions").update(toRow(t)).eq("id", editId).select().single();
    if (error) throw error;
    const i = state.tx.findIndex((x) => x.id === editId); if (i >= 0) state.tx[i] = fromRow(data);
  } else {
    const { data, error } = await sb.from("transactions").insert(toRow(t)).select().single();
    if (error) throw error;
    if (!state.tx.some((x) => x.id === data.id)) state.tx.push(fromRow(data));
  }
  sortTx();
}
async function deleteTx(id) {
  const { error } = await sb.from("transactions").delete().eq("id", id);
  if (error) throw error;
  state.tx = state.tx.filter((t) => t.id !== id);
}
async function insertMany(list) {
  // upsert on (user_id, legacy_id): moving the same entries in twice adds nothing
  const rows = list.filter((t) => t && t.amount > 0 && t.date && (t.type === "credit" || t.type === "debit")).map((t) => ({ ...toRow(t), legacy_id: t.id ? String(t.id).slice(0, 80) : null, user_id: state.user.id }));
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const withId = chunk.filter((r) => r.legacy_id), without = chunk.filter((r) => !r.legacy_id);
    if (withId.length) { const { error } = await sb.from("transactions").upsert(withId, { onConflict: "user_id,legacy_id", ignoreDuplicates: true }); if (error) throw error; }
    if (without.length) { const { error } = await sb.from("transactions").insert(without); if (error) throw error; }
  }
  return rows.length;
}

/* ════════════════ rendering ════════════════ */
function txItem(t) {
  const c = catOf(t);
  return `<button class="tx" data-id="${esc(t.id)}">
    <span class="tx-ico ${t.type}">${c.icon}</span>
    <span class="tx-main"><b>${esc(t.desc || c.name)}</b><span>${esc(c.short || c.name)} · ${esc(t.paymentMode)}${t.time ? " · " + esc(t.time) : ""}</span></span>
    <span class="tx-amt num ${t.type}">${t.type === "credit" ? "+" : "−"}${fmt(t.amount)}</span>
  </button>`;
}
function emptyBox(icon, text) { return `<div class="empty"><span class="e-ico">${icon}</span>${text}</div>`; }
function skeletons(n) { return Array.from({ length: n }, () => '<div class="skeleton"></div>').join(""); }

function render() {
  if (!state.user) return;
  renderHero(); renderDay(); renderMonth(); renderYear(); renderSettings();
  for (const f of renderHooks) f();
}
function renderHero() {
  const m = totals(state.tx.filter((t) => t.date.startsWith(todayStr().slice(0, 7))));
  $("heroLabel").textContent = `${monthLabel(todayStr().slice(0, 7))} · net balance`;
  $("heroNet").textContent = state.loaded ? signed(m.n) : "—";
  $("heroIn").textContent = state.loaded ? fmt(m.i) : "—";
  $("heroOut").textContent = state.loaded ? fmt(m.o) : "—";
}
function renderDay() {
  $("dayTitle").textContent = dayLabel(state.day);
  $("daySub").textContent = longDate(state.day);
  $("dayNext").disabled = false;
  const items = state.tx.filter((t) => t.date === state.day);
  const sum = totals(items);
  $("dIn").textContent = fmt(sum.i); $("dOut").textContent = fmt(sum.o);
  $("dNet").textContent = signed(sum.n); $("dNet").className = "num " + (sum.n >= 0 ? "credit" : "debit");
  const shown = state.filter === "all" ? items : items.filter((t) => t.type === state.filter);
  $("dayList").innerHTML = !state.loaded ? skeletons(3)
    : shown.length ? shown.map(txItem).join("")
    : emptyBox("🧾", state.day === todayStr() ? "Nothing yet today. Tap ＋ to add your first entry." : "No entries on this day.");
}
function renderMonth() {
  $("monTitle").textContent = monthLabel(state.month);
  const items = state.tx.filter((t) => t.date.startsWith(state.month));
  $("monSub").textContent = `${items.length} ${items.length === 1 ? "entry" : "entries"}`;
  const sum = totals(items);
  $("mIn").textContent = fmt(sum.i); $("mOut").textContent = fmt(sum.o);
  $("mNet").textContent = signed(sum.n); $("mNet").className = "num " + (sum.n >= 0 ? "credit" : "debit");
  // daily cash flow bars
  const [y, m] = state.month.split("-").map(Number), days = new Date(y, m, 0).getDate();
  const inD = new Array(days + 1).fill(0), outD = new Array(days + 1).fill(0);
  for (const t of items) { const d = +t.date.slice(8, 10); t.type === "credit" ? (inD[d] += +t.amount) : (outD[d] += +t.amount); }
  drawBars($("monChart"), Array.from({ length: days }, (_, k) => ({ a: inD[k + 1], b: outD[k + 1], label: (k + 1) % 5 === 0 || k === 0 ? String(k + 1) : "" })));
  // categories
  const cats = {};
  for (const t of items) if (t.type === "debit") cats[t.category] = (cats[t.category] || 0) + +t.amount;
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  $("monCats").innerHTML = top.length ? top.map(([name, amt]) => {
    const c = catOf({ type: "debit", category: name }), pct = sum.o ? Math.round((amt / sum.o) * 100) : 0;
    return `<div class="cat"><div class="ico">${c.icon}</div><div><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(c.name)}</b><small>${pct}%</small></div><div class="bar"><i style="width:${pct}%"></i></div></div><b class="num">${fmt(amt)}</b></div>`;
  }).join("") : emptyBox("🥧", "No spending this month.");
  // ledger, with search
  const q = $("monSearch").value.trim().toLowerCase();
  const shown = q ? items.filter((t) => [t.desc, t.category, t.paymentMode].some((v) => (v || "").toLowerCase().includes(q))) : items;
  let html = "", lastDay = "";
  for (const t of shown) { if (t.date !== lastDay) { lastDay = t.date; html += `<div class="day-head">${esc(dayLabel(t.date))}</div>`; } html += txItem(t); }
  $("monList").innerHTML = !state.loaded ? skeletons(4) : html || emptyBox("🔍", q ? "No entries match your search." : "No entries this month.");
}
function renderYear() {
  $("yrTitle").textContent = state.year;
  const items = state.tx.filter((t) => t.date.startsWith(String(state.year)));
  const sum = totals(items);
  $("yIn").textContent = fmt(sum.i); $("yOut").textContent = fmt(sum.o);
  $("yNet").textContent = signed(sum.n); $("yNet").className = "num " + (sum.n >= 0 ? "credit" : "debit");
  const months = Array.from({ length: 12 }, (_, k) => totals(items.filter((t) => +t.date.slice(5, 7) === k + 1)));
  const names = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  drawBars($("yrChart"), months.map((x, k) => ({ a: x.i, b: x.o, label: names[k] })));
  $("yrRows").innerHTML = months.map((x, k) => (x.i || x.o) ? `<div class="month-row"><b>${new Date(state.year, k, 1).toLocaleDateString("en-IN", { month: "long" })}</b><span class="num credit">+${fmt(x.i)}</span><span class="num debit">−${fmt(x.o)}</span></div>` : "").join("") || emptyBox("📅", "No entries this year.");
}
function drawBars(svg, data) {
  const W = 340, H = 160, pad = 18, n = data.length, slot = (W - 8) / n, bw = Math.max(2, slot * 0.36);
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const y = (v) => H - pad - (v / max) * (H - pad - 8);
  let s = `<line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" stroke="var(--line)"/>`;
  data.forEach((d, k) => {
    const x = 4 + k * slot + (slot - bw * 2 - 1) / 2;
    if (d.a) s += `<rect x="${x}" y="${y(d.a)}" width="${bw}" height="${H - pad - y(d.a)}" rx="${Math.min(3, bw / 2)}" fill="var(--credit)"><title>${fmt(d.a)} income</title></rect>`;
    if (d.b) s += `<rect x="${x + bw + 1}" y="${y(d.b)}" width="${bw}" height="${H - pad - y(d.b)}" rx="${Math.min(3, bw / 2)}" fill="var(--debit)"><title>${fmt(d.b)} spent</title></rect>`;
    if (d.label) s += `<text x="${4 + k * slot + slot / 2}" y="${H - 3}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--muted)">${d.label}</text>`;
  });
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = s;
}
function deviceEntries() {
  try { const raw = localStorage.getItem(OLD_STORAGE_KEY); const list = raw ? JSON.parse(raw) : []; return Array.isArray(list) ? list : []; } catch (e) { return []; }
}
function renderSettings() {
  $("setEmail").textContent = state.user.email;
  $("avatarBtn").textContent = (state.user.email || "?")[0].toUpperCase();
  $("currencySel").value = state.currency;
  try { $("themeSel").value = localStorage.getItem(THEME_KEY) || ""; } catch (e) {}
  const local = deviceEntries();
  let done = null; try { done = localStorage.getItem(IMPORTED_KEY); } catch (e) {}
  $("importBanner").hidden = !local.length || done === state.user.id;
  $("importText").textContent = `${local.length} ${local.length === 1 ? "entry" : "entries"} saved in this browser from the old version.`;
}

/* ════════════════ navigation ════════════════ */
const TITLES = { viewHome: "Today", viewMonth: "Monthly", viewLoans: "Lend & borrow", viewMore: "More", viewYear: "Yearly", viewInvest: "Investments", viewVault: "Vault", viewSettings: "Settings" };
// pages opened from More: the More tab stays lit and a back arrow shows
const PARENT = { viewYear: "viewMore", viewInvest: "viewMore", viewVault: "viewMore", viewSettings: "viewMore" };
function go(view) {
  state.view = view;
  for (const v of Object.keys(TITLES)) $(v).hidden = v !== view;
  const tab = PARENT[view] || view;
  document.querySelectorAll(".tab").forEach((b) => { if (b.dataset.view === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  $("backBtn").hidden = !PARENT[view];
  $("topTitle").firstChild.nodeValue = TITLES[view];
  $("topSub").textContent = view === "viewHome" ? new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }) : state.user ? state.user.email : "";
  window.scrollTo({ top: 0 });
}
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => go(b.dataset.view)));
$("avatarBtn").onclick = () => go("viewSettings");
$("backBtn").onclick = () => go("viewMore");
document.addEventListener("click", (e) => { const t = e.target.closest("[data-go]"); if (t) go(t.dataset.go); });
$("dayPrev").onclick = () => { state.day = shiftDate(state.day, -1); renderDay(); };
$("dayNext").onclick = () => { state.day = shiftDate(state.day, 1); renderDay(); };
$("dayTitleBtn").onclick = () => { const p = $("dayPicker"); p.value = state.day; p.showPicker ? p.showPicker() : p.click(); };
$("dayPicker").onchange = (e) => { if (e.target.value) { state.day = e.target.value; renderDay(); } };
$("monPrev").onclick = () => { state.month = shiftMonth(state.month, -1); renderMonth(); };
$("monNext").onclick = () => { state.month = shiftMonth(state.month, 1); renderMonth(); };
$("yrPrev").onclick = () => { state.year--; renderYear(); };
$("yrNext").onclick = () => { state.year++; renderYear(); };
$("monSearch").oninput = () => renderMonth();
document.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => {
  state.filter = b.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  renderDay();
}));
document.addEventListener("click", (e) => { const row = e.target.closest(".tx[data-id]"); if (row) openSheet(row.dataset.id); });

/* ════════════════ add / edit sheet ════════════════ */
let sheetOpenFor = null;
function setType(type) {
  state.sheet.type = type;
  $("tDebit").className = type === "debit" ? "debit-on" : "";
  $("tCredit").className = type === "credit" ? "credit-on" : "";
  const pool = type === "credit" ? CREDIT_CATEGORIES : DEBIT_CATEGORIES;
  if (!pool.some((c) => c.name === state.sheet.category)) state.sheet.category = pool[0].name;
  $("catGrid").innerHTML = pool.map((c) => `<button type="button" class="cat-opt" data-cat="${esc(c.name)}" aria-pressed="${c.name === state.sheet.category}"><b>${c.icon}</b>${esc(c.short)}</button>`).join("");
}
$("catGrid").onclick = (e) => {
  const b = e.target.closest(".cat-opt"); if (!b) return;
  state.sheet.category = b.dataset.cat;
  $("catGrid").querySelectorAll(".cat-opt").forEach((x) => x.setAttribute("aria-pressed", x === b));
};
$("tDebit").onclick = () => setType("debit");
$("tCredit").onclick = () => setType("credit");
function openSheet(editId) {
  const t = editId ? state.tx.find((x) => x.id === editId) : null;
  state.sheet.editId = t ? t.id : null;
  state.sheet.category = t ? t.category : null;
  setType(t ? t.type : "debit");
  $("sheetTitle").textContent = t ? "Edit entry" : "New entry";
  $("fAmount").value = t ? t.amount : "";
  $("fDesc").value = t ? t.desc : "";
  $("fPay").value = t ? t.paymentMode : "UPI";
  $("fDate").value = t ? t.date : (state.view === "viewHome" ? state.day : todayStr());
  $("curSym").textContent = state.currency;
  $("delBtn").hidden = !t; $("sheetActions").classList.toggle("single", !t);
  $("formErr").hidden = true;
  openLayer($("sheet"));
  sheetOpenFor = editId;
  if (!t) setTimeout(() => $("fAmount").focus(), 300);
}
function openLayer(el) {
  const scrim = $("scrim"); scrim.hidden = false; el.hidden = false;
  requestAnimationFrame(() => { scrim.classList.add("on"); el.classList.add("on"); });
}
function closeLayers() {
  for (const id of ["sheet", "panel", "confirm", "scrim"]) {
    const el = $(id); el.classList.remove("on");
    setTimeout(() => { if (!el.classList.contains("on")) el.hidden = true; }, 320);
  }
}
$("scrim").onclick = closeLayers;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLayers(); });
$("fab").onclick = () => (fabHooks[state.view] || (() => openSheet(null)))();
$("sheet").onsubmit = async (e) => {
  e.preventDefault();
  const amount = parseFloat($("fAmount").value), date = $("fDate").value;
  const err = $("formErr");
  if (!(amount > 0)) { err.hidden = false; err.textContent = "Enter an amount above zero."; $("fAmount").focus(); return; }
  if (amount > 1e11) { err.hidden = false; err.textContent = "That amount is too large."; return; }
  if (!date) { err.hidden = false; err.textContent = "Pick a date."; return; }
  err.hidden = true;
  const editing = state.sheet.editId ? state.tx.find((x) => x.id === state.sheet.editId) : null;
  const t = { type: state.sheet.type, amount, category: state.sheet.category, desc: $("fDesc").value.trim(), paymentMode: $("fPay").value, date, time: editing ? editing.time : nowTime() };
  const btn = $("saveBtn"); busy(btn, true);
  try {
    await saveTx(t, state.sheet.editId);
    closeLayers(); render();
    toast(state.sheet.editId ? "Entry updated" : t.type === "credit" ? "Income added" : "Expense added");
  } catch (er) { err.hidden = false; err.textContent = friendly(er); }
  finally { busy(btn, false); }
};
$("delBtn").onclick = () => {
  const id = state.sheet.editId;
  confirmAsk("Delete this entry?", "It will be removed from all your devices.", async () => { await deleteTx(id); render(); toast("Entry deleted"); });
};

/* ── confirm sheet ── */
let confirmAction = null;
function confirmAsk(title, text, action, yes) {
  for (const id of ["sheet", "panel"]) { $(id).classList.remove("on"); setTimeout(() => ($(id).hidden = !$(id).classList.contains("on")), 320); }
  $("confirmTitle").textContent = title; $("confirmText").textContent = text; $("confirmYes").textContent = yes || "Delete";
  confirmAction = action;
  openLayer($("confirm"));
}
$("confirmNo").onclick = closeLayers;
$("confirmYes").onclick = async () => {
  const btn = $("confirmYes"); busy(btn, true);
  try { await confirmAction(); closeLayers(); } catch (e) { toast(friendly(e), "err"); }
  finally { busy(btn, false); }
};

/* ════════════════ settings actions ════════════════ */
$("currencySel").onchange = async (e) => {
  state.currency = e.target.value; render();
  const { error } = await sb.auth.updateUser({ data: { currency: state.currency } });
  if (error) toast(friendly(error), "err"); else toast("Currency saved");
};
$("themeSel").onchange = (e) => applyTheme(e.target.value);
$("importBtn").onclick = async () => {
  const btn = $("importBtn"); busy(btn, true);
  try {
    const n = await insertMany(deviceEntries());
    try { localStorage.setItem(IMPORTED_KEY, state.user.id); } catch (e) {}
    await loadAll(); render();
    toast(`${n} ${n === 1 ? "entry" : "entries"} moved to your account`);
  } catch (e) { toast(friendly(e), "err"); }
  finally { busy(btn, false); }
};
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function csv(list) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return ["Date,Time,Type,Category,Description,Payment mode,Amount", ...list.map((t) => [t.date, t.time, t.type, t.category, t.desc, t.paymentMode, t.amount].map(q).join(","))].join("\n");
}
$("exportMonth").onclick = () => download(`fintrack-${state.month}.csv`, csv(state.tx.filter((t) => t.date.startsWith(state.month))), "text/csv");
$("exportAllBtn").onclick = () => download(`fintrack-all-${todayStr()}.csv`, csv(state.tx), "text/csv");
$("backupBtn").onclick = () => download(`fintrack-backup-${todayStr()}.json`, JSON.stringify({ app: "FinTrack", version: 2, exportedAt: new Date().toISOString(), currency: state.currency, transactions: state.tx }, null, 2), "application/json");
$("restoreFile").onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = ""; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.transactions;
    if (!Array.isArray(list)) throw new Error("That file isn't a FinTrack backup.");
    const n = await insertMany(list);
    await loadAll(); render(); toast(`${n} ${n === 1 ? "entry" : "entries"} restored`);
  } catch (er) { toast(er instanceof SyntaxError ? "That file isn't valid JSON." : friendly(er), "err"); }
};
$("sampleBtn").onclick = async () => {
  const d = (n) => shiftDate(todayStr(), -n);
  const sample = [
    { type: "credit", amount: 85000, category: "Salary & Professional Fee", desc: "Monthly salary", paymentMode: "Net Banking", date: d(9) },
    { type: "debit", amount: 18000, category: "House Rent & Maintenance", desc: "Flat rent", paymentMode: "Net Banking", date: d(8) },
    { type: "debit", amount: 2450, category: "Groceries & Provisions", desc: "Monthly groceries", paymentMode: "UPI", date: d(6) },
    { type: "debit", amount: 1320, category: "Electricity & Utilities", desc: "Electricity bill", paymentMode: "UPI", date: d(5) },
    { type: "debit", amount: 640, category: "Food & Dining Out", desc: "Dinner with friends", paymentMode: "Credit Card", date: d(3) },
    { type: "credit", amount: 6500, category: "Freelance & Business", desc: "Logo design project", paymentMode: "UPI", date: d(2) },
    { type: "debit", amount: 300, category: "Transport, Petrol & Cab", desc: "Cab to office", paymentMode: "UPI", date: d(1) },
    { type: "debit", amount: 180, category: "Food & Dining Out", desc: "Tea & snacks", paymentMode: "Cash", date: d(0) },
  ];
  const btn = $("sampleBtn"); btn.disabled = true;
  try { const n = await insertMany(sample); await loadAll(); render(); toast(`${n} sample entries added`); }
  catch (e) { toast(friendly(e), "err"); }
  finally { btn.disabled = false; }
};
$("signOutBtn").onclick = async () => { await sb.auth.signOut(); };
$("wipeBtn").onclick = () => confirmAsk("Delete all your entries?", `All ${state.tx.length} entries in your account will be removed from every device. Download a backup first if you might need them.`, async () => {
  const { error } = await sb.from("transactions").delete().eq("user_id", state.user.id);
  if (error) throw error;
  state.tx = []; render(); toast("All entries deleted");
}, "Delete all");

/* ════════════════ shared by the other sections ════════════════ */
// A bottom sheet whose contents each section fills in (loan form, vault item…).
function openPanel(html) {
  const p = $("panel");
  $("sheet").classList.remove("on"); $("sheet").hidden = true;
  $("confirm").classList.remove("on"); $("confirm").hidden = true;
  p.innerHTML = `<div class="grabber"></div>${html}`;
  p.scrollTop = 0;
  if (!p.classList.contains("on")) openLayer(p);
  return p;
}
function panelError(p, text) { const el = p.querySelector(".err-text"); if (el) { el.hidden = !text; el.textContent = text || ""; } }
function num(v) { const n = parseFloat(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : NaN; }
function round2(n) { return Math.round(n * 100) / 100; }
function dateObj(str) { return new Date(str + "T00:00:00"); }
function dateStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function daysBetween(a, b) { return Math.round((dateObj(b) - dateObj(a)) / 86400000); }
// same day n months later; the 31st becomes the month's last day when needed
function addMonths(str, n) {
  const d = dateObj(str), day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return dateStr(t);
}
function shortDate(str) { return dateObj(str).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
// "1 yr 3 mo", "4 mo 12 d", "9 d"
function duration(a, b) {
  if (b < a) return "0 d";
  let m = 0; while (addMonths(a, m + 1) <= b) m++;
  const d = daysBetween(addMonths(a, m), b), y = Math.floor(m / 12), mo = m % 12;
  return [y && `${y} yr`, mo && `${mo} mo`, (d || !m) && `${d} d`].filter(Boolean).join(" ");
}

/* ════════════════ start ════════════════ */
async function enterApp(user) {
  state.user = user;
  state.currency = (user.user_metadata && user.user_metadata.currency) || "₹";
  show("app"); go("viewHome");
  state.loaded = false; render();
  try { await loadAll(); } catch (e) { toast(friendly(e), "err"); state.loaded = true; }
  render(); listen();
  await Promise.all(loadHooks.map((f) => f().catch((e) => toast(friendly(e), "err"))));
  render();
}
function leaveApp() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  Object.assign(state, { user: null, tx: [], loaded: false });
  for (const f of resetHooks) f();
  closeLayers(); show("authScreen"); setAuthMode("in");
  $("authPass").value = "";
}

// starts once every script on the page (loans.js, invest.js, vault.js) has loaded
window.addEventListener("DOMContentLoaded", function start() {
  if (!window.supabase || /YOUR-PROJECT-REF/.test(SUPABASE_URL)) { show("setupScreen"); return; }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let entered = null;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { state.user = session.user; show("resetScreen"); return; }
    const user = session && session.user;
    if (user && entered !== user.id) { entered = user.id; enterApp(user); }
    else if (!user && entered !== null) { entered = null; leaveApp(); }
    else if (!user && entered === null) { show("authScreen"); }
  });
});
