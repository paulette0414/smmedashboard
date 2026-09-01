// Thin forwarder — the frontend (index.html) POSTs { fn, args } here, and
// this function just relays that exact body to the Apps Script Web App URL
// and hands back whatever Apps Script returned ({ result: ... } or
// { error: ... }). No business logic lives here; all of it (Sheets, Drive,
// MailApp, the new login/role system) lives in code.gs on the Apps Script
// side. See SETUP-GUIDE.md for how GAS_WEB_APP_URL is obtained and set.

function jsonResponse(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed — this endpoint only accepts POST." });
  }

  const GAS_URL = process.env.GAS_WEB_APP_URL;
  if (!GAS_URL) {
    return jsonResponse(200, { error: "Server misconfigured: GAS_WEB_APP_URL environment variable is not set. See SETUP-GUIDE.md." });
  }

  try {
    // Validate it's at least JSON before bothering Apps Script with it.
    JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(200, { error: "Invalid JSON in request body." });
  }

  try {
    const gasRes = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: event.body,
      redirect: "follow"
    });
    const text = await gasRes.text();
    // Apps Script already returns JSON shaped as { result } or { error } —
    // pass it straight through unchanged.
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: text
    };
  } catch (err) {
    return jsonResponse(200, { error: "Could not reach Apps Script backend: " + (err && err.message ? err.message : String(err)) });
  }
};
