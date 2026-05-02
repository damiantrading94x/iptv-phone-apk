/* ══════════════════════════════════════════════════════════════
   IPTV Phone App — Samsung S24 Ultra
   Direct connection to IPTV server (no proxy needed).
   Touch-optimized mobile UI.
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const SERVER   = "http://vpn.mojatv.online";
  const USERNAME = "b0e44e84c3";
  const PASSWORD = "8ffb557f0f2b";

  // ── DOM ───────────────────────────────────────────────────
  const loader      = document.getElementById("loader");
  const chPanel     = document.getElementById("chPanel");
  const catBar      = document.getElementById("catBar");
  const npLabel     = document.getElementById("npLabel");
  const searchInput = document.getElementById("searchInput");
  const searchBtn   = document.getElementById("searchBtn");
  const searchOverlay = document.getElementById("searchOverlay");
  const searchClose = document.getElementById("searchClose");
  const tabBtns     = document.querySelectorAll(".tab-btn");
  const toastEl     = document.getElementById("toast");

  // ── State ─────────────────────────────────────────────────
  let section = "recent";
  let channels = [];
  let allChannelsCache = {};
  let searchTimer = null;
  let isFullscreen = false;
  let longPressTimer = null;

  // ── Recent channels ───────────────────────────────────────
  const RECENT_KEY = "iptv_recent";
  const MAX_RECENT = 20;

  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
    catch { return []; }
  }

  function addRecent(ch) {
    let list = getRecent();
    const id = ch.stream_id || ch.series_id;
    list = list.filter(c => (c.stream_id || c.series_id) !== id);
    list.unshift(ch);
    if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }

  // ── Favorites ─────────────────────────────────────────────
  const FAVS_KEY = "iptv_favorites";

  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAVS_KEY)) || []; }
    catch { return []; }
  }

  function addFavorite(ch) {
    let list = getFavorites();
    const id = ch.stream_id || ch.series_id;
    if (list.some(c => (c.stream_id || c.series_id) === id)) return;
    list.push({ name: ch.name, title: ch.title, stream_id: ch.stream_id,
      series_id: ch.series_id, container_extension: ch.container_extension,
      _section: ch._section || section });
    localStorage.setItem(FAVS_KEY, JSON.stringify(list));
  }

  function removeFavorite(ch) {
    let list = getFavorites();
    const id = ch.stream_id || ch.series_id;
    list = list.filter(c => (c.stream_id || c.series_id) !== id);
    localStorage.setItem(FAVS_KEY, JSON.stringify(list));
  }

  function isFavorite(ch) {
    const id = ch.stream_id || ch.series_id;
    return getFavorites().some(c => (c.stream_id || c.series_id) === id);
  }

  // ── Helpers ───────────────────────────────────────────────
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2000);
  }

  // ── Fullscreen ────────────────────────────────────────────
  function enterFullscreen() {
    isFullscreen = true;
    document.body.classList.add("fs");
    if (typeof NativePlayer !== "undefined") NativePlayer.show();
  }
  function exitFullscreen() {
    isFullscreen = false;
    document.body.classList.remove("fs");
    if (typeof NativePlayer !== "undefined") NativePlayer.hide();
  }

  // ── API (direct to IPTV server) ───────────────────────────
  async function api(action, extra) {
    let url = `${SERVER}/player_api.php?username=${USERNAME}&password=${PASSWORD}&action=${action}`;
    if (extra) url += extra;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return resp.json();
  }

  function streamUrl(type, id, ext) {
    return `${SERVER}/${type}/${USERNAME}/${PASSWORD}/${id}.${ext}`;
  }

  // ── Channel item ──────────────────────────────────────────
  function makeChannelItem(ch) {
    const name = ch.name || ch.title || "Unknown";
    const fav = isFavorite(ch);
    const div = document.createElement("div");
    div.className = "ch-item";
    div._channel = ch;
    div.innerHTML = `<span class="ch-fav">${fav ? "★" : ""}</span><span class="ch-name">${name}</span>`;

    // Tap to play
    div.addEventListener("click", () => {
      chPanel.querySelectorAll(".active").forEach(b => b.classList.remove("active"));
      div.classList.add("active");
      playChannel(ch);
    });

    // Long-press to toggle favorite
    let lpTimer = null;
    let lpFired = false;
    div.addEventListener("touchstart", (e) => {
      lpFired = false;
      lpTimer = setTimeout(() => {
        lpFired = true;
        if (isFavorite(ch)) {
          removeFavorite(ch);
          toast("☆ Removed from favorites");
        } else {
          addFavorite(ch);
          toast("★ Added to favorites");
        }
        // Refresh if on favs/recent tab
        if (section === "favs") loadFavorites();
        else if (section === "recent") loadRecent();
        else {
          const favSpan = div.querySelector(".ch-fav");
          favSpan.textContent = isFavorite(ch) ? "★" : "";
        }
      }, 600);
    }, { passive: true });
    div.addEventListener("touchend", () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      if (lpFired) { lpFired = false; }
    });
    div.addEventListener("touchmove", () => {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    });

    return div;
  }

  // ── Load sections ─────────────────────────────────────────
  function loadRecent() {
    catBar.classList.remove("visible");
    catBar.innerHTML = "";
    chPanel.innerHTML = "";
    const recent = getRecent();
    channels = recent;
    if (!recent.length) {
      chPanel.innerHTML = '<div class="empty-state"><div class="empty-icon">📺</div><div class="empty-text">No recent channels yet<br>Play something to see it here</div></div>';
      return;
    }
    recent.forEach(ch => chPanel.appendChild(makeChannelItem(ch)));
  }

  function loadFavorites() {
    catBar.classList.remove("visible");
    catBar.innerHTML = "";
    chPanel.innerHTML = "";
    const favs = getFavorites();
    channels = favs;
    if (!favs.length) {
      chPanel.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><div class="empty-text">No favorites yet<br>Long-press a channel to add</div></div>';
      return;
    }
    favs.forEach(ch => chPanel.appendChild(makeChannelItem(ch)));
  }

  // ── Categories ────────────────────────────────────────────
  async function loadCategories() {
    show(loader);
    catBar.innerHTML = "";
    chPanel.innerHTML = "";
    channels = [];

    const actions = { live: "get_live_categories", vod: "get_vod_categories", series: "get_series_categories" };
    try {
      const cats = await api(actions[section]);
      hide(loader);
      if (!cats || !cats.length) return;

      catBar.classList.add("visible");
      cats.forEach(cat => {
        const chip = document.createElement("button");
        chip.className = "cat-chip";
        chip.textContent = cat.category_name || "Unknown";
        chip.addEventListener("click", () => {
          catBar.querySelectorAll(".active").forEach(b => b.classList.remove("active"));
          chip.classList.add("active");
          loadChannels(cat.category_id);
        });
        catBar.appendChild(chip);
      });

      // Auto-select first
      catBar.firstChild.classList.add("active");
      loadChannels(cats[0].category_id);
    } catch (e) {
      hide(loader);
      npLabel.textContent = "⚠ Failed to load categories";
      console.error(e);
    }
  }

  // ── Channels ──────────────────────────────────────────────
  async function loadChannels(catId) {
    show(loader);
    chPanel.innerHTML = "";
    const actions = { live: "get_live_streams", vod: "get_vod_streams", series: "get_series" };
    try {
      channels = await api(actions[section], `&category_id=${catId}`);
      hide(loader);
      renderChannels(channels);
    } catch (e) {
      hide(loader);
      npLabel.textContent = "⚠ Failed to load channels";
      console.error(e);
    }
  }

  function renderChannels(list) {
    chPanel.innerHTML = "";
    if (!list || !list.length) return;
    list.forEach(ch => chPanel.appendChild(makeChannelItem(ch)));
  }

  // ── Play ──────────────────────────────────────────────────
  let currentName = "";
  let qualityKickTimer = null;
  let needsQualityKick = false;
  let currentPlayUrl = "";

  function playChannel(ch) {
    const name = ch.name || ch.title || "Unknown";
    const id = ch.stream_id || ch.series_id;
    const ext = ch.container_extension || "ts";

    if (section === "series" && ch.series_id && !ch._ep) {
      loadEpisodes(ch);
      return;
    }

    addRecent({ name: ch.name, title: ch.title, stream_id: ch.stream_id,
      series_id: ch.series_id, container_extension: ch.container_extension,
      _section: ch._section || section });

    const playSection = ch._section || section;
    let url;
    if (playSection === "live" || playSection === "recent" || playSection === "favs") {
      url = streamUrl("live", id, "m3u8");
    } else if (playSection === "vod") {
      url = streamUrl("movie", id, ext);
    } else {
      url = streamUrl("series", id, ext);
    }
    playURL(url, name);
  }

  // Native player callbacks
  window._onNativePlaying = () => {
    npLabel.textContent = "▶ " + currentName;
    enterFullscreen();
    if (needsQualityKick) {
      needsQualityKick = false;
      clearTimeout(qualityKickTimer);
      if (typeof NativePlayer !== "undefined" && currentPlayUrl) {
        NativePlayer.stop();
        setTimeout(() => { NativePlayer.play(currentPlayUrl); }, 500);
      }
    }
  };
  window._onNativeError = (what, extra) => {
    npLabel.textContent = `⚠ Playback error (${what})`;
  };
  window._onNativeBuffering = (isBuffering) => {
    npLabel.textContent = isBuffering ? `⏳ Buffering — ${currentName}` : "▶ " + currentName;
  };
  window._onNativeReconnecting = () => {
    npLabel.textContent = `🔄 Reconnecting — ${currentName}`;
  };
  window._onNativeBack = () => {
    exitFullscreen();
  };

  function playURL(url, name) {
    currentName = name;
    currentPlayUrl = url;
    needsQualityKick = true;
    npLabel.textContent = "⏳ Loading " + name + "…";
    clearTimeout(qualityKickTimer);

    if (typeof NativePlayer !== "undefined") {
      NativePlayer.stop();
      NativePlayer.play(url);
      qualityKickTimer = setTimeout(() => {
        if (needsQualityKick) {
          needsQualityKick = false;
          NativePlayer.stop();
          setTimeout(() => { NativePlayer.play(url); }, 500);
        }
      }, 8000);
    }
  }

  // ── Series episodes ───────────────────────────────────────
  async function loadEpisodes(series) {
    show(loader);
    try {
      const info = await api("get_series_info", `&series_id=${series.series_id}`);
      hide(loader);
      if (!info || !info.episodes) return;
      chPanel.innerHTML = "";
      channels = [];
      const seasons = Object.keys(info.episodes).sort((a, b) => +a - +b);
      seasons.forEach(sn => {
        const hdr = document.createElement("div");
        hdr.className = "section-header";
        hdr.textContent = `Season ${sn}`;
        chPanel.appendChild(hdr);
        info.episodes[sn].forEach(ep => {
          const title = ep.title || `Episode ${ep.episode_num || "?"}`;
          const display = `S${sn}E${ep.episode_num || "?"} — ${title}`;
          const obj = { name: display, stream_id: ep.id, container_extension: ep.container_extension || "mp4", _ep: true };
          channels.push(obj);
          chPanel.appendChild(makeChannelItem(obj));
        });
      });
    } catch (e) {
      hide(loader);
      console.error(e);
    }
  }

  // ── Search ────────────────────────────────────────────────
  searchBtn.addEventListener("click", () => {
    searchOverlay.classList.add("open");
    searchInput.focus();
  });
  searchClose.addEventListener("click", () => {
    searchOverlay.classList.remove("open");
    searchInput.value = "";
    searchInput.blur();
    // Restore current tab
    if (section === "recent") loadRecent();
    else if (section === "favs") loadFavorites();
    else loadCategories();
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 400);
  });

  async function doSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q || q.length < 2) return;

    const words = q.split(/\s+/);
    show(loader);
    try {
      let all = allChannelsCache["live"];
      if (!all) {
        all = await api("get_live_streams");
        if (Array.isArray(all)) allChannelsCache["live"] = all;
      }
      hide(loader);
      if (Array.isArray(all)) {
        const results = all.filter(ch => {
          const name = (ch.name || ch.title || "").toLowerCase();
          return words.every(w => name.includes(w));
        });

        // Switch to live tab
        section = "live";
        tabBtns.forEach(b => b.classList.remove("active"));
        const liveBtn = document.querySelector('.tab-btn[data-section="live"]');
        if (liveBtn) liveBtn.classList.add("active");

        catBar.classList.remove("visible");
        const total = results.length;
        const capped = results.slice(0, 50);
        channels = capped;
        renderChannels(capped);
        npLabel.textContent = total
          ? `${total} result(s) for "${searchInput.value.trim()}"` + (total > 50 ? " (first 50)" : "")
          : `No results for "${searchInput.value.trim()}"`;
      }
    } catch (e) {
      hide(loader);
      console.error(e);
    }
  }

  // ── Tab navigation ────────────────────────────────────────
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.section === section) return;
      section = btn.dataset.section;
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      // Close search if open
      searchOverlay.classList.remove("open");
      searchInput.value = "";
      if (section === "recent") loadRecent();
      else if (section === "favs") loadFavorites();
      else loadCategories();
    });
  });

  // ── Tap fullscreen video to exit ──────────────────────────
  document.addEventListener("click", (e) => {
    if (isFullscreen) {
      exitFullscreen();
    }
  });

  // ── Init ──────────────────────────────────────────────────
  loadRecent();
})();
