/* ════════════════════════════════════════════════════════════════════════════
   Vault — logins, private notes and important files, encrypted on this device.

   How it's locked:
   • The vault password is stretched with PBKDF2-SHA256 (600,000 rounds) and a
     random salt into a key-encryption key. That never leaves the browser.
   • A random 256-bit vault key (AES-GCM) encrypts every item and file. The
     database only stores that vault key *wrapped* by the key-encryption key.
   • So Supabase, anyone who gets the database, or anyone with this public
     code sees only scrambled bytes. Forget the vault password and the data
     cannot be recovered — by anyone.
   • Unlocked, the key lives only in this tab's memory (not extractable) and is
     dropped after 5 idle minutes, a minute in the background, or sign-out.
   ════════════════════════════════════════════════════════════════════════════ */
const VAULT_ITERATIONS = 600000;
const VAULT_IDLE_MS = 5 * 60 * 1000;
const VAULT_HIDDEN_MS = 60 * 1000;
const VAULT_MAX_FILE = 10 * 1024 * 1024;
const VAULT_KINDS = { login: { icon: "🔑", label: "Login" }, note: { icon: "📝", label: "Note" }, file: { icon: "📎", label: "File" } };
const vault = { row: undefined, key: null, items: [], filter: "all", q: "", idleTimer: null, hiddenAt: 0, busy: false };

/* ── crypto ── */
const enc = new TextEncoder(), dec = new TextDecoder();
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
function toB64(buf) { const b = new Uint8Array(buf); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(str) { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
const aad = () => enc.encode(`fintrack-vault-v1:${state.user.id}`); // ties every item to this account

async function passwordKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
}
async function unwrapVaultKey(password, row, extractable) {
  const kek = await passwordKey(password, fromB64(row.salt), row.iterations);
  return crypto.subtle.unwrapKey("raw", fromB64(row.wrapped_key), kek, { name: "AES-GCM", iv: fromB64(row.wrap_iv) }, { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"]);
}
async function wrapVaultKey(password, vaultKey) {
  const salt = randomBytes(16), iv = randomBytes(12), kek = await passwordKey(password, salt, VAULT_ITERATIONS);
  const wrapped = await crypto.subtle.wrapKey("raw", vaultKey, kek, { name: "AES-GCM", iv });
  return { salt: toB64(salt), iterations: VAULT_ITERATIONS, wrapped_key: toB64(wrapped), wrap_iv: toB64(iv) };
}
async function sealJSON(obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad() }, vault.key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), data: toB64(ct) };
}
async function openJSON(row) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(row.iv), additionalData: aad() }, vault.key, fromB64(row.data));
  return JSON.parse(dec.decode(pt));
}
async function sealBytes(buf) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad() }, vault.key, buf));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function openBytes(buf) {
  const b = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12), additionalData: aad() }, vault.key, b.slice(12));
}
function strength(pw) {
  let s = 0;
  if (pw.length >= 12) s++; if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return pw.length < 10 ? 0 : Math.min(4, s);
}
function generatePassword(len = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+?";
  const out = [], buf = new Uint32Array(len * 2);
  crypto.getRandomValues(buf);
  for (const n of buf) { if (n < Math.floor(2 ** 32 / chars.length) * chars.length) out.push(chars[n % chars.length]); if (out.length === len) break; }
  return out.join("");
}

/* ── lock / unlock ── */
async function loadVaultRow() {
  const { data, error } = await sb.from("vault_keys").select("*").maybeSingle();
  if (error) throw error;
  vault.row = data;
}
async function loadVaultItems() {
  const { data, error } = await sb.from("vault_items").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  vault.items = await Promise.all(data.map(async (r) => {
    try { return { ...r, ...(await openJSON(r)), ok: true }; } catch (e) { return { ...r, ok: false, title: "Can't be opened" }; }
  }));
}
function lockVault(silent) {
  const was = !!vault.key;
  vault.key = null; vault.items = []; vault.q = "";
  clearTimeout(vault.idleTimer);
  if (state.view === "viewVault") closeLayers();
  if ($("vaultSearch")) $("vaultSearch").value = "";
  renderVault();
  if (was && !silent) toast("Vault locked");
}
function touchVault() {
  if (!vault.key) return;
  clearTimeout(vault.idleTimer);
  vault.idleTimer = setTimeout(() => lockVault(), VAULT_IDLE_MS);
}
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, touchVault, { passive: true }));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) vault.hiddenAt = Date.now();
  else if (vault.key && Date.now() - vault.hiddenAt > VAULT_HIDDEN_MS) lockVault();
});
loadHooks.push(loadVaultRow);
resetHooks.push(() => { lockVault(true); vault.row = undefined; });
renderHooks.push(renderVault);
fabHooks.viewVault = () => (vault.key ? openVaultForm(null, "login") : toast("Unlock the vault first"));

/* ── the Vault page ── */
function renderVault() {
  if (!state.user) return;
  const locked = !vault.key;
  $("vaultLocked").hidden = !locked; $("vaultOpen").hidden = locked;
  $("tileVaultSub").textContent = vault.row ? (locked ? "Locked" : `Open · ${vault.items.length} items`) : "Set up";
  if (locked) return renderVaultLock();
  document.querySelectorAll("[data-vfilter]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.vfilter === vault.filter));
  const q = vault.q.toLowerCase();
  const list = vault.items.filter((it) => (vault.filter === "all" || it.kind === vault.filter) && (!q || [it.title, it.username, it.url, it.fileName, it.notes].some((v) => (v || "").toLowerCase().includes(q))));
  $("vaultList").innerHTML = list.length ? list.map((it) => {
    const k = VAULT_KINDS[it.kind];
    const sub = it.kind === "login" ? it.username || it.url || "" : it.kind === "file" ? `${it.fileName || "file"} · ${fileSize(it.file_size)}` : (it.notes || "").split("\n")[0];
    return `<button class="tx" data-vitem="${esc(it.id)}"><span class="tx-ico brand-bg">${k.icon}</span><span class="tx-main"><b>${esc(it.title || "Untitled")}</b><span>${esc(sub)}</span></span><span class="muted">›</span></button>`;
  }).join("") : emptyBox("🔐", q ? "Nothing matches your search." : "Your vault is empty. Tap ＋ to add a login, a note or a file.");
}
function fileSize(n) { n = +n || 0; return n > 1048576 ? `${round2(n / 1048576)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`; }
function renderVaultLock() {
  const box = $("vaultLocked");
  if (vault.row === undefined) { delete box.dataset.mode; box.innerHTML = skeletons(1); return; }
  if (box.dataset.mode === (vault.row ? "unlock" : "setup")) return; // don't wipe what's being typed
  box.dataset.mode = vault.row ? "unlock" : "setup";
  if (!vault.row) {
    box.innerHTML = `
      <div class="lock-ico">🔐</div>
      <h3>Set up your vault</h3>
      <p class="muted">Keep email logins, passwords, ID numbers and important files here. They're encrypted on this device with a <b>vault password</b> before they're saved — no one else can read them, not even the server.</p>
      <div class="field"><label for="vNew">Vault password</label><div class="pw"><input class="input" id="vNew" type="password" autocomplete="new-password" minlength="10" placeholder="At least 10 characters"><button type="button" class="icon-btn" data-reveal="vNew" aria-label="Show password">👁</button></div></div>
      <div class="meter" id="vMeter"><i></i></div>
      <div class="field mt"><label for="vNew2">Type it again</label><input class="input" id="vNew2" type="password" autocomplete="new-password"></div>
      <label class="check mt"><input type="checkbox" id="vAck"> <span>I understand: <b>if I forget the vault password, everything in the vault is lost for good.</b> It can't be reset by email.</span></label>
      <p class="fine left">Use a different password from your FinTrack sign-in. A short sentence works well, e.g. “mango tea at 6 on the terrace”.</p>
      <div class="err-text" hidden></div>
      <button class="btn btn-primary btn-block mt" id="vCreate">Create vault</button>`;
    const pw = $("vNew");
    pw.oninput = () => { const s = strength(pw.value); $("vMeter").firstElementChild.style.width = `${s * 25}%`; $("vMeter").dataset.s = s; };
    $("vCreate").onclick = async (e) => {
      const a = pw.value, b = $("vNew2").value;
      if (a.length < 10) return panelError(box, "Use at least 10 characters.");
      if (strength(a) < 2) return panelError(box, "That's too easy to guess — make it longer or mix in numbers and symbols.");
      if (a !== b) return panelError(box, "The two passwords don't match.");
      if (!$("vAck").checked) return panelError(box, "Tick the box to confirm you understand.");
      panelError(box, ""); busy(e.currentTarget, true, " Securing…");
      try {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const row = await wrapVaultKey(a, key);
        const { data, error } = await sb.from("vault_keys").insert(row).select().single();
        if (error) throw error;
        vault.row = data;
        vault.key = await unwrapVaultKey(a, data, false); // keep only a non-exportable copy
        vault.items = []; delete box.dataset.mode; touchVault(); renderVault(); toast("Vault ready");
      } catch (er) { panelError(box, friendly(er)); busy(e.currentTarget, false); }
    };
  } else {
    box.innerHTML = `
      <div class="lock-ico">🔒</div>
      <h3>Vault is locked</h3>
      <p class="muted">Enter your vault password to open it on this device.</p>
      <form id="vUnlockForm" novalidate>
        <div class="field"><label for="vPw">Vault password</label><div class="pw"><input class="input" id="vPw" type="password" autocomplete="current-password"><button type="button" class="icon-btn" data-reveal="vPw" aria-label="Show password">👁</button></div></div>
        <div class="err-text" hidden></div>
        <button class="btn btn-primary btn-block mt" id="vUnlock" type="submit">Unlock</button>
      </form>
      <button class="link mt" id="vForgot">Forgot the vault password?</button>`;
    $("vUnlockForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("vUnlock"), pw = $("vPw");
      if (!pw.value) return panelError(box, "Enter the vault password.");
      panelError(box, ""); busy(btn, true, " Unlocking…");
      try {
        let key;
        try { key = await unwrapVaultKey(pw.value, vault.row, false); } catch (er) { throw new Error("Wrong vault password."); }
        vault.key = key;
        await loadVaultItems();
        pw.value = ""; delete box.dataset.mode; touchVault(); renderVault();
      } catch (er) { vault.key = null; panelError(box, friendly(er)); busy(btn, false); pw.select(); }
    };
    $("vForgot").onclick = () => confirmAsk("Reset the vault?", "Without the vault password nothing in it can be opened. Resetting permanently deletes every login, note and file in the vault so you can start again with a new password.", resetVault, "Delete everything");
  }
}
async function resetVault() {
  const { data, error } = await sb.from("vault_items").select("file_path").not("file_path", "is", null);
  if (error) throw error;
  const paths = data.map((r) => r.file_path);
  for (let i = 0; i < paths.length; i += 100) { const { error: e2 } = await sb.storage.from("vault").remove(paths.slice(i, i + 100)); if (e2) throw e2; }
  let r = await sb.from("vault_items").delete().eq("user_id", state.user.id); if (r.error) throw r.error;
  r = await sb.from("vault_keys").delete().eq("user_id", state.user.id); if (r.error) throw r.error;
  vault.row = null; vault.key = null; vault.items = []; delete $("vaultLocked").dataset.mode;
  renderVault(); toast("Vault reset");
}
$("vaultSearch").oninput = (e) => { vault.q = e.target.value.trim(); renderVault(); };
$("vaultLockBtn").onclick = () => lockVault();
$("vaultChangePw").onclick = () => openChangeVaultPassword();
document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-vfilter]"); if (f) { vault.filter = f.dataset.vfilter; renderVault(); return; }
  const it = e.target.closest("[data-vitem]"); if (it) { openVaultItem(it.dataset.vitem); return; }
  const r = e.target.closest("[data-reveal]");
  if (r) { const i = $(r.dataset.reveal) || r.parentElement.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; r.textContent = i.type === "password" ? "👁" : "🙈"; }
});

/* ── copy, with the clipboard cleared again for secrets ── */
async function copySecret(text, secret) {
  try {
    await navigator.clipboard.writeText(text);
    toast(secret ? "Copied — clears in 30 seconds" : "Copied");
    if (secret) setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), 30000);
  } catch (e) { toast("Couldn't copy", "err"); }
}

/* ── one item ── */
function openVaultItem(id) {
  const it = vault.items.find((x) => x.id === id); if (!it || !vault.key) return;
  if (!it.ok) {
    const p = openPanel(`<h3>Can't open this item</h3><p class="muted">It was saved with a different key. You can delete it.</p><div class="sheet-actions single mt"><button class="btn btn-danger" id="viDel">Delete</button></div>`);
    p.querySelector("#viDel").onclick = () => deleteVaultItem(it);
    return;
  }
  const row = (label, value, opts = {}) => value ? `<div class="field-row"><div class="fv"><small>${label}</small><span class="${opts.secret ? "secret" : ""}" ${opts.secret ? `data-secret="${esc(value)}"` : ""}>${opts.secret ? "••••••••••" : opts.link ? `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>` : esc(value).replace(/\n/g, "<br>")}</span></div>${opts.secret ? `<button class="icon-btn" data-show aria-label="Show">👁</button>` : ""}${opts.copy ? `<button class="icon-btn" data-copy="${esc(value)}" data-is-secret="${opts.secret ? 1 : ""}" aria-label="Copy ${label}">⧉</button>` : ""}</div>` : "";
  const safeUrl = it.url && /^https?:\/\//i.test(it.url) ? it.url : it.url ? `https://${it.url}` : "";
  const p = openPanel(`
    <h3>${VAULT_KINDS[it.kind].icon} ${esc(it.title || "Untitled")}</h3>
    <p class="panel-sub">${VAULT_KINDS[it.kind].label} · updated ${esc(shortDate(it.updated_at.slice(0, 10)))}</p>
    <div class="card-inset">
      ${it.kind === "login" ? row("Email / username", it.username, { copy: true }) + row("Password", it.password, { copy: true, secret: true }) + row("Website", safeUrl, { link: true, copy: true }) : ""}
      ${it.kind === "file" ? row("File", `${it.fileName} · ${fileSize(it.file_size)}`) : ""}
      ${row(it.kind === "note" ? "Note" : "Notes", it.notes, { copy: it.kind === "note" })}
    </div>
    <div class="btn-grid">
      ${it.kind === "file" ? `<button class="btn btn-primary" id="viDown" style="grid-column:1/-1">Download file</button>` : ""}
      <button class="btn btn-ghost" id="viEdit">Edit</button>
      <button class="btn btn-danger" id="viDel">Delete</button>
    </div>`);
  p.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => copySecret(b.dataset.copy, !!b.dataset.isSecret)));
  p.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => {
    const s = b.parentElement.querySelector(".secret"), shown = s.textContent !== "••••••••••";
    s.textContent = shown ? "••••••••••" : s.dataset.secret; b.textContent = shown ? "👁" : "🙈";
  }));
  p.querySelector("#viEdit").onclick = () => openVaultForm(it, it.kind);
  p.querySelector("#viDel").onclick = () => deleteVaultItem(it);
  if (it.kind === "file") p.querySelector("#viDown").onclick = async (e) => {
    busy(e.currentTarget, true, " Decrypting…");
    try {
      const { data, error } = await sb.storage.from("vault").download(it.file_path);
      if (error) throw error;
      const plain = await openBytes(await data.arrayBuffer());
      download(it.fileName || "file", plain, it.mime || "application/octet-stream");
    } catch (er) { toast(er && er.name === "OperationError" ? "This file couldn't be decrypted." : friendly(er), "err"); }
    finally { busy(e.currentTarget, false); }
  };
}
function deleteVaultItem(it) {
  confirmAsk(`Delete “${it.title || "this item"}”?`, it.kind === "file" ? "The file will be deleted for good." : "It will be deleted for good.", async () => {
    if (it.file_path) { const { error } = await sb.storage.from("vault").remove([it.file_path]); if (error) throw error; }
    const { error } = await sb.from("vault_items").delete().eq("id", it.id);
    if (error) throw error;
    vault.items = vault.items.filter((x) => x.id !== it.id); renderVault(); toast("Deleted");
  });
}

/* ── add / edit ── */
function openVaultForm(it, kind) {
  if (!vault.key) return;
  const v = it || {};
  const p = openPanel(`
    <h3>${it ? "Edit" : "Add to vault"}</h3>
    ${it ? "" : segHTML("vkind", [["login", "🔑 Login"], ["note", "📝 Note"], ["file", "📎 File"]], kind)}
    <div class="field mt"><label for="vfTitle">Title</label><input class="input" id="vfTitle" maxlength="120" value="${esc(v.title || "")}" placeholder="e.g. Gmail, Bank netbanking, PAN card" autocomplete="off"></div>
    <div data-for="login">
      <div class="field mt"><label for="vfUser">Email / username</label><input class="input" id="vfUser" maxlength="300" value="${esc(v.username || "")}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field mt"><label for="vfPass">Password</label><div class="pw"><input class="input" id="vfPass" type="password" maxlength="500" value="${esc(v.password || "")}" autocomplete="new-password" spellcheck="false"><button type="button" class="icon-btn" data-reveal="vfPass" aria-label="Show password">👁</button><button type="button" class="icon-btn" id="vfGen" aria-label="Generate a strong password" title="Generate">🎲</button></div></div>
      <div class="field mt"><label for="vfUrl">Website (optional)</label><input class="input" id="vfUrl" maxlength="500" value="${esc(v.url || "")}" placeholder="mail.google.com" autocapitalize="off" spellcheck="false"></div>
    </div>
    <div data-for="file">
      ${it ? `<p class="muted mt">File: ${esc(v.fileName || "")} · ${fileSize(v.file_size)}</p>` : `<div class="field mt"><label for="vfFile">File (up to 10 MB)</label><input class="input" id="vfFile" type="file"></div>`}
    </div>
    <div class="field mt"><label for="vfNotes" id="vfNotesLabel">Notes (optional)</label><textarea class="input" id="vfNotes" maxlength="20000" spellcheck="false">${esc(v.notes || "")}</textarea></div>
    <p class="fine left">🔒 Encrypted on this device before saving.</p>
    <div class="err-text" hidden></div>
    <div class="sheet-actions single mt"><button class="btn btn-primary" id="vfSave">${it ? "Save" : "Save to vault"}</button></div>`);
  const cur = () => (it ? it.kind : segVal(p, "vkind"));
  const sync = () => {
    const k = cur();
    p.querySelectorAll("[data-for]").forEach((s) => (s.hidden = s.dataset.for !== k));
    p.querySelector("#vfNotesLabel").textContent = k === "note" ? "Note" : "Notes (optional)";
  };
  p.addEventListener("change", (e) => { if (e.target.closest("[data-seg]")) sync(); });
  sync();
  p.querySelector("#vfGen").onclick = () => { const i = p.querySelector("#vfPass"); i.value = generatePassword(); i.type = "text"; };
  setTimeout(() => p.querySelector("#vfTitle").focus(), 300);
  p.querySelector("#vfSave").onclick = async (e) => {
    const k = cur(), title = p.querySelector("#vfTitle").value.trim(), notes = p.querySelector("#vfNotes").value;
    const payload = { title, notes };
    if (!title) return panelError(p, "Give it a title.");
    if (k === "login") Object.assign(payload, { username: p.querySelector("#vfUser").value.trim(), password: p.querySelector("#vfPass").value, url: p.querySelector("#vfUrl").value.trim() });
    if (k === "note" && !notes.trim()) return panelError(p, "Write the note.");
    let file = null;
    if (k === "file" && !it) {
      file = p.querySelector("#vfFile").files[0];
      if (!file) return panelError(p, "Choose a file.");
      if (file.size > VAULT_MAX_FILE) return panelError(p, "That file is over 10 MB.");
    }
    if (k === "file" && it) Object.assign(payload, { fileName: it.fileName, mime: it.mime });
    panelError(p, ""); busy(e.currentTarget, true, " Encrypting…");
    let uploaded = null;
    try {
      const row = { kind: k };
      if (file) {
        uploaded = `${state.user.id}/${crypto.randomUUID()}`;
        const sealed = await sealBytes(await file.arrayBuffer());
        const { error } = await sb.storage.from("vault").upload(uploaded, new Blob([sealed], { type: "application/octet-stream" }), { contentType: "application/octet-stream", upsert: false });
        if (error) throw error;
        Object.assign(payload, { fileName: file.name.slice(0, 200), mime: file.type || "application/octet-stream" });
        Object.assign(row, { file_path: uploaded, file_size: file.size });
      }
      Object.assign(row, await sealJSON(payload));
      const { data, error } = it ? await sb.from("vault_items").update({ data: row.data, iv: row.iv }).eq("id", it.id).select().single() : await sb.from("vault_items").insert(row).select().single();
      if (error) throw error;
      const item = { ...data, ...payload, ok: true };
      vault.items = [item, ...vault.items.filter((x) => x.id !== item.id)];
      renderVault(); openVaultItem(item.id); toast("Saved to vault");
    } catch (er) {
      if (uploaded && !it) sb.storage.from("vault").remove([uploaded]).catch(() => {});
      panelError(p, friendly(er)); busy(e.currentTarget, false);
    }
  };
}

/* ── change the vault password (re-locks the same vault key; items untouched) ── */
function openChangeVaultPassword() {
  const p = openPanel(`
    <h3>Change vault password</h3>
    <div class="field"><label for="cvOld">Current vault password</label><input class="input" id="cvOld" type="password" autocomplete="current-password"></div>
    <div class="field mt"><label for="cvNew">New vault password</label><div class="pw"><input class="input" id="cvNew" type="password" autocomplete="new-password"><button type="button" class="icon-btn" data-reveal="cvNew" aria-label="Show password">👁</button></div></div>
    <div class="field mt"><label for="cvNew2">Type the new one again</label><input class="input" id="cvNew2" type="password" autocomplete="new-password"></div>
    <div class="err-text" hidden></div>
    <div class="sheet-actions single mt"><button class="btn btn-primary" id="cvSave">Change password</button></div>`);
  p.querySelector("#cvSave").onclick = async (e) => {
    const old = p.querySelector("#cvOld").value, a = p.querySelector("#cvNew").value, b = p.querySelector("#cvNew2").value;
    if (a.length < 10 || strength(a) < 2) return panelError(p, "Make the new password at least 10 characters and harder to guess.");
    if (a !== b) return panelError(p, "The new passwords don't match.");
    panelError(p, ""); busy(e.currentTarget, true, " Re-locking…");
    try {
      let exportable;
      try { exportable = await unwrapVaultKey(old, vault.row, true); } catch (er) { throw new Error("The current vault password is wrong."); }
      const row = await wrapVaultKey(a, exportable);
      const { data, error } = await sb.from("vault_keys").update(row).eq("user_id", state.user.id).select().single();
      if (error) throw error;
      vault.row = data; closeLayers(); toast("Vault password changed");
    } catch (er) { panelError(p, friendly(er)); busy(e.currentTarget, false); }
  };
}
