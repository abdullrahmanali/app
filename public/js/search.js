// public/js/search.js
document.addEventListener("DOMContentLoaded", () => {
  const inputField = document.getElementById("input");
  const resultsContainer = document.getElementById("resultsContainer");
  const searchWrapper = document.getElementById("searchWrapper");
  const searchButton = document.getElementById("searchButton");
  const messageBox = document.getElementById("messageBox");
  const detailView = document.getElementById("detailView");

  let lastResults = [];
  let msgTimer = null;

  function showMessage(
    html,
    { autoHide = false, t = 5000, center = false } = {},
  ) {
    clearTimeout(msgTimer);
    messageBox.innerHTML = html;
    messageBox.classList.remove("hidden");
    if (center) messageBox.classList.add("center");
    else messageBox.classList.remove("center");
    if (autoHide)
      msgTimer = setTimeout(() => messageBox.classList.add("hidden"), t);
  }
  function hideMessage() {
    clearTimeout(msgTimer);
    messageBox.classList.add("hidden");
    messageBox.classList.remove("center");
  }

  searchButton.addEventListener("click", performSearch);
  inputField.addEventListener("keydown", (e) => {
    if (e.key === "Enter") performSearch();
  });

  async function performSearch() {
    const q = inputField.value.trim();
    if (!q) {
      showMessage(`<p class="no-results">✨ اكتب اسم أنمي للبحث ✨</p>`, {
        autoHide: true,
        center: true,
      });
      resultsContainer.innerHTML = "";
      return;
    }
    try {
      searchWrapper.classList.add("top");
      showMessage(`<div class="loader"></div><p>جاري البحث...</p>`, {
        center: true,
      });
      resultsContainer.innerHTML = "";
      detailView.classList.add("hidden");

      const res = await fetch(`/api/search?name=${encodeURIComponent(q)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("network " + res.status);
      const data = await res.json();
      hideMessage();
      lastResults = data;
      renderResults(data);
    } catch (err) {
      console.error(err);
      showMessage(`<p class="error">❌ حدث خطأ في البحث</p>`, {
        autoHide: true,
        center: true,
      });
    }
  }

  function renderResults(list) {
    resultsContainer.innerHTML = "";
    if (!Array.isArray(list) || !list.length) {
      showMessage(`<p class="no-results">😢 لا توجد نتائج</p>`, {
        autoHide: true,
        center: true,
      });
      return;
    }
    list.forEach((it, idx) => {
      const card = document.createElement("div");
      card.className = "result-item";
      card.style.animationDelay = `${idx * 0.06}s`;
      card.innerHTML = `<img src="${it.image}" alt="${it.name}"><h3>${it.name}</h3>`;
      card.addEventListener("click", () => openDetail(it.id));
      resultsContainer.appendChild(card);
    });
  }

  async function openDetail(id) {
    try {
      showMessage(`<div class="loader"></div><p>جاري جلب المعلومات...</p>`, {
        center: true,
      });
      const res = await fetch(`/api/info?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("info fetch " + res.status);
      const info = await res.json();
      hideMessage();
      renderDetail(info);
    } catch (e) {
      console.error(e);
      showMessage(`<p class="error">❌ فشل في جلب معلومات الأنمي</p>`, {
        autoHide: true,
        center: true,
      });
    }
  }

  function renderDetail(info) {
    // build episodes array robustly
    let episodes = [];
    if (Array.isArray(info.ep) && info.ep.length) {
      const flat = info.ep.flat(2);
      flat.forEach((e, idx) => {
        if (!e) return;
        if (typeof e === "string" || typeof e === "number")
          episodes.push({ raw: String(e) });
        else if (typeof e === "object") {
          const epName =
            e.epName || e.episode || e.name
              ? String(e.epName || e.episode || e.name)
              : null;
          episodes.push({
            raw: epName ? epName : e.id ? String(e.id) : String(idx + 1),
            meta: e,
          });
        }
      });
    } else if (info.total && Number(info.total) > 0) {
      const tot = Number(info.total);
      for (let i = 1; i <= tot; i++) episodes.push({ raw: String(i) });
    } else {
      episodes.push({ raw: "1" });
    }

    const CHUNK = 100;
    let loaded = Math.min(CHUNK, episodes.length);

    detailView.innerHTML = `
      <div class="detail-wrap">
        <div class="detail-left">
          <div class="player-card">
            <div class="video-wrap">
              <video id="player" class="custom-video" poster="${info.cover || info.tag || info.background}" preload="metadata"></video>
              <div class="video-loader" id="videoLoader"><div class="spinner"></div></div>
            </div>
            <div class="controls">
              <button id="playBtn" class="ctrl-btn">▶</button>
              <div class="progress" id="progress"><div class="bar" id="bar"></div></div>
              <div class="small" id="timeLabel">00:00 / 00:00</div>
              <button id="fsBtn" class="ctrl-btn">⤢</button>
              <button id="muteBtn" class="ctrl-btn">🔊</button>
            </div>

            <div class="episodes">
              <div class="episodes-grid" id="episodesGrid"></div>
              <div style="display:flex;gap:8px;margin-top:8px;">
                <input id="jumpInput" type="number" placeholder="اذهب لحلقة #" style="padding:8px;border-radius:6px;background:#111;border:1px solid rgba(255,255,255,0.03);color:#fff;">
                <button id="jumpBtn" class="ctrl-btn">اذهب</button>
                <button id="loadMore" class="ctrl-btn">تحميل المزيد</button>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-right">
          <div class="info-card">
            <img class="cover" src="${info.cover || info.tag || info.background}" alt="${info.name}">
            <h2>${info.name}</h2>
            <p class="small"><strong>النوع:</strong> ${info.type || "غير معروف"}</p>
            <p class="small"><strong>التصنيف:</strong> ${(info.genre && info.genre.map((g) => g.name).join(", ")) || "غير متوفر"}</p>
            <p class="small"><strong>سنة الإصدار:</strong> ${info.anime_release || info.start_date || "غير معروف"}</p>
            <p style="margin-top:8px;"><strong>القصة:</strong><br>${info.story || "لا يوجد وصف"}</p>
            <button class="back-btn" id="backBtn">⬅ العودة للنتائج</button>
          </div>
        </div>
      </div>
    `;

    detailView.classList.remove("hidden");
    resultsContainer.innerHTML = "";

    // refs
    const player = document.getElementById("player");
    const loader = document.getElementById("videoLoader");
    const playBtn = document.getElementById("playBtn");
    const progress = document.getElementById("progress");
    const bar = document.getElementById("bar");
    const timeLabel = document.getElementById("timeLabel");
    const fsBtn = document.getElementById("fsBtn");
    const muteBtn = document.getElementById("muteBtn");
    const episodesGrid = document.getElementById("episodesGrid");
    const loadMore = document.getElementById("loadMore");
    const jumpInput = document.getElementById("jumpInput");
    const jumpBtn = document.getElementById("jumpBtn");
    const backBtn = document.getElementById("backBtn");

    function showVideoLoader() {
      loader.classList.remove("hidden");
    }
    function hideVideoLoader() {
      loader.classList.add("hidden");
    }

    function resolveStreamParams(epObj) {
      const raw = String(epObj.raw || "");
      if (epObj.meta && typeof epObj.meta === "object") {
        const mId = epObj.meta.id;
        if (mId && typeof mId === "string") {
          const m = mId.match(/^(\d+)EP[-_]?(\d+)$/i);
          if (m) return { animeId: m[1], ep: m[2] };
        }
        if (epObj.meta.epName)
          return { animeId: info.id, ep: String(epObj.meta.epName) };
      }
      const p = raw.match(/^(\d+)EP[-_]?(\d+)$/i);
      if (p) return { animeId: p[1], ep: p[2] };
      if (info.type && String(info.type).trim() === "فلم")
        return { animeId: info.id, ep: "1" };
      return { animeId: info.id, ep: raw };
    }

    function renderChunk(limit) {
      episodesGrid.innerHTML = "";
      for (let i = 0; i < limit; i++) {
        const el = document.createElement("div");
        el.className = "ep-item";
        el.textContent = episodes[i].raw;
        el.dataset.index = i;
        el.addEventListener("click", () => playIndex(i));
        episodesGrid.appendChild(el);
      }
      loadMore.style.display =
        limit < episodes.length ? "inline-block" : "none";
    }

    let currentIndex = 0;

    async function playIndex(idx) {
      if (idx < 0 || idx >= episodes.length) return;
      currentIndex = idx;
      const params = resolveStreamParams(episodes[idx]);
      const streamUrl = `/stream/${encodeURIComponent(params.animeId)}/${encodeURIComponent(params.ep)}`;
      try {
        showVideoLoader();
        player.pause();
        player.src = streamUrl;
        await player.load();
        player.play().catch(() => {});
        highlightActive();
      } catch (e) {
        console.error("play error", e);
        showMessage(`<p class="error">❌ فشل في تشغيل الحلقة</p>`, {
          autoHide: true,
          center: true,
        });
      }
    }

    function highlightActive() {
      Array.from(episodesGrid.children).forEach((c, idx) =>
        c.classList.toggle("active", idx === currentIndex),
      );
    }

    renderChunk(loaded);

    loadMore.addEventListener("click", () => {
      const prev = loaded;
      loaded = Math.min(episodes.length, loaded + CHUNK);
      for (let i = prev; i < loaded; i++) {
        const el = document.createElement("div");
        el.className = "ep-item";
        el.textContent = episodes[i].raw;
        el.dataset.index = i;
        el.addEventListener("click", () => playIndex(i));
        episodesGrid.appendChild(el);
      }
      loadMore.style.display =
        loaded < episodes.length ? "inline-block" : "none";
    });

    jumpBtn.addEventListener("click", () => {
      const v = Number(jumpInput.value);
      if (!isNaN(v) && v >= 1 && v <= episodes.length) {
        const idx = episodes.findIndex((e) => Number(e.raw) === v);
        const target = idx >= 0 ? idx : v - 1;
        if (target >= loaded) {
          while (loaded <= target)
            loaded = Math.min(episodes.length, loaded + CHUNK);
          renderChunk(loaded);
        }
        playIndex(target);
        const node = episodesGrid.children[target];
        if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    // video events
    player.addEventListener("waiting", showVideoLoader);
    player.addEventListener("loadstart", showVideoLoader);
    player.addEventListener("playing", hideVideoLoader);
    player.addEventListener("canplay", hideVideoLoader);
    player.addEventListener("canplaythrough", hideVideoLoader);
    player.addEventListener("loadedmetadata", hideVideoLoader);

    playBtn.addEventListener("click", () =>
      player.paused ? player.play() : player.pause(),
    );
    player.addEventListener("play", () => (playBtn.textContent = "⏸"));
    player.addEventListener("pause", () => (playBtn.textContent = "▶"));

    player.addEventListener("timeupdate", () => {
      const cur = player.currentTime || 0;
      const dur = player.duration || 0;
      const pct = dur ? (cur / dur) * 100 : 0;
      bar.style.width = pct + "%";
      timeLabel.textContent =
        formatTime(cur) + " / " + (dur ? formatTime(dur) : "--:--");
    });

    progress.addEventListener("click", (ev) => {
      const r = progress.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const pct = x / r.width;
      if (player.duration) player.currentTime = player.duration * pct;
    });

    let inactivityTimer = null;
    fsBtn.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          document.body.classList.add("in-fullscreen");
          clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(
            () => document.body.classList.add("fullscreen-hide-controls"),
            3000,
          );
        } else {
          await document.exitFullscreen();
          document.body.classList.remove(
            "in-fullscreen",
            "fullscreen-hide-controls",
          );
          clearTimeout(inactivityTimer);
        }
      } catch (e) {
        console.error("fs error", e);
      }
    });

    document.addEventListener("mousemove", () => {
      if (document.fullscreenElement) {
        document.body.classList.remove("fullscreen-hide-controls");
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(
          () => document.body.classList.add("fullscreen-hide-controls"),
          3000,
        );
      }
    });

    muteBtn.addEventListener("click", () => {
      player.muted = !player.muted;
      muteBtn.textContent = player.muted ? "🔇" : "🔊";
    });

    backBtn.addEventListener("click", () => {
      detailView.classList.add("hidden");
      if (Array.isArray(lastResults) && lastResults.length)
        renderResults(lastResults);
      else resultsContainer.innerHTML = "";
    });

    function formatTime(s) {
      if (!s || isNaN(s)) return "00:00";
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }

    playIndex(0);
  }

  window.openDetail = (id) => openDetail(id);
});
