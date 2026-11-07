/* ════════════════════════════════════════════════════════════════════════════
   Money with friends — "gave ₹2,000 to Ravi, back in 15 days", or a friend
   helping you out till the month's end.

   Added from today's entry sheet, it is two things at once:
     · a LOAN on the Loans page (0% interest, the "get back by" date as its due
       date), so it is followed up and closed like any other loan, and
     · a CASH ENTRY linked to that loan (legacy_id "loan:<id>:start"), so the
       cash balance goes down when you hand the money over and up when you
       get it back.
   Neither entry is spending or income: totals() counts them on their own.
   Every payment back adds its own linked cash entry ("loan:<id>:p:<payId>" — at most 80 characters, the database limit),
   and the loan closes by itself once it is fully settled.
   ════════════════════════════════════════════════════════════════════════════ */
const FRIEND_OUT = { lent: "Lent to friend", borrowed: "Borrowed from friend" };
const FRIEND_BACK = { lent: "Money returned to me", borrowed: "Returned to friend" };

// made from a daily entry (so its money runs through the cash balance)
const isHandLoan = (l) => state.tx.some((t) => t.legacyId === `loan:${l.id}:start`);
const handLoans = () => state.loans.filter((l) => !l.closed_on && isHandLoan(l));

// the cash entry for money moving on a friend loan
function friendTx(l, kind, amount, date, key) {
  const lent = l.direction === "lent";
  // giving (more) when lending, or paying back when borrowing, takes cash out
  const out = kind === "repaid" ? !lent : lent;
  return {
    type: out ? "debit" : "credit", amount: round2(amount),
    category: kind === "repaid" ? FRIEND_BACK[l.direction] : FRIEND_OUT[l.direction],
    description: `${kind === "repaid" ? (lent ? "Got back from" : "Returned to") : lent ? "Lent to" : "Borrowed from"} ${l.person}`.slice(0, 140),
    payment_mode: "Cash", tx_date: date, legacy_id: `loan:${l.id}:${key}`, user_id: state.user.id,
  };
}
async function reloadMoney() { await loadLoans(); await loadAll(); render(); }

/* ── "Gave / got money for a few days" ── */
function openFriendForm() {
  const people = [...new Set(state.loans.map((l) => l.person))].slice(0, 50);
  const p = openPanel(`
    <h3>🤝 Money with a friend</h3>
    <p class="panel-sub">Not spent, not income — it comes back. Followed up on the Loans page and on Today until it's settled.</p>
    ${segHTML("fdir", [["lent", "⬆ I gave money"], ["borrowed", "⬇ I got money"]], "lent")}
    <div class="field mt"><label for="ffPerson" id="ffPersonLabel">Given to</label><input class="input" id="ffPerson" maxlength="80" list="ffPeople" placeholder="Friend's name" autocomplete="off"><datalist id="ffPeople">${people.map((n) => `<option value="${esc(n)}">`).join("")}</datalist></div>
    <div class="form-grid mt">
      <div class="field"><label for="ffAmt">Amount</label><input class="input" id="ffAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0"></div>
      <div class="field"><label for="ffDate">Date</label><input class="input" id="ffDate" type="date" value="${esc(todayStr())}"></div>
    </div>
    <div class="field"><label for="ffDue" id="ffDueLabel">Get back by</label><input class="input" id="ffDue" type="date" value="${esc(shiftDate(todayStr(), 15))}"></div>
    <div class="chips mb">${[[10, "10 days"], [15, "15 days"], [30, "1 month"], [60, "2 months"]].map(([d, l]) => `<button type="button" class="chip-btn" data-ffdays="${d}">${l}</button>`).join("")}</div>
    <div class="field"><label for="ffNote">Note (optional)</label><input class="input" id="ffNote" maxlength="200" placeholder="e.g. for hospital bill, via PhonePe"></div>
    <div class="err-text" hidden></div>
    <div class="sheet-actions single mt"><button class="btn btn-primary" id="ffSave">Save</button></div>`);
  const dir = () => segVal(p, "fdir");
  const labels = () => {
    const lent = dir() === "lent";
    p.querySelector("#ffPersonLabel").textContent = lent ? "Given to" : "Got from";
    p.querySelector("#ffDueLabel").textContent = lent ? "Get back by" : "Give back by";
  };
  p.addEventListener("change", labels);
  p.querySelectorAll("[data-ffdays]").forEach((b) => (b.onclick = () => {
    p.querySelector("#ffDue").value = shiftDate(p.querySelector("#ffDate").value || todayStr(), +b.dataset.ffdays);
  }));
  setTimeout(() => p.querySelector("#ffPerson").focus(), 300);
  p.querySelector("#ffSave").onclick = async (e) => {
    const person = p.querySelector("#ffPerson").value.trim(), amount = num(p.querySelector("#ffAmt").value);
    const start = p.querySelector("#ffDate").value, due = p.querySelector("#ffDue").value || null, note = p.querySelector("#ffNote").value.trim();
    if (!person) return panelError(p, "Enter the friend's name.");
    if (!(amount > 0) || amount > 1e11) return panelError(p, "Enter the amount.");
    if (!start) return panelError(p, "Pick the date.");
    if (due && due < start) return panelError(p, "The date to settle is before the date given.");
    panelError(p, "");
    busy(e.currentTarget, true);
    let loan = null;
    try {
      const { data, error } = await sb.from("loans").insert({
        direction: dir(), person, principal: round2(amount), start_date: start, due_date: due,
        rate: 0, rate_unit: "pct_year", interest_kind: "simple", compounding: "yearly", note: note || "Short-term, from a daily entry",
      }).select().single();
      if (error) throw error;
      loan = data;
      const tx = await sb.from("transactions").insert(friendTx(loan, "start", amount, start, "start"));
      if (tx.error) throw tx.error;
      await reloadMoney(); closeLayers();
      toast(dir() === "lent" ? `${fmt(amount)} lent to ${person} — not counted as spent` : `${fmt(amount)} from ${person} — not counted as income`);
    } catch (er) {
      // no half-made loan without its cash entry
      if (loan) await sb.from("loans").delete().eq("id", loan.id);
      panelError(p, friendly(er)); busy(e.currentTarget, false);
    }
  };
}

/* ── got it back / paid it back ── */
function openSettle(id) {
  const l = loanById(id); if (!l) return;
  const lent = l.direction === "lent", bal = Math.max(0, loanCalc(l, paysOf(l.id), todayStr()).balance);
  const p = openPanel(`
    <h3>${lent ? `${esc(l.person)} paid you back` : `You paid ${esc(l.person)} back`}</h3>
    <p class="panel-sub">Still ${lent ? "to get" : "to give"}: <b class="num">${fmt(bal)}</b>. ${lent ? "Not income — it's your own money coming back." : "Not spending — you're returning what you got."}</p>
    <div class="form-grid">
      <div class="field"><label for="fsAmt">Amount</label><input class="input" id="fsAmt" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(round2(bal))}"></div>
      <div class="field"><label for="fsDate">Date</label><input class="input" id="fsDate" type="date" value="${esc(todayStr())}"></div>
    </div>
    <div class="err-text" hidden></div>
    <div class="sheet-actions mt"><button class="btn btn-ghost" id="fsLoan">Open loan</button><button class="btn btn-primary" id="fsSave">Save</button></div>`);
  p.querySelector("#fsLoan").onclick = () => openLoan(l.id);
  p.querySelector("#fsSave").onclick = async (e) => {
    const amount = num(p.querySelector("#fsAmt").value), date = p.querySelector("#fsDate").value;
    if (!(amount > 0) || amount > 1e11) return panelError(p, "Enter the amount.");
    if (!date) return panelError(p, "Pick the date.");
    panelError(p, "");
    busy(e.currentTarget, true);
    try {
      const closed = await recordFriendPayment(l, "repaid", amount, date);
      closeLayers();
      toast(closed ? `Settled with ${l.person} 🎉` : `Saved — ${fmt(Math.max(0, bal - amount))} still ${lent ? "to get" : "to give"}`);
    } catch (er) { panelError(p, friendly(er)); busy(e.currentTarget, false); }
  };
}

// A payment on a friend loan: the loan payment, its cash entry, and the loan
// closed once nothing is left. Used here and by the Loans page. Returns
// whether the loan is now closed.
async function recordFriendPayment(l, kind, amount, date, note = "") {
  const { data: pay, error } = await sb.from("loan_payments").insert({ loan_id: l.id, kind, amount: round2(amount), paid_on: date, note }).select().single();
  if (error) throw error;
  const tx = await sb.from("transactions").insert(friendTx(l, kind, amount, date, `p:${pay.id}`));
  if (tx.error) { await sb.from("loan_payments").delete().eq("id", pay.id); throw tx.error; }
  await loadLoans();
  const left = loanCalc(loanById(l.id), paysOf(l.id), date).balance;
  let closed = false;
  if (kind === "repaid" && left <= 0.5) {
    const up = await sb.from("loans").update({ closed_on: date }).eq("id", l.id);
    closed = !up.error;
  }
  await reloadMoney();
  return closed;
}

/* ── Today: what is out with friends, and what you owe them ── */
function renderCollect() {
  const card = $("collectCard"); if (!card) return;
  const open = state.loaded && state.loansLoaded ? handLoans() : [];
  card.hidden = !open.length;
  if (!open.length) return;
  const today = todayStr();
  const row = (l) => {
    const bal = Math.max(0, loanCalc(l, paysOf(l.id), today).balance), lent = l.direction === "lent";
    const d = l.due_date ? daysBetween(today, l.due_date) : null;
    const when = d == null ? `since ${shortDate(l.start_date)}` : d < 0 ? `${-d} ${-d === 1 ? "day" : "days"} overdue` : d === 0 ? "due today" : `in ${d} ${d === 1 ? "day" : "days"}`;
    return `<div class="due-row"><span class="avatar-sm ${lent ? "credit-bg" : "debit-bg"}">${lent ? "🤝" : "🤲"}</span>
      <span class="tx-main" data-openloan="${esc(l.id)}" style="cursor:pointer"><b>${esc(l.person)}</b><span class="num">${fmt(bal)} · given ${esc(shortDate(l.start_date))}</span></span>
      <span style="display:grid;gap:4px;justify-items:end"><span class="badge ${d != null && d < 0 ? "warn" : ""}">${esc(when)}</span><button class="btn btn-ghost" style="padding:6px 10px;font-size:12px" data-settle="${esc(l.id)}">${lent ? "Received" : "Returned"}</button></span></div>`;
  };
  const get = open.filter((l) => l.direction === "lent").sort((a, b) => ((a.due_date || "9") < (b.due_date || "9") ? -1 : 1));
  const give = open.filter((l) => l.direction === "borrowed").sort((a, b) => ((a.due_date || "9") < (b.due_date || "9") ? -1 : 1));
  const sum = (list) => list.reduce((s, l) => s + Math.max(0, loanCalc(l, paysOf(l.id), today).balance), 0);
  const late = open.filter((l) => l.due_date && l.due_date < today).length;
  card.innerHTML = `<h3>🤝 Money with friends ${late ? `<span class="badge warn">${late} overdue</span>` : ""}</h3>
    ${get.length ? `<div class="muted small-label">To collect · <b class="num credit">${fmt(sum(get))}</b></div>${get.map(row).join("")}` : ""}
    ${give.length ? `<div class="muted small-label" style="margin-top:10px">To give back · <b class="num debit">${fmt(sum(give))}</b></div>${give.map(row).join("")}` : ""}`;
}
document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-settle]"); if (s) return openSettle(s.dataset.settle);
  const o = e.target.closest("[data-openloan]"); if (o) openLoan(o.dataset.openloan);
});
// the sheet is open: the panel takes its place
$("tFriend").onclick = () => openFriendForm();
renderHooks.push(renderCollect);
