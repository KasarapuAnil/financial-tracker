/* ════════════════════════════════════════════════════════════════════════════
   Year insights — the deeper look under More → Yearly: this year against the
   last, month against month, where the money went and what grew most, every
   investment type, the loans, the farm, the total corpus, and where it is
   heading.

   Nothing here is stored. It is all worked out from what the other pages
   already keep: cash entries (app.js), investments (invest.js — its value on
   any date), loans (loans.js — the balance on any date) and the farm's crop
   cycles (farm.js).

   NET WORTH (the corpus) on a date = cash balance + what the investments are
   worth + what others owe you − what you owe. Investment payments come out of
   cash and show up in the investments, so they move money between the two,
   not out of the corpus.
   ════════════════════════════════════════════════════════════════════════════ */
Object.assign(state, { insRet: 10, insInfl: true });

const INS_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INS_YEARS = [1, 2, 5, 10, 20, 30];
const INFLATION = 0.06; // a yearly 6%, for "in today's money"

/* ── small pieces ── */
// whole rupees: paisa is noise in an overview
const money = (n) => fmt(Math.round(+n || 0));
const sgn = (n) => signed(Math.round(+n || 0));
const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
// the last day of a month (m 1-12), or today if that is still to come
function monthEnd(y, m) {
  const d = dateStr(new Date(y, m, 0)), t = todayStr();
  return d > t ? t : d;
}
const yearEnd = (y) => monthEnd(y, 12);
const inYear = (y) => state.tx.filter((t) => t.date.startsWith(String(y)));
// a change as "▲ 12%" — up is green unless `upIsBad` (spending, debts)
function chg(cur, prev, upIsBad) {
  if (!prev && !cur) return `<span class="chg flat">—</span>`;
  if (!prev) return `<span class="chg flat">new</span>`;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(d) < 0.5) return `<span class="chg flat">● same</span>`;
  const up = d > 0, good = upIsBad ? !up : up;
  return `<span class="chg ${good ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(d) >= 1000 ? ">999" : Math.round(Math.abs(d))}%</span>`;
}
const diff = (n) => (n >= 0 ? "+" : "−") + money(Math.abs(n));
function kpi(label, value, change, cls = "") {
  return `<div class="ins-kpi"><span>${esc(label)}</span><b class="num ${cls}">${value}</b>${change}</div>`;
}

/* ── what each part is worth on a date ── */
const cashAt = (d) => totals(state.tx.filter((t) => t.date <= d)).n;
const invAtDate = (d) => (state.invs.length ? invTotals(d) : { invested: 0, value: 0, gain: 0 });
function loansAt(d) {
  let get = 0, owe = 0;
  for (const l of state.loans) {
    if (l.start_date > d) continue;
    const c = loanCalc(l, paysOf(l.id), d);
    const bal = Math.max(0, c.balance);
    if (l.closed_on && l.closed_on <= d) continue;
    if (l.direction === "lent") get += bal; else owe += bal;
  }
  return { get, owe };
}
function worthAt(d) {
  const cash = cashAt(d), inv = invAtDate(d).value, l = loansAt(d);
  return { cash, inv, get: l.get, owe: l.owe, net: cash + inv + l.get - l.owe };
}
// the first year anything was recorded
function firstYear() {
  const ys = [
    ...state.tx.map((t) => +t.date.slice(0, 4)),
    ...state.invs.map((i) => +i.start_date.slice(0, 4)),
    ...state.loans.map((l) => +l.start_date.slice(0, 4)),
    ...state.cycles.map((c) => +c.year),
  ].filter(Boolean);
  return ys.length ? Math.min(...ys) : new Date().getFullYear();
}

/* ── a line chart: one or two series over labelled points ── */
function drawLines(pts, series) {
  const W = 340, H = 150, padB = 18, top = 10;
  const all = pts.flatMap((p) => series.map((s) => p[s.key]));
  const max = Math.max(1, ...all), min = Math.min(0, ...all), span = max - min || 1;
  const x = (k) => (pts.length < 2 ? W / 2 : 6 + (k * (W - 12)) / (pts.length - 1));
  const y = (v) => top + (H - padB - top) * (1 - (v - min) / span);
  let s = `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>`;
  for (const se of series) {
    const line = pts.map((p, k) => `${x(k)},${y(p[se.key])}`).join(" ");
    if (se.fill) s += `<polygon points="${x(0)},${y(0)} ${line} ${x(pts.length - 1)},${y(0)}" fill="${se.color}" opacity=".12"/>`;
    s += `<polyline points="${line}" fill="none" stroke="${se.color}" stroke-width="${se.dash ? 2 : 2.5}" ${se.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
    pts.forEach((p, k) => (s += `<circle cx="${x(k)}" cy="${y(p[se.key])}" r="2.6" fill="${se.color}"><title>${esc(p.label)}: ${money(p[se.key])}</title></circle>`));
  }
  const step = Math.ceil(pts.length / 7);
  pts.forEach((p, k) => { if (k % step === 0 || k === pts.length - 1) s += `<text x="${x(k)}" y="${H - 3}" text-anchor="${k === 0 ? "start" : k === pts.length - 1 ? "end" : "middle"}" font-size="10" font-weight="700" fill="var(--muted)">${esc(p.label)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

/* ── more charts ── */
const INS_PAL = ["#6366F1", "#10B981", "#F59E0B", "#EC4899", "#06B6D4", "#8B5CF6", "#F97316", "#84CC16", "#EF4444", "#64748B"];
const legend = (items) => `<div class="legend">${items.map(([c, l]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}</div>`;
// paired columns: this period (solid) against the one before (faded)
function drawPairs(data, colA, colB) {
  const W = 340, H = 150, pad = 18, n = data.length, slot = (W - 8) / n, bw = Math.max(2, slot * 0.34);
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const y = (v) => H - pad - (v / max) * (H - pad - 8);
  let s = `<line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" stroke="var(--line)"/>`;
  data.forEach((d, k) => {
    const x = 4 + k * slot + (slot - bw * 2 - 1) / 2;
    if (d.b) s += `<rect x="${x}" y="${y(d.b)}" width="${bw}" height="${H - pad - y(d.b)}" rx="2" fill="${colB}" opacity=".45"><title>${esc(d.label)} ${esc(d.lb || "")}: ${money(d.b)}</title></rect>`;
    if (d.a) s += `<rect x="${x + bw + 1}" y="${y(d.a)}" width="${bw}" height="${H - pad - y(d.a)}" rx="2" fill="${colA}"><title>${esc(d.label)} ${esc(d.la || "")}: ${money(d.a)}</title></rect>`;
    s += `<text x="${4 + k * slot + slot / 2}" y="${H - 3}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--muted)">${esc(d.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}
// horizontal bars, one row per item; last period as a thin grey bar under it
function drawHBars(items) {
  const max = Math.max(1, ...items.flatMap((x) => [x.a, x.b || 0]));
  return `<div style="display:grid;gap:9px;margin-bottom:12px">${items.map((x, k) => `<div>
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:700"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.label}</span><span class="num">${money(x.a)}</span></div>
    <div style="height:9px;border-radius:9px;background:var(--surface-2);margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${(x.a / max) * 100}%;background:${x.color || INS_PAL[k % INS_PAL.length]};border-radius:9px"></i></div>
    ${x.b != null ? `<div style="height:4px;border-radius:4px;margin-top:2px;width:${(x.b / max) * 100}%;background:var(--muted);opacity:.5" title="last year ${money(x.b)}"></div>` : ""}
  </div>`).join("")}</div>`;
}
// a donut of shares, with the total in the middle
function drawDonut(items, mid, sub) {
  const total = items.reduce((t, x) => t + Math.max(0, x.v), 0), C = 2 * Math.PI * 40;
  let acc = 0, segs = "";
  items.forEach((x, k) => {
    const f = total ? Math.max(0, x.v) / total : 0;
    segs += `<circle cx="50" cy="50" r="40" fill="none" stroke="${INS_PAL[k % INS_PAL.length]}" stroke-width="14" stroke-dasharray="${f * C} ${C}" stroke-dashoffset="${-acc * C}" transform="rotate(-90 50 50)"><title>${esc(x.label)}: ${money(x.v)} (${Math.round(f * 100)}%)</title></circle>`;
    acc += f;
  });
  return `<div style="display:grid;grid-template-columns:130px 1fr;gap:14px;align-items:center;margin-bottom:12px">
    <div style="position:relative"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--surface-2)" stroke-width="14"/>${segs}</svg>
      <div style="position:absolute;inset:22%;display:grid;place-content:center;text-align:center;line-height:1.2"><small class="muted" style="font-size:9px">${esc(sub)}</small><b class="num" style="font-size:11px;word-break:break-all">${mid}</b></div></div>
    <div style="display:grid;gap:6px;font-size:12.5px">${items.map((x, k) => `<div style="display:flex;gap:8px;align-items:center"><i style="width:10px;height:10px;border-radius:3px;background:${INS_PAL[k % INS_PAL.length]};flex:none"></i><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.label)}</span><b>${total ? Math.round((Math.max(0, x.v) / total) * 100) : 0}%</b></div>`).join("")}</div>
  </div>`;
}
// stacked columns (the corpus's parts at each horizon)
function drawStacks(data, parts) {
  const W = 340, H = 170, pad = 18, n = data.length, slot = (W - 8) / n, bw = Math.min(34, slot * 0.6);
  const max = Math.max(1, ...data.map((d) => parts.reduce((t, p) => t + Math.max(0, d[p.key]), 0)));
  const h = (v) => (Math.max(0, v) / max) * (H - pad - 8);
  let s = `<line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" stroke="var(--line)"/>`;
  data.forEach((d, k) => {
    const x = 4 + k * slot + (slot - bw) / 2; let base = H - pad;
    for (const p of parts) { const hh = h(d[p.key]); if (!hh) continue; base -= hh; s += `<rect x="${x}" y="${base}" width="${bw}" height="${hh}" fill="${p.color}"><title>${esc(d.label)} · ${esc(p.label)}: ${money(d[p.key])}</title></rect>`; }
    s += `<text x="${4 + k * slot + slot / 2}" y="${H - 3}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--muted)">${esc(d.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

/* ── the page ── */
function renderInsights() {
  if (!state.user || state.view !== "viewYear") return;
  const Y = state.year, P = Y - 1;
  if (!state.loaded) { $("yrCompare").innerHTML = skeletons(2); return; }
  renderCompare(Y, P);
  renderWorth(Y);
  renderMoM(Y, P);
  renderCats(Y, P);
  renderInvTypes(Y, P);
  renderLoanYear(Y, P);
  renderFarmYear(Y, P);
  renderFuture();
}

// 1 · this year against the last, at a glance
function renderCompare(Y, P) {
  // saved = income − real spending: money put into investments is saved too
  const a = totals(inYear(Y)), b = totals(inYear(P));
  a.s = a.i - a.o; b.s = b.i - b.o;
  const rate = a.i ? (a.s / a.i) * 100 : 0, rateP = b.i ? (b.s / b.i) * 100 : 0;
  const wY = worthAt(yearEnd(Y)), wP = worthAt(yearEnd(P));
  const ivY = invAtDate(yearEnd(Y)), ivP = invAtDate(yearEnd(P));
  const rateChg = !b.i ? `<span class="chg flat">—</span>` : `<span class="chg ${rate >= rateP ? "up" : "down"}">${rate >= rateP ? "▲" : "▼"} ${Math.abs(Math.round(rate - rateP))} pts</span>`;
  $("yrCompare").innerHTML = `<h3>${Y} vs ${P}</h3>
    <div class="ins-grid">
      ${kpi("Income", money(a.i), chg(a.i, b.i), "credit")}
      ${kpi("Spent", money(a.o), chg(a.o, b.o, true), "debit")}
      ${kpi("Saved", sgn(a.s), chg(a.s, b.s), a.s >= 0 ? "credit" : "debit")}
      ${kpi("Invested", money(a.v), chg(a.v, b.v))}
      ${kpi("Kept as cash", sgn(a.n), chg(a.n, b.n), a.n >= 0 ? "credit" : "debit")}
      ${kpi("Savings rate", `${Math.round(rate)}%`, rateChg)}
      ${kpi("Net worth (year end)", sgn(wY.net), chg(wY.net, wP.net))}
      ${kpi("Investments value", money(ivY.value), chg(ivY.value, ivP.value))}
    </div>
    <p class="ins-note">Net worth grew by <b class="num">${diff(wY.net - wP.net)}</b> in ${Y}${Y === new Date().getFullYear() ? " so far" : ""}. ${a.i ? `You kept <b>${Math.round(rate)}%</b> of what came in.` : ""}</p>`;
}

// 2 · the corpus: month-end net worth through the year, and year on year
function renderWorth(Y) {
  const now = new Date(), lastM = Y === now.getFullYear() ? now.getMonth() + 1 : Y > now.getFullYear() ? 0 : 12;
  if (!lastM) { $("yrWorth").innerHTML = emptyBox("🏦", "This year hasn't started yet."); return; }
  const months = [], prevEnd = worthAt(yearEnd(Y - 1)).net;
  for (let m = 1; m <= lastM; m++) months.push({ label: INS_MONTHS[m - 1], m, ...worthAt(monthEnd(Y, m)) });
  const rows = months.map((x, k) => {
    const before = k ? months[k - 1].net : prevEnd, d = x.net - before;
    return `<tr><td>${x.label}</td><td class="num">${money(x.cash)}</td><td class="num">${money(x.inv)}</td><td class="num">${money(x.get - x.owe)}</td><td class="num"><b>${sgn(x.net)}</b></td><td class="num ${d >= 0 ? "credit" : "debit"}">${diff(d)}</td></tr>`;
  }).join("");
  // year on year, from the first year with anything in it
  const years = [];
  for (let y = Math.max(firstYear(), Y - 9); y <= Y; y++) years.push({ label: String(y), y, net: worthAt(yearEnd(y)).net, inv: invAtDate(yearEnd(y)).value });
  const yrows = years.map((x, k) => {
    const before = k ? years[k - 1].net : worthAt(yearEnd(x.y - 1)).net;
    return `<tr><td>${x.y}</td><td class="num"><b>${sgn(x.net)}</b></td><td class="num ${x.net - before >= 0 ? "credit" : "debit"}">${diff(x.net - before)}</td><td>${chg(x.net, before)}</td></tr>`;
  }).join("");
  $("yrWorth").innerHTML = `${drawLines(months, [{ key: "net", color: "var(--brand)", fill: true }, { key: "inv", color: "var(--credit)", dash: true }])}
    <div class="legend"><span><i style="background:var(--brand)"></i>Net worth</span><span><i style="background:var(--credit)"></i>Investments</span></div>
    <div class="ins-sub">Month on month · ${Y}</div>
    <div class="ins-scroll"><table class="ins-table"><tr><th>Month</th><th>Cash</th><th>Invest.</th><th>Loans</th><th>Net worth</th><th>Change</th></tr>${rows}</table></div>
    <div class="ins-sub">Year on year</div>
    ${years.length > 1 ? drawLines(years, [{ key: "net", color: "var(--brand)", fill: true }]) : ""}
    <div class="ins-scroll"><table class="ins-table"><tr><th>Year end</th><th>Net worth</th><th>Grew by</th><th>%</th></tr>${yrows}</table></div>
    <p class="ins-note">Loans = owed to you − owed by you. Investment values are estimates from their expected return, unless you entered an actual value.</p>`;
}

// 3 · month against month: income, spending, savings
function renderMoM(Y, P) {
  const m = Array.from({ length: 12 }, (_, k) => { const x = totals(state.tx.filter((t) => t.date.startsWith(ym(Y, k + 1)))); return { k, ...x, s: x.i - x.o }; });
  const lastDec = totals(state.tx.filter((t) => t.date.startsWith(ym(P, 12))));
  const live = m.filter((x) => x.i || x.o || x.v);
  if (!live.length) { $("yrMoM").innerHTML = emptyBox("📆", "No entries this year."); return; }
  const worst = live.reduce((a, b) => (b.o > a.o ? b : a)), best = live.reduce((a, b) => (b.s > a.s ? b : a));
  const big = inYear(Y).filter((t) => t.type === "debit" && !isInvestTx(t)).sort((a, b) => b.amount - a.amount)[0];
  const rows = m.map((x) => {
    if (!x.i && !x.o && !x.v) return "";
    const before = x.k ? m[x.k - 1] : lastDec;
    return `<tr><td>${INS_MONTHS[x.k]}</td><td class="num credit">${money(x.i)}</td><td class="num debit">${money(x.o)}</td><td>${chg(x.o, before.o, true)}</td><td class="num" style="color:var(--brand)">${money(x.v)}</td><td class="num ${x.s >= 0 ? "credit" : "debit"}">${sgn(x.s)}</td></tr>`;
  }).join("");
  const avg = live.reduce((s, x) => s + x.o, 0) / live.length;
  const pm = Array.from({ length: 12 }, (_, k) => totals(state.tx.filter((t) => t.date.startsWith(ym(P, k + 1)))));
  const pairs = m.map((x) => ({ label: INS_MONTHS[x.k][0], a: x.o, b: pm[x.k].o, la: String(Y), lb: String(P) }));
  const savePts = m.filter((x) => x.i || x.o || x.v).map((x) => ({ label: INS_MONTHS[x.k], saved: x.s, inv: x.v }));
  $("yrMoM").innerHTML = `
    <div class="ins-sub" style="margin-top:0">Spending: ${Y} vs ${P}</div>
    ${drawPairs(pairs, "var(--debit)", "var(--muted)")}
    ${legend([["var(--debit)", String(Y)], ["var(--muted)", String(P)]])}
    <div class="ins-sub">Saved each month</div>
    ${drawLines(savePts, [{ key: "saved", color: "var(--credit)", fill: true }, { key: "inv", color: "var(--brand)", dash: true }])}
    ${legend([["var(--credit)", "Saved (income − spending)"], ["var(--brand)", "of it invested"]])}
    <div class="ins-flag" style="margin-top:12px"><span>🔥</span><span>Most spent in <b>${INS_MONTHS[worst.k]}</b>: <b class="num">${money(worst.o)}</b> — ${avg ? Math.round((worst.o / avg - 1) * 100) : 0}% above your monthly average of <span class="num">${money(avg)}</span>.${big ? ` Biggest single payment: <b class="num">${money(big.amount)}</b> on ${esc(big.category)}${big.desc ? ` (${esc(big.desc)})` : ""}, ${esc(shortDate(big.date))}.` : ""}</span></div>
    <div class="ins-flag good"><span>🌟</span><span>Best month for saving: <b>${INS_MONTHS[best.k]}</b>, <b class="num">${sgn(best.s)}</b> saved.</span></div>
    <div class="ins-scroll"><table class="ins-table"><tr><th>Month</th><th>In</th><th>Spent</th><th>vs prev.</th><th>Invested</th><th>Saved</th></tr>${rows}</table></div>`;
}

// 4 · where the money went, and what grew most against last year
function renderCats(Y, P) {
  const by = (y) => { const o = {}; for (const t of inYear(y)) if (t.type === "debit" && !isInvestTx(t)) o[t.category] = (o[t.category] || 0) + +t.amount; return o; };
  const a = by(Y), b = by(P), names = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (!names.length) { $("yrCats").innerHTML = emptyBox("🧾", "No spending this year."); return; }
  const list = names.map((n) => ({ n, a: a[n] || 0, b: b[n] || 0 })).sort((x, y) => y.a - x.a);
  const total = list.reduce((s, x) => s + x.a, 0);
  const jump = list.filter((x) => x.b).sort((x, y) => (y.a - y.b) - (x.a - x.b))[0];
  const rows = list.map((x) => {
    const c = catOf({ type: "debit", category: x.n });
    return `<tr><td>${c.icon} ${esc(c.name)}</td><td class="num">${money(x.a)}</td><td>${total ? Math.round((x.a / total) * 100) : 0}%</td><td class="num">${money(x.b)}</td><td>${chg(x.a, x.b, true)}</td></tr>`;
  }).join("");
  const bars = drawHBars(list.slice(0, 8).map((x) => { const c = catOf({ type: "debit", category: x.n }); return { label: `${c.icon} ${esc(c.name)}`, a: x.a, b: x.b }; }));
  $("yrCats").innerHTML = `${bars}${legend([["var(--brand)", String(Y)], ["var(--muted)", `${P} (thin bar)`]])}${jump && jump.a > jump.b ? `<div class="ins-flag"><span>📈</span><span>Grew most: <b>${esc(catOf({ type: "debit", category: jump.n }).name)}</b> — <b class="num">${diff(jump.a - jump.b)}</b> more than in ${P}.</span></div>` : ""}
    <div class="ins-scroll"><table class="ins-table"><tr><th>Category</th><th>${Y}</th><th>Share</th><th>${P}</th><th>Change</th></tr>${rows}
    <tr class="total"><td>Total</td><td class="num">${money(total)}</td><td></td><td class="num">${money(list.reduce((s, x) => s + x.b, 0))}</td><td></td></tr></table></div>`;
}

// 5 · every investment type: put in this year, worth at the year's end, growth
function renderInvTypes(Y, P) {
  if (!state.invs.length) { $("yrInv").innerHTML = emptyBox("💼", "No investments added yet."); return; }
  const eY = yearEnd(Y), eP = yearEnd(P), kinds = {};
  for (const i of state.invs) {
    const k = (kinds[i.kind] = kinds[i.kind] || { put: 0, vY: 0, vP: 0, n: 0 });
    const y = invAt(i, eY), p = invAt(i, eP);
    k.put += y.invested - p.invested; k.vY += y.value; k.vP += p.value; k.n++;
  }
  const list = Object.entries(kinds).sort((a, b) => b[1].vY - a[1].vY);
  const tot = list.reduce((s, [, k]) => ({ put: s.put + k.put, vY: s.vY + k.vY, vP: s.vP + k.vP }), { put: 0, vY: 0, vP: 0 });
  const rows = list.map(([kind, k]) => {
    const info = INV_KINDS[kind] || INV_KINDS.other, earned = k.vY - k.vP - k.put;
    return `<tr><td>${info.icon} ${esc(info.label.split(" / ")[0])}${k.n > 1 ? ` <small class="muted">×${k.n}</small>` : ""}</td><td class="num">${money(k.put)}</td><td class="num">${money(k.vP)}</td><td class="num"><b>${money(k.vY)}</b></td><td class="num ${earned >= 0 ? "credit" : "debit"}">${diff(earned)}</td><td>${chg(k.vY, k.vP)}</td></tr>`;
  }).join("");
  const earned = tot.vY - tot.vP - tot.put;
  const kname = (kind) => { const x = INV_KINDS[kind] || INV_KINDS.other; return `${x.icon} ${x.label.split(" / ")[0]}`; };
  const donut = drawDonut(list.map(([kind, k]) => ({ label: kname(kind), v: k.vY })), money(tot.vY), `${Y} end`);
  const yoy = drawPairs(list.map(([kind, k]) => ({ label: (INV_KINDS[kind] || INV_KINDS.other).icon, a: k.vY, b: k.vP, la: String(Y), lb: String(P) })), "var(--brand)", "var(--muted)");
  $("yrInv").innerHTML = `${donut}<div class="ins-sub">Value: ${P} end vs ${Y} end</div>${yoy}${legend([["var(--brand)", String(Y)], ["var(--muted)", String(P)]])}<div class="ins-grid" style="margin-top:12px">
      ${kpi(`Put in during ${Y}`, money(tot.put), "")}
      ${kpi("Growth earned", diff(earned), "", earned >= 0 ? "credit" : "debit")}
    </div>
    <div class="ins-scroll" style="margin-top:12px"><table class="ins-table"><tr><th>Type</th><th>Put in</th><th>${P} end</th><th>${Y} end</th><th>Growth</th><th>YoY</th></tr>${rows}
    <tr class="total"><td>All</td><td class="num">${money(tot.put)}</td><td class="num">${money(tot.vP)}</td><td class="num">${money(tot.vY)}</td><td class="num">${diff(earned)}</td><td>${chg(tot.vY, tot.vP)}</td></tr></table></div>
    <p class="ins-note">“Put in” is what went in during ${Y}; “Growth” is the rise in value beyond that. LIC and other policies are under Insurance; PF, PPF, EPF and NPS under PPF.</p>`;
}

// 6 · loans: where they stood at each year end, and the interest in the year
function renderLoanYear(Y, P) {
  if (!state.loans.length) { $("yrLoans").innerHTML = emptyBox("🤝", "No loans recorded."); return; }
  const eY = yearEnd(Y), eP = yearEnd(P), sY = `${Y}-01-01`;
  let intIn = 0, intOut = 0;
  const rows = state.loans.filter((l) => l.start_date <= eY).map((l) => {
    const now = loanCalc(l, paysOf(l.id), eY), before = l.start_date < sY ? loanCalc(l, paysOf(l.id), shiftDate(sY, -1)) : null;
    const interest = now.interest - (before ? before.interest : 0);
    if (l.direction === "lent") intIn += interest; else intOut += interest;
    const was = l.start_date <= eP ? Math.max(0, loanCalc(l, paysOf(l.id), eP).balance) : 0;
    const is = l.closed_on && l.closed_on <= eY ? 0 : Math.max(0, now.balance);
    return `<tr><td>${l.direction === "lent" ? "⬆️" : "⬇️"} ${esc(l.person)}</td><td class="num">${money(was)}</td><td class="num"><b>${money(is)}</b></td><td class="num">${money(interest)}</td></tr>`;
  }).join("");
  const a = loansAt(eY), b = loansAt(eP);
  const lb = drawHBars([
    { label: "⬆️ Owed to you", a: a.get, b: b.get, color: "var(--credit)" },
    { label: "⬇️ You owe", a: a.owe, b: b.owe, color: "var(--debit)" },
  ]);
  $("yrLoans").innerHTML = `${lb}<div class="ins-grid">
      ${kpi("Owed to you", money(a.get), chg(a.get, b.get), "credit")}
      ${kpi("You owe", money(a.owe), chg(a.owe, b.owe, true), "debit")}
      ${kpi(`Interest earned in ${Y}`, money(intIn), "", "credit")}
      ${kpi(`Interest paid in ${Y}`, money(intOut), "", "debit")}
    </div>
    <div class="ins-scroll" style="margin-top:12px"><table class="ins-table"><tr><th>Person</th><th>${P} end</th><th>${Y} end</th><th>Interest ${Y}</th></tr>${rows}</table></div>
    <p class="ins-note">⬆️ money you lent · ⬇️ money you borrowed. Interest is what built up during the year, paid or not.</p>`;
}

// 7 · the farm: this year's crops against last year's
function renderFarmYear(Y, P) {
  if (!state.cycles.length) { $("yrFarm").innerHTML = emptyBox("🌾", "No crops recorded."); return; }
  const sumY = (y) => state.cycles.filter((c) => +c.year === y).reduce((s, c) => ({ i: s.i + cycleIncome(c), o: s.o + cycleSpent(c), n: s.n + 1 }), { i: 0, o: 0, n: 0 });
  const a = sumY(Y), b = sumY(P);
  const crops = {};
  for (const c of state.cycles) {
    if (+c.year !== Y && +c.year !== P) continue;
    const k = (crops[c.crop] = crops[c.crop] || { iY: 0, oY: 0, iP: 0, oP: 0 });
    if (+c.year === Y) { k.iY += cycleIncome(c); k.oY += cycleSpent(c); } else { k.iP += cycleIncome(c); k.oP += cycleSpent(c); }
  }
  const rows = Object.entries(crops).sort((x, y) => y[1].iY - x[1].iY).map(([crop, k]) => `<tr><td>${cropIcon(crop)} ${esc(crop)}</td><td class="num">${money(k.iY)}</td><td class="num">${money(k.oY)}</td><td class="num ${k.iY - k.oY >= 0 ? "credit" : "debit"}">${sgn(k.iY - k.oY)}</td><td>${chg(k.iY - k.oY, k.iP - k.oP)}</td></tr>`).join("");
  const cropBars = drawHBars(Object.entries(crops).filter(([, k]) => k.iY || k.oY).sort((x, y) => (y[1].iY - y[1].oY) - (x[1].iY - x[1].oY)).map(([crop, k]) => ({ label: `${cropIcon(crop)} ${esc(crop)}`, a: Math.max(0, k.iY - k.oY), b: Math.max(0, k.iP - k.oP), color: "var(--credit)" })));
  // profit for every year on record
  const years = [...new Set(state.cycles.map((c) => +c.year))].sort();
  const pts = years.map((y) => { const s = sumY(y); return { label: String(y), profit: s.i - s.o, income: s.i }; });
  $("yrFarm").innerHTML = `<div class="ins-grid">
      ${kpi("Crop income", money(a.i), chg(a.i, b.i), "credit")}
      ${kpi("Crop costs", money(a.o), chg(a.o, b.o, true), "debit")}
      ${kpi("Profit", sgn(a.i - a.o), chg(a.i - a.o, b.i - b.o), a.i - a.o >= 0 ? "credit" : "debit")}
      ${kpi("Return on costs", a.o ? `${Math.round(((a.i - a.o) / a.o) * 100)}%` : "—", "")}
    </div>
    ${rows ? `<div class="ins-sub">Profit by crop · ${Y}</div>${cropBars}<div class="ins-scroll" style="margin-top:12px"><table class="ins-table"><tr><th>Crop</th><th>Income</th><th>Costs</th><th>Profit</th><th>vs ${P}</th></tr>${rows}</table></div>` : `<p class="ins-note">No crops in ${Y}.</p>`}
    ${pts.length > 1 ? `<div class="ins-sub">Profit, year on year</div>${drawLines(pts, [{ key: "income", color: "var(--credit)", dash: true }, { key: "profit", color: "var(--brand)", fill: true }])}<div class="legend"><span><i style="background:var(--brand)"></i>Profit</span><span><i style="background:var(--credit)"></i>Income</span></div>` : ""}
    <p class="ins-note">Farm money is its own book: it isn't part of the cash balance or net worth above.</p>`;
}

// 8 · the future: today's corpus carried forward
function renderFuture() {
  const today = todayStr(), w = worthAt(today);
  // what you have been keeping each month, over the last 12 months
  const from = shiftDate(today, -365), last = totals(state.tx.filter((t) => t.date > from && t.date <= today && !(t.legacyId || "").startsWith("inv:")));
  const sipNow = state.invs.length ? activeMonthly().reduce((s, i) => s + perMonth(i), 0) : 0;
  const keep = Math.max(0, last.n / 12);
  const r = state.insRet / 100, mr = Math.pow(1 + r, 1 / 12) - 1;
  const stacks = [];
  const rows = INS_YEARS.map((n) => {
    const d = addMonths(today, 12 * n);
    const inv = invAtDate(d).value;                                    // investments, on their own schedules
    const cash = (w.cash + w.get - w.owe) * Math.pow(1 + r, n);        // what you hold now, put to work
    const saved = mr ? keep * ((Math.pow(1 + mr, 12 * n) - 1) / mr) : keep * 12 * n; // savings, put to work monthly
    const total = inv + cash + saved, real = total / Math.pow(1 + INFLATION, n);
    stacks.push({ label: `${n}y`, inv, cs: cash + saved });
    return `<tr><td><b>${n} ${n === 1 ? "yr" : "yrs"}</b><br><small class="muted">${new Date(d + "T00:00:00").getFullYear()}</small></td><td class="num">${money(inv)}</td><td class="num">${money(cash + saved)}</td><td class="num"><b>${money(total)}</b></td><td class="num">${money(real)}</td></tr>`;
  }).join("");
  $("yrFuture").innerHTML = `<div class="ins-seg" role="group" aria-label="Return on savings">${[6, 8, 10, 12].map((p) => `<button type="button" data-insret="${p}" aria-pressed="${p === state.insRet}">${p}% a year</button>`).join("")}</div>
    ${drawStacks(stacks, [{ key: "inv", color: "var(--brand)", label: "Investments" }, { key: "cs", color: "var(--credit)", label: "Cash + savings" }])}
    ${legend([["var(--brand)", "Investments"], ["var(--credit)", "Cash + savings"]])}
    <div class="ins-grid" style="margin-top:12px">
      ${kpi("Net worth today", sgn(w.net), "")}
      ${kpi("You keep each month", money(keep), `<small class="muted">avg. last 12 months</small>`)}
    </div>
    <div class="ins-scroll" style="margin-top:12px"><table class="ins-table"><tr><th>In</th><th>Investments</th><th>Cash + savings</th><th>Total corpus</th><th>Today's money</th></tr>${rows}</table></div>
    <p class="ins-note"><b>Investments</b> grow on their own schedules (SIPs keep going until their end date, at each one's expected return). <b>Cash + savings</b>: today's cash and loans, plus the ${money(keep)} you keep each month${sipNow ? ` on top of your ${money(sipNow)}/month investments` : ""}, both earning ${state.insRet}% a year. <b>Today's money</b> takes off 6% inflation a year. These are estimates, not promises.</p>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-insret]"); if (!b) return;
  state.insRet = +b.dataset.insret; renderFuture();
});

renderHooks.push(renderInsights);
// the year pager redraws only the top of the page: redraw these with it
for (const id of ["yrPrev", "yrNext"]) $(id).addEventListener("click", () => setTimeout(renderInsights));
// and opening the page draws them (render() skips it while another page shows)
document.addEventListener("click", (e) => { if (e.target.closest('[data-go="viewYear"]')) setTimeout(renderInsights); });
