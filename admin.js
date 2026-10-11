/* ============ PREMVIO — Admin panel (v2) ============ */
const AD = { me: null, stats: {}, channel: null, orderFilter: "pending", userQ: "", wdFilter: "pending", kycFilter: "pending", txType: "all", staffQ: "" };
const root = $("#root");

sb.auth.getSession().then(async ({ data }) => {
  if (data.session) {
    try {
      const p = await getMyProfile();
      if (p && p.role === "admin" && !p.blocked) return start(p);
      await sb.auth.signOut();
    } catch (e) {}
  }
  staffLogin(root, "Admin", ["admin"], start);
});

const SECTIONS = [
  { id: "dashboard", label: "Dashboard", icon: ICONS.grid },
  { id: "orders", label: "Orders", icon: ICONS.bag, count: "pending_orders" },
  { id: "products", label: "Products", icon: ICONS.star },
  { id: "features", label: "New features", icon: ICONS.spark },
  { id: "customers", label: "Customers", icon: ICONS.users },
  { id: "agents", label: "Agents & admins", icon: ICONS.shield },
  { id: "kyc", label: "KYC review", icon: ICONS.shield, count: "pending_kyc" },
  { id: "withdrawals", label: "Withdrawal codes", icon: ICONS.wallet, count: "pending_withdrawals" },
  { id: "transactions", label: "Transactions", icon: ICONS.list },
  { id: "notify", label: "Send notification", icon: ICONS.bell },
  { id: "settings", label: "Settings", icon: ICONS.gear },
];

function start(p) {
  AD.me = p;
  applyTheme("dark");
  root.innerHTML = `
  <div class="panel">
    <aside class="sidebar" id="side">
      <div class="brand"><img src="img/logo.png" alt=""><div>Premvio<div class="small muted">Admin · ${esc(p.member_id)}</div></div></div>
      ${SECTIONS.map((s) => `<button class="side-link" data-s="${s.id}">${s.icon}<span>${s.label}</span>${s.count ? `<span class="count hidden" data-count="${s.count}"></span>` : ""}</button>`).join("")}
      <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
      <button class="side-link" id="pushBtn">${ICONS.bell}<span>Enable push alerts</span></button>
      <button class="side-link" id="outBtn">${ICONS.logout}<span>Log out</span></button>
    </aside>
    <div class="panel-main">
      <div class="panel-top"><button class="icon-btn menu-btn" id="menu">${ICONS.menu}</button><h1 id="ptitle" class="grow"></h1>
        <span class="small muted">${esc(p.full_name)}</span></div>
      <div id="view"></div>
    </div>
  </div>`;
  $$(".side-link[data-s]").forEach((b) => (b.onclick = () => { location.hash = b.dataset.s; $("#side").classList.remove("open"); }));
  $("#menu").onclick = () => $("#side").classList.toggle("open");
  $("#outBtn").onclick = async () => { await disablePush().catch(() => {}); await sb.auth.signOut(); location.hash = ""; location.reload(); };
  $("#pushBtn").onclick = async () => { if (await enablePush()) toast("You'll get push alerts for new orders and KYC.", "success"); };
  window.onhashchange = route;
  AD.channel = sb.channel("admin")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (x) => {
      toast(`New order #${x.new.id}: ${x.new.product_name} × ${x.new.quantity}`, "success");
      refreshCounts();
      if (["orders", "dashboard"].includes(currentSection())) route();
    }).subscribe();
  if (pushSupported() && Notification.permission === "granted") enablePush(true);
  refreshCounts();
  route();
}

function currentSection() {
  const s = (location.hash || "#dashboard").slice(1).split("/")[0];
  return SECTIONS.find((x) => x.id === s) ? s : "dashboard";
}
function hashArg() { return decodeURIComponent((location.hash || "").slice(1).split("/")[1] || ""); }
async function refreshCounts() {
  const { data } = await sb.rpc("admin_stats");
  if (!data) return;
  AD.stats = data;
  $$("[data-count]").forEach((el) => { const n = data[el.dataset.count]; el.textContent = n; el.classList.toggle("hidden", !n); });
}
function route() {
  const s = currentSection();
  $$(".side-link[data-s]").forEach((b) => b.classList.toggle("on", b.dataset.s === s));
  $("#ptitle").textContent = SECTIONS.find((x) => x.id === s).label;
  const v = $("#view");
  v.innerHTML = `<div class="loader"></div>`;
  const fn = { dashboard, orders, products, features, customers, agents, kyc, withdrawals, transactions, notify, settings }[s];
  fn(v).catch((e) => (v.innerHTML = `<div class="card">${esc(errMsg(e))}</div>`));
}
function table(head, rows, empty = "Nothing here yet") {
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.length ? rows.join("") : `<tr><td colspan="${head.length}"><div class="empty">${empty}</div></td></tr>`}</tbody></table></div>`;
}
function chips(list, cur, attr) {
  return `<div class="chips">${list.map(([k, l]) => `<button class="chip ${cur === k ? "on" : ""}" data-${attr}="${k}">${l}</button>`).join("")}</div>`;
}
function who(p) { return p ? `${esc(p.full_name)}<div class="small muted mono">${esc(p.member_id)}</div>` : "—"; }
function amt(n) { return `<span class="${n >= 0 ? "amt-pos" : "amt-neg"}">${n >= 0 ? "+" : "−"}${money(Math.abs(n))}</span>`; }
const TX_LABEL = { load: "Deposit (agent)", withdraw: "Withdrawal", purchase: "Purchase", refund: "Refund", adjust: "Admin adjust", agent_load: "Loaded customer", agent_payout: "Paid withdrawal" };

/* ---------- Deposit / Withdraw money (admin only) ---------- */
function moneyModal(u, kind, after) {
  const dep = kind === "deposit";
  openModal(`<h2 style="color:${dep ? "var(--green)" : "var(--red)"}">${dep ? "Deposit to" : "Withdraw from"} ${esc(u.full_name)}</h2>
    <p class="muted small">${esc(u.member_id)} · ${esc(u.role)} · current balance <b>${money(u.balance)}</b></p>
    <form id="mf">
      <label>Amount (${CFG.CURRENCY})</label><input type="number" name="amount" min="0.01" step="0.01" required inputmode="decimal">
      <label>Note (shown in history)</label><input name="note" maxlength="120" placeholder="${dep ? "e.g. Cash received" : "e.g. Cash returned"}">
      <button class="btn block mt ${dep ? "deposit" : "withdraw"}">${dep ? "Deposit" : "Withdraw"}</button>
    </form>`, (m) => {
    $("#mf", m).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      const a = Math.abs(Number(f.amount.value));
      if (!(a > 0)) return toast("Enter an amount.", "error");
      if (!dep && a > Number(u.balance)) return toast("That's more than their balance.", "error");
      busy($("button", f), async () => {
        const note = f.note.value.trim() || (dep ? "Deposit by admin" : "Withdrawal by admin");
        const { data, error } = await sb.rpc("admin_adjust_balance", { p_user: u.id, p_amount: dep ? a : -a, p_note: note });
        if (error) throw error;
        closeModal();
        toast(`${dep ? "Deposited" : "Withdrew"} ${money(a)}. New balance ${money(data)}.`, "success");
        after ? after() : route();
      });
    };
  });
}

/* ---------------- DASHBOARD ---------------- */
async function dashboard(v) {
  await refreshCounts();
  const s = AD.stats;
  const [{ data: daily }, { data: recent }] = await Promise.all([
    sb.rpc("admin_daily", { p_days: 7 }),
    sb.from("orders").select("*, profiles(full_name, member_id)").eq("status", "pending").order("created_at", { ascending: false }).limit(8),
  ]);
  const max = Math.max(1, ...(daily || []).map((d) => Number(d.sales)));
  v.innerHTML = `<div class="stats">
    ${[["Sales today", money(s.sales_today)], ["Deposits today", money(s.loads_today)], ["Pending orders", s.pending_orders],
       ["Pending KYC", s.pending_kyc], ["Active withdrawal codes", s.pending_withdrawals], ["Customers", s.customers],
       ["Agents", s.agents], ["Customer balances", money(s.customer_balance)], ["Agent balances", money(s.agent_balance)]]
      .map(([k, val]) => `<div class="stat"><div class="k">${k}</div><div class="v">${val ?? 0}</div></div>`).join("")}
  </div>
  <div class="card mt"><div class="row between"><h3 style="margin:0">Sales — last 7 days</h3><span class="small muted">NPR, Nepal time</span></div>
    <div class="bars">${(daily || []).map((d) => `<div class="b"><div class="val">${Number(d.sales) ? Number(d.sales).toLocaleString("en-IN") : ""}</div>
      <div class="col" style="height:${Math.round((Number(d.sales) / max) * 120)}px" title="${money(d.sales)} · ${d.orders} orders"></div>
      <div class="day">${new Date(d.day + "T00:00").toLocaleDateString("en-GB", { weekday: "short" })}</div></div>`).join("")}</div></div>
  <h2 class="mt">Pending orders</h2>
  ${orderTable(recent || [])}`;
  bindOrderButtons(v);
}

/* ---------------- ORDERS ---------------- */
function formView(fd) {
  return (fd || []).filter((x) => x.value).map((x) => `<div class="kv"><span>${esc(x.label)}:</span> <b>${esc(x.value)}</b>
    <button class="link-btn small" onclick="copyText(this.dataset.v)" data-v="${esc(x.value)}">copy</button></div>`).join("") || `<span class="muted">—</span>`;
}
function orderTable(list) {
  return table(["#", "Customer", "Product", "Qty", "Total", "Customer's form", "Date", "Status", ""], list.map((o) => `<tr>
    <td>${o.id}</td><td>${who(o.profiles)}</td><td>${esc(o.product_name)}</td><td>${o.quantity}</td><td><b>${money(o.total)}</b></td>
    <td>${formView(o.form_data)}</td>
    <td class="small">${fmtDate(o.created_at)}</td>
    <td><span class="badge ${o.status}">${o.status}</span>${o.admin_note ? `<div class="small muted">${esc(o.admin_note)}</div>` : ""}</td>
    <td style="white-space:nowrap">${o.status === "pending" ? `<button class="btn sm success" data-done="${o.id}">Complete</button><button class="btn sm ghost" data-cancel="${o.id}">Cancel</button>` : ""}</td>
  </tr>`), "No orders");
}
function bindOrderButtons(v) {
  $$("[data-done]", v).forEach((b) => (b.onclick = () => openModal(`<h2>Complete order #${b.dataset.done}</h2>
    <p class="muted">The customer gets a notification that it was delivered.</p>
    <form id="df"><label>Message to customer (optional)</label><input name="note" maxlength="200">
    <button class="btn success block mt">Mark completed</button></form>`, (m) => {
    $("#df", m).onsubmit = (e) => {
      e.preventDefault();
      busy($("button", e.target), async () => {
        const { error } = await sb.rpc("admin_update_order", { p_id: Number(b.dataset.done), p_status: "completed", p_note: e.target.note.value.trim() || null });
        if (error) throw error;
        closeModal(); toast("Order completed.", "success"); refreshCounts(); route();
      });
    };
  })));
  $$("[data-cancel]", v).forEach((b) => (b.onclick = () => openModal(`<h2>Cancel order #${b.dataset.cancel}</h2>
    <p class="muted">The full amount is refunded to the customer's balance.</p>
    <form id="cf"><label>Reason (shown to customer)</label><input name="note" maxlength="200">
    <button class="btn danger block mt">Cancel &amp; refund</button></form>`, (m) => {
    $("#cf", m).onsubmit = (e) => {
      e.preventDefault();
      busy($("button", e.target), async () => {
        const { error } = await sb.rpc("admin_update_order", { p_id: Number(b.dataset.cancel), p_status: "cancelled", p_note: e.target.note.value.trim() || null });
        if (error) throw error;
        closeModal(); toast("Order cancelled and refunded.", "success"); refreshCounts(); route();
      });
    };
  })));
}
async function orders(v) {
  let q = sb.from("orders").select("*, profiles(full_name, member_id)").order("created_at", { ascending: false }).limit(300);
  if (AD.orderFilter !== "all") q = q.eq("status", AD.orderFilter);
  const { data, error } = await q;
  if (error) throw error;
  v.innerHTML = chips([["pending", "Pending"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]], AD.orderFilter, "of") + orderTable(data);
  $$("[data-of]", v).forEach((c) => (c.onclick = () => { AD.orderFilter = c.dataset.of; route(); }));
  bindOrderButtons(v);
}

/* ---------------- PRODUCTS (with custom order form) ---------------- */
async function products(v) {
  const { data, error } = await sb.from("products").select("*").order("sort").order("created_at", { ascending: false });
  if (error) throw error;
  v.innerHTML = `<div class="toolbar"><span class="muted grow">Products show on the customer Home page. Each product has its own order form.</span>
    <button class="btn" id="add">${ICONS.plus} Add product</button></div>
    ${table(["Photo", "Name", "Price", "Qty limits", "Form fields", "Status", ""], data.map((p) => `<tr>
      <td>${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}">` : `<div class="thumb"></div>`}</td>
      <td><b>${esc(p.name)}</b><div class="small muted" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.description)}</div></td>
      <td><b>${money(p.price)}</b></td><td class="small">${p.min_qty} – ${p.max_qty}</td>
      <td class="small">${(p.fields || []).map((f) => esc(f.label) + (f.required ? "*" : "")).join(", ") || "—"}</td>
      <td><span class="badge ${p.active ? "active" : "cancelled"}">${p.active ? "visible" : "hidden"}</span></td>
      <td style="white-space:nowrap"><button class="btn sm soft" data-edit="${p.id}">Edit</button><button class="btn sm ghost" data-del="${p.id}">Delete</button></td>
    </tr>`), "No products yet — add your first one")}`;
  $("#add").onclick = () => productForm();
  $$("[data-edit]", v).forEach((b) => (b.onclick = () => productForm(data.find((p) => p.id == b.dataset.edit))));
  $$("[data-del]", v).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox("Delete product?", "It disappears from the customer app. Past orders are kept.", "Delete", true))) return;
    const { error } = await sb.from("products").delete().eq("id", b.dataset.del);
    if (error) return toast(errMsg(error), "error");
    toast("Deleted.", "success"); route();
  }));
}
const FIELD_TYPES = [["text", "Short text"], ["textarea", "Long text"], ["number", "Number"], ["select", "Dropdown (choose one)"]];
function newFieldId() { return "f" + Math.random().toString(36).slice(2, 8); }
function productForm(p = {}) {
  let fields = JSON.parse(JSON.stringify(p.fields && p.fields.length ? p.fields
    : p.id ? [] : [{ id: newFieldId(), label: "Telegram username", type: "text", required: true, placeholder: "@username" }]));
  openModal(`<h2>${p.id ? "Edit" : "Add"} product</h2><form id="pf">
    <label>Photo</label>
    <div class="row"><img id="prev" class="thumb ${p.image_url ? "" : "hidden"}" src="${esc(p.image_url || "")}" style="width:72px;height:72px">
    <input type="file" name="file" accept="image/*"></div>
    <label>Product name</label><input name="pname" required maxlength="100" value="${esc(p.name || "")}" placeholder="e.g. Telegram Stars">
    <div class="grid-2"><div><label>Price per 1 (${CFG.CURRENCY})</label><input type="number" name="price" min="0" step="0.01" required value="${p.price ?? ""}"></div>
    <div><label>Display order (lower = first)</label><input type="number" name="sort" value="${p.sort ?? 0}"></div>
    <div><label>Minimum quantity</label><input type="number" name="min_qty" min="1" value="${p.min_qty ?? 1}"></div>
    <div><label>Maximum quantity</label><input type="number" name="max_qty" min="1" value="${p.max_qty ?? 1000}"></div></div>
    <label>Description</label><textarea name="description" maxlength="3000">${esc(p.description || "")}</textarea>
    <div class="setting-row"><b>Visible to customers</b><label class="switch" style="margin:0"><input type="checkbox" name="active" ${p.active !== false ? "checked" : ""}><span></span></label></div>

    <h3 class="mt">Order form for this product</h3>
    <p class="small muted">Customers fill this in when they buy (quantity is always asked). Add, edit, reorder or remove fields.</p>
    <div id="fields"></div>
    <button type="button" class="btn soft block mt" id="addField">${ICONS.plus} Add field</button>
    <button class="btn block mt">Save product</button></form>`, (m) => {
    const f = $("#pf", m);
    const box = $("#fields", m);
    const draw = () => {
      box.innerHTML = fields.length ? fields.map((fd, i) => `<div class="field-row" data-i="${i}">
        <div class="row"><input class="grow" data-k="label" value="${esc(fd.label)}" placeholder="Field name, e.g. Telegram username" required>
          <select data-k="type" style="width:auto">${FIELD_TYPES.map(([k, l]) => `<option value="${k}" ${fd.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="row mt">
          ${fd.type === "select" ? `<input class="grow" data-k="options" value="${esc((fd.options || []).join(", "))}" placeholder="Options, separated by commas">`
            : `<input class="grow" data-k="placeholder" value="${esc(fd.placeholder || "")}" placeholder="Hint shown inside the box (optional)">`}
          <label class="row small" style="margin:0;white-space:nowrap;color:var(--text)"><input type="checkbox" data-k="required" ${fd.required ? "checked" : ""} style="width:auto"> Required</label>
        </div>
        <div class="row mt" style="justify-content:flex-end">
          <button type="button" class="btn sm soft" data-mv="-1" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn sm soft" data-mv="1" ${i === fields.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn sm danger" data-rm>Remove</button></div>
      </div>`).join("") : `<p class="small muted">No extra fields — customers only choose a quantity.</p>`;
    };
    const sync = () => $$(".field-row", box).forEach((row) => {
      const fd = fields[row.dataset.i];
      fd.label = $('[data-k="label"]', row).value.trim();
      fd.type = $('[data-k="type"]', row).value;
      fd.required = $('[data-k="required"]', row).checked;
      const o = $('[data-k="options"]', row), ph = $('[data-k="placeholder"]', row);
      if (o) fd.options = o.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (ph) fd.placeholder = ph.value.trim();
    });
    box.onchange = (e) => { if (e.target.dataset.k === "type") { sync(); draw(); } };
    box.onclick = (e) => {
      const row = e.target.closest(".field-row"); if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.dataset.mv) { sync(); const j = i + Number(e.target.dataset.mv); [fields[i], fields[j]] = [fields[j], fields[i]]; draw(); }
      if (e.target.hasAttribute("data-rm")) { sync(); fields.splice(i, 1); draw(); }
    };
    $("#addField", m).onclick = () => { sync(); fields.push({ id: newFieldId(), label: "", type: "text", required: true }); draw(); $$('[data-k="label"]', box).pop()?.focus(); };
    draw();
    f.file.onchange = () => { const file = f.file.files[0]; if (file) { $("#prev", m).src = URL.createObjectURL(file); $("#prev", m).classList.remove("hidden"); } };
    f.onsubmit = (e) => {
      e.preventDefault();
      sync();
      for (const fd of fields) {
        if (!fd.label) return toast("Every form field needs a name.", "error");
        if (fd.type === "select" && !(fd.options || []).length) return toast(`Add options for "${fd.label}".`, "error");
        if (fd.type !== "select") delete fd.options;
      }
      const minq = Math.max(1, Math.floor(Number(f.min_qty.value) || 1)), maxq = Math.max(minq, Math.floor(Number(f.max_qty.value) || minq));
      busy($('button.btn:not([type="button"])', f), async () => {
        let image_url = p.image_url || null;
        if (f.file.files[0]) image_url = await uploadImage(f.file.files[0], "products");
        const row = { name: f.pname.value.trim(), price: Number(f.price.value), sort: Number(f.sort.value) || 0,
          description: f.description.value.trim(), active: f.active.checked, image_url, fields, min_qty: minq, max_qty: maxq };
        const { error } = p.id ? await sb.from("products").update(row).eq("id", p.id) : await sb.from("products").insert(row);
        if (error) throw error;
        closeModal(); toast("Product saved.", "success"); route();
      });
    };
  });
}

/* ---------------- NEW FEATURES ---------------- */
async function features(v) {
  const { data, error } = await sb.from("features").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  v.innerHTML = `<div class="toolbar"><span class="muted grow">Shown in the customer "New" tab — what's coming next.</span>
    <button class="btn" id="add">${ICONS.plus} Add feature</button></div>
    ${table(["Photo", "Title", "Expected", "Posted", ""], data.map((f) => `<tr>
      <td>${f.image_url ? `<img class="thumb" src="${esc(f.image_url)}">` : `<div class="thumb"></div>`}</td>
      <td><b>${esc(f.title)}</b><div class="small muted" style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.description)}</div></td>
      <td>${esc(f.eta || "—")}</td><td class="small">${fmtDate(f.created_at)}</td>
      <td style="white-space:nowrap"><button class="btn sm soft" data-edit="${f.id}">Edit</button><button class="btn sm ghost" data-del="${f.id}">Delete</button></td>
    </tr>`), "Nothing announced yet")}`;
  $("#add").onclick = () => featureForm();
  $$("[data-edit]", v).forEach((b) => (b.onclick = () => featureForm(data.find((x) => x.id == b.dataset.edit))));
  $$("[data-del]", v).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox("Delete this post?", "Customers won't see it anymore.", "Delete", true))) return;
    const { error } = await sb.from("features").delete().eq("id", b.dataset.del);
    if (error) return toast(errMsg(error), "error");
    route();
  }));
}
function featureForm(f = {}) {
  openModal(`<h2>${f.id ? "Edit" : "Add"} upcoming feature</h2><form id="ff">
    <label>Photo (optional)</label><input type="file" name="file" accept="image/*">
    <label>Title</label><input name="ftitle" required maxlength="120" value="${esc(f.title || "")}">
    <label>Expected (optional)</label><input name="eta" maxlength="40" value="${esc(f.eta || "")}" placeholder="e.g. Coming in November">
    <label>Description</label><textarea name="description" maxlength="3000">${esc(f.description || "")}</textarea>
    <label class="row" style="color:var(--text)"><input type="checkbox" name="announce" style="width:auto"> Also notify all customers</label>
    <button class="btn block mt">Save</button></form>`, (m) => {
    const fm = $("#ff", m);
    fm.onsubmit = (e) => {
      e.preventDefault();
      busy($("button.btn", fm), async () => {
        let image_url = f.image_url || null;
        if (fm.file.files[0]) image_url = await uploadImage(fm.file.files[0], "features");
        const row = { title: fm.ftitle.value.trim(), eta: fm.eta.value.trim() || null, description: fm.description.value.trim(), image_url };
        const { error } = f.id ? await sb.from("features").update(row).eq("id", f.id) : await sb.from("features").insert(row);
        if (error) throw error;
        if (fm.announce.checked) await sb.rpc("admin_send_notification", { p_target: "customers", p_title: "Coming soon: " + row.title, p_body: row.eta || "Check the New tab for details." });
        closeModal(); toast("Saved.", "success"); route();
      });
    };
  });
}

/* ---------------- CUSTOMERS ---------------- */
async function customers(v) {
  if (hashArg()) return personView(v, hashArg(), "customers");
  let q = sb.from("profiles").select("*").eq("role", "customer").order("created_at", { ascending: false }).limit(300);
  const term = AD.userQ.trim().replace(/[%,()]/g, "");
  if (term) q = q.or(`member_id.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw error;
  v.innerHTML = `<form class="toolbar" id="us"><input name="q" placeholder="Search name, Member ID, email, phone" value="${esc(AD.userQ)}">
    <button class="btn">Search</button></form>
    ${table(["Customer", "Email / phone", "Country", "Balance", "KYC", "Joined", ""], data.map((u) => `<tr>
      <td>${who(u)}${u.blocked ? ` <span class="badge blocked">blocked</span>` : ""}</td>
      <td class="small">${esc(u.email)}<div class="muted">${esc(u.phone || "")}</div></td><td>${esc(u.country || "")}</td>
      <td><b>${money(u.balance)}</b></td><td><span class="badge ${u.kyc_status}">${u.kyc_status}</span></td>
      <td class="small">${fmtDate(u.created_at)}</td>
      <td style="white-space:nowrap"><button class="btn sm deposit" data-dep="${u.id}">Deposit</button>
        <button class="btn sm withdraw" data-wd="${u.id}">Withdraw</button>
        <a class="btn sm soft" href="#customers/${u.id}">Open</a></td></tr>`), "No customers found")}`;
  $("#us").onsubmit = (e) => { e.preventDefault(); AD.userQ = e.target.q.value; route(); };
  $$("[data-dep]", v).forEach((b) => (b.onclick = () => moneyModal(data.find((u) => u.id === b.dataset.dep), "deposit")));
  $$("[data-wd]", v).forEach((b) => (b.onclick = () => moneyModal(data.find((u) => u.id === b.dataset.wd), "withdraw")));
}

/* ---------------- AGENTS & ADMINS ---------------- */
async function agents(v) {
  if (hashArg()) return personView(v, hashArg(), "agents");
  let q = sb.from("profiles").select("*").in("role", ["agent", "admin"]).order("role").order("created_at", { ascending: false });
  const term = AD.staffQ.trim().replace(/[%,()]/g, "");
  if (term) q = q.or(`member_id.ilike.%${term}%,full_name.ilike.%${term}%,city.ilike.%${term}%,phone.ilike.%${term}%`);
  const { data, error } = await q;
  if (error) throw error;
  v.innerHTML = `<form class="toolbar" id="ss"><input name="q" placeholder="Search ID, name, city, phone" value="${esc(AD.staffQ)}">
    <button class="btn soft">Search</button><button type="button" class="btn" id="addStaff">${ICONS.plus} Add agent / admin</button></form>
    <p class="small muted">Only you can create agent and admin IDs. They log in with their ID and password (agents at <b>agent.html</b>, admins at <b>admin.html</b>).</p>
    ${table(["ID / name", "Role", "Location", "Phone", "Balance", "Status", ""], data.map((u) => `<tr>
      <td>${who(u)}</td><td><span class="badge ${u.role}">${u.role}</span></td>
      <td class="small">${esc([u.street, u.city, u.country].filter(Boolean).join(", ") || "—")}</td><td>${esc(u.phone || "—")}</td>
      <td><b>${money(u.balance)}</b></td><td><span class="badge ${u.blocked ? "blocked" : "active"}">${u.blocked ? "blocked" : "active"}</span></td>
      <td style="white-space:nowrap"><button class="btn sm deposit" data-dep="${u.id}">Deposit</button>
        <button class="btn sm withdraw" data-wd="${u.id}">Withdraw</button>
        <a class="btn sm soft" href="#agents/${u.id}">History</a></td></tr>`), "No agents yet — add one")}`;
  $("#ss").onsubmit = (e) => { e.preventDefault(); AD.staffQ = e.target.q.value; route(); };
  $("#addStaff").onclick = () => staffForm();
  $$("[data-dep]", v).forEach((b) => (b.onclick = () => moneyModal(data.find((u) => u.id === b.dataset.dep), "deposit")));
  $$("[data-wd]", v).forEach((b) => (b.onclick = () => moneyModal(data.find((u) => u.id === b.dataset.wd), "withdraw")));
}
function staffForm(u) {
  const edit = !!u;
  openModal(`<h2>${edit ? "Edit " + esc(u.member_id) : "Add agent / admin"}</h2><form id="sf">
    ${edit ? "" : `<label>Role</label><select name="srole"><option value="agent">Agent</option><option value="admin">Admin</option></select>`}
    <label>Full name</label><input name="full_name" required maxlength="80" value="${esc(u?.full_name || "")}">
    <label>Phone</label><input name="phone" maxlength="20" value="${esc(u?.phone || "")}">
    <div class="grid-2"><div><label>Country</label><select name="country">${countryOptions(u?.country || "Nepal")}</select></div>
    <div><label>City</label><input name="city" maxlength="60" value="${esc(u?.city || "")}"></div></div>
    <label>Street / area</label><input name="street" maxlength="120" value="${esc(u?.street || "")}">
    ${edit ? "" : `<label>Password (give this to them)</label><input name="password" required minlength="6" value="${Math.random().toString(36).slice(2, 10)}">`}
    <button class="btn block mt">${edit ? "Save" : "Create account"}</button></form>`, (m) => {
    $("#sf", m).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      busy($("button", f), async () => {
        if (edit) {
          const { error } = await sb.rpc("admin_update_staff", { p_user: u.id, p_full_name: f.full_name.value, p_phone: f.phone.value,
            p_country: f.country.value, p_city: f.city.value, p_street: f.street.value });
          if (error) throw error;
          closeModal(); toast("Saved.", "success"); route(); return;
        }
        const { data, error } = await sb.rpc("admin_create_staff", { p_role: f.srole.value, p_full_name: f.full_name.value, p_password: f.password.value,
          p_phone: f.phone.value, p_country: f.country.value, p_city: f.city.value, p_street: f.street.value });
        if (error) throw error;
        const page = f.srole.value === "agent" ? "agent.html" : "admin.html";
        openModal(`<div class="empty"><div class="big">✅</div><h2>${f.srole.value === "agent" ? "Agent" : "Admin"} created</h2>
          <div class="code-box mt"><div class="small muted">Login ID</div><div class="code mono">${esc(data)}</div>
          <div class="small muted mt">Password</div><div class="mono" style="font-size:1.3rem;font-weight:800">${esc(f.password.value)}</div></div>
          <p class="small muted mt">Send these to ${esc(f.full_name.value)}. They log in at <b>${page}</b>.</p>
          <button class="btn block mt" onclick="copyText('ID: ${esc(data)}  Password: ${esc(f.password.value)}')">${ICONS.copy} Copy ID &amp; password</button>
          <button class="btn ghost block mt" data-close>Done</button></div>`);
        route();
      });
    };
  });
}

/* ---------- one person: details + money + full history ---------- */
async function personView(v, id, back) {
  const [{ data: u, error }, { data: tx }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", id).single(),
    sb.from("transactions").select("*, profiles(full_name, member_id)").or(`user_id.eq.${id},actor_id.eq.${id}`).order("created_at", { ascending: false }).limit(500),
  ]);
  if (error) throw error;
  const staff = u.role !== "customer";
  const own = (tx || []).filter((t) => t.user_id === id);
  const sum = (type) => own.filter((t) => t.type === type).reduce((a, t) => a + Number(t.amount), 0);
  const stats = staff
    ? [["Customers loaded", money(-sum("agent_load"))], ["Withdrawals paid", money(sum("agent_payout"))], ["Admin deposits/withdrawals", money(sum("adjust"))]]
    : [["Deposits", money(sum("load") + Math.max(0, sum("adjust")))], ["Purchases", money(-sum("purchase"))], ["Withdrawals", money(-sum("withdraw"))]];
  v.innerHTML = `<a class="back-link" href="#${back}">← Back</a>
  <div class="card">
    <div class="row wrap between"><div><h2 style="margin:0">${esc(u.full_name)} <span class="badge ${u.role}">${u.role}</span>
      ${u.blocked ? `<span class="badge blocked">blocked</span>` : ""}</h2><div class="mono muted">${esc(u.member_id)}</div></div>
      <div style="text-align:right"><div class="small muted">Balance</div><div style="font-size:1.6rem;font-weight:800">${money(u.balance)}</div></div></div>
    <div class="info-grid mt">
      ${[["Phone", u.phone], ["Email", staff ? "—" : u.email], ["Country", u.country], ["City", u.city], ["Street", u.street], ["KYC", u.kyc_status], ["Joined", fmtDate(u.created_at)]]
        .filter(([, val]) => val).map(([k, val]) => `<div><div class="k">${k}</div><div class="v">${esc(val)}</div></div>`).join("")}
    </div>
    <div class="money-actions mt"><button class="btn deposit" id="dep">Deposit</button><button class="btn withdraw" id="wd">Withdraw</button></div>
    <div class="row wrap mt">
      ${staff ? `<button class="btn sm soft" id="edit">Edit details</button><button class="btn sm soft" id="pw">Reset password</button>
        <button class="btn sm soft" id="role">Make ${u.role === "agent" ? "admin" : "agent"}</button>` : ""}
      ${u.id !== AD.me.id ? `<button class="btn sm ${u.blocked ? "success" : "danger"}" id="blk">${u.blocked ? "Unblock" : "Block"}</button>` : ""}
    </div>
  </div>
  <div class="stats mt">${stats.map(([k, val]) => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:1.2rem">${val}</div></div>`).join("")}</div>
  <h2 class="mt">History</h2>
  ${table(["Date", "Type", "Amount", "Balance after", "Details"], (tx || []).map((t) => {
    const mine = t.user_id === id;
    return `<tr><td class="small">${fmtDate(t.created_at)}</td>
      <td><span class="badge">${esc(mine ? TX_LABEL[t.type] || t.type : "Loaded " + (t.profiles?.member_id || "customer"))}</span></td>
      <td>${amt(Number(t.amount))}</td><td>${mine ? money(t.balance_after) : `<span class="muted small">customer's</span>`}</td>
      <td class="small">${esc(t.description || "")}</td></tr>`;
  }), "No history yet")}`;
  const reload = () => personView(v, id, back);
  $("#dep").onclick = () => moneyModal(u, "deposit", reload);
  $("#wd").onclick = () => moneyModal(u, "withdraw", reload);
  if ($("#edit")) $("#edit").onclick = () => staffForm(u);
  if ($("#pw")) $("#pw").onclick = () => openModal(`<h2>New password for ${esc(u.member_id)}</h2><form id="pf">
      <label>New password</label><input name="p" minlength="6" required value="${Math.random().toString(36).slice(2, 10)}">
      <button class="btn block mt">Set password</button></form>`, (m) => {
    $("#pf", m).onsubmit = (e) => {
      e.preventDefault();
      busy($("button", e.target), async () => {
        const { error } = await sb.rpc("admin_set_staff_password", { p_user: u.id, p_password: e.target.p.value });
        if (error) throw error;
        closeModal(); toast(`Password changed. New password: ${e.target.p.value}`, "success");
      });
    };
  });
  if ($("#role")) $("#role").onclick = async () => {
    const to = u.role === "agent" ? "admin" : "agent";
    if (!(await confirmBox("Change role", `Make ${esc(u.full_name)} an <b>${to}</b>?`, "Change"))) return;
    const { error } = await sb.rpc("admin_set_role", { p_user: u.id, p_role: to });
    if (error) return toast(errMsg(error), "error");
    toast("Role changed.", "success"); reload();
  };
  if ($("#blk")) $("#blk").onclick = async () => {
    if (!(await confirmBox(u.blocked ? "Unblock?" : "Block account?", u.blocked ? "They can use the app again." : "They won't be able to use the app.", u.blocked ? "Unblock" : "Block", !u.blocked))) return;
    const { error } = await sb.rpc("admin_set_blocked", { p_user: u.id, p_blocked: !u.blocked });
    if (error) return toast(errMsg(error), "error");
    reload();
  };
}

/* ---------------- KYC ---------------- */
async function kyc(v) {
  let q = sb.from("kyc").select("*, profiles(full_name, member_id, email, phone, country)").order("submitted_at", { ascending: false }).limit(300);
  if (AD.kycFilter !== "all") q = q.eq("status", AD.kycFilter);
  const { data, error } = await q;
  if (error) throw error;
  v.innerHTML = chips([["pending", "Pending"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]], AD.kycFilter, "kf") +
    table(["Member", "Name on document", "Document", "Region / City", "Submitted", "Status", ""], data.map((k) => `<tr>
      <td>${who(k.profiles)}<div class="small muted">${esc(k.profiles?.phone || "")}</div></td><td><b>${esc(k.full_name)}</b></td>
      <td>${esc(k.doc_type)}<div class="mono small">${esc(k.doc_number)}</div></td><td>${esc(k.region)}, ${esc(k.city)}</td>
      <td class="small">${fmtDate(k.submitted_at)}</td>
      <td><span class="badge ${k.status}">${k.status}</span>${k.note ? `<div class="small muted">${esc(k.note)}</div>` : ""}</td>
      <td style="white-space:nowrap">${k.status === "pending" ? `<button class="btn sm success" data-ok="${k.user_id}">Approve</button><button class="btn sm ghost" data-no="${k.user_id}">Reject</button>` : ""}</td>
    </tr>`), "No KYC submissions");
  $$("[data-kf]", v).forEach((c) => (c.onclick = () => { AD.kycFilter = c.dataset.kf; route(); }));
  $$("[data-ok]", v).forEach((b) => (b.onclick = async () => {
    const { error } = await sb.rpc("admin_review_kyc", { p_user: b.dataset.ok, p_approve: true, p_note: null });
    if (error) return toast(errMsg(error), "error");
    toast("KYC approved.", "success"); refreshCounts(); route();
  }));
  $$("[data-no]", v).forEach((b) => (b.onclick = () => openModal(`<h2>Reject KYC</h2><form id="rf">
    <label>Reason (shown to customer)</label><input name="note" required maxlength="200" placeholder="e.g. Document number doesn't match">
    <button class="btn danger block mt">Reject</button></form>`, (m) => {
    $("#rf", m).onsubmit = (e) => {
      e.preventDefault();
      busy($("button", e.target), async () => {
        const { error } = await sb.rpc("admin_review_kyc", { p_user: b.dataset.no, p_approve: false, p_note: e.target.note.value.trim() });
        if (error) throw error;
        closeModal(); toast("KYC rejected.", "success"); refreshCounts(); route();
      });
    };
  })));
}

/* ---------------- WITHDRAWAL CODES ---------------- */
async function withdrawals(v) {
  let q = sb.from("withdrawals").select("*, customer:profiles!withdrawals_user_id_fkey(full_name, member_id), agent:profiles!withdrawals_agent_id_fkey(full_name, member_id)")
    .order("created_at", { ascending: false }).limit(300);
  if (AD.wdFilter !== "all") q = q.eq("status", AD.wdFilter);
  const { data, error } = await q;
  if (error) throw error;
  v.innerHTML = `<p class="muted small">Customers' withdrawal codes are paid out by agents. Unused codes refund automatically when they expire.</p>` +
    chips([["pending", "Active"], ["completed", "Completed"], ["expired", "Expired"], ["cancelled", "Cancelled"], ["all", "All"]], AD.wdFilter, "wf") +
    table(["Code", "Customer", "Amount", "Location", "Created", "Expires / done", "Paid by agent", "Status"], data.map((w) => `<tr>
      <td class="mono"><b>${esc(w.code)}</b></td><td>${who(w.customer)}</td><td><b>${money(w.amount)}</b></td>
      <td class="small">${esc(w.city)}, ${esc(w.street)}</td><td class="small">${fmtDate(w.created_at)}</td>
      <td class="small">${w.status === "pending" ? timeLeft(w.expires_at) : w.completed_at ? fmtDate(w.completed_at) : fmtDate(w.expires_at)}</td>
      <td>${w.agent ? who(w.agent) : "—"}</td><td><span class="badge ${w.status}">${w.status}</span></td></tr>`), "No withdrawal codes");
  $$("[data-wf]", v).forEach((c) => (c.onclick = () => { AD.wdFilter = c.dataset.wf; route(); }));
}

/* ---------------- TRANSACTIONS ---------------- */
async function transactions(v) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  let q = sb.from("transactions").select("*, profiles(id, full_name, member_id, role)").gte("created_at", since).order("created_at", { ascending: false }).limit(500);
  if (AD.txType !== "all") q = q.eq("type", AD.txType);
  const { data, error } = await q;
  if (error) throw error;
  const types = [["all", "All"], ["load", "Agent deposits"], ["adjust", "Admin deposit/withdraw"], ["purchase", "Purchases"], ["withdraw", "Withdrawals"], ["refund", "Refunds"], ["agent_load", "Agent loads"], ["agent_payout", "Agent payouts"]];
  v.innerHTML = `<p class="muted small">Last 30 days, newest first. Click a name to see that person's full history.</p>` + chips(types, AD.txType, "tt") +
    table(["Date", "User", "Type", "Amount", "Balance after", "Details"], data.map((t) => `<tr>
      <td class="small">${fmtDate(t.created_at)}</td>
      <td><a href="#${t.profiles?.role === "customer" ? "customers" : "agents"}/${t.user_id}">${who(t.profiles)}</a></td>
      <td><span class="badge">${esc(TX_LABEL[t.type] || t.type)}</span></td>
      <td>${amt(Number(t.amount))}</td><td>${money(t.balance_after)}</td><td class="small">${esc(t.description || "")}</td></tr>`), "No transactions");
  $$("[data-tt]", v).forEach((c) => (c.onclick = () => { AD.txType = c.dataset.tt; route(); }));
}

/* ---------------- NOTIFICATIONS ---------------- */
async function notify(v) {
  v.innerHTML = `<div class="card" style="max-width:620px"><h2>Send a push notification</h2>
    <p class="muted small">Appears in the app's bell, and as a push alert for everyone who turned notifications on.</p>
    <form id="nf">
      <label>Send to</label><select name="send_to"><option value="customers">All customers</option><option value="agents">All agents</option>
        <option value="all">Everyone</option><option value="one">One person (ID)</option></select>
      <div id="oneBox" class="hidden"><label>Member / Agent ID</label><input name="member" placeholder="PV100001 or AG1002"></div>
      <label>Title</label><input name="ntitle" required maxlength="80">
      <label>Message</label><textarea name="body" maxlength="300"></textarea>
      <button class="btn block mt">${ICONS.send} Send</button></form></div>`;
  const f = $("#nf");
  f.send_to.onchange = () => $("#oneBox").classList.toggle("hidden", f.send_to.value !== "one");
  f.onsubmit = (e) => {
    e.preventDefault();
    const target = f.send_to.value === "one" ? f.member.value.trim() : f.send_to.value;
    if (!target) return toast("Enter an ID.", "error");
    busy($("button", f), async () => {
      const { data, error } = await sb.rpc("admin_send_notification", { p_target: target, p_title: f.ntitle.value, p_body: f.body.value });
      if (error) throw error;
      toast(`Sent to ${data} ${data === 1 ? "person" : "people"}.`, "success");
      f.reset(); $("#oneBox").classList.add("hidden");
    });
  };
}

/* ---------------- SETTINGS ---------------- */
async function settings(v) {
  const { data } = await sb.from("app_settings").select("*");
  const s = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  v.innerHTML = `<div class="card" style="max-width:620px"><h2>App settings</h2><form id="sf">
    <label>Telegram username customers message to deposit</label><input name="telegram_username" required value="${esc(s.telegram_username || "@premvio")}">
    <div class="grid-2"><div><label>Minimum withdrawal (${CFG.CURRENCY})</label><input type="number" name="min_withdraw" min="0" value="${esc(s.min_withdraw || 100)}"></div>
    <div><label>Maximum withdrawal (${CFG.CURRENCY})</label><input type="number" name="max_withdraw" min="0" value="${esc(s.max_withdraw || 100000)}"></div></div>
    <label>Withdrawal code valid for (hours)</label><input type="number" name="withdraw_hours" min="1" max="168" value="${esc(s.withdraw_hours || 24)}">
    <button class="btn block mt">Save settings</button></form></div>
    <div class="card" style="max-width:620px"><h3>Your account</h3>
      <p class="small">You are <b>${esc(AD.me.member_id)}</b> (${esc(AD.me.full_name)}). Another admin can reset your password from Agents &amp; admins.</p></div>`;
  $("#sf").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    let tg = f.telegram_username.value.trim();
    if (!tg.startsWith("@")) tg = "@" + tg;
    const rows = [["telegram_username", tg], ["min_withdraw", f.min_withdraw.value], ["max_withdraw", f.max_withdraw.value], ["withdraw_hours", f.withdraw_hours.value]]
      .map(([key, value]) => ({ key, value: String(value) }));
    busy($("button", f), async () => {
      const { error } = await sb.from("app_settings").upsert(rows);
      if (error) throw error;
      toast("Settings saved.", "success");
    });
  };
}
