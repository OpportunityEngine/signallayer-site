// chrome-extension/telemetry.js
// Reliable telemetry sender for popup + background

const QS_BACKEND = "http://127.0.0.1:5050"; // use 127.0.0.1 to avoid localhost/IPv6 quirks

async function qsGetOrCreate(key, makeFn) {
  try {
    const obj = await chrome.storage.local.get([key]);
    if (obj && obj[key]) return obj[key];
    const v = makeFn();
    await chrome.storage.local.set({ [key]: v });
    return v;
  } catch (_) {
    return makeFn();
  }
}

async function qsSendTelemetry(action, meta = {}) {
  const session_id = await qsGetOrCreate(
    "qs_session_id",
    () => `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`
  );
  const user_id = await qsGetOrCreate("qs_user_id", () => "rep-unknown");

  const payload = {
    ts: new Date().toISOString(),
    source: "chrome_extension",
    action: String(action || "unknown"),
    user_id,
    session_id,
    meta: meta && typeof meta === "object" ? meta : {}
  };

  const res = await fetch(`${QS_BACKEND}/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Telemetry POST failed: HTTP ${res.status}. ${txt.slice(0, 300)}`);
  }

  return true;
}

// Expose to popup.js
self.qsSendTelemetry = qsSendTelemetry;
self.qsBackendBase = QS_BACKEND;
