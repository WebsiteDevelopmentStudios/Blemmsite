require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || \`http://localhost:\${PORT}\`;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || \`\${BASE_URL}/auth/discord/callback\`;
const COOKIE_SECRET = process.env.COOKIE_SECRET;
const DEVELOPER_USR = process.env.DEVELOPER_USR;
const DEVELOPER_PASS = process.env.DEVELOPER_PASS;
const DEVELOPER_FILE = path.join(__dirname, "developer-data.json");
const STORE_FILE = path.join(__dirname, "store-data.json");
const DISCORD_INVITE_CODE = "8tsmAVtqZx";
const DISCORD_GUILD_ID = "1484873038926319739";
const MINECRAFT_REDEEM_CODES = (process.env.MINECRAFT_REDEEM_CODES || "")
  .split(",").map(code => code.trim()).filter(Boolean);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Connect a Render PostgreSQL database before starting Blemmsite.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

function normalizeStoreCodes(codes, redeemed = []) {
  const legacyRedeemed = new Set(redeemed);
  return (Array.isArray(codes) ? codes : []).map(item => {
    if (typeof item === "string") {
      return {
        code: item.trim(),
        usage: "single-user",
        redeemedBy: legacyRedeemed.has(item.trim()) ? ["legacy"] : []
      };
    }
    return {
      code: String(item?.code || "").trim(),
      usage: item?.usage === "per-user" ? "per-user" : "single-user",
      redeemedBy: Array.isArray(item?.redeemedBy) ? item.redeemedBy.map(String) : []
    };
  }).filter(item => item.code);
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

function encryptDeveloperPassword(password) {
  if (!COOKIE_SECRET) throw new Error("COOKIE_SECRET is required to encrypt developer passwords.");
  const key = crypto.createHash("sha256").update(COOKIE_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

function decryptDeveloperPassword(value) {
  if (!value || !COOKIE_SECRET) return null;
  try {
    const [ivText, tagText, encryptedText] = value.split(".");
    if (!ivText || !tagText || !encryptedText) return null;
    const key = crypto.createHash("sha256").update(COOKIE_SECRET).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
}

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

  try {
    const [payload, signature] = decodeURIComponent(match[1]).split(".");
    if (!payload || !signature || !COOKIE_SECRET) return null;

    const expected = sign(payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

async function getDeveloper(req) {
  const header = req.headers.cookie || "";
  const match = header.match(/(?:^|; )developer_session=([^;]+)/);
  if (!match || !COOKIE_SECRET) return null;

  try {
    const [username, signature] = decodeURIComponent(match[1]).split(".");
    if (!username || !signature || signature !== sign(username)) return null;

    const result = await pool.query(
      \`SELECT username, password_salt, password_hash, password_encrypted, role, created_at
       FROM developer_users WHERE username = $1 LIMIT 1\`,
      [username]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error("Could not read developer session:", error);
    return null;
  }
}

async function isDeveloper(req) {
  return Boolean(await getDeveloper(req));
}

async function requireDeveloperPage(req, res, next) {
  if (!await isDeveloper(req)) return res.redirect("/#profile");
  next();
}

async function initializeDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(\`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS developer_users (
        username VARCHAR(32) PRIMARY KEY,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_encrypted TEXT,
        role VARCHAR(32) NOT NULL DEFAULT 'developer',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS store_prices (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        mcfa TEXT NOT NULL,
        minecraft TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS redeem_codes (
        code VARCHAR(100) PRIMARY KEY,
        usage VARCHAR(16) NOT NULL CHECK (usage IN ('per-user', 'single-user')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS redeem_code_redemptions (
        code VARCHAR(100) NOT NULL REFERENCES redeem_codes(code) ON DELETE CASCADE,
        user_id VARCHAR(64) NOT NULL,
        redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (code, user_id)
      );

      CREATE INDEX IF NOT EXISTS redeem_code_redemptions_code_idx
        ON redeem_code_redemptions(code);
    \`);

    const migration = await client.query(
      "SELECT 1 FROM schema_migrations WHERE version = 1 LIMIT 1"
    );

    if (migration.rowCount === 0) {
      let developerData = null;
      let storeData = null;

      try {
        if (fs.existsSync(DEVELOPER_FILE)) {
          developerData = JSON.parse(fs.readFileSync(DEVELOPER_FILE, "utf8"));
        }
      } catch (error) {
        console.error("Could not read legacy developer-data.json for migration:", error);
      }

      try {
        if (fs.existsSync(STORE_FILE)) {
          storeData = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
        }
      } catch (error) {
        console.error("Could not read legacy store-data.json for migration:", error);
      }

      const legacyUsers = Array.isArray(developerData?.users) ? developerData.users : [];
      for (const user of legacyUsers) {
        if (!user?.username || !user?.password?.salt || !user?.password?.hash) continue;

        await client.query(
          \`INSERT INTO developer_users
             (username, password_salt, password_hash, password_encrypted, role, created_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
           ON CONFLICT (username) DO NOTHING\`,
          [
            String(user.username),
            String(user.password.salt),
            String(user.password.hash),
            user.passwordEncrypted ? String(user.passwordEncrypted) : null,
            user.role === "owner" ? "owner" : "developer",
            user.createdAt || null
          ]
        );
      }

      const fallbackMcfa = process.env.MCFA_PRICE || "<insert custom price>";
      const fallbackMinecraft = process.env.MINECRAFT_CODE_PRICE || "<insert custom price>";
      const prices = storeData?.prices || {};

      await client.query(
        \`INSERT INTO store_prices (id, mcfa, minecraft)
         VALUES (1, $1, $2)
         ON CONFLICT (id) DO NOTHING\`,
        [
          String(prices.mcfa ?? fallbackMcfa).trim() || fallbackMcfa,
          String(prices.minecraft ?? fallbackMinecraft).trim() || fallbackMinecraft
        ]
      );

      const codes = storeData?.codes ?? MINECRAFT_REDEEM_CODES;
      const legacyRedeemed = Array.isArray(storeData?.redeemed) ? storeData.redeemed : [];
      for (const item of normalizeStoreCodes(codes, legacyRedeemed)) {
        await client.query(
          \`INSERT INTO redeem_codes (code, usage)
           VALUES ($1, $2)
           ON CONFLICT (code) DO NOTHING\`,
          [item.code, item.usage]
        );

        for (const userId of item.redeemedBy) {
          await client.query(
            \`INSERT INTO redeem_code_redemptions (code, user_id)
             VALUES ($1, $2)
             ON CONFLICT (code, user_id) DO NOTHING\`,
            [item.code, userId]
          );
        }
      }

      await client.query(
        "INSERT INTO schema_migrations (version) VALUES (1)"
      );

      console.log("PostgreSQL migration complete. Legacy JSON data was imported when present.");
    }

    if (DEVELOPER_USR && DEVELOPER_PASS) {
      const password = hashPassword(DEVELOPER_PASS);

      const owner = await client.query(
        "SELECT username FROM developer_users WHERE username = $1 LIMIT 1",
        [DEVELOPER_USR]
      );

      if (owner.rowCount === 0) {
        await client.query(
          \`INSERT INTO developer_users
             (username, password_salt, password_hash, password_encrypted, role)
           VALUES ($1, $2, $3, NULL, 'owner')\`,
          [DEVELOPER_USR, password.salt, password.hash]
        );
      } else {
        await client.query(
          "UPDATE developer_users SET role = 'owner' WHERE username = $1",
          [DEVELOPER_USR]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (!CLIENT_ID || !CLIENT_SECRET || !COOKIE_SECRET) {
  console.warn("Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, and COOKIE_SECRET before using Discord login.");
}

app.use(express.json());

app.get("/developer.html", requireDeveloperPage, (req, res) => {
  res.sendFile(path.join(__dirname, "developer.html"));
});

app.use(express.static(path.join(__dirname)));

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

  res.redirect(\`https://discord.com/oauth2/authorize?\${params}\`);
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
        \`Discord token exchange failed. HTTP \${tokenResponse.status}. Check the Render logs for the exact Discord error.\`
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
      headers: { Authorization: \`Bearer \${token.access_token}\` }
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
      \`https://discord.com/api/v10/invites/\${DISCORD_INVITE_CODE}?with_counts=true\`
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
      ? \`https://cdn.discordapp.com/icons/\${guild.id}/\${guild.icon}.\${guild.icon.startsWith("a_") ? "gif" : "png"}?size=256\`
      : null;

    const bannerUrl = guild.banner
      ? \`https://cdn.discordapp.com/banners/\${guild.id}/\${guild.banner}.\${guild.banner.startsWith("a_") ? "gif" : "png"}?size=1024\`
      : null;

    res.json({
      ok: true,
      id: guild.id || DISCORD_GUILD_ID,
      name: guild.name || "Minehut Community",
      icon: iconUrl,
      banner: bannerUrl,
      approximateMemberCount: invite.approximate_member_count ?? null,
      approximatePresenceCount: invite.approximate_presence_count ?? null,
      invite: \`https://discord.gg/\${DISCORD_INVITE_CODE}\`
    });
  } catch (error) {
    console.error("Discord server lookup error:", error);
    res.status(502).json({ ok: false, message: "Could not load Discord server information." });
  }
});

app.get("/api/store", async (req, res) => {
  try {
    const prices = await pool.query(
      "SELECT mcfa, minecraft FROM store_prices WHERE id = 1 LIMIT 1"
    );
    const codes = await pool.query(
      "SELECT COUNT(*)::int AS count FROM redeem_codes"
    );

    res.json({
      prices: prices.rows[0] || {
        mcfa: process.env.MCFA_PRICE || "<insert custom price>",
        minecraft: process.env.MINECRAFT_CODE_PRICE || "<insert custom price>"
      },
      codesAvailable: codes.rows[0]?.count || 0
    });
  } catch (error) {
    console.error("Could not load store:", error);
    res.status(500).json({ ok: false, message: "Could not load store data." });
  }
});

app.post("/api/redeem", async (req, res) => {
  const user = readSession(req);
  if (!user?.id) {
    return res.status(401).json({ ok: false, message: "Sign in with Discord before redeeming a code." });
  }

  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ ok: false, message: "Enter a redeem code." });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const codeResult = await client.query(
      "SELECT code, usage FROM redeem_codes WHERE code = $1 LIMIT 1",
      [code]
    );

    if (codeResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "That redeem code is invalid." });
    }

    const entry = codeResult.rows[0];
    const existing = await client.query(
      "SELECT user_id FROM redeem_code_redemptions WHERE code = $1",
      [entry.code]
    );

    if (entry.usage === "single-user" && existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, message: "That redeem code has already been redeemed." });
    }

    if (
      entry.usage === "per-user" &&
      existing.rows.some(row => String(row.user_id) === String(user.id))
    ) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, message: "You have already redeemed that code." });
    }

    await client.query(
      \`INSERT INTO redeem_code_redemptions (code, user_id)
       VALUES ($1, $2)\`,
      [entry.code, String(user.id)]
    );

    await client.query("COMMIT");
    res.json({ ok: true, message: "Code redeemed successfully." });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}

    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        message: "That redeem code has already been redeemed by this account."
      });
    }

    console.error("Could not save redemption:", error);
    res.status(500).json({ ok: false, message: "Could not save the redemption." });
  } finally {
    client.release();
  }
});

app.get("/api/developer/store", async (req, res) => {
  if (!await isDeveloper(req)) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  try {
    const pricesResult = await pool.query(
      "SELECT mcfa, minecraft FROM store_prices WHERE id = 1 LIMIT 1"
    );
    const codesResult = await pool.query(\`
      SELECT
        c.code,
        c.usage,
        COUNT(r.user_id)::int AS "redemptionCount"
      FROM redeem_codes c
      LEFT JOIN redeem_code_redemptions r ON r.code = c.code
      GROUP BY c.code, c.usage, c.created_at
      ORDER BY c.created_at DESC
    \`);

    res.json({
      ok: true,
      store: {
        prices: pricesResult.rows[0] || {
          mcfa: process.env.MCFA_PRICE || "<insert custom price>",
          minecraft: process.env.MINECRAFT_CODE_PRICE || "<insert custom price>"
        },
        codes: codesResult.rows
      }
    });
  } catch (error) {
    console.error("Could not load developer store:", error);
    res.status(500).json({ ok: false, message: "Could not load store settings." });
  }
});

app.put("/api/developer/store", async (req, res) => {
  if (!await isDeveloper(req)) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  const prices = req.body?.prices || {};

  try {
    const current = await pool.query(
      "SELECT mcfa, minecraft FROM store_prices WHERE id = 1 LIMIT 1"
    );
    const old = current.rows[0] || {
      mcfa: process.env.MCFA_PRICE || "<insert custom price>",
      minecraft: process.env.MINECRAFT_CODE_PRICE || "<insert custom price>"
    };

    const mcfa = String(prices.mcfa ?? old.mcfa).trim() || "<insert custom price>";
    const minecraft = String(prices.minecraft ?? old.minecraft).trim() || "<insert custom price>";

    await pool.query(
      \`INSERT INTO store_prices (id, mcfa, minecraft, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
       SET mcfa = EXCLUDED.mcfa,
           minecraft = EXCLUDED.minecraft,
           updated_at = NOW()\`,
      [mcfa, minecraft]
    );

    res.json({
      ok: true,
      message: "Store settings saved.",
      store: { prices: { mcfa, minecraft } }
    });
  } catch (error) {
    console.error("Could not save store data:", error);
    res.status(500).json({ ok: false, message: "Could not save store settings." });
  }
});

app.post("/api/developer/codes", async (req, res) => {
  if (!await isDeveloper(req)) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  const code = String(req.body?.code || "").trim();
  const usage = req.body?.usage === "per-user" ? "per-user" : "single-user";

  if (!/^[A-Za-z0-9_-]{3,100}$/.test(code)) {
    return res.status(400).json({
      ok: false,
      message: "Code must be 3-100 characters and use letters, numbers, hyphens, or underscores."
    });
  }

  try {
    const duplicate = await pool.query(
      "SELECT code FROM redeem_codes WHERE LOWER(code) = LOWER($1) LIMIT 1",
      [code]
    );

    if (duplicate.rowCount > 0) {
      return res.status(409).json({ ok: false, message: "That redeem code already exists." });
    }

    await pool.query(
      "INSERT INTO redeem_codes (code, usage) VALUES ($1, $2)",
      [code, usage]
    );

    res.json({ ok: true, message: "Redeem code created." });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ ok: false, message: "That redeem code already exists." });
    }
    console.error("Could not save redeem code:", error);
    res.status(500).json({ ok: false, message: "Could not save redeem code." });
  }
});

app.delete("/api/developer/codes/:code", async (req, res) => {
  if (!await isDeveloper(req)) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  const code = decodeURIComponent(req.params.code);

  try {
    const result = await pool.query(
      "DELETE FROM redeem_codes WHERE code = $1 RETURNING code",
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: "Redeem code not found." });
    }

    res.json({ ok: true, message: "Redeem code removed." });
  } catch (error) {
    console.error("Could not remove redeem code:", error);
    res.status(500).json({ ok: false, message: "Could not remove redeem code." });
  }
});

app.post("/api/developer/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  try {
    const result = await pool.query(
      \`SELECT username, password_salt, password_hash, role
       FROM developer_users WHERE username = $1 LIMIT 1\`,
      [username]
    );
    const developer = result.rows[0];

    if (!developer || !verifyPassword(password, {
      salt: developer?.password_salt,
      hash: developer?.password_hash
    })) {
      return res.status(401).json({ ok: false, message: "Invalid developer credentials." });
    }

    setCookie(res, "developer_session", username + "." + sign(username), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/"
    });

    res.json({
      ok: true,
      message: "Developer sign-in successful.",
      username,
      role: developer.role
    });
  } catch (error) {
    console.error("Developer login failed:", error);
    res.status(500).json({ ok: false, message: "Developer login failed." });
  }
});

app.get("/api/developer/me", async (req, res) => {
  const developer = await getDeveloper(req);
  if (!developer) return res.status(401).json({ authenticated: false });
  res.json({
    authenticated: true,
    username: developer.username,
    role: developer.role
  });
});

app.post("/api/developer/logout", (req, res) => {
  setCookie(res, "developer_session", "", {
    maxAge: 0,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax"
  });
  res.status(204).end();
});

app.get("/api/developer/users", async (req, res) => {
  if (!await isDeveloper(req)) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  try {
    const result = await pool.query(\`
      SELECT username, role, created_at, password_encrypted
      FROM developer_users
      ORDER BY created_at ASC
    \`);

    res.json({
      ok: true,
      users: result.rows.map(user => ({
        username: user.username,
        role: user.role,
        createdAt: user.created_at,
        password: user.role === "owner" ? null : decryptDeveloperPassword(user.password_encrypted)
      }))
    });
  } catch (error) {
    console.error("Could not load developer users:", error);
    res.status(500).json({ ok: false, message: "Could not load developer users." });
  }
});

app.post("/api/developer/users", async (req, res) => {
  if (!await isDeveloper(req)) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return res.status(400).json({
      ok: false,
      message: "Username must be 3-32 characters and use letters, numbers, dots, underscores, or hyphens."
    });
  }

  if (password.length < 8) {
    return res.status(400).json({ ok: false, message: "Password must be at least 8 characters." });
  }

  try {
    const duplicate = await pool.query(
      "SELECT username FROM developer_users WHERE LOWER(username) = LOWER($1) LIMIT 1",
      [username]
    );

    if (duplicate.rowCount > 0) {
      return res.status(409).json({ ok: false, message: "That developer username already exists." });
    }

    const passwordHash = hashPassword(password);

    await pool.query(
      \`INSERT INTO developer_users
       (username, password_salt, password_hash, password_encrypted, role)
       VALUES ($1, $2, $3, $4, 'developer')\`,
      [
        username,
        passwordHash.salt,
        passwordHash.hash,
        encryptDeveloperPassword(password)
      ]
    );

    res.json({ ok: true, message: "Developer account created.", username });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ ok: false, message: "That developer username already exists." });
    }
    console.error("Could not save developer users:", error);
    res.status(500).json({ ok: false, message: "Could not save the developer account." });
  }
});

app.delete("/api/developer/users/:username", async (req, res) => {
  const developer = await getDeveloper(req);
  if (!developer) {
    return res.status(401).json({ ok: false, message: "Developer authentication required." });
  }

  const username = decodeURIComponent(req.params.username);

  if (
    username.toLowerCase() === String(developer.username).toLowerCase() ||
    username.toLowerCase() === String(DEVELOPER_USR || "").toLowerCase()
  ) {
    return res.status(400).json({ ok: false, message: "The owner account cannot be deleted." });
  }

  try {
    const result = await pool.query(
      "DELETE FROM developer_users WHERE username = $1 RETURNING username",
      [username]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, message: "Developer account not found." });
    }

    res.json({ ok: true, message: "Developer account removed." });
  } catch (error) {
    console.error("Could not remove developer user:", error);
    res.status(500).json({ ok: false, message: "Could not remove the developer account." });
  }
});

app.get("/api/me", (req, res) => {
  const user = readSession(req);
  if (!user) return res.status(401).json({ authenticated: false });
  res.json(user);
});

app.post("/auth/logout", (req, res) => {
  setCookie(res, "blemm_session", "", {
    maxAge: 0,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax"
  });
  res.status(204).end();
});

async function start() {
  try {
    await initializeDatabase();
    await pool.query("SELECT 1");
    app.listen(PORT, () => console.log(\`Blemm running at \${BASE_URL} with PostgreSQL persistence\`));
  } catch (error) {
    console.error("Could not initialize PostgreSQL:", error);
    await pool.end();
    process.exit(1);
  }
}

start();
