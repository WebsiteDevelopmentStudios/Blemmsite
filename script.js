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
      <p>@${escapeHtml(user.username)} is connected to MineLoot.</p>
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


// MineLoot Arcade games
(function initArcade() {
  const moneyEl = document.getElementById("gameMoney");
  if (!moneyEl) return;

  let money = Number.parseInt(localStorage.getItem("mineloot_arcade_money") || "150", 10);
  if (!Number.isFinite(money) || money < 150) money = 150;

  const cooldowns = { doubleButton: 2000, tripleButton: 5000, quadButton: 10000 };
  const labels = { doubleButton: "2x", tripleButton: "3x", quadButton: "4x" };
  const failures = { doubleButton: 0.30, tripleButton: 0.60, quadButton: 0.80 };
  const multipliers = { doubleButton: 2, tripleButton: 3, quadButton: 4 };

  function renderMoney() {
    moneyEl.textContent = Math.floor(money).toLocaleString();
    localStorage.setItem("mineloot_arcade_money", String(Math.floor(money)));
  }
  renderMoney();

  Object.keys(cooldowns).forEach(id => {
    document.getElementById(id)?.addEventListener("click", () => {
      const button = document.getElementById(id);
      if (button.disabled) return;
      button.disabled = true;

      const multiplier = multipliers[id];
      const failed = Math.random() < failures[id];
      let result;

      if (failed) {
        if (money > 300) {
          if (id === "doubleButton") money = Math.max(150, Math.floor(money * 0.5));
          else if (id === "tripleButton") money = Math.max(150, Math.floor(money * 0.2));
          else money = 150;
          result = `${labels[id]} failed. Your balance was reduced, but cannot go below $150.`;
        } else {
          result = `${labels[id]} failed, but your balance is $300 or less, so no money was lost.`;
        }
      } else {
        money = Math.floor(money * multiplier);
        result = `Success! ${labels[id]} turned your balance into ${money.toLocaleString()}.`;
      }

      renderMoney();
      document.getElementById("doubleStatus").textContent = result;

      const seconds = cooldowns[id] / 1000;
      let remaining = seconds;
      button.textContent = `${labels[id]} · ${remaining}s`;
      const timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(timer);
          button.disabled = false;
          button.innerHTML = `<strong>${labels[id]}</strong><span>${id === "doubleButton" ? "30% fail · 2s cooldown" : id === "tripleButton" ? "60% fail · 5s cooldown" : "80% fail · 10s cooldown"}</span>`;
        } else {
          button.textContent = `${labels[id]} · ${remaining}s`;
        }
      }, 1000);
    });
  });

  document.getElementById("resetMoneyButton")?.addEventListener("click", () => {
    money = 150;
    renderMoney();
    document.getElementById("doubleStatus").textContent = "Balance reset to $150.";
  });

  // Wordle
  const wordleBoard = document.getElementById("wordleBoard");
  const wordleKeyboard = document.getElementById("wordleKeyboard");
  const wordleStatus = document.getElementById("wordleStatus");
  const wordleGuessCount = document.getElementById("wordleGuessCount");
  const wordleReset = document.getElementById("wordleResetButton");
  if (wordleBoard && wordleKeyboard) {
    const words = ["apple","beach","black","block","brain","bread","brick","chair","cloud","crown","dream","earth","flame","ghost","grape","green","heart","house","light","magic","metal","mouse","night","ocean","paper","plant","queen","river","robot","round","sheep","smile","space","stone","storm","sword","table","thing","tiger","train","water","world","zebra"];
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    let answer = "", guesses = [], current = "", gameOver = false;
    const state = {};
    function newWordle() { answer=words[Math.floor(Math.random()*words.length)].toUpperCase(); guesses=[]; current=""; gameOver=false; Object.keys(state).forEach(k=>delete state[k]); wordleGuessCount.textContent="0"; wordleStatus.textContent="Guess the 5-letter word."; renderWordleBoard(); renderWordleKeyboard(); }
    function getWordleTileClasses(guess) {
      const result = Array(5).fill("wordle-absent");
      const remaining = {};
      for (let i = 0; i < 5; i++) {
        if (guess[i] === answer[i]) {
          result[i] = "wordle-correct";
        } else {
          remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
        }
      }
      for (let i = 0; i < 5; i++) {
        if (result[i] === "wordle-correct") continue;
        const letter = guess[i];
        if (remaining[letter] > 0) {
          result[i] = "wordle-present";
          remaining[letter]--;
        }
      }
      return result;
    }
    function renderWordleBoard() {
      wordleBoard.innerHTML = "";
      for (let row = 0; row < 6; row++) {
        const guess = guesses[row] || (row === guesses.length ? current : "");
        const classes = guesses[row] ? getWordleTileClasses(guess) : [];
        for (let col = 0; col < 5; col++) {
          const tile = document.createElement("div");
          tile.className = "wordle-tile";
          tile.textContent = guess[col] || "";
          if (guesses[row]) tile.classList.add(classes[col]);
          else if (guess[col]) tile.classList.add("wordle-filled");
          wordleBoard.appendChild(tile);
        }
      }
    }
    function addKey(parent,key,wide=false){const button=document.createElement("button"); button.type="button"; button.className="wordle-key"+(wide?" wordle-wide":""); button.textContent=key; button.dataset.wordleKey=key; button.addEventListener("click",()=>handleWordleKey(key)); parent.appendChild(button);}
    function renderWordleKeyboard(){wordleKeyboard.innerHTML=""; const rows=[alphabet.slice(0,10),alphabet.slice(10,19),alphabet.slice(19)]; rows.forEach(row=>{const el=document.createElement("div");el.className="wordle-key-row";row.forEach(key=>addKey(el,key));wordleKeyboard.appendChild(el);}); addKey(wordleKeyboard.lastElementChild,"ENTER",true);addKey(wordleKeyboard.lastElementChild,"⌫",true); Object.keys(state).forEach(key=>{const button=document.querySelector('[data-wordle-key="'+key+'"]');if(button)button.classList.add(state[key]);});}
    function submitWordle() {
      if (current.length !== 5) {
        wordleStatus.textContent = "Your guess needs 5 letters.";
        return;
      }
      if (!/^[A-Z]{5}$/.test(current)) {
        wordleStatus.textContent = "Use exactly 5 letters.";
        return;
      }
      const guess = current;
      const classes = getWordleTileClasses(guess);
      guesses.push(guess);
      current = "";
      wordleGuessCount.textContent = guesses.length;
      for (let i = 0; i < 5; i++) {
        const letter = guess[i];
        if (classes[i] === "wordle-correct") {
          state[letter] = "wordle-key-correct";
        } else if (classes[i] === "wordle-present" && state[letter] !== "wordle-key-correct") {
          state[letter] = "wordle-key-present";
        } else if (!state[letter]) {
          state[letter] = "wordle-key-absent";
        }
      }
      renderWordleBoard();
      renderWordleKeyboard();
      if (guess === answer) {
        gameOver = true;
        wordleStatus.textContent = "You got it!";
      } else if (guesses.length >= 6) {
        gameOver = true;
        wordleStatus.textContent = "The word was " + answer + ".";
      } else {
        wordleStatus.textContent = "Keep going.";
      }
    }
    function handleWordleKey(key){if(gameOver)return;if(key==="ENTER")return submitWordle();if(key==="⌫"){current=current.slice(0,-1);renderWordleBoard();return;}if(/^[A-Z]$/.test(key)&&current.length<5){current+=key;renderWordleBoard();}}
    document.addEventListener("keydown",event=>{if(!document.getElementById("game")?.classList.contains("active-page"))return;if(/^[a-zA-Z]$/.test(event.key))handleWordleKey(event.key.toUpperCase());else if(event.key==="Enter")handleWordleKey("ENTER");else if(event.key==="Backspace")handleWordleKey("⌫");});
    wordleReset.addEventListener("click",newWordle); newWordle();
  }

  // Snake
  const canvas = document.getElementById("snakeCanvas");
  const snakeStart = document.getElementById("snakeStartButton");
  const snakeScoreEl = document.getElementById("snakeScore");
  const snakeStatus = document.getElementById("snakeStatus");
  if (canvas && snakeStart) {
    const ctx = canvas.getContext("2d");
    const size = 21;
    let snake = [], food = { x: 10, y: 10 }, direction = { x: 1, y: 0 };
    let nextDirection = { x: 1, y: 0 }, snakeTimer = null, snakeScore = 0, running = false;

    function spawnFood() {
      do {
        food = { x: Math.floor(Math.random() * size), y: Math.floor(Math.random() * size) };
      } while (snake.some(part => part.x === food.x && part.y === food.y));
    }
    function drawSnake() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cell = canvas.width / size;
      ctx.fillStyle = "#0b0d17";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#8f78ad";
      ctx.fillRect(food.x * cell + 3, food.y * cell + 3, cell - 6, cell - 6);
      snake.forEach((part, i) => {
        ctx.fillStyle = i === 0 ? "#b9a4d1" : "#78639c";
        ctx.fillRect(part.x * cell + 2, part.y * cell + 2, cell - 4, cell - 4);
      });
    }
    function startSnake() {
      clearInterval(snakeTimer);
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      direction = { x: 1, y: 0 }; nextDirection = { x: 1, y: 0 };
      snakeScore = 0; running = true;
      snakeScoreEl.textContent = "0";
      snakeStatus.textContent = "Go!";
      spawnFood(); drawSnake();
      snakeTimer = setInterval(tickSnake, 115);
    }
    function tickSnake() {
      direction = nextDirection;
      const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };
      if (head.x < 0 || head.y < 0 || head.x >= size || head.y >= size || snake.some(part => part.x === head.x && part.y === head.y)) {
        clearInterval(snakeTimer); running = false; snakeStatus.textContent = `Game over. Score: ${snakeScore}.`; return;
      }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) {
        snakeScore += 1; snakeScoreEl.textContent = snakeScore; spawnFood();
      } else snake.pop();
      drawSnake();
    }
    document.addEventListener("keydown", event => {
      const keys = {
        ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }
      };
      const next = keys[event.key];
      if (!next || !running) return;
      if (next.x + direction.x !== 0 || next.y + direction.y !== 0) nextDirection = next;
      if (event.key.startsWith("Arrow")) event.preventDefault();
    });
    snakeStart.addEventListener("click", startSnake);
    drawSnake();
  }

  // Reaction test
  const reactionArea = document.getElementById("reactionArea");
  const reactionStatus = document.getElementById("reactionStatus");
  const reactionBest = document.getElementById("reactionBest");
  if (reactionArea) {
    let reactionState = "ready", reactionStart = 0, reactionTimeout = null, best = Number(localStorage.getItem("mineloot_reaction_best"));
    reactionBest.textContent = Number.isFinite(best) ? Math.round(best) : "—";
    reactionArea.addEventListener("click", () => {
      if (reactionState === "ready") {
        reactionState = "waiting";
        reactionArea.textContent = "Wait...";
        reactionStatus.textContent = "Don't click until it turns green.";
        reactionArea.classList.remove("reaction-go");
        reactionTimeout = setTimeout(() => {
          reactionState = "go"; reactionStart = performance.now();
          reactionArea.textContent = "CLICK!";
          reactionArea.classList.add("reaction-go");
          reactionStatus.textContent = "Click!";
        }, 1200 + Math.random() * 2800);
      } else if (reactionState === "waiting") {
        clearTimeout(reactionTimeout);
        reactionState = "ready"; reactionArea.textContent = "Too soon"; reactionArea.classList.remove("reaction-go");
        reactionStatus.textContent = "Too early. Try again.";
      } else {
        const ms = Math.round(performance.now() - reactionStart);
        reactionState = "ready"; reactionArea.textContent = `${ms} ms`; reactionArea.classList.remove("reaction-go");
        if (!Number.isFinite(best) || ms < best) {
          best = ms; reactionBest.textContent = ms; localStorage.setItem("mineloot_reaction_best", String(ms));
          reactionStatus.textContent = "New best reaction time!";
        } else reactionStatus.textContent = "Nice. Try to beat your best.";
      }
    });
  }

  // Memory Match
  const memoryGrid = document.getElementById("memoryGrid");
  const memoryMoves = document.getElementById("memoryMoves");
  const memoryStatus = document.getElementById("memoryStatus");
  const memoryReset = document.getElementById("memoryResetButton");
  if (memoryGrid) {
    const symbols = ["◆","●","▲","■","★","✦","⬟","♥"];
    let first = null, lock = false, moves = 0, matched = 0;
    function newMemory() {
      const cards = [...symbols, ...symbols].sort(() => Math.random() - 0.5);
      first = null; lock = false; moves = 0; matched = 0;
      memoryMoves.textContent = "0"; memoryStatus.textContent = "Match all the pairs.";
      memoryGrid.innerHTML = "";
      cards.forEach(symbol => {
        const card = document.createElement("button");
        card.type = "button"; card.className = "memory-card"; card.dataset.symbol = symbol;
        card.innerHTML = "<span>?</span>";
        card.addEventListener("click", () => {
          if (lock || card.classList.contains("matched") || card === first) return;
          card.classList.add("revealed"); card.innerHTML = `<span>${symbol}</span>`;
          if (!first) { first = card; return; }
          moves++; memoryMoves.textContent = moves;
          const second = card;
          if (first.dataset.symbol === second.dataset.symbol) {
            first.classList.add("matched"); second.classList.add("matched");
            first = null; matched += 2;
            if (matched === cards.length) memoryStatus.textContent = `Completed in ${moves} moves.`;
          } else {
            lock = true;
            setTimeout(() => {
              first.classList.remove("revealed"); second.classList.remove("revealed");
              first.innerHTML = "<span>?</span>"; second.innerHTML = "<span>?</span>";
              first = null; lock = false;
            }, 650);
          }
        });
        memoryGrid.appendChild(card);
      });
    }
    memoryReset.addEventListener("click", newMemory);
    newMemory();
  }

  // Target Click
  const targetArea = document.getElementById("targetArea");
  const targetButton = document.getElementById("targetButton");
  const targetStart = document.getElementById("targetStartButton");
  const targetScore = document.getElementById("targetScore");
  const targetTimer = document.getElementById("targetTimer");
  const targetStatus = document.getElementById("targetStatus");
  if (targetArea && targetButton) {
    let targetRunning = false, targetHits = 0, targetRemaining = 20, targetInterval = null;
    function moveTarget() {
      const maxX = Math.max(0, targetArea.clientWidth - targetButton.offsetWidth - 10);
      const maxY = Math.max(0, targetArea.clientHeight - targetButton.offsetHeight - 10);
      targetButton.style.left = (5 + Math.random() * maxX) + "px";
      targetButton.style.top = (5 + Math.random() * maxY) + "px";
    }
    targetStart.addEventListener("click", () => {
      clearInterval(targetInterval);
      targetRunning = true; targetHits = 0; targetRemaining = 20;
      targetScore.textContent = "0"; targetTimer.textContent = "20s"; targetStatus.textContent = "Go!";
      targetButton.hidden = false; moveTarget();
      targetInterval = setInterval(() => {
        targetRemaining--;
        targetTimer.textContent = targetRemaining + "s";
        if (targetRemaining <= 0) {
          clearInterval(targetInterval); targetRunning = false; targetButton.hidden = true;
          targetStatus.textContent = `Round over. You got ${targetHits} hits.`;
        }
      }, 1000);
    });
    targetButton.addEventListener("click", () => {
      if (!targetRunning) return;
      targetHits++; targetScore.textContent = targetHits; moveTarget();
    });
    targetButton.hidden = true;
  }
})();

loadStore();
loadDeveloperPanel();
loadDiscordServer();

// Prevent native image dragging (including dynamically inserted images).
document.addEventListener("dragstart", event => {
  if (event.target instanceof HTMLImageElement) event.preventDefault();
});
document.querySelectorAll("img").forEach(img => {
  img.draggable = false;
});


document.addEventListener("click", event => {
  const x = event.clientX;
  const y = event.clientY;

  // Main expanding ring.
  const ripple = document.createElement("span");
  ripple.className = "click-effect";
  ripple.style.left = x + "px";
  ripple.style.top = y + "px";
  document.body.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());

  // A larger, randomized particle burst gives the click much more impact.
  const particleCount = 12 + Math.floor(Math.random() * 9);
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("span");
    particle.className = "click-particle";

    const angle = Math.random() * Math.PI * 2;
    const distance = 24 + Math.random() * 42;
    const size = 2 + Math.random() * 4;
    const rotation = Math.random() * 360;
    const delay = Math.random() * 70;
    const duration = 360 + Math.random() * 220;

    particle.style.left = x + "px";
    particle.style.top = y + "px";
    particle.style.width = size + "px";
    particle.style.height = size + "px";
    particle.style.setProperty("--particle-x", Math.cos(angle) * distance + "px");
    particle.style.setProperty("--particle-y", Math.sin(angle) * distance + "px");
    particle.style.setProperty("--particle-rotation", rotation + "deg");
    particle.style.animationDuration = duration + "ms";
    particle.style.animationDelay = delay + "ms";

    document.body.appendChild(particle);
    particle.addEventListener("animationend", () => particle.remove());
  }

  // Small central flash to sell the impact.
  const flash = document.createElement("span");
  flash.className = "click-flash";
  flash.style.left = x + "px";
  flash.style.top = y + "px";
  document.body.appendChild(flash);
  flash.addEventListener("animationend", () => flash.remove());
});
