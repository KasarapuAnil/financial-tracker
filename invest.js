/* ════════════════════════════════════════════════════════════════════════════
   Investments — what you've put in, what it's likely worth now, and where it
   goes if you keep going. Plus the More page's net-worth summary.

   Each monthly instalment grows at the expected yearly return from its own
   date, compounded; a one-time amount grows from the start date. Deposits
   (FD, RD, chit) stop growing at maturity; the others only stop taking new
   money on their end date. Enter a real "current value" from your statement
   and it replaces the estimate for today, and projections grow from it.
   ════════════════════════════════════════════════════════════════════════════ */
const INV_KINDS = {
  sip: { icon: "📈", label: "SIP / Mutual fund", ret: 12 },
  fd: { icon: "🏦", label: "Fixed deposit", ret: 7, matures: true },
  rd: { icon: "🔁", label: "Recurring deposit", ret: 7, matures: true },
  stocks: { icon: "📊", label: "Stocks", ret: 12 },
  gold: { icon: "🪙", label: "Gold", ret: 9 },
  ppf: { icon: "🛡️", label: "PPF / EPF / NPS", ret: 7.1, noCash: true },
  insurance: { icon: "☂️", label: "Insurance policy", ret: 8 },
  chit: { icon: "🤝", label: "Chit fund", ret: 8, matures: true },
  property: { icon: "🏠", label: "Property", ret: 6 },
  other: { icon: "💼", label: "Other", ret: 8 },
};
// how often the regular amount is paid (months between payments); 0 = one-time only
const FREQS = [
  { m: 0, label: "One-time", sub: "pay once" },
  { m: 1, label: "Monthly", sub: "every month", per: "month" },
  { m: 3, label: "Quarterly", sub: "every 3 months", per: "quarter" },
  { m: 6, label: "Half-yearly", sub: "every 6 months", per: "6 months" },
  { m: 12, label: "Yearly", sub: "once a year", per: "year" },
];
const freqOf = (i) => [1, 3, 6, 12].includes(+i.frequency_months) ? +i.frequency_months : 1;
const freqInfo = (m) => FREQS.find((f) => f.m === m) || FREQS[1];
// the regular amount spread per month, e.g. ₹30,000 every 6 months → ₹5,000/month
const perMonth = (i) => +i.monthly_amount / freqOf(i);
// next payment on or after a date (null when it has stopped); with `after`,
// strictly after it
function nextDue(i, from = todayStr(), after = false) {
  if (!(+i.monthly_amount > 0)) return null;
  const f = freqOf(i);
  for (let k = 0; k < 1200; k++) {
    const d = addMonths(i.start_date, k * f);
    if (i.end_date && d > i.end_date) return null;
    if (after ? d > from : d >= from) return d;
  }
  return null;
}
// a payment falling today is already made: counted in "Invested" and (unless
// noCash) taken from cash on its date, so it is "paid", not "due"
const paidToday = (i) => nextDue(i) === todayStr();
function dueLabel(d) {
  const n = daysBetween(todayStr(), d);
  return n === 0 ? "Due today" : n === 1 ? "Tomorrow" : n < 31 ? `In ${n} days` : shortDate(d);
}
Object.assign(state, { invs: [], invsLoaded: false, invYears: 10 });

/* ── money added later ("＋ Add money") ──
   Each extra buy is a cash entry with legacy_id "inv:<id>:add:<stamp>": the
   entry IS the record, so it is taken from cash once, and deleting it from
   the cash list takes it out of the investment too. */
const addKey = (i) => `inv:${i.id}:add:`;
function topUps(i) {
  const key = addKey(i);
  return state.tx.filter((t) => t.legacyId && t.legacyId.startsWith(key) && t.type === "debit").map((t) => ({ date: t.date, amount: +t.amount }));
}

/* ── the calculation ── */
function grow(r, from, to) { return to > from ? Math.pow(1 + r, daysBetween(from, to) / 365) : 1; }
function instalments(i, upTo) {
  const out = [];
  if (+i.monthly_amount > 0) {
    const stop = i.end_date && i.end_date < upTo ? i.end_date : upTo;
    const f = freqOf(i);
    for (let k = 0; k < 1200; k++) { const d = addMonths(i.start_date, k * f); if (d > stop) break; out.push(d); }
  }
  return out;
}
// { invested, value } on a date, from the start (the plain estimate)
function invEstimate(i, asOf) {
  if (asOf < i.start_date) return { invested: 0, value: 0 };
  const r = (+i.expected_return || 0) / 100;
  const until = INV_KINDS[i.kind] && INV_KINDS[i.kind].matures && i.end_date && i.end_date < asOf ? i.end_date : asOf;
  let invested = +i.lump_amount, value = +i.lump_amount * grow(r, i.start_date, until);
  for (const d of instalments(i, asOf)) { invested += +i.monthly_amount; value += +i.monthly_amount * grow(r, d, until); }
  for (const a of topUps(i)) if (a.date <= asOf) { invested += a.amount; value += a.amount * grow(r, a.date, until); }
  return { invested, value };
}
// the same, but anchored to the real current value when one was entered: that
// value is as of the day it was entered (current_value_on), and every payment
// after that day is added on top of it, so an instalment taken from cash also
// shows up here
function invAt(i, asOf) {
  const on = i.current_value_on || todayStr();
  if (i.current_value == null || asOf < on) return invEstimate(i, asOf);
  const r = (+i.expected_return || 0) / 100;
  const until = INV_KINDS[i.kind] && INV_KINDS[i.kind].matures && i.end_date && i.end_date < asOf ? i.end_date : asOf;
  let value = +i.current_value * grow(r, on, until);
  for (const d of instalments(i, asOf)) if (d > on) value += +i.monthly_amount * grow(r, d, until);
  for (const a of topUps(i)) if (a.date > on && a.date <= asOf) value += a.amount * grow(r, a.date, until);
  return { invested: invEstimate(i, asOf).invested, value };
}
function invTotals(asOf) {
  let invested = 0, value = 0;
  for (const i of state.invs) { const x = invAt(i, asOf); invested += x.invested; value += x.value; }
  return { invested, value, gain: value - invested };
}
const activeMonthly = () => state.invs.filter((i) => +i.monthly_amount > 0 && i.start_date <= todayStr() && (!i.end_date || i.end_date >= todayStr()));

/* ── data ── */
async function loadInvs() {
  const { data, error } = await sb.from("investments").select("*").order("start_date", { ascending: false });
  if (error) throw error;
  state.invs = data; state.invsLoaded = true;
  await postInvDebits();
}

/* ── take investments out of cash ──
   Every monthly instalment and every one-time buy (stocks, FD…) becomes a
   "spent" entry on its date, so the cash balance drops. PF/PPF/EPF/NPS
   (noCash) only grows here and never touches cash. Each entry carries a
   legacy_id like "inv:<id>:2026-11-05", so it is only ever posted once.
   Nothing is posted before AUTO_ON, so older months stay as you entered them. */
const AUTO_ON = "2026-11-01";
const INV_CATEGORY = "Investments & SIP";
async function postInvDebits() {
  if (!state.loaded) return;
  const today = todayStr(), have = new Set(state.tx.map((t) => t.legacyId).filter(Boolean)), rows = [];
  for (const i of state.invs) {
    if ((INV_KINDS[i.kind] || {}).noCash) continue;
    const created = (i.created_at || today).slice(0, 10), floor = created > AUTO_ON ? created : AUTO_ON;
    const add = (key, amount, date) => {
      const legacy_id = `inv:${i.id}:${key}`;
      if (have.has(legacy_id) || !(amount > 0)) return;
      rows.push({ type: "debit", amount: round2(amount), category: INV_CATEGORY, description: `${i.name} · auto`, payment_mode: "Auto debit", tx_date: date, legacy_id, user_id: state.user.id });
    };
    if (+i.lump_amount > 0 && created >= AUTO_ON && i.start_date <= today) add("lump", +i.lump_amount, i.start_date);
    for (const d of instalments(i, today)) if (d >= floor) add(d, +i.monthly_amount, d);
  }
  if (!rows.length) return;
  const { error } = await sb.from("transactions").upsert(rows, { onConflict: "user_id,legacy_id", ignoreDuplicates: true });
  if (error) throw error;
  await loadAll(); render();
  toast(`${rows.length} investment ${rows.length === 1 ? "payment" : "payments"} taken from cash`);
}
loadHooks.push(loadInvs);
resetHooks.push(() => Object.assign(state, { invs: [], invsLoaded: false }));
renderHooks.push(renderInvest, renderMore);
fabHooks.viewInvest = () => openInvForm(null);

/* ── the Investments page ── */
function pct(gain, base) { return base > 0 ? ` (${gain >= 0 ? "+" : "−"}${Math.abs(round2((gain / base) * 100))}%)` : ""; }
function renderInvest() {
  const today = todayStr(), t = invTotals(today);
  $("iValue").textContent = fmt(t.value);
  $("iInvested").textContent = fmt(t.invested);
  $("iGain").textContent = (t.gain >= 0 ? "+" : "−") + fmt(t.gain);
  $("iGainPct").textContent = pct(t.gain, t.invested).trim();
  const monthly = activeMonthly();
  $("iMonthly").textContent = fmt(monthly.reduce((s, i) => s + perMonth(i), 0)) + "/mo";
  $("iMonthlySub").textContent = monthly.length ? `on average across ${monthly.length} running ${monthly.length === 1 ? "investment" : "investments"} · ${fmt(monthly.reduce((s, i) => s + perMonth(i) * 12, 0))} a year` : "no regular investments running";
  // upcoming payments in the next 90 days
  const soon = state.invs.map((i) => ({ i, d: nextDue(i, today, true) })).filter((x) => x.d && daysBetween(today, x.d) <= 90).sort((a, b) => (a.d < b.d ? -1 : 1));
  const up = $("iUpcoming");
  up.hidden = !soon.length;
  up.innerHTML = soon.length ? `<span class="muted small-label">Coming up</span>` + soon.slice(0, 6).map(({ i, d }) => `<div class="due-row"><span class="avatar-sm brand-bg">${(INV_KINDS[i.kind] || INV_KINDS.other).icon}</span><span class="tx-main"><b>${esc(i.name)}</b><span>${fmt(i.monthly_amount)} · ${esc(freqInfo(freqOf(i)).label.toLowerCase())}</span></span><span class="due-when ${daysBetween(today, d) <= 7 ? "soon" : ""}">${esc(dueLabel(d))}</span></div>`).join("") : "";
  // projection
  document.querySelectorAll("[data-years]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.years === state.invYears));
  const pts = [];
  for (let y = 0; y <= state.invYears; y++) { const d = addMonths(today, 12 * y); pts.push({ y, ...invTotals(d) }); }
  const last = pts[pts.length - 1];
  $("iProj").innerHTML = state.invs.length
    ? `In ${state.invYears} ${state.invYears === 1 ? "year" : "years"} (${esc(shortDate(addMonths(today, 12 * state.invYears)))}): <b class="num">${fmt(last.value)}</b><br><span class="muted">You'd have put in ${fmt(last.invested)} · growth ${fmt(last.value - last.invested)}</span>`
    : "Add an investment to see where it's heading.";
  drawGrowth($("iChart"), pts);
  $("invList").innerHTML = !state.invsLoaded ? skeletons(2)
    : state.invs.length ? state.invs.map(invCard).join("")
    : emptyBox("📈", "No investments yet. Tap ＋ to add a SIP, FD, gold, stocks…");
}
function invCard(i) {
  const k = INV_KINDS[i.kind] || INV_KINDS.other, now = invAt(i, todayStr()), gain = now.value - now.invested;
  const parts = [];
  if (+i.monthly_amount) parts.push(`${fmt(i.monthly_amount)}/${freqInfo(freqOf(i)).per}`);
  if (+i.lump_amount) parts.push(`${fmt(i.lump_amount)} once`);
  const added = topUps(i).reduce((s, a) => s + a.amount, 0);
  if (added) parts.push(`+${fmt(added)} added`);
  parts.push(`since ${shortDate(i.start_date)}`);
  const ended = i.end_date && i.end_date < todayStr(), nd = !ended && nextDue(i, todayStr(), true);
  if (!ended && paidToday(i)) parts.push("paid today ✓");
  if (nd) parts.push(`next ${shortDate(nd)}`);
  return `<button class="card item" data-inv="${esc(i.id)}">
    <div class="item-top">
      <span class="avatar-sm brand-bg">${k.icon}</span>
      <span class="tx-main"><b>${esc(i.name)}</b><span>${esc(parts.join(" · "))} · ${+i.expected_return}%/yr</span></span>
      ${ended ? `<span class="badge">${k.matures ? "Matured" : "Stopped"}</span>` : i.current_value != null ? `<span class="badge ok">Actual</span>` : ""}
    </div>
    <div class="nums">
      <div><small>Invested</small><b class="num">${fmt(now.invested)}</b></div>
      <div><small>${i.current_value != null ? "Value" : "Est. value"}</small><b class="num">${fmt(now.value)}</b></div>
      <div><small>Gain</small><b class="num ${gain >= 0 ? "credit" : "debit"}">${gain >= 0 ? "+" : "−"}${fmt(gain)}</b></div>
    </div>
  </button>`;
}
function drawGrowth(svg, pts) {
  const W = 340, H = 150, padL = 4, padB = 18, top = 10;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.value, p.invested)));
  const x = (k) => padL + (k / Math.max(1, pts.length - 1)) * (W - padL * 2);
  const y = (v) => H - padB - (v / max) * (H - padB - top);
  const line = (key) => pts.map((p, k) => `${x(k).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const step = pts.length > 11 ? Math.ceil((pts.length - 1) / 5) : 1;
  let s = `<line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="var(--line)"/>`;
  s += `<polygon points="${x(0)},${H - padB} ${line("value")} ${x(pts.length - 1)},${H - padB}" fill="var(--brand)" opacity=".12"/>`;
  s += `<polyline points="${line("invested")}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4"/>`;
  s += `<polyline points="${line("value")}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round"/>`;
  pts.forEach((p, k) => { if (k % step === 0 || k === pts.length - 1) s += `<text x="${x(k)}" y="${H - 3}" text-anchor="${k === 0 ? "start" : k === pts.length - 1 ? "end" : "middle"}" font-size="10" font-weight="700" fill="var(--muted)">${k === 0 ? "Now" : `${p.y}y`}</text>`; });
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = s;
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-inv]"); if (c) return openInvForm(state.invs.find((i) => i.id === c.dataset.inv));
  const y = e.target.closest("[data-years]"); if (y) { state.invYears = +y.dataset.years; renderInvest(); }
});

/* ── add / edit an investment ── */
function openInvForm(i) {
  const v = i || { kind: "sip", name: "", monthly_amount: "", lump_amount: "", frequency_months: 1, start_date: todayStr(), end_date: "", expected_return: INV_KINDS.sip.ret, current_value: null, note: "" };
  let kind = v.kind, freq = i && !(+i.monthly_amount > 0) ? 0 : freqOf(v);
  const p = openPanel(`
    <h3>${i ? "Edit investment" : "New investment"}</h3>
    <div class="cat-grid" id="ifKinds">${Object.entries(INV_KINDS).map(([k, x]) => `<button type="button" class="cat-opt" data-kind="${k}" aria-pressed="${k === kind}"><b>${x.icon}</b>${esc(x.label.split(" / ")[0])}</button>`).join("")}</div>
    <div class="field"><label for="ifName">Name</label><input class="input" id="ifName" maxlength="80" value="${esc(v.name)}" placeholder="e.g. Nifty 50 index fund, SBI FD"></div>
    <label class="mt" style="display:block;font-weight:700;font-size:13px;margin-bottom:6px">How often do you pay?</label>
    <div class="freq-grid" id="ifFreqs" role="group" aria-label="How often">${FREQS.map((f) => `<button type="button" class="freq-opt" data-freq="${f.m}" aria-pressed="${f.m === freq}"><b>${f.label}</b><span>${f.sub}</span></button>`).join("")}</div>
    <div class="form-grid">
      <div class="field" id="ifMonthlyWrap"><label for="ifMonthly" id="ifMonthlyLabel"></label><input class="input" id="ifMonthly" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(+v.monthly_amount || "")}" placeholder="0"></div>
      <div class="field"><label for="ifLump" id="ifLumpLabel"></label><input class="input" id="ifLump" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(+v.lump_amount || "")}" placeholder="0"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="ifStart">Started on</label><input class="input" id="ifStart" type="date" value="${esc(v.start_date)}"></div>
      <div class="field"><label for="ifEnd" id="ifEndLabel"></label><input class="input" id="ifEnd" type="date" value="${esc(v.end_date || "")}"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="ifRet">Expected return (% a year)</label><input class="input" id="ifRet" type="number" inputmode="decimal" step="0.1" min="-100" max="100" value="${esc(v.expected_return)}"></div>
      <div class="field"><label for="ifCur">Actual value today</label><input class="input" id="ifCur" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(v.current_value ?? "")}" placeholder="optional"></div>
    </div>
    <p class="fine left" id="ifCashNote"></p>
    <p class="fine left">Know the real value from your app or statement? Enter it under “Actual value today” — it replaces the estimate. Leave it empty to estimate from the expected return.</p>
    <div class="field mt"><label for="ifNote">Note (optional)</label><input class="input" id="ifNote" maxlength="500" value="${esc(v.note)}" placeholder="folio no., bank, nominee…"></div>
    <div class="calc-out" id="ifPreview"></div>
    <div class="err-text" hidden></div>
    ${i && !(INV_KINDS[i.kind] || {}).noCash ? `<button type="button" class="btn btn-ghost mt" id="ifAdd" style="width:100%">＋ Add money — bought more today</button>
    <p class="fine left">Bought more? Use “Add money”: it is taken from your cash balance and added here from its date. Changing the one-time amount above only corrects your first buy.</p>` : ""}
    <div class="sheet-actions ${i ? "" : "single"} mt">${i ? `<button class="btn btn-danger" id="ifDel">Delete</button>` : ""}<button class="btn btn-primary" id="ifSave">${i ? "Save changes" : "Add investment"}</button></div>`);
  const read = () => {
    const cur = p.querySelector("#ifCur").value;
    return {
      kind, name: p.querySelector("#ifName").value.trim(),
      monthly_amount: freq ? num(p.querySelector("#ifMonthly").value || 0) : 0, frequency_months: freq || 1, lump_amount: num(p.querySelector("#ifLump").value || 0),
      start_date: p.querySelector("#ifStart").value, end_date: p.querySelector("#ifEnd").value || null,
      expected_return: num(p.querySelector("#ifRet").value || 0), current_value: cur === "" ? null : num(cur),
      note: p.querySelector("#ifNote").value.trim(),
    };
  };
  const preview = () => {
    const r = read(), today = todayStr();
    p.querySelector("#ifCashNote").textContent = INV_KINDS[kind].noCash ? "🛡️ Not taken from cash — this only grows here (e.g. PF deducted from salary)." : "💸 Each payment and one-time buy is taken from your cash balance automatically on its date.";
    const fi = freqInfo(freq);
    p.querySelector("#ifMonthlyWrap").hidden = !freq;
    p.querySelector("#ifMonthlyLabel").textContent = freq ? `Amount ${fi.sub}` : "";
    p.querySelector("#ifLumpLabel").textContent = freq ? "Extra one-time amount (optional)" : "Amount";
    p.querySelector("#ifStart").previousElementSibling.textContent = freq ? "First payment on" : "Paid on";
    p.querySelector("#ifEndLabel").textContent = INV_KINDS[kind].matures ? "Matures on (optional)" : "Stop adding on (optional)";
    const out = p.querySelector("#ifPreview");
    if (!(r.monthly_amount > 0 || r.lump_amount > 0) || !r.start_date) { out.textContent = "Enter an amount to see the numbers."; return; }
    const nd = nextDue(r), sched = r.monthly_amount > 0 ? `${fmt(r.monthly_amount)} ${fi.sub} = <b class="num">${fmt((r.monthly_amount * 12) / freq)}</b> a year${nd ? ` · next due <b>${esc(shortDate(nd))}</b>` : ""}<br>` : "";
    const now = invAt(r, today), y5 = invAt(r, addMonths(today, 60)), y10 = invAt(r, addMonths(today, 120));
    out.innerHTML = `${sched}Invested so far <b class="num">${fmt(now.invested)}</b> · worth <b class="num">${fmt(now.value)}</b><br>In 5 years <b class="num">${fmt(y5.value)}</b> · in 10 years <b class="num">${fmt(y10.value)}</b>`;
  };
  p.querySelector("#ifKinds").onclick = (e) => {
    const b = e.target.closest("[data-kind]"); if (!b) return;
    const prevDefault = INV_KINDS[kind].ret;
    kind = b.dataset.kind;
    p.querySelectorAll("[data-kind]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    const ret = p.querySelector("#ifRet");
    if (num(ret.value) === prevDefault || ret.value === "") ret.value = INV_KINDS[kind].ret;
    preview();
  };
  p.querySelector("#ifFreqs").onclick = (e) => {
    const b = e.target.closest("[data-freq]"); if (!b) return;
    freq = +b.dataset.freq;
    p.querySelectorAll("[data-freq]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    preview();
  };
  p.addEventListener("input", preview); p.addEventListener("change", preview); preview();
  p.querySelector("#ifSave").onclick = async (e) => {
    const r = read();
    if (!r.name) return panelError(p, "Give it a name.");
    if (!(r.monthly_amount >= 0) || !(r.lump_amount >= 0) || !(r.monthly_amount > 0 || r.lump_amount > 0)) return panelError(p, freq ? `Enter the amount you pay ${freqInfo(freq).sub}.` : "Enter the amount.");
    if (r.monthly_amount > 1e11 || r.lump_amount > 1e11 || (r.current_value != null && !(r.current_value >= 0 && r.current_value <= 1e11))) return panelError(p, "Check the amounts.");
    if (!r.start_date) return panelError(p, "Pick the start date.");
    if (r.end_date && r.end_date < r.start_date) return panelError(p, "The end date is before the start date.");
    if (!(r.expected_return >= -100 && r.expected_return <= 100)) return panelError(p, "Expected return must be between −100% and 100%.");
    panelError(p, "");
    const row = { ...r, monthly_amount: round2(r.monthly_amount), lump_amount: round2(r.lump_amount), expected_return: round2(r.expected_return), current_value: r.current_value == null ? null : round2(r.current_value) };
    // the actual value is as of today when it is entered or changed; kept as
    // it was when left alone (editing the name doesn't move its date)
    row.current_value_on = row.current_value == null ? null
      : i && i.current_value != null && +i.current_value === row.current_value && i.current_value_on ? i.current_value_on
      : todayStr();
    busy(e.currentTarget, true);
    try {
      const { error } = i ? await sb.from("investments").update(row).eq("id", i.id) : await sb.from("investments").insert(row);
      if (error) throw error;
      await loadInvs(); render(); closeLayers(); toast(i ? "Investment updated" : "Investment added");
    } catch (er) { panelError(p, /frequency_months|current_value_on/.test(er && er.message || "") ? "Your database needs the new “how often” column — run supabase/schema.sql in the Supabase SQL editor." : friendly(er)); busy(e.currentTarget, false); }
  };
  const addBtn = p.querySelector("#ifAdd");
  if (addBtn) addBtn.onclick = () => openAddMoney(i);
  if (i) p.querySelector("#ifDel").onclick = () => {
    // the cash entries it made (its buys, instalments, money added): deleted
    // with it, so their money comes back to the cash balance
    const paid = state.tx.filter((t) => t.legacyId && t.legacyId.startsWith(`inv:${i.id}:`));
    const back = paid.reduce((s, t) => s + (t.type === "debit" ? +t.amount : 0), 0);
    confirmAsk(`Delete “${i.name}”?`, back ? `It will be removed from your investments, and the ${fmt(back)} it took from cash goes back to your cash balance.` : "It will be removed from your investments.", async () => {
      if (paid.length) {
        const { error } = await sb.from("transactions").delete().like("legacy_id", `inv:${i.id}:%`);
        if (error) throw error;
      }
      const { error } = await sb.from("investments").delete().eq("id", i.id);
      if (error) throw error;
      await loadAll(); await loadInvs(); render(); toast(back ? `Investment deleted · ${fmt(back)} back in cash` : "Investment deleted");
    });
  };
}

/* ── ＋ Add money: an extra buy, taken from cash ── */
function openAddMoney(i) {
  const k = INV_KINDS[i.kind] || INV_KINDS.other;
  const p = openPanel(`
    <h3>${k.icon} Add money to ${esc(i.name)}</h3>
    <div class="form-grid">
      <div class="field"><label for="amAmt">Amount</label><input class="input" id="amAmt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0"></div>
      <div class="field"><label for="amDate">Date</label><input class="input" id="amDate" type="date" value="${esc(todayStr())}" max="${esc(todayStr())}"></div>
    </div>
    <p class="fine left">💸 This is taken from your cash balance and added to this investment from that date.</p>
    <div class="err-text" hidden></div>
    <div class="sheet-actions mt"><button class="btn btn-ghost" id="amBack">Back</button><button class="btn btn-primary" id="amSave">Add money</button></div>`);
  p.querySelector("#amAmt").focus();
  p.querySelector("#amBack").onclick = () => openInvForm(i);
  p.querySelector("#amSave").onclick = async (e) => {
    const amount = num(p.querySelector("#amAmt").value), date = p.querySelector("#amDate").value;
    if (!(amount > 0) || amount > 1e11) return panelError(p, "Enter the amount you added.");
    if (!date) return panelError(p, "Pick the date.");
    if (date > todayStr()) return panelError(p, "The date can't be in the future.");
    panelError(p, "");
    busy(e.currentTarget, true);
    try {
      const { error } = await sb.from("transactions").insert({
        type: "debit", amount: round2(amount), category: INV_CATEGORY, description: `${i.name} · added`,
        payment_mode: "Auto debit", tx_date: date, legacy_id: `${addKey(i)}${Date.now()}`, user_id: state.user.id,
      });
      if (error) throw error;
      await loadAll(); render(); closeLayers(); toast(`${fmt(amount)} added to ${i.name} and taken from cash`);
    } catch (er) { panelError(p, friendly(er)); busy(e.currentTarget, false); }
  };
}

/* ── More: everything summed up ── */
function renderMore() {
  const cash = totals(state.tx).n, inv = invTotals(todayStr()).value, l = loanTotals();
  const net = cash + inv + l.get - l.owe;
  $("nwNet").textContent = signed(net);
  $("nwRows").innerHTML = [
    ["💵", "Cash balance", "All income minus all spending you've entered", cash],
    ["📈", "Investments", "Estimated value today", inv],
    ["⬆", "Money lent", "Due to you, with interest", l.get],
    ["⬇", "Money borrowed", "You owe, with interest", -l.owe],
  ].map(([ico, name, sub, v]) => `<div class="nw-row"><span class="ri">${ico}</span><span class="tx-main"><b>${name}</b><span>${sub}</span></span><b class="num ${v < 0 ? "debit" : ""}">${signed(v)}</b></div>`).join("");
  const monthly = activeMonthly().reduce((s, i) => s + perMonth(i), 0);
  $("tileInvSub").textContent = state.invs.length ? `${fmt(inv)} · ${fmt(monthly)}/mo` : "SIP, FD, gold…";
}
