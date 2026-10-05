require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/discord/callback`;
const COOKIE_SECRET = process.env.COOKIE_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET || !COOKIE_SECRET) {
  console.warn("Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and COOKIE_SECRET before using Discord login.");
}

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