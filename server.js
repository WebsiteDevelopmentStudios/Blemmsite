require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DEVELOPER_USR = process.env.DEVELOPER_USR;
const DEVELOPER_PASS = process.env.DEVELOPER_PASS;
const DEVELOPER_FILE = path.join(__dirname, "developer-data.json");
const DISCORD_INVITE_CODE = "8tsmAVtqZx";
const DISCORD_GUILD_ID = "1484873038926319739";
const MINECRAFT_REDEEM_CODES = (process.env.MINECRAFT_REDEEM_CODES || "")
  .split(",").map(code => code.trim()).filter(Boolean);
const STORE_FILE = path.join(__dirname, "store-data.json");

function loadStore() {
  const fallback = {
    prices: {
      mcfa: process.env.MCFA_PRICE || "<insert custom price>",
      minecraft: process.env.MINECRAFT_CODE_PRICE || "<insert custom price>"
    },
    codes: MINECRAFT_REDEEM_CODES,
    redeemed: []
  };
  try {
    if (!fs.existsSync(STORE_FILE)) {
      fs.writeFileSync(STORE_FILE, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const saved = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      prices: { ...fallback.prices, ...(saved.prices || {}) },
      codes: Array.isArray(saved.codes) ? saved.codes : fallback.codes,
      redeemed: Array.isArray(saved.redeemed) ? saved.redeemed : []
    };
  } catch (error) {
    console.error("Could not load store data:", error);
    return fallback;
  }
}

let store = loadStore();

function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const candidate = crypto.pbkdf2Sync(password, stored.salt, 120000, 64, "sha512").toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(stored.hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loadDevelopers() {
  try {
    if (fs.existsSync(DEVELOPER_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DEVELOPER_FILE, "utf8"));
      if (Array.isArray(saved.users)) return saved;
    }
  } catch (error) {
    console.error("Could not load developer users:", error);
  }
  return { users: [] };
}

let developers = loadDevelopers();

function saveDevelopers() {
  fs.writeFileSync(DEVELOPER_FILE, JSON.stringify(developers, null, 2));
}

function seedOwnerDeveloper() {
  if (!DEVELOPER_USR || !DEVELOPER_PASS) return;
  const existing = developers.users.find(user => user.username === DEVELOPER_USR);
  if (!existing) {
    const password = hashPassword(DEVELOPER_PASS);
    developers.users.push({
      username: DEVELOPER_USR,
      password,
      role: "owner",
      createdAt: new Date().toISOString()
    });
    saveDevelopers();
  } else if (existing.role !== "owner") {
    existing.role = "owner";
    saveDevelopers();
  }
}

seedOwnerDeveloper();

function getDeveloper(req) {
  const header = req.headers.cookie || "";
  const match = header.match(/(?:^|; )developer_session=([^;]+)/);
  if (!match || !COOKIE_SECRET) return null;
  try {
    const [username, signature] = decodeURIComponent(match[1]).split(".");
    if (!username || !signature || signature !== sign(username)) return null;
    return developers.users.find(user => user.username === username) || null;
  } catch {
    return null;
  }
}

function isDeveloper(req) {
  return Boolean(getDeveloper(req));
}

function requireDeveloperPage(req, res, next) {
  if (!isDeveloper(req)) return res.redirect("/#profile");
  next();
}

if (!CLIENT_ID || !CLIENT_SECRET || !COOKIE_SECRET) {
  console.warn("Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and COOKIE_SECRET before using Discord login.");
}

app.use(express.json());

app.get("/developer.html", requireDeveloperPage, (req, res) => {
  res.sendFile(path.join(__dirname, "developer.html"));
});

app.use(express.static(path.join(__dirname)));

function sign(value) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("base64url");
}

function setCookie(res, name, value, options = {}) {
  const parts = [name + "=" + encodeURIComponent(value)];
  if (options.maxAge !== undefined) parts.push("Max-Age=" + Math.floor(options.maxAge / 1000));
  if (options.path) parts.push("Path=" + options.path);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push("SameSite=" + options.sameSite);
  res.append("Set-Cookie", parts.join("; "));
}

function setSession(res, user) {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  const token = payload + "." + sign(payload);
  setCookie(res, "blemm_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/"
  });
}

function readSession(req) {
  const header = req.headers.cookie || "";
  const match = header.match(/(?:^|; )blemm_session=([^;]+)/);
  if (!match) return null;
  const [payload, signature] = decodeURIComponent(match[1]).split(".");
  if (!payload || !signature || !COOKIE_SECRET) return null;

  const expected = sign(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

app.get("/auth/discord", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send("Discord OAuth is not configured.");
  }

  const state = crypto.randomBytes(24).toString("hex");

  setCookie(res, "oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 10 * 60 * 1000,
    path: "/"
  });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "identify",
    state
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  const cookie = (req.headers.cookie || "").match(/(?:^|; )oauth_state=([^;]+)/)?.[1];

  if (!req.query.code || !req.query.state || !cookie || cookie !== req.query.state) {
    return res.status(400).send("Invalid OAuth state.");
  }

  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: REDIRECT_URI
      })
    });

    const tokenText = await tokenResponse.text();

    if (!tokenResponse.ok) {
      console.error("Discord token exchange failed:", tokenResponse.status, tokenText);
      console.error("OAuth redirect URI used:", REDIRECT_URI);
      return res.status(500).send(
        `Discord token exchange failed. HTTP ${tokenResponse.status}. Check the Render logs for the exact Discord error.`
      );
    }

    let token;
    try {
      token = JSON.parse(tokenText);
    } catch {
      console.error("Discord returned invalid token JSON:", tokenText);
      return res.status(500).send("Discord returned an invalid token response.");
    }

    if (!token.access_token) {
      console.error("Discord token response did not contain an access token.");
      return res.status(500).send("Discord did not return an access token.");
    }

    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });

    const userText = await userResponse.text();

    if (!userResponse.ok) {
      console.error("Discord user request failed:", userResponse.status, userText);
      return res.status(500).send("Could not fetch your Discord user.");
    }

    let user;
    try {
      user = JSON.parse(userText);
    } catch {
      console.error("Discord returned invalid user JSON:", userText);
      return res.status(500).send("Discord returned an invalid user response.");
    }

    setSession(res, {
      id: user.id,
      username: user.username,
      global_name: user.global_name || null,
      avatar: user.avatar || null
    });

    res.redirect("/#profile");
  } catch (error) {
    console.error("Discord OAuth callback error:", error);
    res.status(500).send("Discord login failed. Check the Render logs for details.");
  }
});

app.get("/api/discord-server", async (req, res) => {
  try {
    const response = await fetch(
      `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`
    );
    if (!response.ok) {
      console.error("Discord invite lookup failed:", response.status);
      return res.status(502).json({ ok: false, message: "Could not load Discord server information." });
    }

    const invite = await response.json();
    const guild = invite.guild || {};

    if (guild.id && guild.id !== DISCORD_GUILD_ID) {
      console.error("Discord invite returned unexpected guild:", guild.id);
      return res.status(502).json({ ok: false, message: "Discord server verification failed." });
    }

    const iconUrl = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith("a_") ? "gif" : "png"}?size=256`
      : null;

    const bannerUrl = guild.banner
      ? `https://cdn.discordapp.com/banners/${guild.id}/${guild.banner}.${guild.banner.startsWith("a_") ? "gif" : "png"}?size=1024`
      : null;

    res.json({
      ok: true,
      id: guild.id || DISCORD_GUILD_ID,
      name: guild.name || "Minehut Community",
      icon: iconUrl,
      banner: bannerUrl,
      approximateMemberCount: invite.approximate_member_count ?? null,
      approximatePresenceCount: invite.approximate_presence_count ?? null,
      invite: `https://discord.gg/${DISCORD_INVITE_CODE}`
    });
  } catch (error) {
    console.error("Discord server lookup error:", error);
    res.status(502).json({ ok: false, message: "Could not load Discord server information." });
  }
});

app.get("/api/store", (req, res) => {
  res.json({
    prices: store.prices,
    codesAvailable: store.codes.filter(code => !store.redeemed.includes(code)).length
  });
});

app.post("/api/redeem", (req, res) => {
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ ok: false, message: "Enter a redeem code." });
  if (!store.codes.includes(code)) {
    return res.status(404).json({ ok: false, message: "That redeem code is invalid." });
  }
  if (store.redeemed.includes(code)) {
    return res.status(409).json({ ok: false, message: "That redeem code has already been redeemed." });
  }
  store.redeemed.push(code);
  saveStore();
  res.json({ ok: true, message: "Code redeemed successfully." });
});

app.get("/api/developer/store", (req, res) => {
  if (!isDeveloper(req)) return res.status(401).json({ ok: false, message: "Developer authentication required." });
  res.json({ ok: true, store });
});

app.put("/api/developer/store", (req, res) => {
  if (!isDeveloper(req)) return res.status(401).json({ ok: false, message: "Developer authentication required." });

  const prices = req.body?.prices || {};
  const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];

  const cleanCodes = [...new Set(codes.map(code => String(code).trim()).filter(Boolean))];
  const redeemed = store.redeemed.filter(code => cleanCodes.includes(code));

  store = {
    prices: {
      mcfa: String(prices.mcfa ?? store.prices.mcfa).trim() || "<insert custom price>",
      minecraft: String(prices.minecraft ?? store.prices.minecraft).trim() || "<insert custom price>"
    },
    codes: cleanCodes,
    redeemed
  };

  try {
    saveStore();
    res.json({ ok: true, message: "Store settings saved.", store });
  } catch (error) {
    console.error("Could not save store data:", error);
    res.status(500).json({ ok: false, message: "Could not save store settings." });
  }
});

app.post("/api/developer/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const developer = developers.users.find(user => user.username === username);
  if (!developer || !verifyPassword(password, developer.password)) {
    return res.status(401).json({ ok: false, message: "Invalid developer credentials." });
  }
  setCookie(res, "developer_session", username + "." + sign(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/"
  });
  res.json({ ok: true, message: "Developer sign-in successful.", username, role: developer.role });
});

app.get("/api/developer/me", (req, res) => {
  const developer = getDeveloper(req);
  if (!developer) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: developer.username, role: developer.role });
});

app.post("/api/developer/logout", (req, res) => {
  setCookie(res, "developer_session", "", { maxAge: 0, path: "/" });
  res.status(204).end();
});

app.get("/api/developer/users", (req, res) => {
  const developer = getDeveloper(req);
  if (!developer) return res.status(401).json({ ok: false, message: "Developer authentication required." });
  res.json({
    ok: true,
    users: developers.users.map(user => ({
      username: user.username,
      role: user.role,
      createdAt: user.createdAt
    }))
  });
});

app.post("/api/developer/users", (req, res) => {
  const developer = getDeveloper(req);
  if (!developer) return res.status(401).json({ ok: false, message: "Developer authentication required." });

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({ ok: false, message: "Username must be 3-32 characters and use letters, numbers, dots, underscores, or hyphens." });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, message: "Password must be at least 8 characters." });
  }
  if (developers.users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ ok: false, message: "That developer username already exists." });
  }

  const passwordHash = hashPassword(password);
  developers.users.push({
    username,
    password: passwordHash,
    role: "developer",
    createdAt: new Date().toISOString()
  });

  try {
    saveDevelopers();
    res.json({ ok: true, message: "Developer account created.", username });
  } catch (error) {
    console.error("Could not save developer users:", error);
    res.status(500).json({ ok: false, message: "Could not save the developer account." });
  }
});

app.delete("/api/developer/users/:username", (req, res) => {
  const developer = getDeveloper(req);
  if (!developer) return res.status(401).json({ ok: false, message: "Developer authentication required." });

  const username = decodeURIComponent(req.params.username);
  if (username === developer.username || username === DEVELOPER_USR) {
    return res.status(400).json({ ok: false, message: "The owner account cannot be deleted." });
  }

  const index = developers.users.findIndex(user => user.username === username);
  if (index === -1) return res.status(404).json({ ok: false, message: "Developer account not found." });

  developers.users.splice(index, 1);
  saveDevelopers();
  res.json({ ok: true, message: "Developer account removed." });
});

app.get("/api/me", (req, res) => {
  const user = readSession(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json(user);
});

app.post("/auth/logout", (req, res) => {
  setCookie(res, "blemm_session", "", { maxAge: 0, path: "/" });
  res.status(204).end();
});

app.listen(PORT, () => console.log(`Blemm running at ${BASE_URL}`));