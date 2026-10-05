// Blemm site client logic.
// Discord OAuth requires a small server-side callback because the client secret must never
// be exposed in browser code. Set OAUTH_LOGIN_URL to your backend's /auth/discord endpoint.
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
  if (!CONFIG.OAUTH_LOGIN_URL || CONFIG.OAUTH_LOGIN_URL === "#") {
    alert("Discord login is not configured yet. Set OAUTH_LOGIN_URL in script.js to your OAuth backend.");
    return;
  }
  window.location.href = CONFIG.OAUTH_LOGIN_URL;
}

document.querySelectorAll('[data-action="login"], #loginButton').forEach(button => {
  button.addEventListener("click", loginWithDiscord);
});

function renderProfile() {
  const params = new URLSearchParams(location.search);
  const user = {
    id: params.get("discord_id"),
    username: params.get("username"),
    avatar: params.get("avatar")
  };
  if (!user.username) return;
  const card = document.getElementById("profileCard");
  const avatar = user.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";
  card.innerHTML = `
    <img class="profile-avatar" src="${escapeHtml(avatar)}" alt="">
    <div>
      <span class="server-label">Discord account</span>
      <h3>${escapeHtml(user.username)}</h3>
      <p>Your Discord account is connected to Blemm.</p>
      <button class="ghost-button" id="logoutButton">Log out</button>
    </div>`;
  document.getElementById("logoutButton").addEventListener("click", () => {
    localStorage.removeItem("blemm_user");
    history.replaceState(null, "", "#profile");
    location.reload();
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[char]));
}

renderProfile();
const initial = location.hash.slice(1);
if (initial && document.getElementById(initial)) showPage(initial);
