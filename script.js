const CONFIG = {
  OAUTH_LOGIN_URL: "/auth/discord",
  DISCORD_INVITE_URL: "https://discord.gg/8tsmAVtqZx"
};

document.getElementById("year").textContent = new Date().getFullYear();


async function loadDiscordServer() {
  try {
    const response = await fetch("/api/discord-server", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.ok) return;

    document.getElementById("discordServerName").textContent = data.name;
    document.getElementById("discordInvite").href = data.invite;

    const icon = document.getElementById("discordServerIcon");
    const fallback = document.getElementById("discordServerIconFallback");
    if (data.icon) {
      icon.src = data.icon;
      icon.hidden = false;
      fallback.hidden = true;
    }

    const banner = document.getElementById("discordServerBannerImage");
    const bannerFallback = document.querySelector(".discord-server-banner-fallback");
    if (data.banner) {
      banner.src = data.banner;
      banner.hidden = false;
      bannerFallback.hidden = true;
    }

    if (data.approximateMemberCount !== null) {
      document.getElementById("memberCount").textContent = data.approximateMemberCount.toLocaleString();
    }
    if (data.approximatePresenceCount !== null) {
      document.getElementById("onlineCount").textContent = data.approximatePresenceCount.toLocaleString();
    }
  } catch (error) {
    console.error("Could not load Discord server:", error);
  }
}

async function loadStore() {
  try {
    const response = await fetch("/api/store", { credentials: "include", cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    document.getElementById("mcfaPriceDisplay").textContent = data.prices?.mcfa || "<insert custom price>";
    document.getElementById("minecraftPriceDisplay").textContent = data.prices?.minecraft || "<insert custom price>";
  } catch (error) {
    console.error("Could not load store:", error);
  }
}
document.getElementById("discordInvite").href = CONFIG.DISCORD_INVITE_URL;

const pages = [...document.querySelectorAll(".page")];
const links = [...document.querySelectorAll("[data-page]")];

function showPage(name) {
  const target = document.getElementById(name) || document.getElementById("home");
  pages.forEach(page => page.classList.toggle("active-page", page === target));
  links.forEach(link => link.classList.toggle("active", link.dataset.page === target.id));
  if (location.hash !== "#" + target.id) history.replaceState(null, "", "#" + target.id);
}
links.forEach(link => link.addEventListener("click", event => {
  event.preventDefault();
  showPage(link.dataset.page);
}));

function loginWithDiscord() {
  window.location.href = CONFIG.OAUTH_LOGIN_URL;
}
document.querySelectorAll('[data-action="login"], #loginButton').forEach(button => {
  button.addEventListener("click", loginWithDiscord);
});

async function checkAuthentication() {
  document.body.classList.add("auth-pending");

  try {
    const response = await fetch("/api/me", {
      credentials: "include",
      cache: "no-store"
    });

    if (!response.ok) {
      requireLogin();
      return false;
    }

    const user = await response.json();
    if (!user?.id) {
      requireLogin();
      return false;
    }

    document.body.classList.remove("auth-pending", "auth-required");
    renderProfile(user);
    return true;
  } catch (error) {
    console.error("Could not verify authentication:", error);
    requireLogin();
    return false;
  }
}

function requireLogin() {
  document.body.classList.remove("auth-pending");
  document.body.classList.add("auth-required");
}

function renderProfile(user) {
  const card = document.getElementById("profileCard");
  const avatar = user.avatar
    ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=256`
    : "https://cdn.discordapp.com/embed/avatars/0.png";

  const serverProfile = user.serverProfile || {};
  const inServer = serverProfile.inServer === true;
  const membershipMessage = inServer
    ? "You are in the Discord server."
    : "You aren't in the Discord server.";

  card.innerHTML = `
    <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="">
    <div>
      <span class="server-label">Discord account</span>
      <h3 class="profile-name">${escapeHtml(user.global_name || user.username)}</h3>
      <p>@${escapeHtml(user.username)} is connected to Minehut.</p>
      <p class="profile-server-status ${inServer ? "profile-server-member" : "profile-server-missing"}">${membershipMessage}</p>
      <button class="ghost-button" id="logoutButton">Log out</button>
    </div>`;

  document.getElementById("logoutButton").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    location.reload();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[char]));
}

checkAuthentication().then(authenticated => {
  if (!authenticated) return;
  const initial = location.hash.slice(1);
  if (initial && document.getElementById(initial)) showPage(initial);
});

document.getElementById("redeemButton")?.addEventListener("click", async () => {
  const input = document.getElementById("redeemCode");
  const message = document.getElementById("redeemMessage");
  const code = input.value.trim();
  if (!code) { message.textContent = "Enter a redeem code."; return; }
  try {
    const response = await fetch("/api/redeem", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      credentials: "include",
      body: JSON.stringify({code})
    });
    const data = await response.json();
    message.textContent = data.message || "Unable to redeem code.";
  } catch {
    message.textContent = "Unable to contact the server.";
  }
});

document.getElementById("developerLoginForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("developerMessage");
  try {
    const response = await fetch("/api/developer/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      credentials: "include",
      body: JSON.stringify({
        username: document.getElementById("developerUsername").value,
        password: document.getElementById("developerPassword").value
      })
    });
    const data = await response.json();
    message.textContent = data.message || "Unable to sign in.";
    if (response.ok) {
      event.target.reset();
      window.location.href = "/developer.html";
    }
  } catch {
    message.textContent = "Unable to contact the server.";
  }
});


async function loadDeveloperPanel() {
  const panel = document.getElementById("developerPanel");
  if (!panel) return;
  try {
    const response = await fetch("/api/developer/store", { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      panel.hidden = true;
      return;
    }
    const data = await response.json();
    document.getElementById("mcfaPrice").value = data.store.prices.mcfa;
    document.getElementById("minecraftPrice").value = data.store.prices.minecraft;
    document.getElementById("redeemCodes").value = data.store.codes.join("\n");
    panel.hidden = false;
  } catch (error) {
    console.error("Could not load developer panel:", error);
  }
}

document.getElementById("developerStoreForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const message = document.getElementById("developerStoreMessage");
  const codes = document.getElementById("redeemCodes").value
    .split(/\r?\n/)
    .map(code => code.trim())
    .filter(Boolean);
  try {
    const response = await fetch("/api/developer/store", {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      credentials: "include",
      body: JSON.stringify({
        prices: {
          mcfa: document.getElementById("mcfaPrice").value,
          minecraft: document.getElementById("minecraftPrice").value
        },
        codes
      })
    });
    const data = await response.json();
    message.textContent = data.message || "Unable to save store settings.";
    if (response.ok) {
      await loadStore();
      await loadDeveloperPanel();
    }
  } catch {
    message.textContent = "Unable to contact the server.";
  }
});

loadStore();
loadDeveloperPanel();
loadDiscordServer();


document.addEventListener("click", event => {
  const ripple = document.createElement("span");
  ripple.className = "click-effect";
  const burst = document.createElement("span");
  burst.className = "click-burst";
  ripple.style.left = event.clientX + "px";
  ripple.style.top = event.clientY + "px";
  document.body.appendChild(ripple);
  document.body.appendChild(burst);
  ripple.addEventListener("animationend", () => ripple.remove());
  burst.addEventListener("animationend", () => burst.remove());
});
