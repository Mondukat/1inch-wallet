/**
 * 1inch OAuth2 Proxy Server
 * Handles authorization_code + refresh_token flow.
 * Keeps CLIENT_SECRET off the frontend.
 *
 * Setup:
 *   npm install
 *   node 1inch-proxy.js
 */

require("dotenv").config();
const express = require("express");
const cors    = require("cors");

const app = express();
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());

const CLIENT_ID     = process.env.ONEINCH_CLIENT_ID     || "7a919fec-2384-4227-b809-ff087bb8bd8c";
const CLIENT_SECRET = process.env.ONEINCH_CLIENT_SECRET;
const REDIRECT_URI  = process.env.ONEINCH_REDIRECT_URI  || "http://localhost:3000/callback";
const TOKEN_URL     = "https://oauth.1inch.io/oauth/v2/token";
const AUTH_URL      = "https://oauth.1inch.io/oauth/v2/auth";

// In-memory token store (use Redis/DB in production)
const tokenStore = {};

// ── 1. Build the authorization URL ──────────────────────────────────────────
app.get("/auth/1inch/authorize", (req, res) => {
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    scope:         "swap portfolio",
    state,
  });
  res.json({ url: `${AUTH_URL}?${params}`, state });
});

// ── 2. Exchange authorization code for tokens ────────────────────────────────
app.post("/auth/1inch/token", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Missing code" });

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  REDIRECT_URI,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const tokens = await response.json();
    const sessionId = Math.random().toString(36).slice(2);
    tokenStore[sessionId] = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    Date.now() + (tokens.expires_in - 60) * 1000,
    };

    res.json({ sessionId, expires_in: tokens.expires_in });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3. Refresh tokens ────────────────────────────────────────────────────────
app.post("/auth/1inch/refresh", async (req, res) => {
  const { sessionId } = req.body;
  const session = tokenStore[sessionId];
  if (!session) return res.status(401).json({ error: "Invalid session" });

  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: session.refresh_token,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });

    const tokens = await response.json();
    tokenStore[sessionId] = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token || session.refresh_token,
      expires_at:    Date.now() + (tokens.expires_in - 60) * 1000,
    };

    res.json({ ok: true, expires_in: tokens.expires_in });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. Proxy 1inch API calls ─────────────────────────────────────────────────
async function getValidToken(sessionId) {
  const session = tokenStore[sessionId];
  if (!session) throw new Error("Not authenticated");

  if (Date.now() >= session.expires_at) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: session.refresh_token,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }).toString(),
    });
    const tokens = await response.json();
    session.access_token = tokens.access_token;
    session.expires_at   = Date.now() + (tokens.expires_in - 60) * 1000;
    if (tokens.refresh_token) session.refresh_token = tokens.refresh_token;
  }

  return session.access_token;
}

app.get("/api/1inch", async (req, res) => {
  const { sessionId, path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path" });

  try {
    const token = await getValidToken(sessionId);
    const qs    = new URLSearchParams(params).toString();
    const url   = `https://api.1inch.dev${path}${qs ? "?" + qs : ""}`;

    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    res.status(err.message === "Not authenticated" ? 401 : 500).json({ error: err.message });
  }
});

app.post("/api/1inch", async (req, res) => {
  const { sessionId, path } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path" });

  try {
    const token    = await getValidToken(sessionId);
    const upstream = await fetch(`https://api.1inch.dev${path}`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept:         "application/json",
      },
      body: JSON.stringify(req.body),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`✅ 1inch OAuth proxy running → http://localhost:${PORT}`)
);
