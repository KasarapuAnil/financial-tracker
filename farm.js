/* ════════════════════════════════════════════════════════════════════════════
   Farm — what each crop earned, what it cost, and what was left.

   A CYCLE is one crop, on one field, in one season of one year: "Paddy, 2
   Acres, Rabi 2026". That is the unit the farm is actually run in, and the
   unit the paper register has always been kept in, so it is the unit here.

   INCOME IS COMPUTED, NEVER TYPED. Straight out of the register:

       quintals = (bags × kg/bag + cuttings kg) ÷ 100
       income   = quintals × rate/quintal + anything else sold

   Checked against the real book before this was written -- 2 Acres, Kharif
   2025: (112 × 40) + 224 = 4,704 kg = 47.04 qtl × ₹2,389 = ₹1,12,378.56, which
   is the figure in the register to the paisa.

   Storing the total as well would be a second copy of a number four others
   already determine, and the first edit to a rate leaves the two disagreeing
   with nothing to say which is right.

   FARM MONEY STAYS HERE. It does not reach the Today or Month screens: a
   ₹1.3 lakh harvest and a ₹40,000 fertiliser bill would swamp a chart of
   household spending, and the two are different books kept for different
   reasons.
   ════════════════════════════════════════════════════════════════════════════ */

const SEASONS = [
  ["kharif", "Kharif"],
  ["rabi", "Rabi"],
  ["summer", "Summer"],
  ["other", "Other"],
];
const SEASON_LABEL = Object.fromEntries(SEASONS);

/* The categories a crop's money actually goes on, in roughly the order of the
 * season. Not a generic expense list: "ploughing" and "transplanting" are
 * separate jobs paid to different people at different times, and collapsing
 * them into "labour" would lose the breakdown that makes this worth keeping. */
const CROP_CATS = [
  ["seeds", "🌱 Seeds"],
  ["fertiliser", "🧪 Fertiliser"],
  ["pesticide", "🛡 Pesticide"],
  ["ploughing", "🚜 Ploughing"],
  ["transplanting", "🌾 Transplanting"],
  ["labour", "👷 Labour"],
  ["water", "💧 Water / power"],
  ["harvesting", "✂️ Harvesting"],
  ["transport", "🛻 Transport"],
  ["other", "📦 Other"],
];
const CAT_LABEL = Object.fromEntries(CROP_CATS);

Object.assign(state, { cycles: [], cropExp: [], farmLoaded: false, farmYear: "all" });

/* ── the calculation ── */
function cycleQtl(c) {
  return ((+c.bags || 0) * (+c.kg_per_bag || 0) + (+c.cuttings_kg || 0)) / 100;
}
function cycleIncome(c) {
  return cycleQtl(c) * (+c.rate_per_qtl || 0) + (+c.other_income || 0);
}
function cycleSpent(c) {
  return state.cropExp.reduce((s, e) => (e.cycle_id === c.id ? s + (+e.amount || 0) : s), 0);
}
function cycleProfit(c) { return cycleIncome(c) - cycleSpent(c); }

// Harvested yet? A cycle that is sown but not cut has no income, and showing
// it a ₹0 income beside a real expense total would read as a loss rather than
// as a crop still standing in the field.
function cycleHarvested(c) { return cycleQtl(c) > 0 || (+c.other_income || 0) > 0; }

function cycleTitle(c) { return `${c.crop} · ${c.field}`; }
function cycleWhen(c) { return `${SEASON_LABEL[c.season] || c.season} ${c.year}`; }

/* ── loading ── */
async function loadFarm() {
  const [cy, ex] = await Promise.all([
    sb.from("crop_cycles").select("*").order("year", { ascending: false }).order("season"),
    sb.from("crop_expenses").select("*").order("spent_on"),
  ]);
  if (cy.error || ex.error) { toast("Couldn't load the farm book", "err"); return; }
  state.cycles = cy.data || [];
  state.cropExp = ex.data || [];
  state.farmLoaded = true;
  renderFarm();
}

/* Same three hooks every other module registers: loaded once at sign-in,
 * re-rendered whenever anything changes, emptied on sign-out so the next
 * person to sign in on this phone does not see the last one's harvest. */
loadHooks.push(loadFarm);
renderHooks.push(() => { if (state.farmLoaded) renderFarm(); });
resetHooks.push(() => Object.assign(state, { cycles: [], cropExp: [], farmLoaded: false, farmYear: "all" }));

// The ＋ button means "new crop" while this view is open.
fabHooks.viewFarm = () => openCycleForm(null);

// Wired at top level like every other module's handlers: these scripts run at
// the end of <body>, so the markup above them already exists.
$("fmAdd").onclick = () => openCycleForm(null);
$("fmSpend").onclick = () => openSpendPicker();
$("fmImport").onclick = () => openFarmImport();

/* ── the dashboard ── */
const CROP_ICONS = [[/paddy|rice|wheat|jowar|bajra|ragi/i, "🌾"], [/maize|corn/i, "🌽"], [/chill?i|mirchi/i, "🌶️"], [/groundnut|peanut/i, "🥜"], [/tomato/i, "🍅"], [/sugar ?cane/i, "🎋"], [/onion/i, "🧅"], [/banana/i, "🍌"], [/mango/i, "🥭"], [/cotton/i, "☁️"], [/potato/i, "🥔"], [/coconut/i, "🥥"]];
function cropIcon(name) { const hit = CROP_ICONS.find(([re]) => re.test(name || "")); return hit ? hit[1] : "🌱"; }

function farmYears() {
  return [...new Set(state.cycles.map((c) => c.year))].sort((a, b) => b - a);
}

function renderFarm() {
  const years = farmYears();
  if (state.farmYear !== "all" && !years.includes(+state.farmYear)) state.farmYear = "all";
  const shown = state.cycles.filter((c) => state.farmYear === "all" || c.year === +state.farmYear);

  const income = shown.reduce((s, c) => s + cycleIncome(c), 0);
  const spent = shown.reduce((s, c) => s + cycleSpent(c), 0);
  const profit = income - spent;

  $("fmProfit").textContent = (profit < 0 ? "−" : "") + fmt(profit);
  $("fmProfitLbl").textContent = profit < 0 ? "Loss" : "Profit";
  $("fmIncome").textContent = fmt(income);
  $("fmSpent").textContent = fmt(spent);
  const qtl = shown.reduce((s, c) => s + cycleQtl(c), 0);
  $("fmYield").textContent = qtl > 0 ? `${qtl.toFixed(2)} qtl` : "—";
  const margin = income > 0 ? Math.round((profit / income) * 100) : null;
  $("fmMargin").textContent = margin == null ? `${shown.length} ${shown.length === 1 ? "crop" : "crops"}` : `${margin >= 0 ? "▲" : "▼"} ${Math.abs(margin)}% margin · ${shown.length} ${shown.length === 1 ? "crop" : "crops"}`;
  $("fmMargin").className = "fm-pill " + (margin != null && margin < 0 ? "bad" : "");
  $("fmCover").style.width = `${income > 0 ? Math.min(100, (spent / income) * 100) : spent > 0 ? 100 : 0}%`;
  $("fmCoverLbl").textContent = income > 0 ? `Costs took ${Math.round((spent / income) * 100)}% of income` : spent > 0 ? "Costs so far — no harvest yet" : "";

  // year chips
  $("fmYears").innerHTML =
    [["all", "All years"], ...years.map((y) => [String(y), String(y)])]
      .map(([v, label]) => `<button class="chip-btn${String(state.farmYear) === v ? " on" : ""}" data-fyear="${v}">${label}</button>`)
      .join("");

  // by crop, biggest first -- "did the cotton pay?" is the question this answers
  const byCrop = {};
  for (const c of shown) {
    const k = c.crop || "—";
    byCrop[k] = byCrop[k] || { income: 0, spent: 0, qtl: 0 };
    byCrop[k].income += cycleIncome(c);
    byCrop[k].spent += cycleSpent(c);
    byCrop[k].qtl += cycleQtl(c);
  }
  const crops = Object.entries(byCrop).sort((a, b) => b[1].income - a[1].income);
  const maxCrop = Math.max(1, ...crops.map(([, v]) => Math.max(v.income, v.spent)));
  $("fmByCrop").innerHTML = crops.length
    ? crops.map(([name, v]) => {
        const p = v.income - v.spent, m = v.income > 0 ? Math.round((p / v.income) * 100) : null;
        return `<div class="fm-crop">
          <span class="fm-ico">${cropIcon(name)}</span>
          <div class="fm-crop-mid">
            <div class="fm-row"><b>${esc(name)}</b><b class="num ${p < 0 ? "debit" : "credit"}">${p < 0 ? "−" : "+"}${fmt(p)}</b></div>
            <div class="fm-bars"><i class="in" style="width:${(v.income / maxCrop) * 100}%"></i><i class="out" style="width:${(v.spent / maxCrop) * 100}%"></i></div>
            <div class="fm-row fm-sub"><span>${v.qtl > 0 ? `${v.qtl.toFixed(2)} qtl` : "not harvested yet"}</span><span>${m == null ? "" : `${m}% margin`}</span></div>
          </div>
        </div>`;
      }).join("") + `<div class="legend"><span><i style="background:var(--credit)"></i>Income</span><span><i style="background:var(--debit)"></i>Spent</span></div>`
    : emptyBox("🌾", "No crops yet. Add one above, or paste an old sheet if you have it.");

  // the cycles themselves
  $("fmList").innerHTML = !state.farmLoaded
    ? skeletons(2)
    : shown.length
    ? shown.map((c) => {
        const income = cycleIncome(c), spent = cycleSpent(c), p = income - spent;
        const done = cycleHarvested(c);
        // "Growing" rather than a ₹0 income: a crop still in the field has
        // costs and no return yet, and showing that as a loss would be wrong.
        const badge = done
          ? (c.cut_date ? `<span class="badge ok">Cut ${esc(shortDate(c.cut_date))}</span>` : `<span class="badge ok">Harvested</span>`)
          : `<span class="badge">Growing</span>`;
        const today = todayStr();
        const days = !done && c.sow_date && c.sow_date <= today ? daysBetween(c.sow_date, today) : null;
        const cover = income > 0 ? Math.min(100, (spent / income) * 100) : 100;
        return `<button class="card item fm-cycle ${done ? (p < 0 ? "is-loss" : "is-win") : "is-growing"}" data-cycle="${esc(c.id)}">
          <div class="item-top">
            <span class="fm-ico">${cropIcon(c.crop)}</span>
            <span class="tx-main"><b>${esc(cycleTitle(c))}</b><span>${esc(cycleWhen(c))}${done ? ` · ${cycleQtl(c).toFixed(2)} qtl` : days != null ? ` · day ${days + 1} in the field` : ""}</span></span>
            ${badge}
          </div>
          <div class="nums">
            <div><small>Income</small><b class="num">${done ? fmt(income) : "—"}</b></div>
            <div><small>Spent</small><b class="num">${fmt(spent)}</b></div>
            <div><small>${done ? (p < 0 ? "Loss" : "Profit") : "So far"}</small><b class="num ${done ? (p < 0 ? "debit" : "credit") : "debit"}">${done ? fmt(p) : fmt(-spent)}</b></div>
          </div>
          ${done && income > 0 ? `<div class="fm-track" title="Share of income spent on costs"><i style="width:${cover}%"></i></div>` : ""}
        </button>`;
      }).join("")
    : emptyBox("🌾", "Nothing for this year.");
}

document.addEventListener("click", (e) => {
  const y = e.target.closest("[data-fyear]");
  if (y) { state.farmYear = y.dataset.fyear; renderFarm(); return; }
  const c = e.target.closest("[data-cycle]");
  if (c) { const cy = state.cycles.find((x) => x.id === c.dataset.cycle); if (cy) openCycle(cy); }
});

/* ── one cycle, in detail ── */
function openCycle(c) {
  const qtl = cycleQtl(c);
  const income = cycleIncome(c);
  const spent = cycleSpent(c);
  const profit = income - spent;
  const mine = state.cropExp.filter((e) => e.cycle_id === c.id).sort((a, b) => (a.spent_on < b.spent_on ? 1 : -1));

  // The sum by category, so "where did it all go" is answerable without
  // reading every line.
  const byCat = {};
  for (const e of mine) byCat[e.category] = (byCat[e.category] || 0) + (+e.amount || 0);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const p = openPanel(`
    <h3>${esc(cycleTitle(c))}</h3>
    <p style="color:var(--text-2);margin:-6px 0 14px">${esc(cycleWhen(c))}${c.sow_date ? ` · sown ${shortDate(c.sow_date)}` : ""}${c.cut_date ? ` · cut ${shortDate(c.cut_date)}` : ""}</p>

    <div class="card hero" style="margin-bottom:14px">
      <div class="label">${profit < 0 ? "Loss" : "Profit"}</div>
      <div class="big num" style="color:${profit < 0 ? "var(--debit)" : "var(--credit)"}">${fmt(profit)}</div>
      <div class="split">
        <div class="chip"><span>Income</span><b class="num">${fmt(income)}</b></div>
        <div class="chip"><span>Spent</span><b class="num">${fmt(spent)}</b></div>
      </div>
    </div>

    ${qtl > 0 ? `
    <div class="card box" style="margin-bottom:14px">
      <!-- The working, shown rather than just the answer: this is the sum the
           register has always had written in the margin, and seeing it is how
           a wrong bag count gets spotted. -->
      <div class="fine" style="line-height:1.8">
        ${soldByOf(c) === "bags" ? `${(+c.bags || 0)} bags × ${(+c.kg_per_bag || 0)} kg${(+c.cuttings_kg || 0) ? ` + ${(+c.cuttings_kg)} kg cuttings` : ""}
        = <b>${qtl.toFixed(2)} qtl</b><br>` : soldByOf(c) === "kg" ? `${(+c.bags || 0)} kg = <b>${qtl.toFixed(2)} qtl</b><br>` : ""}
        ${qtl.toFixed(2)} × ${fmtReal(+c.rate_per_qtl || 0)}/qtl = <b>${fmtReal(qtl * (+c.rate_per_qtl || 0))}</b>
        ${(+c.other_income || 0) ? `<br>+ ${fmtReal(+c.other_income)} other` : ""}
      </div>
    </div>` : `<p class="fine" style="margin-bottom:14px">Not harvested yet — add the quantity and rate when it is cut.</p>`}

    ${cats.length ? `<div class="card box" style="margin-bottom:12px">${
      cats.map(([k, v]) => `<div class="item-top" style="padding:7px 0">
        <span class="tx-main"><b>${esc(CAT_LABEL[k] || k)}</b></span>
        <b class="num">${fmt(v)}</b>
      </div>`).join("")
    }</div>` : ""}

    <div class="chips mb"><button class="chip-btn" id="cyAddExp">＋ Add an expense</button></div>

    <div class="card box" style="margin-bottom:14px">${
      mine.length
        ? mine.map((e) => `<div class="item-top" style="padding:8px 0">
            <span class="tx-main"><b>${esc(CAT_LABEL[e.category] || e.category)}</b><span>${esc(shortDate(e.spent_on))}${e.note ? ` · ${esc(e.note)}` : ""}</span></span>
            <b class="num">${fmt(+e.amount)}</b>
            <button class="link" data-delexp="${esc(e.id)}" aria-label="Remove this expense">✕</button>
          </div>`).join("")
        : `<p class="fine" style="margin:4px 0">Nothing spent on this one yet.</p>`
    }</div>

    ${c.note ? `<p class="fine">${esc(c.note)}</p>` : ""}
    <div class="sheet-actions">
      <button class="btn btn-danger" id="cyDel">Delete</button>
      <button class="btn btn-primary" id="cyEdit">Edit</button>
    </div>
  `);

  p.querySelector("#cyEdit").onclick = () => openCycleForm(c);
  p.querySelector("#cyAddExp").onclick = () => openExpenseForm(c);
  p.querySelector("#cyDel").onclick = () =>
    confirmAsk(`Delete ${cycleTitle(c)}, ${cycleWhen(c)}?`,
      mine.length
        ? `Its ${mine.length} expense${mine.length > 1 ? "s" : ""} (${fmtReal(spent)}) go with it. This cannot be undone.`
        : "This cannot be undone.",
      async () => {
        // Thrown, not toasted: confirmYes() catches it, says what went wrong
        // and leaves the sheet open. Returning quietly would close the sheet
        // as though it had worked.
        const { error } = await sb.from("crop_cycles").delete().eq("id", c.id);
        if (error) throw error;
        // The database removes the expenses itself (on delete cascade); this
        // just keeps the copy on screen in step without a round trip.
        state.cycles = state.cycles.filter((x) => x.id !== c.id);
        state.cropExp = state.cropExp.filter((x) => x.cycle_id !== c.id);
        renderFarm();
        toast("Crop deleted");
      });

  p.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-delexp]");
    if (!b) return;
    const e = state.cropExp.find((x) => x.id === b.dataset.delexp);
    if (!e) return;
    confirmAsk(`Remove ${CAT_LABEL[e.category] || e.category}?`,
      `${fmtReal(+e.amount)} on ${shortDate(e.spent_on)} will be taken off this crop.`,
      async () => {
        const { error } = await sb.from("crop_expenses").delete().eq("id", e.id);
        if (error) throw error;
        state.cropExp = state.cropExp.filter((x) => x.id !== e.id);
        renderFarm();
        toast("Removed");
        // Back to the crop afterwards, so the running total can be seen to
        // have changed. The delay lets the confirm sheet finish closing.
        setTimeout(() => openCycle(state.cycles.find((x) => x.id === c.id)), 350);
      }, "Remove");
  });
}

/* ── add / edit a cycle ── */
/* How a crop's harvest is counted. All three fit the same columns:
   bags × kg_per_bag + cuttings_kg = total kg, so "quintals" is stored as
   bags = quintals with 100 kg each, and "kg" as bags = kg with 1 kg each. */
const SOLD_BY = { bags: "Bags", qtl: "Quintals", kg: "Kg" };
const QTL_CROPS = /cotton|chill?i|mirchi|turmeric|maize|corn|groundnut|soya|red ?gram|tur|bengal ?gram|jowar|sugar ?cane/i;
const QUICK_CROPS = ["Paddy", "Cotton", "Maize", "Chilli", "Groundnut", "Red gram"];
function soldByOf(c) {
  if (!c) return "bags";
  if (+c.kg_per_bag === 100 && !(+c.cuttings_kg)) return "qtl";
  if (+c.kg_per_bag === 1 && !(+c.cuttings_kg)) return "kg";
  return "bags";
}

function openCycleForm(c) {
  const thisYear = new Date().getFullYear();
  const p = openPanel(`
    <h3>${c ? "Edit crop" : "New crop"}</h3>
    <div class="form-grid">
      <div class="field"><label for="cfCrop">Crop</label><input class="input" id="cfCrop" maxlength="40" placeholder="Paddy" value="${c ? esc(c.crop) : "Paddy"}" list="cfCrops"></div>
      <div class="field"><label for="cfField">Field</label><input class="input" id="cfField" maxlength="60" placeholder="2 Acres" value="${c ? esc(c.field) : ""}" list="cfFields"></div>
    </div>
    <div class="fm-quick" id="cfQuick">${QUICK_CROPS.map((n) => `<button type="button" class="chip-btn" data-crop="${esc(n)}">${cropIcon(n)} ${esc(n)}</button>`).join("")}</div>
    <datalist id="cfCrops">${[...new Set([...QUICK_CROPS, ...state.cycles.map((x) => x.crop)])].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
    <datalist id="cfFields">${[...new Set(state.cycles.map((x) => x.field))].map((f) => `<option value="${esc(f)}">`).join("")}</datalist>
    <div class="field"><label>Season</label>${segHTML("season", SEASONS, c ? c.season : "kharif")}</div>
    <div class="form-grid">
      <div class="field"><label for="cfYear">Year</label><input class="input" id="cfYear" type="number" min="1990" max="2100" value="${c ? c.year : thisYear}"></div>
      <div class="field"><label for="cfSow">Sown</label><input class="input" id="cfSow" type="date" value="${c && c.sow_date ? c.sow_date : ""}"></div>
    </div>
    <div class="field"><label for="cfCut">Cut</label><input class="input" id="cfCut" type="date" value="${c && c.cut_date ? c.cut_date : ""}"></div>

    <!-- The harvest. Left empty while the crop is still standing; the detail
         screen says "not harvested yet" rather than showing a ₹0 income. -->
    <p class="fine" style="margin:14px 0 8px">Harvest — fill this in when it is cut</p>
    <div class="field"><label>Sold by</label>
      <div class="seg" id="cfSold" role="group" aria-label="Sold by">${Object.entries(SOLD_BY).map(([k, v]) => `<button type="button" data-sold="${k}" aria-pressed="false">${v}</button>`).join("")}</div>
    </div>
    <div class="form-grid" id="cfBagRow">
      <div class="field"><label for="cfBags" id="cfBagsLbl">Bags</label><input class="input" id="cfBags" type="number" inputmode="decimal" min="0" step="0.01" value="${c && +c.bags ? +c.bags : ""}"></div>
      <div class="field" id="cfKgWrap"><label for="cfKg">Kg per bag</label><input class="input" id="cfKg" type="number" inputmode="decimal" min="0" step="0.01" value="${c && soldByOf(c) === "bags" ? +c.kg_per_bag : 40}"></div>
    </div>
    <div class="form-grid">
      <div class="field" id="cfCutWrap"><label for="cfCut2">Cuttings (kg)</label><input class="input" id="cfCut2" type="number" inputmode="decimal" min="0" step="0.01" value="${c && +c.cuttings_kg ? +c.cuttings_kg : ""}"></div>
      <div class="field"><label for="cfRate">Rate per quintal (₹)</label><input class="input" id="cfRate" type="number" inputmode="decimal" min="0" step="0.01" value="${c && +c.rate_per_qtl ? +c.rate_per_qtl : ""}"></div>
    </div>
    <div class="field"><label for="cfOther">Anything else sold (₹)</label><input class="input" id="cfOther" type="number" inputmode="decimal" min="0" step="0.01" placeholder="straw, etc." value="${c && +c.other_income ? +c.other_income : ""}"></div>
    <!-- The total, live, so a mistyped bag count is obvious before it is saved
         rather than a fortnight later when the year's figure looks wrong. -->
    <p class="fine" id="cfPreview" style="margin:-4px 0 12px"></p>
    <div class="field"><label for="cfNote">Note</label><input class="input" id="cfNote" maxlength="200" value="${c ? esc(c.note) : ""}"></div>
    <div class="err-text" id="cfErr" hidden></div>
    <div class="sheet-actions"><button class="btn btn-ghost" id="cfCancel">Cancel</button><button class="btn btn-primary" id="cfSave">Save</button></div>
  `);

  let sold = soldByOf(c);
  if (!c && QTL_CROPS.test(p.querySelector("#cfCrop").value)) sold = "qtl";
  const draftOf = () => {
    const amt = p.querySelector("#cfBags").value;
    return {
      bags: amt,
      kg_per_bag: sold === "qtl" ? 100 : sold === "kg" ? 1 : p.querySelector("#cfKg").value,
      cuttings_kg: sold === "bags" ? p.querySelector("#cfCut2").value : 0,
      rate_per_qtl: p.querySelector("#cfRate").value,
      other_income: p.querySelector("#cfOther").value,
    };
  };
  const setSold = (k) => {
    sold = k;
    p.querySelectorAll("[data-sold]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sold === k));
    p.querySelector("#cfBagsLbl").textContent = k === "qtl" ? "Quintals" : k === "kg" ? "Total kg" : "Bags";
    p.querySelector("#cfKgWrap").hidden = k !== "bags";
    p.querySelector("#cfCutWrap").hidden = k !== "bags";
    p.querySelector("#cfBagRow").classList.toggle("one", k !== "bags");
    preview();
  };
  const preview = () => {
    const draft = draftOf(), q = cycleQtl(draft);
    p.querySelector("#cfPreview").innerHTML = q > 0 || +draft.other_income
      ? `<span class="fm-calc"><b>${q.toFixed(2)} qtl</b>${+draft.rate_per_qtl ? ` × ${fmtReal(+draft.rate_per_qtl)}` : ""}${+draft.other_income ? ` + ${fmtReal(+draft.other_income)}` : ""} = <b>${fmtReal(cycleIncome(draft))}</b></span>`
      : "";
  };
  p.querySelector("#cfSold").onclick = (e) => { const b = e.target.closest("[data-sold]"); if (b) setSold(b.dataset.sold); };
  p.querySelector("#cfQuick").onclick = (e) => {
    const b = e.target.closest("[data-crop]"); if (!b) return;
    p.querySelector("#cfCrop").value = b.dataset.crop;
    setSold(QTL_CROPS.test(b.dataset.crop) ? "qtl" : "bags");
  };
  // typing "cotton" switches to quintals, once, until you pick a mode yourself
  let picked = !!c;
  p.querySelector("#cfSold").addEventListener("click", () => (picked = true));
  p.querySelector("#cfCrop").oninput = () => { if (!picked) setSold(QTL_CROPS.test(p.querySelector("#cfCrop").value) ? "qtl" : "bags"); };
  ["#cfBags", "#cfKg", "#cfCut2", "#cfRate", "#cfOther"].forEach((s) => (p.querySelector(s).oninput = preview));
  setSold(sold);

  p.querySelector("#cfCancel").onclick = closeLayers;
  p.querySelector("#cfSave").onclick = async () => {
    const err = p.querySelector("#cfErr");
    const row = {
      crop: p.querySelector("#cfCrop").value.trim() || "Paddy",
      field: p.querySelector("#cfField").value.trim(),
      season: segVal(p, "season") || "kharif",
      year: parseInt(p.querySelector("#cfYear").value, 10),
      sow_date: p.querySelector("#cfSow").value || null,
      cut_date: p.querySelector("#cfCut").value || null,
      bags: round2(+draftOf().bags || 0),
      kg_per_bag: round2(+draftOf().kg_per_bag || 0),
      cuttings_kg: round2(+draftOf().cuttings_kg || 0),
      rate_per_qtl: round2(+p.querySelector("#cfRate").value || 0),
      other_income: round2(+p.querySelector("#cfOther").value || 0),
      note: p.querySelector("#cfNote").value.trim(),
    };
    if (!row.field) { err.textContent = "Which field is it?"; err.hidden = false; return; }
    if (!Number.isFinite(row.year) || row.year < 1990 || row.year > 2100) { err.textContent = "That year does not look right."; err.hidden = false; return; }
    err.hidden = true;

    const q = c ? sb.from("crop_cycles").update(row).eq("id", c.id).select().single()
                : sb.from("crop_cycles").insert(row).select().single();
    const { data, error } = await q;
    if (error) { err.textContent = "Couldn't save it. " + error.message; err.hidden = false; return; }
    if (c) state.cycles = state.cycles.map((x) => (x.id === data.id ? data : x));
    else state.cycles = [data, ...state.cycles];
    state.cycles.sort((a, b) => b.year - a.year || String(a.season).localeCompare(b.season));
    closeLayers(); renderFarm(); toast(c ? "Saved" : "Crop added");
  };
}

/* ── "I spent money on the farm" — which crop? ──
 *
 * Expenses belong to a cycle, and that is what makes "did this season pay?"
 * answerable at all. But it also buried the button two taps deep, inside a
 * crop you had to think to open first. This is the same journey starting from
 * the other end: say what you spent, pick the crop after.
 *
 * With one crop in the ground there is nothing to pick, so it skips straight
 * through rather than asking a question with a single answer. */
function openSpendPicker() {
  const live = state.cycles.filter((c) => !cycleHarvested(c));
  const list = (live.length ? live : state.cycles).slice();
  if (!list.length) { toast("Add a crop first"); openCycleForm(null); return; }
  if (list.length === 1) { openExpenseForm(list[0]); return; }

  const p = openPanel(`
    <h3>Which crop?</h3>
    <p style="color:var(--text-2);margin:-6px 0 14px">${live.length ? "Still growing" : "All crops"} — tap the one you spent on.</p>
    <div class="card box">${list.map((c) => `
      <button class="item-top" data-pick="${esc(c.id)}" style="padding:10px 0;width:100%;background:none;border:0;text-align:left">
        <span class="avatar-sm credit-bg">${esc((c.crop || "?").trim()[0].toUpperCase())}</span>
        <span class="tx-main"><b>${esc(cycleTitle(c))}</b><span>${esc(cycleWhen(c))} · ${fmt(cycleSpent(c))} so far</span></span>
      </button>`).join("")}
    </div>
    ${live.length && live.length < state.cycles.length
      ? `<div class="chips mt"><button class="chip-btn" id="spAll">Show harvested crops too</button></div>` : ""}
    <div class="sheet-actions"><button class="btn btn-ghost" id="spCancel">Cancel</button></div>
  `);

  p.querySelector("#spCancel").onclick = closeLayers;
  const all = p.querySelector("#spAll");
  // A bill can arrive after the harvest -- the last transport run, usually --
  // so the finished crops are reachable, just not in the way by default.
  if (all) all.onclick = () => openSpendPickerAll();
  p.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pick]"); if (!b) return;
    const c = state.cycles.find((x) => x.id === b.dataset.pick);
    if (c) openExpenseForm(c);
  });
}

// The same picker without the "still growing" filter.
function openSpendPickerAll() {
  const p = openPanel(`
    <h3>Which crop?</h3>
    <div class="card box">${state.cycles.map((c) => `
      <button class="item-top" data-pick="${esc(c.id)}" style="padding:10px 0;width:100%;background:none;border:0;text-align:left">
        <span class="avatar-sm credit-bg">${esc((c.crop || "?").trim()[0].toUpperCase())}</span>
        <span class="tx-main"><b>${esc(cycleTitle(c))}</b><span>${esc(cycleWhen(c))} · ${fmt(cycleSpent(c))} so far</span></span>
      </button>`).join("")}
    </div>
    <div class="sheet-actions"><button class="btn btn-ghost" id="spCancel2">Cancel</button></div>
  `);
  p.querySelector("#spCancel2").onclick = closeLayers;
  p.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pick]"); if (!b) return;
    const c = state.cycles.find((x) => x.id === b.dataset.pick);
    if (c) openExpenseForm(c);
  });
}

/* ── an expense against one cycle ── */
function openExpenseForm(c) {
  const p = openPanel(`
    <h3>Spent on ${esc(cycleTitle(c))}</h3>
    <p style="color:var(--text-2);margin:-6px 0 14px">${esc(cycleWhen(c))}</p>
    <div class="amount"><span>${state.currency}</span><input id="efAmt" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0" aria-label="Amount"></div>
    <div class="field"><label>What for</label></div>
    <div class="fm-opts" id="efCats" role="radiogroup" aria-label="What for">${CROP_CATS.map(([v, label], i) => { const [ico, ...t] = label.split(" "); return `<button type="button" class="fm-opt${i === 0 ? " on" : ""}" role="radio" aria-checked="${i === 0}" data-cat="${v}"><span class="fm-opt-ico">${ico}</span><span class="fm-opt-t">${esc(t.join(" "))}</span><span class="fm-opt-tick" aria-hidden="true">✓</span></button>`; }).join("")}</div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label for="efDate">Date</label><input class="input" id="efDate" type="date" value="${todayStr()}"></div>
      <div class="field"><label for="efNote">Note</label><input class="input" id="efNote" maxlength="120" placeholder="optional"></div>
    </div>
    <div class="err-text" id="efErr" hidden></div>
    <div class="sheet-actions"><button class="btn btn-ghost" id="efCancel">Cancel</button><button class="btn btn-primary" id="efSave">Save</button></div>
  `);

  p.querySelector("#efCats").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cat]"); if (!b) return;
    p.querySelectorAll("#efCats .fm-opt").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
  });

  p.querySelector("#efCancel").onclick = () => openCycle(c);
  p.querySelector("#efSave").onclick = async () => {
    const err = p.querySelector("#efErr");
    const amount = round2(+p.querySelector("#efAmt").value || 0);
    if (!(amount > 0)) { err.textContent = "How much was it?"; err.hidden = false; return; }
    const cat = p.querySelector("#efCats .fm-opt.on");
    const { data, error } = await sb.from("crop_expenses").insert({
      cycle_id: c.id,
      category: cat ? cat.dataset.cat : "other",
      amount,
      spent_on: p.querySelector("#efDate").value || todayStr(),
      note: p.querySelector("#efNote").value.trim(),
    }).select().single();
    if (error) { err.textContent = "Couldn't save it. " + error.message; err.hidden = false; return; }
    state.cropExp.push(data);
    renderFarm(); openCycle(c); toast("Added");
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   Bringing the old register in.

   The register is a spreadsheet, and the fastest way out of a spreadsheet and
   into a phone is to select the rows and paste them. No file picker, no export
   step, nothing to go wrong on a phone that has no Downloads folder worth
   speaking of.

   WHAT IS SHOWN BEFORE ANYTHING IS SAVED. The sheet has subtotal rows, year
   banners and blank seasons in it, and the parser throws those away by
   recognising them -- but a parser that silently discarded a REAL row would
   quietly lose a season's income. So everything it understood is listed, with
   the totals it worked out, and nothing is written until that list has been
   looked at.
   ════════════════════════════════════════════════════════════════════════════ */
function parseSheet(text, defaultYear) {
  const rows = [];
  let year = defaultYear;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // "YEAR 2026" banners set the year for the rows beneath them.
    const yb = line.match(/(?:^|\s)(?:year\s*)?(20\d\d)\s*$/i) || line.match(/year\s*(20\d\d)/i);
    if (yb && !/\t/.test(line)) { year = +yb[1]; continue; }

    // Subtotals and annual totals are derived rows -- re-importing them would
    // double every figure they summarise.
    if (/subtotal|annual total|s\.?no/i.test(line)) continue;

    const cells = raw.split("\t").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (cells.length < 4) continue;

    // A data row is: S.No, Field, Season, ... -- the season is what identifies it.
    const seasonCell = cells.find((s) => /^(kharif|rabi|summer)$/i.test(s));
    if (!seasonCell) continue;
    const si = cells.indexOf(seasonCell);
    const field = (cells[si - 1] || "").trim();
    if (!field) continue;

    const num = (s) => {
      if (s === undefined || s === null) return 0;
      const v = String(s).replace(/[₹,\s]/g, "");
      if (!v || v === "-" || v === "–") return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const date = (s) => {
      if (!s || /^[-–]$/.test(s)) return null;
      const d = new Date(String(s).replace(/-/g, " "));
      if (isNaN(d)) return null;
      const yy = d.getFullYear();
      return `${yy}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    // Columns after the season: Sow, Cut, Bags, Kg/Bag, Rate/Kg, Cuttings,
    // Total Qtl, Rate/Qtl, Total. Positional, because that is what the sheet
    // is -- and the preview is what catches it when a column has moved.
    const after = cells.slice(si + 1);
    const bags = num(after[2]);
    const kg = num(after[3]) || 40;
    const cuttings = num(after[5]);
    let rateQtl = num(after[7]);
    if (!rateQtl) rateQtl = num(after[4]) * 100;   // only Rate/Kg was filled in

    const rowYear = (() => {
      const d = date(after[1]) || date(after[0]);
      return d ? +d.slice(0, 4) : year;
    })();
    if (!rowYear) continue;
    // Nothing worth keeping: no harvest and no dates is an empty template row.
    if (!bags && !cuttings && !date(after[0]) && !date(after[1])) continue;

    rows.push({
      crop: "Paddy",
      field,
      season: seasonCell.toLowerCase(),
      year: rowYear,
      sow_date: date(after[0]),
      cut_date: date(after[1]),
      bags: round2(bags),
      kg_per_bag: round2(kg),
      cuttings_kg: round2(cuttings),
      rate_per_qtl: round2(rateQtl),
      other_income: 0,
      note: "",
      legacy_id: `${rowYear}|${seasonCell.toLowerCase()}|${field}`.toLowerCase(),
    });
  }
  return rows;
}

function openFarmImport() {
  const p = openPanel(`
    <h3>Paste last year's sheet</h3>
    <p style="color:var(--text-2);margin:-6px 0 14px">Select the rows in Excel or Google Sheets, copy, and paste them here. Year banners and subtotal rows are ignored.</p>
    <textarea class="input" id="fiText" rows="7" placeholder="1	20 Gunta	Kharif	–	11-Nov-2025	26	40	₹23.89	0	…" style="width:100%;font-family:ui-monospace,monospace;font-size:13px"></textarea>
    <div class="chips mt mb"><button class="chip-btn" id="fiRead">Read it</button></div>
    <div id="fiPreview"></div>
    <div class="err-text" id="fiErr" hidden></div>
    <div class="sheet-actions"><button class="btn btn-ghost" id="fiCancel">Cancel</button><button class="btn btn-primary" id="fiSave" disabled>Save</button></div>
  `);

  let parsed = [];
  p.querySelector("#fiCancel").onclick = closeLayers;
  p.querySelector("#fiRead").onclick = () => {
    parsed = parseSheet(p.querySelector("#fiText").value, new Date().getFullYear());
    const save = p.querySelector("#fiSave");
    if (!parsed.length) {
      p.querySelector("#fiPreview").innerHTML = `<p class="empty">Nothing recognised in that. Paste the rows including the Field and Season columns.</p>`;
      save.disabled = true;
      return;
    }
    save.disabled = false;
    const total = parsed.reduce((s, r) => s + cycleIncome(r), 0);
    p.querySelector("#fiPreview").innerHTML = `
      <div class="card box">${parsed.map((r) => `
        <div class="item-top" style="padding:8px 0">
          <span class="tx-main">
            <b>${esc(r.field)} · ${SEASON_LABEL[r.season]} ${r.year}</b>
            <span>${cycleQtl(r).toFixed(2)} qtl${r.rate_per_qtl ? ` × ${fmtReal(r.rate_per_qtl)}/qtl` : ""}</span>
          </span>
          <b class="num">${fmtReal(cycleIncome(r))}</b>
        </div>`).join("")}
      </div>
      <p class="fine mt">${parsed.length} row(s) · ${fmtReal(total)} in total. Rows you already have are updated, not duplicated.</p>`;
  };

  p.querySelector("#fiSave").onclick = async () => {
    if (!parsed.length) return;
    const err = p.querySelector("#fiErr");
    /* Upsert on the legacy key, so pasting the same sheet twice corrects the
     * rows rather than doubling the year's income.
     *
     * user_id is written out EXPLICITLY even though the column defaults to
     * auth.uid(). It is half of the conflict target, and a target column that
     * is not in the payload gives "no unique or exclusion constraint matching
     * the ON CONFLICT specification" -- the default fills the row, but not in
     * time for the inference. insertMany() in app.js does the same for the
     * same reason. */
    const rows = parsed.map((r) => ({ ...r, user_id: state.user.id }));
    const { error } = await sb.from("crop_cycles").upsert(rows, { onConflict: "user_id,legacy_id" });
    if (error) { err.textContent = "Couldn't save them. " + error.message; err.hidden = false; return; }
    closeLayers();
    await loadFarm();
    toast(`${parsed.length} row(s) brought in`);
  };
}
