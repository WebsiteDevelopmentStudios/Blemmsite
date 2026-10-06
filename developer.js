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
  renderRedeemCodes(data.store.codes || []);
}

function renderRedeemCodes(codes) {
  const list = document.getElementById("redeemCodeList");
  list.innerHTML = codes.length ? codes.map(item => {
    const policy = item.usage === "per-user"
      ? "Per user"
      : "One user only";
    return `
      <div class="developer-user">
        <div>
          <strong>${escapeHtml(item.code)}</strong>
          <span>${policy} · ${item.redemptionCount || 0} redemption${item.redemptionCount === 1 ? "" : "s"}</span>
        </div>
        <div class="developer-code-actions">
          <button class="ghost-button code-copy" data-code="${escapeHtml(item.code)}" type="button">Copy code</button>
          <button class="ghost-button code-remove" data-code="${escapeHtml(item.code)}" type="button">Remove</button>
        </div>
      </div>
    `;
  }).join("") : "<p>No redeem codes have been created yet.</p>";

  list.querySelectorAll(".code-copy").forEach(button => {
    button.addEventListener("click", async () => {
      const code = button.dataset.code;
      if (!code) return;

      try {
        await navigator.clipboard.writeText(code);
        const originalText = button.textContent;
        button.textContent = "Copied!";
        message("developerStoreMessage", `Copied redeem code "${code}" to your clipboard.`);
        setTimeout(() => {
          button.textContent = originalText;
        }, 1400);
      } catch {
        message("developerStoreMessage", "Unable to copy the code. Please copy it manually.");
      }
    });
  });

  list.querySelectorAll(".code-remove").forEach(button => {
    button.addEventListener("click", async () => {
      const code = button.dataset.code;
      if (!confirm(`Remove redeem code "${code}"?`)) return;
      const response = await api(`/api/developer/codes/${encodeURIComponent(code)}`, { method: "DELETE" });
      const result = await response.json();
      message("developerStoreMessage", result.message || "Unable to remove code.");
      if (response.ok) await loadStore();
    });
  });
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
          ${user.role !== "owner" && user.password ? `<span class="developer-password">Password: ${escapeHtml(user.password)}</span>` : ""}
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
  const response = await api("/api/developer/store", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prices: {
        mcfa: document.getElementById("mcfaPrice").value,
        minecraft: document.getElementById("minecraftPrice").value
      }
    })
  });
  const data = await response.json();
  message("developerStoreMessage", data.message || "Unable to save store settings.");
  if (response.ok) await loadStore();
});

document.getElementById("createRedeemCodeForm").addEventListener("submit", async event => {
  event.preventDefault();
  const response = await api("/api/developer/codes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: document.getElementById("newRedeemCode").value,
      usage: document.getElementById("redeemUsage").value
    })
  });
  const data = await response.json();
  message("developerStoreMessage", data.message || "Unable to create redeem code.");
  if (response.ok) {
    event.target.reset();
    await loadStore();
  }
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
  const button = document.getElementById("developerLogout");
  if (!button || button.disabled) return;

  button.disabled = true;
  button.textContent = "Logging out...";

  try {
    const response = await api("/api/developer/logout", {
      method: "POST",
      headers: { "Cache-Control": "no-store" }
    });

    if (response.ok || response.status === 204) {
      window.location.assign("/index.html#profile");
      return;
    }

    button.disabled = false;
    button.textContent = "Log out";
    message("developerAccountMessage", "Unable to log out. Please try again.");
  } catch {
    button.disabled = false;
    button.textContent = "Log out";
    message("developerAccountMessage", "Unable to contact the server. Please try again.");
  }
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
