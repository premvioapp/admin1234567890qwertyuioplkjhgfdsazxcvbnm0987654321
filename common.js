/* ============ PREMVIO — shared helpers ============ */
if (window.pvDead) throw new Error("stopped");
const CFG = window.PV_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) {
  return CFG.CURRENCY + " " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function timeLeft(to) {
  const ms = new Date(to) - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return `${h}h ${m}m left`;
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
  if (/Email not confirmed/i.test(m)) return "Please confirm your email first — check your inbox.";
  if (/already registered/i.test(m)) return "This email is already registered. Please log in.";
  if (/Failed to fetch/i.test(m)) return "No internet connection. Please try again.";
  return m.replace(/^.*?ERROR:\s*/, "");
}

/* ---------- toast & modal ---------- */
function toast(msg, type = "") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}
function openModal(html, onMount) {
  closeModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.id = "modal";
  bg.innerHTML = `<div class="modal"><button class="icon-btn close" data-close aria-label="Close">${ICONS.x}</button>${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) closeModal(); });
  document.body.appendChild(bg);
  document.body.style.overflow = "hidden";
  onMount && onMount(bg.querySelector(".modal"));
}
function closeModal() {
  $("#modal")?.remove();
  document.body.style.overflow = "";
}
function confirmBox(title, text, okLabel = "Confirm", danger = false) {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(title)}</h2><p class="muted">${text}</p>
      <div class="row mt"><button class="btn ghost grow" data-close>Cancel</button>
      <button class="btn grow ${danger ? "danger" : ""}" id="cbOk">${esc(okLabel)}</button></div>`, (m) => {
      $("#cbOk", m).onclick = () => { closeModal(); resolve(true); };
      $$("[data-close]", m).forEach((b) => b.addEventListener("click", () => resolve(false)));
    });
  });
}
async function busy(btn, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Please wait…";
  try { return await fn(); }
  catch (e) { toast(errMsg(e), "error"); }
  finally { btn.disabled = false; btn.innerHTML = old; }
}

/* ---------- math captcha ---------- */
function mountCaptcha(container) {
  let a, b, op, ans;
  const draw = () => {
    a = 2 + Math.floor(Math.random() * 12);
    b = 1 + Math.floor(Math.random() * 9);
    op = Math.random() < .5 ? "+" : "×";
    if (op === "×") { b = 2 + Math.floor(Math.random() * 5); }
    ans = op === "+" ? a + b : a * b;
    $(".q", container).textContent = `${a} ${op} ${b} = ?`;
    $("input", container).value = "";
  };
  container.innerHTML = `<div class="captcha"><div class="q"></div>
    <input inputmode="numeric" placeholder="Answer" autocomplete="off" required>
    <button type="button" class="icon-btn" title="New question">${ICONS.refresh}</button></div>`;
  $("button", container).onclick = draw;
  draw();
  return { ok: () => Number($("input", container).value.trim()) === ans, reset: draw };
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
  try { localStorage.setItem("pv_theme", t); } catch (e) {}
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === "light" ? "#f2f5fc" : "#060b1a";
}
try { applyTheme(localStorage.getItem("pv_theme") || "dark"); } catch (e) { applyTheme("dark"); }

/* ---------- service worker & push ---------- */
let swReg = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((r) => (swReg = r)).catch(() => {});
}
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function b64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush(silent = false) {
  if (!pushSupported()) {
    if (!silent) toast(isIOS() ? "On iPhone: tap Share → Add to Home Screen, then open Premvio from your home screen to enable notifications." : "This browser doesn't support notifications.", "error");
    return false;
  }
  const perm = Notification.permission === "granted" ? "granted" : silent ? Notification.permission : await Notification.requestPermission();
  if (perm !== "granted") {
    if (!silent) toast("Notifications are blocked. Allow them in your browser settings.", "error");
    return false;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CFG.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.rpc("save_push_subscription", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  if (error) { if (!silent) toast(errMsg(error), "error"); return false; }
  return true;
}
async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isStandalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone; }

/* ---------- auth for staff panels (admin / agent) ---------- */
// Agents and admins log in with their ID (AG1002 / AD1001). Internally that is <id>@staff.premvio.app
function staffEmail(v) {
  v = String(v || "").trim();
  return v.includes("@") ? v : v.toLowerCase() + "@staff.premvio.app";
}
async function getMyProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from("profiles").select("*").eq("id", user.id).single();
  if (error) throw error;
  return data;
}
function staffLogin(container, roleLabel, allowed, onOk) {
  container.innerHTML = `
  <div class="auth-wrap"><div class="auth-box">
    <img src="img/logo.png" class="auth-logo" alt="Premvio">
    <div class="card">
      <h2 class="center">${esc(roleLabel)} login</h2>
      <form id="slForm">
        <label>${esc(roleLabel)} ID</label><input name="email" required autocomplete="username" placeholder="${roleLabel === "Admin" ? "AD1001" : "AG1002"}" style="text-transform:uppercase">
        <label>Password</label><input type="password" name="password" required autocomplete="current-password">
        <label>Security check</label><div id="slCap"></div>
        <button class="btn block mt">Log in</button>
      </form>
    </div>
  </div></div>`;
  const cap = mountCaptcha($("#slCap", container));
  $("#slForm", container).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    if (!cap.ok()) { toast("Wrong captcha answer.", "error"); cap.reset(); return; }
    busy($("button.btn", f), async () => {
      const { error } = await sb.auth.signInWithPassword({ email: staffEmail(f.email.value), password: f.password.value });
      if (error) { cap.reset(); if (/Invalid login/i.test(error.message)) throw new Error("Wrong ID or password."); throw error; }
      const p = await getMyProfile();
      if (!p || !allowed.includes(p.role) || p.blocked) {
        await sb.auth.signOut();
        throw new Error(`This account does not have ${roleLabel.toLowerCase()} access.`);
      }
      onOk(p);
    });
  };
}

/* ---------- image upload (admin) ---------- */
async function uploadImage(file, folder) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from("media").upload(path, file, { cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
}

/* ---------- icons ---------- */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h12v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>',
};

/* ---------- countries ---------- */
const COUNTRIES = "Nepal|India|Bangladesh|Bhutan|Pakistan|Sri Lanka|Maldives|Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Barbados|Belarus|Belgium|Belize|Benin|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burundi|Cabo Verde|Cambodia|Cameroon|Canada|Central African Republic|Chad|Chile|China|Colombia|Comoros|Congo|Costa Rica|Côte d'Ivoire|Croatia|Cuba|Cyprus|Czechia|DR Congo|Denmark|Djibouti|Dominica|Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Grenada|Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Madagascar|Malawi|Malaysia|Mali|Malta|Marshall Islands|Mauritania|Mauritius|Mexico|Micronesia|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nauru|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Korea|North Macedonia|Norway|Oman|Palau|Palestine|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|Portugal|Qatar|Romania|Russia|Rwanda|Saint Kitts and Nevis|Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|Sao Tome and Principe|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|Solomon Islands|Somalia|South Africa|South Korea|South Sudan|Spain|Sudan|Suriname|Sweden|Switzerland|Syria|Taiwan|Tajikistan|Tanzania|Thailand|Timor-Leste|Togo|Tonga|Trinidad and Tobago|Tunisia|Türkiye|Turkmenistan|Tuvalu|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Vanuatu|Vatican City|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe".split("|");
function countryOptions(selected = "Nepal") {
  return COUNTRIES.map((c) => `<option ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
}
function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast("Copied: " + t, "success"), () => toast(t));
}
