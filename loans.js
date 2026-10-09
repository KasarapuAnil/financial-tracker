/* ════════════════════════════════════════════════════════════════════════════
   Lend & borrow — who owes whom, with interest worked out to the day.

   Interest runs per day on what is still owed: a year's rate over 365 days, so
   "₹2 per ₹100 a month" on ₹10,000 is ₹200 for a 30-day month and ₹2,400 for a
   full year. A repayment clears the interest first, then the amount itself.
   Compound loans add the unpaid interest to the amount every month or year,
   counted from the day the money was given.
   ════════════════════════════════════════════════════════════════════════════ */
const RATE_UNITS = {
  per100_month: { label: () => `${state.currency} per ${state.currency}100 / month`, short: (r) => `${state.currency}${r}/${state.currency}100 a month`, perYear: (r) => (r * 12) / 100 },
  pct_month: { label: () => "% per month", short: (r) => `${r}% a month`, perYear: (r) => (r * 12) / 100 },
  pct_year: { label: () => "% per year", short: (r) => `${r}% a year`, perYear: (r) => r / 100 },
};
Object.assign(state, { loans: [], loanPays: [], loansLoaded: false, loanDir: "all", loanStatus: "active" });

/* ── small shared form pieces (also used by invest.js and vault.js) ── */
function segHTML(name, options, value) {
  return `<div class="seg" data-seg="${name}" role="group">${options.map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${v === value}">${label}</button>`).join("")}</div>`;
}
function segVal(root, name) { const b = root.querySelector(`[data-seg="${name}"] [aria-pressed="true"]`); return b ? b.dataset.v : null; }
document.addEventListener("click", (e) => {
  const b = e.target.closest(".seg[data-seg] button"); if (!b) return;
  const seg = b.parentElement;
  seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  seg.dispatchEvent(new Event("change", { bubbles: true }));
});
async function shareText(title, text) {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
    await navigator.clipboard.writeText(text); toast("Copied — paste it anywhere");
  } catch (e) { if (e && e.name !== "AbortError") toast("Couldn't share", "err"); }
}

/* ── the calculation ── */
function loanCalc(loan, pays, asOf) {
  const end = loan.closed_on && loan.closed_on < asOf ? loan.closed_on : asOf;
  const yr = RATE_UNITS[loan.rate_unit].perYear(+loan.rate || 0);
  const start = loan.start_date;
  const events = pays.filter((p) => p.paid_on <= end)
    .map((p) => ({ ...p, on: p.paid_on < start ? start : p.paid_on }))
    .sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : (a.created_at || "") < (b.created_at || "") ? -1 : 1));
  const caps = [];
  if (loan.interest_kind === "compound" && yr > 0) {
    const step = loan.compounding === "monthly" ? 1 : 12;
    for (let k = 1; k < 1200; k++) { const d = addMonths(start, k * step); if (d > end) break; caps.push(d); }
  }
  let principal = +loan.principal, accrued = 0, interest = 0, paid = 0, added = 0, over = 0, cur = start, ci = 0, ei = 0;
  const accrue = (to) => {
    const days = daysBetween(cur, to);
    if (days > 0) { const i = (principal * yr * days) / 365; accrued += i; interest += i; }
    if (to > cur) cur = to;
  };
  while (ci < caps.length || ei < events.length) {
    const cap = caps[ci], ev = events[ei];
    if (ev && (!cap || ev.on < cap)) {
      accrue(ev.on); ei++;
      const x = +ev.amount;
      if (ev.kind === "added") {
        const fromOver = Math.min(x, over); over -= fromOver; principal += x - fromOver; added += x;
      } else {
        paid += x;
        const toInterest = Math.min(x, accrued); accrued -= toInterest;
        principal -= x - toInterest;
        if (principal < 0) { over += -principal; principal = 0; }
      }
    } else { accrue(cap); principal += accrued; accrued = 0; ci++; }
  }
  accrue(end);
  return {
    principal, accrued, interest, paid, added, over, yr, end,
    given: +loan.principal + added,
    balance: principal + accrued - over,
    perMonth: (principal * yr) / 12, perDay: (principal * yr) / 365,
  };
}
const paysOf = (id) => state.loanPays.filter((p) => p.loan_id === id);
const loanById = (id) => state.loans.find((l) => l.id === id);
function loanTotals() {
  let get = 0, owe = 0, earn = 0, pay = 0;
  for (const l of state.loans) {
    if (l.closed_on) continue;
    const c = loanCalc(l, paysOf(l.id), todayStr());
    if (l.direction === "lent") { get += Math.max(0, c.balance); earn += c.perMonth; } else { owe += Math.max(0, c.balance); pay += c.perMonth; }
  }
  return { get, owe, earn, pay };
}

/* ── data ── */
async function loadLoans() {
  const [a, b] = await Promise.all([
    sb.from("loans").select("*").order("start_date", { ascending: false }),
    sb.from("loan_payments").select("*").order("paid_on"),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  state.loans = a.data; state.loanPays = b.data; state.loansLoaded = true;
}
loadHooks.push(loadLoans);
resetHooks.push(() => Object.assign(state, { loans: [], loanPays: [], loansLoaded: false }));
renderHooks.push(renderLoans);
fabHooks.viewLoans = () => openLoanForm(null);

/* ── the Loans page ── */
function renderLoans() {
  const t = loanTotals();
  $("lGet").textContent = fmt(t.get);
  $("lGetSub").textContent = t.earn ? `+${fmt(t.earn)}/mo interest` : "nothing due to you";
  $("lOwe").textContent = fmt(t.owe);
  $("lOweSub").textContent = t.pay ? `+${fmt(t.pay)}/mo interest` : "you owe nothing";
  const list = state.loans.filter((l) => (state.loanDir === "all" || l.direction === state.loanDir) && (state.loanStatus === "active" ? !l.closed_on : !!l.closed_on));
  $("loanList").innerHTML = !state.loansLoaded ? skeletons(2)
    : list.length ? list.map(loanCard).join("")
    : emptyBox("🤝", state.loanStatus === "active" ? "No open loans. Tap ＋ to record money you lent or borrowed." : "No closed loans yet.");
}
function loanCard(l) {
  const c = loanCalc(l, paysOf(l.id), todayStr()), lent = l.direction === "lent";
  const today = todayStr(), overdue = !l.closed_on && l.due_date && l.due_date < today && c.balance > 0.5;
  const badge = l.closed_on ? `<span class="badge ok">Closed</span>` : overdue ? `<span class="badge warn">Overdue</span>` : l.due_date ? `<span class="badge">Due ${esc(shortDate(l.due_date))}</span>` : "";
  const owedTotal = c.given + c.interest, pct = owedTotal > 0 ? Math.min(100, Math.round((c.paid / owedTotal) * 100)) : 0;
  return `<button class="card item" data-loan="${esc(l.id)}">
    <div class="item-top">
      <span class="avatar-sm ${lent ? "credit-bg" : "debit-bg"}">${esc((l.person || "?").trim()[0].toUpperCase())}</span>
      <span class="tx-main"><b>${esc(l.person)}</b><span>${lent ? "You lent" : "You borrowed"} · ${+l.rate ? esc(RATE_UNITS[l.rate_unit].short(+l.rate)) : "no interest"} · ${esc(duration(l.start_date, c.end))}</span></span>
      ${badge}
    </div>
    <div class="nums">
      <div><small>Given</small><b class="num">${fmt(c.given)}</b></div>
      <div><small>Interest</small><b class="num">${fmt(c.interest)}</b></div>
      <div><small>${lent ? "To get" : "To pay"}</small><b class="num ${lent ? "credit" : "debit"}">${fmt(Math.max(0, c.balance))}</b></div>
    </div>
    ${c.paid ? `<div class="progress" title="${pct}% paid back"><i style="width:${pct}%"></i></div>` : ""}
  </button>`;
}
document.addEventListener("click", (e) => { const c = e.target.closest("[data-loan]"); if (c) openLoan(c.dataset.loan); });
$("loanDirSeg").addEventListener("change", () => { state.loanDir = segVal(document, "loanDir"); renderLoans(); });
$("loanStatusSeg").addEventListener("change", () => { state.loanStatus = segVal(document, "loanStatus"); renderLoans(); });

/* ── one loan ── */
function openLoan(id) {
  const l = loanById(id); if (!l) return;
  const pays = paysOf(id), c = loanCalc(l, pays, todayStr()), lent = l.direction === "lent", today = todayStr();
  let dueLine = "";
  if (l.due_date && !l.closed_on) {
    const d = daysBetween(today, l.due_date);
    const onDue = loanCalc(l, pays, l.due_date < today ? today : l.due_date);
    dueLine = `<div><span>Due date</span><b>${esc(shortDate(l.due_date))} <small class="${d < 0 ? "debit" : "muted"}">${d < 0 ? `${-d} days late` : d === 0 ? "today" : `in ${d} days`}</small></b></div>
      ${d > 0 ? `<div><span>Balance on due date</span><b class="num">${fmt(onDue.balance)}</b></div>` : ""}`;
  }
  const hist = [
    { on: l.start_date, text: `${lent ? "Gave" : "Got"} ${fmt(l.principal)}`, sub: "Loan started" },
    ...pays.map((p) => ({ on: p.paid_on, id: p.id, text: `${p.kind === "added" ? (lent ? "Gave more" : "Got more") : lent ? "Got back" : "Paid back"} ${fmt(p.amount)}`, sub: p.note, cls: p.kind === "added" ? "" : lent ? "credit" : "debit" })),
  ].sort((a, b) => (a.on < b.on ? -1 : 1));
  const p = openPanel(`
    <h3>${esc(l.person)}</h3>
    <p class="panel-sub">${lent ? "You lent" : "You borrowed"} · ${esc(shortDate(l.start_date))} · ${+l.rate ? `${esc(RATE_UNITS[l.rate_unit].short(+l.rate))}, ${l.interest_kind === "compound" ? `compound ${l.compounding}` : "simple"}` : "no interest"}${l.closed_on ? ` · closed ${esc(shortDate(l.closed_on))}` : ""}</p>
    <div class="big-due ${lent ? "credit" : "debit"}"><small>${l.closed_on ? "Balance when closed" : lent ? "They owe you" : "You owe"}</small><b class="num">${fmt(Math.max(0, c.balance))}</b>${c.over > 0.5 ? `<small>${fmt(c.over)} paid extra</small>` : ""}</div>
    <div class="kv card-inset">
      <div><span>Amount ${lent ? "given" : "taken"}</span><b class="num">${fmt(c.given)}</b></div>
      <div><span>Interest so far</span><b class="num">${fmt(c.interest)}</b></div>
      <div><span>Paid back</span><b class="num">${fmt(c.paid)}</b></div>
      ${!l.closed_on && c.yr ? `<div><span>Interest now</span><b class="num">${fmt(c.perMonth)}/month · ${fmt(c.perDay)}/day</b></div>` : ""}
      <div><span>Running for</span><b>${esc(duration(l.start_date, c.end))}</b></div>
      ${dueLine}
    </div>
    <div class="field" style="margin-top:12px"><label for="ldAt">What will the balance be on…</label>
      <div class="pw"><input class="input" id="ldAt" type="date" value="${esc(l.due_date && l.due_date > today ? l.due_date : addMonths(today, 1))}"><span class="calc-inline num" id="ldAtOut"></span></div></div>
    ${l.note ? `<p class="note-box">${esc(l.note)}</p>` : ""}
    <h4 class="h4">History</h4>
    <div class="hist">${hist.map((h) => `<div class="h"><span class="muted h-date">${esc(shortDate(h.on))}</span><span class="tx-main"><b class="${h.cls || ""}">${esc(h.text)}</b>${h.sub && h.sub !== "Loan started" ? `<span>${esc(h.sub)}</span>` : ""}</span>${h.id ? `<button class="x" data-delpay="${esc(h.id)}" aria-label="Remove this payment">×</button>` : ""}</div>`).join("")}</div>
    <div class="btn-grid">
      ${l.closed_on ? "" : `<button class="btn btn-primary" id="ldPay">${lent ? "Got money back" : "Paid back"}</button><button class="btn btn-ghost" id="ldAdd">${lent ? "Gave more" : "Took more"}</button>`}
      <button class="btn btn-ghost" id="ldEdit">Edit</button>
      <button class="btn btn-ghost" id="ldClose">${l.closed_on ? "Reopen" : "Mark settled"}</button>
      <button class="btn btn-ghost" id="ldShare">Share summary</button>
      <button class="btn btn-danger" id="ldDel">Delete</button>
    </div>`);
  const at = () => { const v = p.querySelector("#ldAt").value; if (v) p.querySelector("#ldAtOut").textContent = fmt(Math.max(0, loanCalc({ ...l, closed_on: null }, pays, v < l.start_date ? l.start_date : v).balance)); };
  p.querySelector("#ldAt").onchange = at; at();
  if (!l.closed_on) { p.querySelector("#ldPay").onclick = () => openPaymentForm(l, "repaid"); p.querySelector("#ldAdd").onclick = () => openPaymentForm(l, "added"); }
  p.querySelector("#ldEdit").onclick = () => openLoanForm(l);
  p.querySelector("#ldClose").onclick = async (e) => {
    busy(e.currentTarget, true);
    try {
      const { error } = await sb.from("loans").update({ closed_on: l.closed_on ? null : todayStr() }).eq("id", l.id);
      if (error) throw error;
      await loadLoans(); render(); openLoan(l.id); toast(l.closed_on ? "Loan reopened" : "Marked as settled");
    } catch (er) { toast(friendly(er), "err"); busy(e.currentTarget, false); }
  };
  p.querySelector("#ldShare").onclick = () => shareText(`Loan — ${l.person}`, [
    `${lent ? "Money lent to" : "Money borrowed from"} ${l.person}`,
    `Given on ${shortDate(l.start_date)}: ${fmt(l.principal)}${c.added ? ` (+${fmt(c.added)} later)` : ""}`,
    +l.rate ? `Interest: ${RATE_UNITS[l.rate_unit].short(+l.rate)}, ${l.interest_kind === "compound" ? `compound ${l.compounding}` : "simple"}` : "No interest",
    `Interest till ${shortDate(c.end)}: ${fmt(c.interest)}`,
    `Paid back: ${fmt(c.paid)}`,
    `Balance: ${fmt(Math.max(0, c.balance))}`,
  ].join("\n"));
  p.querySelector("#ldDel").onclick = () => confirmAsk(`Delete the loan with ${l.person}?`, "The loan and all its payments will be removed.", async () => {
    const { error } = await sb.from("loans").delete().eq("id", l.id);
    if (error) throw error;
    await loadLoans(); render(); toast("Loan deleted");
  });
  p.querySelectorAll("[data-delpay]").forEach((b) => (b.onclick = () => confirmAsk("Remove this payment?", "The balance will be worked out again without it.", async () => {
    const { error } = await sb.from("loan_payments").delete().eq("id", b.dataset.delpay);
    if (error) throw error;
    await loadLoans(); render(); toast("Payment removed"); setTimeout(() => openLoan(l.id), 350);
  }, "Remove")));
}

/* ── add / edit a loan ── */
function openLoanForm(l) {
  const v = l || { direction: "lent", person: "", principal: "", start_date: todayStr(), due_date: "", rate: 2, rate_unit: "per100_month", interest_kind: "simple", compounding: "yearly", note: "" };
  const p = openPanel(`
    <h3>${l ? "Edit loan" : "New loan"}</h3>
    ${segHTML("dir", [["lent", "⬆ I lent money"], ["borrowed", "⬇ I borrowed"]], v.direction)}
    <div class="field mt"><label for="lfPerson" id="lfPersonLabel"></label><input class="input" id="lfPerson" maxlength="80" value="${esc(v.person)}" placeholder="Name" autocomplete="off"></div>
    <div class="form-grid mt">
      <div class="field"><label for="lfAmt">Amount</label><input class="input" id="lfAmt" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(v.principal)}" placeholder="0"></div>
      <div class="field"><label for="lfStart">Given on</label><input class="input" id="lfStart" type="date" value="${esc(v.start_date)}"></div>
    </div>
    <div class="form-grid">
      <div class="field"><label for="lfRate">Interest</label><input class="input" id="lfRate" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(v.rate)}" placeholder="0 = none"></div>
      <div class="field"><label for="lfUnit">Rate is</label><select class="input" id="lfUnit">${Object.entries(RATE_UNITS).map(([k, u]) => `<option value="${k}" ${k === v.rate_unit ? "selected" : ""}>${esc(u.label())}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Interest type</label>${segHTML("kind", [["simple", "Simple"], ["compound", "Compound"]], v.interest_kind)}</div>
    <div class="field mt" id="lfCompWrap"><label for="lfComp">Add interest to the amount every</label><select class="input" id="lfComp"><option value="monthly" ${v.compounding === "monthly" ? "selected" : ""}>Month</option><option value="yearly" ${v.compounding === "yearly" ? "selected" : ""}>Year</option></select></div>
    <div class="field mt"><label for="lfDue">Due date (optional)</label><input class="input" id="lfDue" type="date" value="${esc(v.due_date || "")}"></div>
    <div class="field mt"><label for="lfNote">Note (optional)</label><input class="input" id="lfNote" maxlength="500" value="${esc(v.note)}" placeholder="e.g. for house repairs, promissory note signed"></div>
    <div class="calc-out" id="lfPreview"></div>
    <div class="err-text" hidden></div>
    <div class="sheet-actions single mt"><button class="btn btn-primary" id="lfSave">${l ? "Save changes" : "Add loan"}</button></div>`);
  const read = () => ({
    direction: segVal(p, "dir"), person: p.querySelector("#lfPerson").value.trim(), principal: num(p.querySelector("#lfAmt").value),
    start_date: p.querySelector("#lfStart").value, due_date: p.querySelector("#lfDue").value || null,
    rate: num(p.querySelector("#lfRate").value || 0), rate_unit: p.querySelector("#lfUnit").value,
    interest_kind: segVal(p, "kind"), compounding: p.querySelector("#lfComp").value, note: p.querySelector("#lfNote").value.trim(),
  });
  const preview = () => {
    const r = read();
    p.querySelector("#lfPersonLabel").textContent = r.direction === "lent" ? "Lent to" : "Borrowed from";
    p.querySelector("#lfCompWrap").hidden = r.interest_kind !== "compound";
    const out = p.querySelector("#lfPreview");
    if (!(r.principal > 0) || !r.start_date || !(r.rate >= 0)) { out.textContent = "Fill in the amount and date to see the interest."; return; }
    const fake = { ...r, closed_on: null };
    const yr = RATE_UNITS[r.rate_unit].perYear(r.rate), today = todayStr();
    const lines = [`Interest: <b>${fmt((r.principal * yr) / 12)}</b> a month (${round2(yr * 100)}% a year)`];
    if (r.start_date < today) lines.push(`Till today: <b>${fmt(loanCalc(fake, l ? paysOf(l.id) : [], today).balance)}</b> due`);
    if (r.due_date && r.due_date > r.start_date) lines.push(`On the due date: <b>${fmt(loanCalc(fake, l ? paysOf(l.id) : [], r.due_date).balance)}</b>`);
    else lines.push(`After 1 year: <b>${fmt(loanCalc(fake, [], addMonths(r.start_date, 12)).balance)}</b>`);
    out.innerHTML = lines.join("<br>");
  };
  p.addEventListener("input", preview); p.addEventListener("change", preview); preview();
  if (!l) setTimeout(() => p.querySelector("#lfPerson").focus(), 300);
  p.querySelector("#lfSave").onclick = async (e) => {
    const r = read();
    if (!r.person) return panelError(p, "Enter the person's name.");
    if (!(r.principal > 0)) return panelError(p, "Enter the amount.");
    if (r.principal > 1e11) return panelError(p, "That amount is too large.");
    if (!r.start_date) return panelError(p, "Pick the date the money was given.");
    if (!(r.rate >= 0) || r.rate > 1000) return panelError(p, "Enter a valid interest rate (0 for none).");
    if (r.due_date && r.due_date < r.start_date) return panelError(p, "The due date is before the start date.");
    panelError(p, "");
    const row = { ...r, principal: round2(r.principal), rate: round2(r.rate) };
    busy(e.currentTarget, true);
    try {
      const q = l ? sb.from("loans").update(row).eq("id", l.id).select().single() : sb.from("loans").insert(row).select().single();
      const { data, error } = await q;
      if (error) throw error;
      await loadLoans(); render(); openLoan(data.id); toast(l ? "Loan updated" : "Loan added");
    } catch (er) { panelError(p, friendly(er)); busy(e.currentTarget, false); }
  };
}

/* ── record a repayment, or more money on the same loan ── */
function openPaymentForm(l, kind) {
  const lent = l.direction === "lent";
  const c = loanCalc(l, paysOf(l.id), todayStr());
  const title = kind === "added" ? (lent ? `Gave more to ${l.person}` : `Took more from ${l.person}`) : lent ? `${l.person} paid you back` : `You paid ${l.person} back`;
  const p = openPanel(`
    <h3>${esc(title)}</h3>
    ${kind === "repaid" ? `<p class="panel-sub">Balance today ${fmt(Math.max(0, c.balance))} (interest ${fmt(c.accrued)}). Payments clear the interest first.</p>` : `<p class="panel-sub">Added to the same loan; interest runs on it from the date below.</p>`}
    <div class="form-grid">
      <div class="field"><label for="pfAmt">Amount</label><input class="input" id="pfAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"></div>
      <div class="field"><label for="pfDate">Date</label><input class="input" id="pfDate" type="date" value="${todayStr()}"></div>
    </div>
    ${kind === "repaid" ? `<div class="chips mb"><button type="button" class="chip-btn" id="pfAll">Full balance</button><button type="button" class="chip-btn" id="pfInt">Interest only</button></div>` : ""}
    <div class="field"><label for="pfNote">Note (optional)</label><input class="input" id="pfNote" maxlength="200" placeholder="e.g. cash, via PhonePe"></div>
    <div class="err-text" hidden></div>
    <div class="sheet-actions mt"><button class="btn btn-ghost" id="pfBack">Back</button><button class="btn btn-primary" id="pfSave">Save</button></div>`);
  const amt = p.querySelector("#pfAmt");
  if (kind === "repaid") {
    const on = () => loanCalc(l, paysOf(l.id), p.querySelector("#pfDate").value || todayStr());
    p.querySelector("#pfAll").onclick = () => { amt.value = round2(Math.max(0, on().balance)); };
    p.querySelector("#pfInt").onclick = () => { amt.value = round2(on().accrued); };
  }
  p.querySelector("#pfBack").onclick = () => openLoan(l.id);
  setTimeout(() => amt.focus(), 300);
  p.querySelector("#pfSave").onclick = async (e) => {
    const amount = num(amt.value), paid_on = p.querySelector("#pfDate").value;
    if (!(amount > 0)) return panelError(p, "Enter the amount.");
    if (amount > 1e11) return panelError(p, "That amount is too large.");
    if (!paid_on) return panelError(p, "Pick a date.");
    busy(e.currentTarget, true);
    try {
      const { error } = await sb.from("loan_payments").insert({ loan_id: l.id, kind, amount: round2(amount), paid_on, note: p.querySelector("#pfNote").value.trim() });
      if (error) throw error;
      await loadLoans(); render();
      const after = loanCalc(loanById(l.id), paysOf(l.id), todayStr());
      openLoan(l.id);
      toast(kind === "added" ? "Added to the loan" : after.balance <= 0.5 ? "Fully paid back 🎉 — you can mark it settled" : "Payment saved");
    } catch (er) { panelError(p, friendly(er)); busy(e.currentTarget, false); }
  };
}

/* ── quick interest calculator (nothing saved) ── */
(function calculator() {
  const box = $("calcBox");
  box.innerHTML = `
    <div class="form-grid">
      <div class="field"><label for="cAmt">Amount</label><input class="input" id="cAmt" type="number" inputmode="decimal" min="0" placeholder="10000"></div>
      <div class="field"><label for="cRate">Interest</label><input class="input" id="cRate" type="number" inputmode="decimal" min="0" step="0.01" value="2"></div>
    </div>
    <div class="field"><label for="cUnit">Rate is</label><select class="input" id="cUnit">${Object.keys(RATE_UNITS).map((k) => `<option value="${k}">${k === "per100_month" ? "₹ per ₹100 / month" : k === "pct_month" ? "% per month" : "% per year"}</option>`).join("")}</select></div>
    <div class="form-grid mt">
      <div class="field"><label for="cFrom">From</label><input class="input" id="cFrom" type="date" value="${addMonths(todayStr(), -12)}"></div>
      <div class="field"><label for="cTo">To</label><input class="input" id="cTo" type="date" value="${todayStr()}"></div>
    </div>
    ${segHTML("cKind", [["simple", "Simple"], ["compound_monthly", "Compound monthly"], ["compound_yearly", "Compound yearly"]], "simple")}
    <div class="calc-out" id="cOut">Enter an amount to calculate.</div>`;
  const run = () => {
    const P = num($("cAmt").value), r = num($("cRate").value || 0), from = $("cFrom").value, to = $("cTo").value, k = segVal(box, "cKind");
    const out = $("cOut");
    if (!(P > 0) || !(r >= 0) || !from || !to) { out.textContent = "Enter an amount, a rate and both dates."; return; }
    if (to < from) { out.textContent = "The “To” date is before the “From” date."; return; }
    const c = loanCalc({ principal: P, rate: r, rate_unit: $("cUnit").value, start_date: from, interest_kind: k === "simple" ? "simple" : "compound", compounding: k === "compound_monthly" ? "monthly" : "yearly" }, [], to);
    out.innerHTML = `For <b>${esc(duration(from, to))}</b> (${daysBetween(from, to)} days):<br>Interest <b class="num">${fmt(c.interest)}</b> · Total <b class="num">${fmt(c.balance)}</b><br><span class="muted">${round2(c.yr * 100)}% a year · ${fmt((P * c.yr) / 12)} a month on ${fmt(P)}</span>`;
  };
  box.addEventListener("input", run); box.addEventListener("change", run);
})();
