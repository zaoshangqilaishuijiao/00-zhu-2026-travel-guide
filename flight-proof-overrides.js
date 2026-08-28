/* Guide-specific flight-proof presentation for 00 & Boss Zhu. This file intentionally does not alter the shared travel-guide template. */
(() => {
  const root = document.querySelector("[data-flight-records]");
  if (!root) return;

  const guideId = document.body?.dataset?.guideId || location.pathname || "guide";
  const storageKey = `travel-guide-flight-records:${guideId}`;
  const list = root.querySelector("[data-flight-list]");
  const manage = root.querySelector("[data-flight-manage]");
  const editor = root.querySelector("[data-flight-editor]");
  const form = root.querySelector("[data-flight-form]");
  const select = root.querySelector("[data-flight-edit-select]");
  const source = root.querySelector(".flight-source-row");
  const status = root.querySelector("[data-flight-status]");
  const viewer = root.querySelector("[data-flight-viewer]");
  const viewerImage = root.querySelector("[data-flight-view-image]");
  const escapeHtml = (value = "") => String(value).replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const readItems = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_error) { return []; }
  };
  const safeUrl = (value) => /^https:\/\//i.test(String(value || "")) ? String(value) : "";
  const updateEditorCopy = () => {
    root.querySelector(".flight-records-head p").textContent = "航班信息与购票链接可共同编辑同步；机票图片仅保存在当前浏览器。";
    const selectLabel = select?.closest("label");
    if (selectLabel) selectLabel.hidden = true;
    const fields = root.querySelector(".flight-core-grid");
    if (fields) fields.hidden = true;
    if (source) source.setAttribute("aria-label", "机票凭证来源");
    const submit = form?.querySelector('[type="submit"]');
    if (submit) submit.textContent = "保存凭证";
    if (!editor?.hidden) manage.textContent = "收起";
  };
  const render = () => {
    observer.disconnect();
    const items = readItems();
    const cards = items.map((item, index) => {
      const image = item.imageKey ? `<button type="button" class="flight-view" data-proof-image="${escapeHtml(item.id)}">查看图片</button>` : "";
      const link = safeUrl(item.detailUrl) ? `<a class="flight-view" href="${escapeHtml(safeUrl(item.detailUrl))}" target="_blank" rel="noopener noreferrer">打开购票链接</a>` : "";
      const actions = image || link ? `<div class="flight-proof-actions">${image}${link}</div>` : "";
      const flight = [item.airline, item.flightNumber].filter(Boolean).join(" · ");
      const route = [item.departureAirport, item.arrivalAirport].filter(Boolean).join(" → ");
      const schedule = [item.departureDate, item.departureTime && ` ${item.departureTime}`].filter(Boolean).join("");
      const summary = flight && !/^图片\s*\/\s*链接$/.test(flight) ? flight : `机票凭证 ${index + 1}`;
      const details = [schedule, route].filter(Boolean).join(" · ");
      return `<article class="flight-ticket-card flight-proof-card" data-flight-card><header><strong class="flight-number">${escapeHtml(summary)}</strong><button type="button" class="flight-proof-edit" data-proof-edit="${escapeHtml(item.id)}">编辑</button></header>${details ? `<p class="flight-proof-details">${escapeHtml(details)}</p>` : ""}<p>${item.imageKey ? "图片已保存在当前浏览器" : "未附机票图片"}${link ? " · 已附购票链接" : ""}</p>${actions}</article>`;
    }).join("");
    list.innerHTML = cards || '<p class="flight-empty">尚未录入机票凭证。</p>';
    manage.textContent = items.length ? "管理凭证" : "录入凭证";
    observer.observe(list, { childList: true });
  };
  const getImage = (key) => new Promise((resolve, reject) => {
    const request = indexedDB.open("travel-guide-flight-assets-v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("images", "readonly");
      const get = transaction.objectStore("images").get(key);
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result?.blob || null);
    };
  });
  let drawing = false;
  const observer = new MutationObserver(() => {
    if (drawing) return;
    drawing = true;
    queueMicrotask(() => {
      render();
      updateEditorCopy();
      const items = readItems();
      document.dispatchEvent(new CustomEvent("guide:flight-records-local-change", { detail: { items } }));
      document.dispatchEvent(new CustomEvent("guide:flight-records-save", { detail: { records: items } }));
      drawing = false;
    });
  });
  root.dataset.flightRecordMode = "proof";
  const style = document.createElement("style");
  style.textContent = `
    [data-flight-record-mode="proof"] .flight-edit-select,[data-flight-record-mode="proof"] .flight-core-grid{display:none!important}
    [data-flight-record-mode="proof"] .flight-records-editor{margin-top:12px}
    [data-flight-record-mode="proof"] .flight-source-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center}
    [data-flight-record-mode="proof"] .flight-link-field{grid-column:1/-1}
    .flight-proof-card{display:grid;gap:8px;padding:16px}.flight-proof-card header{display:flex;align-items:center;justify-content:space-between;gap:12px}.flight-proof-card p{margin:0;color:var(--guide-muted,#597583);font-size:.88rem}.flight-proof-card .flight-proof-details{color:var(--guide-text,#123b4b);font-weight:650}.flight-proof-actions{display:flex;flex-wrap:wrap;gap:8px}.flight-proof-actions .flight-view{width:auto;text-decoration:none}.flight-proof-edit{border:0;background:transparent;color:var(--guide-primary,#15556a);font:inherit;font-weight:700;cursor:pointer}
    @media (max-width:620px){[data-flight-record-mode="proof"] .flight-source-row{grid-template-columns:1fr}.flight-proof-card{padding:14px}}
  `;
  document.head.append(style);
  updateEditorCopy();
  render();

  manage.addEventListener("click", () => setTimeout(updateEditorCopy));
  form?.addEventListener("submit", (event) => {
    const file = root.querySelector("[data-flight-file]")?.files?.[0];
    const link = root.querySelector("[data-flight-link]")?.value.trim();
    if (!file && !link) {
      event.preventDefault();
      event.stopImmediatePropagation();
      status.textContent = "请至少添加机票图片或购票软件链接。";
      status.dataset.state = "error";
      return;
    }
    const date = document.body?.dataset?.tripStart || "2026-09-24";
    const values = { flightNumber: "机票凭证", airline: "图片 / 链接", departureDate: date, arrivalDate: date, departureTime: "00:00", arrivalTime: "00:00", departureAirport: "机票凭证", arrivalAirport: "购票链接" };
    Object.entries(values).forEach(([key, value]) => {
      const input = root.querySelector(`[data-flight-field="${key}"]`);
      if (input && !input.value) input.value = value;
    });
  }, true);
  document.addEventListener("guide:flight-records-refresh", () => {
    render();
    updateEditorCopy();
  });
  document.addEventListener("guide:flight-records-remote", (event) => {
    const records = Array.isArray(event.detail?.records) ? event.detail.records : [];
    const local = new Map(readItems().map((item) => [item.id, item]));
    const merged = records.map((record) => ({ ...local.get(record.id), ...record, imageKey: local.get(record.id)?.imageKey || "" }));
    localStorage.setItem(storageKey, JSON.stringify(merged));
    render();
    updateEditorCopy();
    status.textContent = "已收到其他设备保存的航班信息；机票图片仍仅在原设备。";
    status.dataset.state = "success";
  });
  document.addEventListener("guide:flight-records-sync-status", (event) => {
    status.textContent = event.detail?.message || "";
    status.dataset.state = event.detail?.state || "";
  });
  list.addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-proof-edit]");
    const image = event.target.closest("[data-proof-image]");
    if (edit) {
      if (select) {
        select.value = edit?.dataset.proofEdit || "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (editor.hidden) manage.click();
      setTimeout(updateEditorCopy);
      return;
    }
    if (!image) return;
    const item = readItems().find((entry) => entry.id === image.dataset.proofImage);
    if (!item?.imageKey) return;
    try {
      const blob = await getImage(item.imageKey);
      if (!blob) throw new Error("missing image");
      viewerImage.src = URL.createObjectURL(blob);
      if (typeof viewer.showModal === "function") viewer.showModal(); else viewer.setAttribute("open", "");
    } catch (_error) {
      status.textContent = "暂时无法读取机票图片。";
      status.dataset.state = "error";
    }
  });
})();
