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
  ppf: { icon: "🛡️", label: "PPF / EPF / NPS", ret: 7.1 },
  chit: { icon: "🤝", label: "Chit fund", ret: 8, matures: true },
  property: { icon: "🏠", label: "Property", ret: 6 },
  other: { icon: "💼", label: "Other", ret: 8 },
};
Object.assign(state, { invs: [], invsLoaded: false, invYears: 10 });

/* ── the calculation ── */
function grow(r, from, to) { return to > from ? Math.pow(1 + r, daysBetween(from, to) / 365) : 1; }
function instalments(i, upTo) {
  const out = [];
  if (+i.monthly_amount > 0) {
    const stop = i.end_date && i.end_date < upTo ? i.end_date : upTo;
    for (let k = 0; k < 1200; k++) { const d = addMonths(i.start_date, k); if (d > stop) break; out.push(d); }
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
  return { invested, value };
}
// the same, but anchored to the real current value when one was entered
function invAt(i, asOf) {
  const today = todayStr();
  if (i.current_value == null || asOf < today) return invEstimate(i, asOf);
  const r = (+i.expected_return || 0) / 100, base = invEstimate(i, today);
  const until = INV_KINDS[i.kind] && INV_KINDS[i.kind].matures && i.end_date && i.end_date < asOf ? i.end_date : asOf;
  let invested = base.invested, value = +i.current_value * grow(r, today, until);
  for (const d of instalments(i, asOf)) if (d > today) { invested += +i.monthly_amount; value += +i.monthly_amount * grow(r, d, until); }
  return { invested, value };
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
  $("iMonthly").textContent = fmt(monthly.reduce((s, i) => s + +i.monthly_amount, 0));
  $("iMonthlySub").textContent = monthly.length ? `every month across ${monthly.length} ${monthly.length === 1 ? "investment" : "investments"}` : "no monthly investments running";
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
  if (+i.monthly_amount) parts.push(`${fmt(i.monthly_amount)}/month`);
  if (+i.lump_amount) parts.push(`${fmt(i.lump_amount)} once`);
  parts.push(`since ${shortDate(i.start_date)}`);
  const ended = i.end_date && i.end_date < todayStr();
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
  const v = i || { kind: "sip", name: "", monthly_amount: "", lump_amount: "", start_date: todayStr(), end_date: "", expected_return: INV_KINDS.sip.ret, current_value: null, note: "" };
  let kind = v.kind;
  const p = openPanel(`
    <h3>${i ? "Edit investment" : "New investment"}</h3>
    <div class="cat-grid" id="ifKinds">${Object.entries(INV_KINDS).map(([k, x]) => `<button type="button" class="cat-opt" data-kind="${k}" aria-pressed="${k === kind}"><b>${x.icon}</b>${esc(x.label.split(" / ")[0])}</button>`).join("")}</div>
    <div class="field"><label for="ifName">Name</label><input class="input" id="ifName" maxlength="80" value="${esc(v.name)}" placeholder="e.g. Nifty 50 index fund, SBI FD"></div>
    <div class="form-grid mt">
      <div class="field"><label for="ifMonthly">Every month</label><input class="input" id="ifMonthly" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(+v.monthly_amount || "")}" placeholder="0"></div>
      <div class="field"><label for="ifLump">One-time amount</label><input class="input" id="ifLump" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(+v.lump_amount || "")}" placeholder="0"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="ifStart">Started on</label><input class="input" id="ifStart" type="date" value="${esc(v.start_date)}"></div>
      <div class="field"><label for="ifEnd" id="ifEndLabel"></label><input class="input" id="ifEnd" type="date" value="${esc(v.end_date || "")}"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="ifRet">Expected return (% a year)</label><input class="input" id="ifRet" type="number" inputmode="decimal" step="0.1" min="-100" max="100" value="${esc(v.expected_return)}"></div>
      <div class="field"><label for="ifCur">Actual value today</label><input class="input" id="ifCur" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(v.current_value ?? "")}" placeholder="optional"></div>
    </div>
    <p class="fine left">Know the real value from your app or statement? Enter it under “Actual value today” — it replaces the estimate. Leave it empty to estimate from the expected return.</p>
    <div class="field mt"><label for="ifNote">Note (optional)</label><input class="input" id="ifNote" maxlength="500" value="${esc(v.note)}" placeholder="folio no., bank, nominee…"></div>
    <div class="calc-out" id="ifPreview"></div>
    <div class="err-text" hidden></div>
    <div class="sheet-actions ${i ? "" : "single"} mt">${i ? `<button class="btn btn-danger" id="ifDel">Delete</button>` : ""}<button class="btn btn-primary" id="ifSave">${i ? "Save changes" : "Add investment"}</button></div>`);
  const read = () => {
    const cur = p.querySelector("#ifCur").value;
    return {
      kind, name: p.querySelector("#ifName").value.trim(),
      monthly_amount: num(p.querySelector("#ifMonthly").value || 0), lump_amount: num(p.querySelector("#ifLump").value || 0),
      start_date: p.querySelector("#ifStart").value, end_date: p.querySelector("#ifEnd").value || null,
      expected_return: num(p.querySelector("#ifRet").value || 0), current_value: cur === "" ? null : num(cur),
      note: p.querySelector("#ifNote").value.trim(),
    };
  };
  const preview = () => {
    const r = read(), today = todayStr();
    p.querySelector("#ifEndLabel").textContent = INV_KINDS[kind].matures ? "Matures on (optional)" : "Stop adding on (optional)";
    const out = p.querySelector("#ifPreview");
    if (!(r.monthly_amount > 0 || r.lump_amount > 0) || !r.start_date) { out.textContent = "Enter a monthly or one-time amount to see the numbers."; return; }
    const now = invAt(r, today), y5 = invAt(r, addMonths(today, 60)), y10 = invAt(r, addMonths(today, 120));
    out.innerHTML = `Invested so far <b class="num">${fmt(now.invested)}</b> · worth <b class="num">${fmt(now.value)}</b><br>In 5 years <b class="num">${fmt(y5.value)}</b> · in 10 years <b class="num">${fmt(y10.value)}</b>`;
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
  p.addEventListener("input", preview); p.addEventListener("change", preview); preview();
  p.querySelector("#ifSave").onclick = async (e) => {
    const r = read();
    if (!r.name) return panelError(p, "Give it a name.");
    if (!(r.monthly_amount >= 0) || !(r.lump_amount >= 0) || !(r.monthly_amount > 0 || r.lump_amount > 0)) return panelError(p, "Enter a monthly amount, a one-time amount, or both.");
    if (r.monthly_amount > 1e11 || r.lump_amount > 1e11 || (r.current_value != null && !(r.current_value >= 0 && r.current_value <= 1e11))) return panelError(p, "Check the amounts.");
    if (!r.start_date) return panelError(p, "Pick the start date.");
    if (r.end_date && r.end_date < r.start_date) return panelError(p, "The end date is before the start date.");
    if (!(r.expected_return >= -100 && r.expected_return <= 100)) return panelError(p, "Expected return must be between −100% and 100%.");
    panelError(p, "");
    const row = { ...r, monthly_amount: round2(r.monthly_amount), lump_amount: round2(r.lump_amount), expected_return: round2(r.expected_return), current_value: r.current_value == null ? null : round2(r.current_value) };
    busy(e.currentTarget, true);
    try {
      const { error } = i ? await sb.from("investments").update(row).eq("id", i.id) : await sb.from("investments").insert(row);
      if (error) throw error;
      await loadInvs(); render(); closeLayers(); toast(i ? "Investment updated" : "Investment added");
    } catch (er) { panelError(p, friendly(er)); busy(e.currentTarget, false); }
  };
  if (i) p.querySelector("#ifDel").onclick = () => confirmAsk(`Delete “${i.name}”?`, "It will be removed from your investments.", async () => {
    const { error } = await sb.from("investments").delete().eq("id", i.id);
    if (error) throw error;
    await loadInvs(); render(); toast("Investment deleted");
  });
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
  const monthly = activeMonthly().reduce((s, i) => s + +i.monthly_amount, 0);
  $("tileInvSub").textContent = state.invs.length ? `${fmt(inv)} · ${fmt(monthly)}/mo` : "SIP, FD, gold…";
}
