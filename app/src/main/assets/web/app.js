/* ══════════════════════════════════════════════════════════════
   IPTV Phone App — Samsung S24 Ultra
   Direct connection to IPTV server (no proxy needed).
   Touch-optimized mobile UI.
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  let SERVER   = localStorage.getItem("iptv_server") || "";
  let USERNAME = localStorage.getItem("iptv_user") || "";
  let PASSWORD = localStorage.getItem("iptv_pass") || "";

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
  
  const setupScreen = document.getElementById("setupScreen");
  const setupServer = document.getElementById("setupServer");
  const setupUser   = document.getElementById("setupUser");
  const setupPass   = document.getElementById("setupPass");
  const setupConnect= document.getElementById("setupConnect");
  const setupError  = document.getElementById("setupError");
  const settingsBtn = document.getElementById("settingsBtn");

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

  // ── Video overlay ──────────────────────────────────────────
  const videoOverlay = document.getElementById("videoOverlay");
  const voSpinner    = document.getElementById("voSpinner");
  const voIcon       = document.getElementById("voIcon");
  const voText       = document.getElementById("voText");
  const voSubtext    = document.getElementById("voSubtext");
  let voHideTimer    = null;
  let reconnectCount = 0;

  function showVideoOverlay(opts) {
    clearTimeout(voHideTimer);
    if (opts.spinner) { voSpinner.style.display = "block"; voIcon.style.display = "none"; }
    else if (opts.icon) { voSpinner.style.display = "none"; voIcon.style.display = "block"; voIcon.textContent = opts.icon; }
    else { voSpinner.style.display = "none"; voIcon.style.display = "none"; }
    voText.innerHTML = opts.text || "";
    voSubtext.innerHTML = opts.subtext || "";
    videoOverlay.classList.add("active");
    if (opts.autohide) {
      voHideTimer = setTimeout(() => hideVideoOverlay(), opts.autohide);
    }
  }

  function hideVideoOverlay() {
    clearTimeout(voHideTimer);
    videoOverlay.classList.remove("active");
  }

  // Native player callbacks
  window._onNativePlaying = () => {
    reconnectCount = 0;
    hideVideoOverlay();
    npLabel.textContent = "▶ " + currentName;
    enterFullscreen();
  };
  window._onNativeError = (what, extra) => {
    npLabel.textContent = `⚠ Playback error (${what})`;
    showVideoOverlay({
      icon: "⚠️",
      text: "Playback Error",
      subtext: `Could not play this stream (code ${what})`,
      autohide: 5000
    });
  };
  window._onNativeBuffering = (isBuffering) => {
    if (isBuffering) {
      npLabel.textContent = `⏳ Buffering — ${currentName}`;
      showVideoOverlay({
        spinner: true,
        text: `Buffering<span class="vo-dots"></span>`,
        subtext: currentName
      });
    } else {
      hideVideoOverlay();
      npLabel.textContent = "▶ " + currentName;
    }
  };
  window._onNativeReconnecting = () => {
    reconnectCount++;
    npLabel.textContent = `🔄 Reconnecting — ${currentName}`;
    const messages = [
      "Stream interrupted, reconnecting",
      "Still trying to reconnect",
      "Connection unstable, retrying",
      "Hang tight, almost there"
    ];
    const msg = messages[Math.min(reconnectCount - 1, messages.length - 1)];
    showVideoOverlay({
      spinner: true,
      text: `${msg}<span class="vo-dots"></span>`,
      subtext: `Attempt ${reconnectCount} · ${currentName}`
    });
  };
  window._onNativeBack = () => {
    hideVideoOverlay();
    reconnectCount = 0;
    exitFullscreen();
  };

  function playURL(url, name) {
    currentName = name;
    currentPlayUrl = url;
    reconnectCount = 0;
    npLabel.textContent = "⏳ Loading " + name + "…";
    showVideoOverlay({
      spinner: true,
      text: `Loading<span class="vo-dots"></span>`,
      subtext: name
    });

    if (typeof NativePlayer !== "undefined") {
      NativePlayer.stop();
      NativePlayer.play(url);
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
      let targetAction = "get_live_streams";
      let cacheKey = "live";

      if (section === "vod") {
        targetAction = "get_vod_streams";
        cacheKey = "vod";
      } else if (section === "series") {
        targetAction = "get_series";
        cacheKey = "series";
      }

      let all = allChannelsCache[cacheKey];
      if (!all) {
        all = await api(targetAction);
        if (Array.isArray(all)) allChannelsCache[cacheKey] = all;
      }
      hide(loader);
      if (Array.isArray(all)) {
        const results = all.filter(ch => {
          const name = (ch.name || ch.title || "").toLowerCase();
          return words.every(w => name.includes(w));
        });

        if (section === "recent" || section === "favs") {
          // Switch to live tab
          section = "live";
          tabBtns.forEach(b => b.classList.remove("active"));
          const liveBtn = document.querySelector('.tab-btn[data-section="live"]');
          if (liveBtn) liveBtn.classList.add("active");
        }

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
      
      const tvGuidePanel = document.getElementById("tvGuidePanel");
      if (section === "tvguide") {
        catBar.classList.remove("visible");
        chPanel.style.display = "none";
        tvGuidePanel.style.display = "block";
        loadTVGuide();
      } else {
        tvGuidePanel.style.display = "none";
        chPanel.style.display = "block";
        if (section === "recent") loadRecent();
        else if (section === "favs") loadFavorites();
        else loadCategories();
      }
    });
  });

  // ── TV Guide ──────────────────────────────────────────────
  const LSTV_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  };
  const TARGET_COUNTRIES = ["Poland", "Great Britain", "USA"];
  const COUNTRY_FLAGS = {"Poland": "🇵🇱", "Great Britain": "🇬🇧", "USA": "🇺🇸"};
  const COUNTRY_LABELS = {"Poland": "Poland", "Great Britain": "UK", "USA": "USA"};
  let tvgSearchTimer = null;

  async function loadTVGuide() {
    const tvGuidePanel = document.getElementById("tvGuidePanel");
    tvGuidePanel.innerHTML = `
      <div style="display:flex; margin-bottom:16px;">
        <input type="text" id="tvgSearch" placeholder="Search team or match..." 
               style="flex:1; padding:12px; border-radius:10px; border:1px solid #333; background:var(--bg3); color:var(--fg); font-size:16px; outline:none;" />
      </div>
      <div id="tvgContent"></div>
    `;
    
    const tvgSearch = document.getElementById("tvgSearch");
    tvgSearch.addEventListener("input", () => {
      clearTimeout(tvgSearchTimer);
      tvgSearchTimer = setTimeout(() => {
        const q = tvgSearch.value.trim();
        if (q.length > 1) fetchTVGSearch(q);
        else loadTodayMatches();
      }, 500);
    });

    loadTodayMatches();
  }

  function tvgShowLoading(text = "Loading...") {
    document.getElementById("tvgContent").innerHTML = `<div style="text-align:center; padding:40px; color:var(--fg-dim);">${text}</div>`;
  }

  function tvgShowEmpty(msg) {
    document.getElementById("tvgContent").innerHTML = `
      <div style="text-align:center; padding:40px;">
        <div style="font-size:48px; margin-bottom:10px;">⚽</div>
        <div style="color:var(--fg-dim);">${msg}</div>
      </div>
    `;
  }

  async function loadTodayMatches() {
    tvgShowLoading("Loading today's matches...");
    try {
      const res = await fetch("https://www.livesoccertv.com/schedules/", { headers: LSTV_HEADERS });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const matches = [];
      const seen = new Set();
      
      doc.querySelectorAll("a").forEach(a => {
        const href = a.getAttribute("href") || "";
        if (!href.includes("/match/") || !href.includes("#")) return;
        const matchId = href.split("#")[1];
        const text = a.textContent.trim();
        if (!text || seen.has(matchId)) return;
        seen.add(matchId);
        if (text.includes(" vs ") || text.includes(" - ")) {
          matches.push({ id: matchId, title: text, url: href });
        }
      });

      renderTodayMatches(matches.slice(0, 15));
    } catch (e) {
      console.error(e);
      tvgShowEmpty("Failed to load today's matches.");
    }
  }

  function renderTodayMatches(matches) {
    const cont = document.getElementById("tvgContent");
    if (!matches.length) {
      tvgShowEmpty("No top matches found for today.");
      return;
    }
    cont.innerHTML = `<div style="font-size:16px; font-weight:bold; margin-bottom:12px;">🔥 Today's Top Matches</div>`;
    matches.forEach(m => {
      const btn = document.createElement("div");
      btn.style.cssText = "background:var(--bg3); padding:16px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;";
      btn.innerHTML = `<div style="font-weight:bold;">🏟️ ${m.title}</div><div style="font-size:12px; color:var(--accent);">Channels ➔</div>`;
      btn.addEventListener("click", () => loadBroadcast(m.id, m.title, "", "Today's Matches"));
      cont.appendChild(btn);
    });
  }

  async function fetchTVGSearch(query) {
    tvgShowLoading("Searching...");
    try {
      const res = await fetch(`https://cdnapi.livesoccertv.com/autocomplete.php?q=${encodeURIComponent(query)}&iso=gb`, { headers: LSTV_HEADERS });
      const data = await res.json();
      const doc = new DOMParser().parseFromString(data.html || "", "text/html");
      const results = [];
      doc.querySelectorAll("div.hints").forEach(hint => {
        const a = hint.querySelector("a");
        if (!a) return;
        const href = a.getAttribute("href") || "";
        const actualUrl = href.includes("url=") ? decodeURIComponent(href.split("url=")[1]) : href;
        const descEl = a.querySelector("div.sdesc");
        const iconEl = a.querySelector("div.flaticon");
        const fullText = a.textContent.trim();
        const desc = descEl ? descEl.textContent.trim() : "";
        const itemType = iconEl ? (iconEl.getAttribute("title") || "") : "";
        const name = fullText.replace(desc, "").trim();
        if (itemType.toLowerCase().includes("team")) {
          results.push({ name, url: actualUrl, desc });
        }
      });
      renderTVGSearch(results, query);
    } catch (e) {
      console.error(e);
      tvgShowEmpty("Search failed. Please try again.");
    }
  }

  function renderTVGSearch(results, query) {
    const cont = document.getElementById("tvgContent");
    if (!results.length) {
      tvgShowEmpty(`No results found for '${query}'`);
      return;
    }
    cont.innerHTML = `<div style="font-size:16px; font-weight:bold; margin-bottom:12px;">Results for '${query}'</div>`;
    results.forEach(r => {
      const btn = document.createElement("div");
      btn.style.cssText = "background:var(--bg3); padding:16px; border-radius:10px; margin-bottom:8px; display:flex; align-items:center;";
      btn.innerHTML = `<div style="font-size:24px; margin-right:12px;">⚽</div><div><div style="font-weight:bold; font-size:16px;">${r.name}</div><div style="font-size:12px; color:var(--fg-dim);">${r.desc || "Team"}</div></div>`;
      btn.addEventListener("click", () => loadFixtures(r.url, r.name));
      cont.appendChild(btn);
    });
  }

  async function loadFixtures(teamUrl, teamName) {
    tvgShowLoading(`Loading fixtures for ${teamName}...`);
    try {
      const res = await fetch(`https://www.livesoccertv.com${teamUrl}`, { headers: LSTV_HEADERS });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const fixtures = [];
      const seen = new Set();
      doc.querySelectorAll("a").forEach(a => {
        const href = a.getAttribute("href") || "";
        if (!href.includes("/match/") || !href.includes("#")) return;
        const matchId = href.split("#")[1];
        const text = a.textContent.trim();
        if (!text || seen.has(matchId)) return;
        seen.add(matchId);
        if (text.includes(" vs ") || text.includes(" - ")) {
          fixtures.push({ id: matchId, title: text });
        }
      });
      renderFixtures(fixtures, teamUrl, teamName);
    } catch (e) {
      console.error(e);
      tvgShowEmpty("Failed to load fixtures.");
    }
  }

  function renderFixtures(fixtures, teamUrl, teamName) {
    const cont = document.getElementById("tvgContent");
    cont.innerHTML = `
      <div style="color:var(--accent); font-weight:bold; margin-bottom:12px; padding:8px 0;" onclick="document.getElementById('tvgSearch').dispatchEvent(new Event('input'))">← Back to search</div>
      <div style="font-size:16px; font-weight:bold; margin-bottom:12px;">⚽ ${teamName} Fixtures</div>
    `;
    if (!fixtures.length) {
      cont.innerHTML += `<div style="color:var(--fg-dim);">No upcoming fixtures found.</div>`;
      return;
    }
    fixtures.forEach(f => {
      const btn = document.createElement("div");
      btn.style.cssText = "background:var(--bg3); padding:16px; border-radius:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;";
      btn.innerHTML = `<div style="font-weight:bold;">🏟️ ${f.title}</div><div style="font-size:12px; color:var(--accent);">Channels ➔</div>`;
      btn.addEventListener("click", () => loadBroadcast(f.id, f.title, teamUrl, teamName));
      cont.appendChild(btn);
    });
  }

  async function loadBroadcast(matchId, matchTitle, teamUrl, teamName) {
    tvgShowLoading("Loading TV channels...");
    try {
      const res = await fetch(`https://www.livesoccertv.com/match/${matchId}/`, { headers: LSTV_HEADERS });
      if (!res.ok) throw new Error("Match not found");
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const table = doc.querySelector("table.ichannels");
      const broadcasts = {};
      
      if (table) {
        table.querySelectorAll("tr").forEach(tr => {
          const tds = tr.querySelectorAll("td");
          if (tds.length < 2) return;
          const country = tds[0].textContent.trim();
          if (!TARGET_COUNTRIES.includes(country)) return;
          
          const channels = [];
          tds[1].querySelectorAll("a").forEach(a => {
            const name = a.textContent.trim();
            const cls = a.className || "";
            channels.push({ name, stream: cls.includes("ministream") });
          });
          broadcasts[country] = channels;
        });
      }
      renderBroadcast(broadcasts, matchTitle, teamUrl, teamName);
    } catch (e) {
      console.error(e);
      tvgShowEmpty("Failed to load TV channels.");
    }
  }

  function renderBroadcast(broadcasts, matchTitle, teamUrl, teamName) {
    const cont = document.getElementById("tvgContent");
    cont.innerHTML = `
      <div id="tvgBackBtn" style="color:var(--accent); font-weight:bold; margin-bottom:12px; padding:8px 0;">← Back</div>
      <div style="font-size:16px; font-weight:bold; margin-bottom:16px;">📺 ${matchTitle}</div>
    `;
    
    document.getElementById("tvgBackBtn").addEventListener("click", () => {
      if (teamUrl === "") loadTodayMatches();
      else loadFixtures(teamUrl, teamName);
    });

    if (Object.keys(broadcasts).length === 0) {
      cont.innerHTML += `<div style="color:var(--fg-dim);">No broadcast info available for Poland, UK, or USA.</div>`;
      return;
    }

    TARGET_COUNTRIES.forEach(country => {
      const channels = broadcasts[country] || [];
      const flag = COUNTRY_FLAGS[country] || "";
      const label = COUNTRY_LABELS[country] || country;
      
      const card = document.createElement("div");
      card.style.cssText = "background:var(--bg3); border-radius:10px; margin-bottom:12px; padding:16px;";
      card.innerHTML = `<div style="font-weight:bold; font-size:14px; margin-bottom:12px;">${flag} ${label.toUpperCase()}</div>`;
      
      if (!channels.length) {
        card.innerHTML += `<div style="color:var(--fg-dim); font-size:12px; font-style:italic;">No channels listed</div>`;
      } else {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";
        channels.forEach(ch => {
          const icon = ch.stream ? "🌐" : "📺";
          const color = ch.stream ? "var(--accent)" : "var(--fg)";
          const tag = document.createElement("div");
          tag.style.cssText = `background:#2a2a2a; padding:6px 10px; border-radius:6px; font-size:13px; font-weight:bold; color:${color};`;
          tag.textContent = `${icon} ${ch.name}`;
          
          tag.addEventListener("click", () => {
             // trigger app search for the channel name!
             tabBtns.forEach(b => b.classList.remove("active"));
             const liveBtn = document.querySelector('.tab-btn[data-section="live"]');
             if (liveBtn) liveBtn.classList.add("active");
             section = "live";
             document.getElementById("tvGuidePanel").style.display = "none";
             chPanel.style.display = "block";
             
             searchOverlay.classList.add("open");
             searchInput.value = ch.name;
             searchInput.focus();
             doSearch();
          });
          
          wrap.appendChild(tag);
        });
        card.appendChild(wrap);
      }
      cont.appendChild(card);
    });
  }

  // ── Native player handles double-tap to exit ────────────────

  // ── Setup / Login ─────────────────────────────────────────
  settingsBtn.addEventListener("click", () => {
    setupServer.value = SERVER;
    setupUser.value = USERNAME;
    setupPass.value = PASSWORD;
    setupError.textContent = "";
    setupScreen.classList.remove("hidden");
  });

  setupConnect.addEventListener("click", async () => {
    const s = setupServer.value.trim().replace(/\/$/, "");
    const u = setupUser.value.trim();
    const p = setupPass.value.trim();

    if (!s || !u || !p) {
      setupError.textContent = "Please fill in all fields.";
      return;
    }

    setupConnect.textContent = "Connecting...";
    setupConnect.disabled = true;
    setupError.textContent = "";

    try {
      const url = `${s}/player_api.php?username=${u}&password=${p}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await resp.json();

      if (data && data.user_info && data.user_info.auth === 1) {
        SERVER = s;
        USERNAME = u;
        PASSWORD = p;
        localStorage.setItem("iptv_server", s);
        localStorage.setItem("iptv_user", u);
        localStorage.setItem("iptv_pass", p);
        
        setupScreen.classList.add("hidden");
        allChannelsCache = {};
        if (section === "recent") loadRecent();
        else if (section === "favs") loadFavorites();
        else loadCategories();
      } else {
        setupError.textContent = "Invalid username or password.";
      }
    } catch (e) {
      setupError.textContent = "Failed to connect to server.";
    } finally {
      setupConnect.textContent = "Connect";
      setupConnect.disabled = false;
    }
  });

  function checkSetup() {
    if (!SERVER || !USERNAME || !PASSWORD) {
      setupScreen.classList.remove("hidden");
      return false;
    }
    setupScreen.classList.add("hidden");
    return true;
  }

  // ── Init ──────────────────────────────────────────────────
  if (checkSetup()) {
    loadRecent();
  }
})();
