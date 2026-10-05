const CONFIG = {
  OAUTH_LOGIN_URL: "/auth/discord",
  DISCORD_INVITE_URL: "https://discord.com"
};

document.getElementById("year").textContent = new Date().getFullYear();
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

  card.innerHTML = `
    <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="">
    <div>
      <span class="server-label">Discord account</span>
      <h3>${escapeHtml(user.global_name || user.username)}</h3>
      <p>@${escapeHtml(user.username)} is connected to Minehut.</p>
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
