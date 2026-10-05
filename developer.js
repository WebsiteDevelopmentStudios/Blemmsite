async function api(url, options = {}) {
  return fetch(url, {
    credentials: "include",
    cache: "no-store",
    ...options
  });
}

document.getElementById("year").textContent = new Date().getFullYear();

function message(id, text) {
  document.getElementById(id).textContent = text;
}

async function verifyDeveloper() {
  try {
    const response = await api("/api/developer/me");
    if (!response.ok) {
      window.location.replace("/#profile");
      return false;
    }
    return true;
  } catch {
    window.location.replace("/#profile");
    return false;
  }
}

async function loadStore() {
  const response = await api("/api/developer/store");
  if (!response.ok) {
    window.location.replace("/#profile");
    return;
  }
  const data = await response.json();
  document.getElementById("mcfaPrice").value = data.store.prices.mcfa;
  document.getElementById("minecraftPrice").value = data.store.prices.minecraft;
  document.getElementById("redeemCodes").value = data.store.codes.join("\n");
}

async function loadDevelopers() {
  const response = await api("/api/developer/users");
  if (!response.ok) return;

  const data = await response.json();
  const list = document.getElementById("developerUserList");

  list.innerHTML = data.users.map(user => {
    const created = user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "";
    const removable = user.role !== "owner";
    return `
      <div class="developer-user">
        <div>
          <strong>${escapeHtml(user.username)}</strong>
          <span>${escapeHtml(user.role)} · ${escapeHtml(created)}</span>
        </div>
        ${removable ? `<button class="ghost-button user-remove" data-username="${escapeHtml(user.username)}" type="button">Remove</button>` : "<span class=\"owner-label\">Owner</span>"}
      </div>
    `;
  }).join("");

  list.querySelectorAll(".user-remove").forEach(button => {
    button.addEventListener("click", async () => {
      const username = button.dataset.username;
      if (!confirm(`Remove developer account "${username}"?`)) return;

      const response = await api(`/api/developer/users/${encodeURIComponent(username)}`, { method: "DELETE" });
      const result = await response.json();
      message("developerAccountMessage", result.message || "Unable to remove account.");
      if (response.ok) await loadDevelopers();
    });
  });
}

document.getElementById("developerStoreForm").addEventListener("submit", async event => {
  event.preventDefault();

  const codes = document.getElementById("redeemCodes").value
    .split(/\r?\n/)
    .map(code => code.trim())
    .filter(Boolean);

  const response = await api("/api/developer/store", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prices: {
        mcfa: document.getElementById("mcfaPrice").value,
        minecraft: document.getElementById("minecraftPrice").value
      },
      codes
    })
  });

  const data = await response.json();
  message("developerStoreMessage", data.message || "Unable to save store settings.");
});

document.getElementById("createDeveloperForm").addEventListener("submit", async event => {
  event.preventDefault();

  const response = await api("/api/developer/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.getElementById("newDeveloperUsername").value,
      password: document.getElementById("newDeveloperPassword").value
    })
  });

  const data = await response.json();
  message("developerAccountMessage", data.message || "Unable to create developer.");
  if (response.ok) {
    event.target.reset();
    await loadDevelopers();
  }
});

document.getElementById("developerLogout").addEventListener("click", async () => {
  await api("/api/developer/logout", { method: "POST" });
  window.location.replace("/#profile");
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[char]));
}

(async () => {
  if (await verifyDeveloper()) {
    await Promise.all([loadStore(), loadDevelopers()]);
  }
})();
