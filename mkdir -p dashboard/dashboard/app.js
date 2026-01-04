const runsListEl = document.getElementById("runsList");
const filesListEl = document.getElementById("filesList");
const runSummaryEl = document.getElementById("runSummary");
const invoiceDetailEl = document.getElementById("invoiceDetail");
const rawJsonEl = document.getElementById("rawJson");
const textPreviewEl = document.getElementById("textPreview");
const itemsPreviewEl = document.getElementById("itemsPreview");
const statusLineEl = document.getElementById("statusLine");
const refreshBtn = document.getElementById("refreshBtn");

let state = {
  runs: [],
  activeRunId: null,
  activeFile: null
};

function setStatus(text) {
  statusLineEl.textContent = text;
}

async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function badgeForStatus(status) {
  const st = String(status || "").toLowerCase();
  if (st.includes("pass")) return `<span class="badge good">${escapeHtml(status)}</span>`;
  if (st.includes("warn")) return `<span class="badge warn">${escapeHtml(status)}</span>`;
  if (st.includes("fail")) return `<span class="badge bad">${escapeHtml(status)}</span>`;
  return `<span class="badge">${escapeHtml(status || "unknown")}</span>`;
}

function pick(obj, paths, fallback = null) {
  for (const p of paths) {
    const parts = p.split(".");
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !(part in cur)) { ok = false; break; }
      cur = cur[part];
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return fallback;
}

function renderRuns() {
  runsListEl.innerHTML = "";
  if (!state.runs.length) {
    runsListEl.innerHTML = `<div class="muted">No runs found. Run batchCapturePdf to generate one.</div>`;
    return;
  }

  for (const run of state.runs) {
    const el = document.createElement("div");
    el.className = "runItem" + (run.runId === state.activeRunId ? " active" : "");
    el.onclick = () => selectRun(run.runId);

    const counts = run.summaryCounts || {};
    const pass = counts["pass-items"] || 0;
    const fail = (counts["fail"] || 0) + (counts["fail-no-items"] || 0) + (counts["fail-error"] || 0);
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);

    el.innerHTML = `
      <div class="row">
        <div><strong>${escapeHtml(run.runId)}</strong></div>
        <div class="small">${escapeHtml(run.createdAt || "")}</div>
      </div>
      <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
        <span class="badge good">pass: ${pass}</span>
        <span class="badge ${fail ? "bad" : ""}">fail: ${fail}</span>
        <span class="badge">total: ${total}</span>
      </div>
    `;

    runsListEl.appendChild(el);
  }
}

function renderRunSummary(runDetail) {
  const summary = runDetail.summary || null;
  const files = runDetail.files || [];

  const counts = (summary && summary.counts) || {};
  const lines = [
    `<div><strong>Run:</strong> ${escapeHtml(runDetail.runId)}</div>`,
    `<div><strong>Files:</strong> ${files.length}</div>`,
    `<div style="margin-top:8px;"><strong>Counts:</strong></div>`,
    `<pre class="pre">${escapeHtml(JSON.stringify(counts, null, 2))}</pre>`
  ];

  runSummaryEl.innerHTML = lines.join("");
}

function renderFiles(files) {
  if (!files.length) {
    filesListEl.innerHTML = `<div class="muted">No result JSON files found in this run.</div>`;
    return;
  }

  filesListEl.innerHTML = files.map((f) => {
    const isActive = state.activeFile === f.fileName;
    return `
      <div class="runItem ${isActive ? "active" : ""}" style="margin-bottom:8px;" onclick="window.__selectFile('${escapeHtml(f.fileName)}')">
        <div class="row">
          <div><strong>${escapeHtml(f.fileName)}</strong></div>
          <div>${badgeForStatus(f.status || "unknown")}</div>
        </div>
        <div class="small" style="margin-top:6px;">
          parser: <strong>${escapeHtml(f.parserUsed || "unknown")}</strong> •
          items: <strong>${escapeHtml(f.parsedItemsCount ?? "")}</strong> •
          OCR: <strong>${escapeHtml(String(!!f.usedOcr))}</strong> •
          textLen: <strong>${escapeHtml(f.textLength ?? "")}</strong>
        </div>
      </div>
    `;
  }).join("");
}

// Expose selector to inline onclick (keeps file tiny, no frameworks)
window.__selectFile = async (fileName) => {
  if (!state.activeRunId) return;
  state.activeFile = fileName;
  setStatus(`Loading ${state.activeRunId}/${fileName}…`);
  await loadFile(state.activeRunId, fileName);
  // Refresh files list highlighting
  const runDetail = await apiGet(`/api/runs/${encodeURIComponent(state.activeRunId)}`);
  renderFiles(runDetail.files || []);
  setStatus(`Loaded ${state.activeRunId}/${fileName}`);
};

function renderInvoiceDetail(obj) {
  // Try to read common fields from your saved response
  const ok = pick(obj, ["ok"], false);
  const message = pick(obj, ["message"], "");
  const parserUsed = pick(obj, ["extracted.parserUsed", "parserUsed"], "unknown");
  const usedOcr = pick(obj, ["extracted.usedOcr", "usedOcr"], false);
  const textLength = pick(obj, ["extracted.textLength", "textLength"], null);
  const parsedItemsCount = pick(obj, ["extracted.parsedItemsCount", "parsedItemsCount"], null);

  const acctName = pick(obj, ["account.accountName", "legacy.account.accountName", "canonical.parties.customer.name"], "");
  const invNo = pick(obj, ["canonical.doc.invoice_number", "doc.invoice_number"], null);

  invoiceDetailEl.innerHTML = `
    <div><strong>ok:</strong> ${escapeHtml(String(ok))}</div>
    <div><strong>message:</strong> ${escapeHtml(message)}</div>
    <div style="margin-top:8px;">
      <span class="badge">parser: ${escapeHtml(parserUsed)}</span>
      <span class="badge">OCR: ${escapeHtml(String(!!usedOcr))}</span>
      <span class="badge">textLen: ${escapeHtml(textLength ?? "")}</span>
      <span class="badge">items: ${escapeHtml(parsedItemsCount ?? "")}</span>
    </div>
    <div style="margin-top:10px;">
      <div><strong>account:</strong> ${escapeHtml(acctName || "(unknown)")}</div>
      <div><strong>invoice #:</strong> ${escapeHtml(invNo || "(unknown)")}</div>
    </div>
  `;

  // Text preview
  const preview = pick(obj, ["extracted.textPreview"], "") || "";
  textPreviewEl.textContent = preview ? preview : "(no textPreview found in JSON)";

  // Items preview (requires backend to include itemsPreview; if absent, show guidance)
  const items = pick(obj, ["extracted.itemsPreview", "extracted.parsedItemsPreview"], null);
  if (Array.isArray(items) && items.length) {
    const rows = items.slice(0, 50).map((it) => `
      <tr>
        <td>${escapeHtml(it.sku || "")}</td>
        <td>${escapeHtml(it.description || it.raw_description || "")}</td>
        <td>${escapeHtml(it.quantity ?? "")}</td>
        <td>${escapeHtml(it.unitPrice ?? it.unit_price?.amount ?? "")}</td>
      </tr>
    `).join("");

    itemsPreviewEl.innerHTML = `
      <table class="table">
        <thead><tr><th>SKU</th><th>Description</th><th>Qty</th><th>Unit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="small" style="margin-top:8px;">Showing first ${Math.min(items.length, 50)} items.</div>
    `;
  } else {
    itemsPreviewEl.innerHTML = `
      <div class="muted">
        No items preview found in this JSON.
        <div style="margin-top:6px;" class="small">
          If you want item-level visibility in Dashboard A, we will add a small debug field in /capture-pdf:
          extracted.itemsPreview = parsedItems.slice(0, 50)
        </div>
      </div>
    `;
  }

  rawJsonEl.textContent = JSON.stringify(obj, null, 2);
}

async function selectRun(runId) {
  state.activeRunId = runId;
  state.activeFile = null;
  setStatus(`Loading run ${runId}…`);

  renderRuns();
  filesListEl.innerHTML = `<div class="muted">Loading…</div>`;
  runSummaryEl.innerHTML = `<div class="muted">Loading…</div>`;
  invoiceDetailEl.innerHTML = `<div class="muted">Select a file</div>`;
  rawJsonEl.textContent = "Select a file";
  textPreviewEl.textContent = "Select a file";
  itemsPreviewEl.innerHTML = `<div class="muted">Select a file</div>`;

  const runDetail = await apiGet(`/api/runs/${encodeURIComponent(runId)}`);
  renderRunSummary(runDetail);
  renderFiles(runDetail.files || []);
  setStatus(`Loaded run ${runId}`);
}

async function loadFile(runId, fileName) {
  const obj = await apiGet(`/api/runs/${encodeURIComponent(runId)}/file/${encodeURIComponent(fileName)}`);
  renderInvoiceDetail(obj);
}

async function loadRuns() {
  setStatus("Loading runs…");
  const data = await apiGet("/api/runs");
  state.runs = data.runs || [];
  // Default to newest run
  if (!state.activeRunId && state.runs.length) {
    state.activeRunId = state.runs[0].runId;
  }
  renderRuns();
  if (state.activeRunId) {
    await selectRun(state.activeRunId);
  } else {
    setStatus("No runs found.");
  }
}

refreshBtn.addEventListener("click", async () => {
  await loadRuns();
});

loadRuns().catch((e) => {
  setStatus("Error loading dashboard: " + e.message);
  console.error(e);
});
