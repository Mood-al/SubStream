// SubStream — Content Script
// Works on any streaming platform
(function () {
  'use strict';

  let subtitleData   = [];
  let offsetMs       = 0;
  let isActive       = false;   // false until a subtitle is actually loaded
  let autoAdvance    = false;   // advance to next folder file on video end
  let fontReady      = false;
  let animFrameId    = null;
  let currentCueIdx  = -1;
  let lastVideoSrc   = null;    // track video src changes for auto-advance

  // ── Font ──────────────────────────────────────────────────────────────────
  // Cairo: wide, clean, purpose-built for Arabic on screens
  const FONT_URL = 'https://fonts.googleapis.com/css2?family=Cairo:wght@600;700&display=swap';
  const FONT_FAMILY = '"Cairo","Inter","Noto Sans","Noto Naskh Arabic","Amiri","Traditional Arabic",sans-serif';

  function injectFont() {
    if (document.getElementById('substream-font')) return;
    const link = document.createElement('link');
    link.id = 'substream-font';
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    (document.head || document.documentElement).appendChild(link);
  }

  // Wait for Cairo to actually be usable before rendering
  async function waitForFont() {
    injectFont();
    try {
      await document.fonts.load('700 20px Cairo');
      fontReady = true;
    } catch (_) {
      fontReady = true; // proceed even if font API fails
    }
  }

  // ── Overlay styles ────────────────────────────────────────────────────────
  const FONT_FAMILY_CSS = FONT_FAMILY;

  function overlayCSS(isFS) {
    return [
      `position:${isFS ? 'absolute' : 'fixed'}`,
      'bottom:7%',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'pointer-events:none',
      'width:92%',
      'max-width:1000px',
      'text-align:center',
      'display:block',
    ].join(';');
  }

  const TEXT_CSS = [
    'display:inline-block',
    `font-family:${FONT_FAMILY_CSS}`,
    'font-size:30px',
    'font-weight:700',
    'line-height:1.75',
    'color:#ffffff',
    'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 2px 10px rgba(0,0,0,0.95)',
    'direction:auto',
    'unicode-bidi:plaintext',
    'background:rgba(0,0,0,0.48)',
    'padding:4px 22px 8px',
    'border-radius:6px',
    'opacity:0',
    'transition:opacity 0.1s ease',
    'white-space:pre-wrap',
    'max-width:100%',
    'letter-spacing:0.02em',
    'word-spacing:0.05em',
  ].join(';');

  // ── Fullscreen helpers ────────────────────────────────────────────────────
  function fsRoot() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  // ── Deep video discovery (shadow DOM, nested iframes) ─────────────────────
  // Disney+, BBC iPlayer, and others hide <video> inside open shadow roots.
  let cachedVideo = null;

  function collectVideos(root, out, seenRoots) {
    if (!root || seenRoots.has(root)) return;
    seenRoots.add(root);

    try {
      root.querySelectorAll('video').forEach(v => out.push(v));
    } catch (_) {}

    let elements = [];
    try {
      elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    } catch (_) {
      return;
    }

    for (const el of elements) {
      if (el.shadowRoot) collectVideos(el.shadowRoot, out, seenRoots);
      if (el.tagName === 'IFRAME') {
        try {
          const doc = el.contentDocument;
          if (doc) collectVideos(doc, out, seenRoots);
        } catch (_) {}
      }
    }
  }

  function scoreVideo(v) {
    if (!v?.isConnected) return -1;
    const rect = v.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < 100) return -1;

    let score = area;
    if (!v.paused) score += 1e6;
    if (v.readyState >= 2) score += 1e5;
    if (v.currentTime > 0) score += 1e4;
    return score;
  }

  function pickBestVideo(videos) {
    let best = null;
    let bestScore = -1;
    for (const v of videos) {
      const s = scoreVideo(v);
      if (s > bestScore) { bestScore = s; best = v; }
    }
    return best;
  }

  function findAllVideos() {
    const videos = [];
    collectVideos(document, videos, new WeakSet());
    return videos;
  }

  function getVideo() {
    if (cachedVideo?.isConnected && scoreVideo(cachedVideo) >= 0) {
      return cachedVideo;
    }

    // Fast path for Disney+
    const disneyHost = document.querySelector('disney-web-player');
    const disneyVideo = disneyHost?.shadowRoot?.querySelector('video');
    if (disneyVideo?.isConnected) {
      cachedVideo = disneyVideo;
      return cachedVideo;
    }

    cachedVideo = pickBestVideo(findAllVideos());
    return cachedVideo;
  }

  function getMountRoot() {
    const video = getVideo();
    const fs = fsRoot();

    if (fs) {
      if (video && (fs.contains(video) || nodeInTree(fs, video))) return fs;
      return fs;
    }

    if (video) {
      const root = video.getRootNode?.();
      if (root instanceof ShadowRoot) return root;
    }

    return document.body;
  }

  function nodeInTree(root, node) {
    if (!root || !node) return false;
    if (root === node) return true;
    if (root.contains?.(node)) return true;

    let elements = [];
    try {
      elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
    } catch (_) {
      return false;
    }

    for (const el of elements) {
      if (el.shadowRoot && nodeInTree(el.shadowRoot, node)) return true;
      if (el.tagName === 'IFRAME') {
        try {
          const doc = el.contentDocument;
          if (doc && nodeInTree(doc, node)) return true;
        } catch (_) {}
      }
    }
    return false;
  }

  function findOverlay() {
    const direct = document.getElementById('substream-overlay');
    if (direct) return direct;

    const roots = [document];
    const seen = new WeakSet();
    while (roots.length) {
      const root = roots.pop();
      if (!root || seen.has(root)) continue;
      seen.add(root);

      const found = root.getElementById?.('substream-overlay');
      if (found) return found;

      let elements = [];
      try {
        elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
      } catch (_) {
        continue;
      }
      for (const el of elements) {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return null;
  }

  function removeOverlay() {
    const el = findOverlay();
    if (el) el.remove();
  }

  // ── Overlay management ────────────────────────────────────────────────────
  function createOverlay() {
    removeOverlay();

    const mount = getMountRoot();
    const wrap = document.createElement('div');
    wrap.id = 'substream-overlay';
    wrap.style.cssText = overlayCSS(!!fsRoot());

    const txt = document.createElement('div');
    txt.id = 'substream-text';
    txt.style.cssText = TEXT_CSS;

    wrap.appendChild(txt);
    mount.appendChild(wrap);
  }

  function ensureOverlay() {
    const mount = getMountRoot();
    let wrap = findOverlay();

    if (!wrap) { createOverlay(); return; }

    if (wrap.parentNode !== mount) {
      mount.appendChild(wrap);
    }
    wrap.style.cssText = overlayCSS(!!fsRoot());
  }

  function textEl() {
    const wrap = findOverlay();
    return wrap?.querySelector('#substream-text') || document.getElementById('substream-text');
  }

  // ── Fullscreen events ─────────────────────────────────────────────────────
  function onFSChange() {
    cachedVideo = null;
    ensureOverlay();
    const w = findOverlay();
    if (w) w.style.display = 'block';
  }
  document.addEventListener('fullscreenchange', onFSChange);
  document.addEventListener('webkitfullscreenchange', onFSChange);

  // ── SPA / body observer ───────────────────────────────────────────────────
  function startBodyObserver() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', startBodyObserver); return; }
    new MutationObserver(() => {
      cachedVideo = null;
      if (!findOverlay() && isActive) createOverlay();
    }).observe(document.body, { childList: true, subtree: true });
  }
  startBodyObserver();

  // ── Auto-advance: watch for video src change or 'ended' event ────────────
  let videoEl = null;

  function bindVideoEvents() {
    const v = getVideo();
    if (!v || v === videoEl) return;
    videoEl = v;
    cachedVideo = v;

    // Watch for 'ended' — fires when episode finishes
    v.addEventListener('ended', onVideoEnded);

    // Also watch src change via a polling fallback (SPA swaps <video> src)
    lastVideoSrc = v.src || v.currentSrc;
  }

  function onVideoEnded() {
    if (!autoAdvance) return;
    // Tell popup/background to advance — but content script can't directly
    // access popup state. We store a flag in chrome.storage that popup watches.
    chrome.storage.local.get(['autoAdvancePending'], (d) => {
      chrome.storage.local.set({ autoAdvancePending: (d.autoAdvancePending || 0) + 1 });
    });
  }

  // Poll for video element appearing (SPAs / shadow-DOM players inject it late)
  setInterval(() => {
    bindVideoEvents();
    if (isActive) ensureOverlay();

    const v = getVideo();
    if (v && autoAdvance) {
      const src = v.src || v.currentSrc;
      if (src && src !== lastVideoSrc) {
        lastVideoSrc = src;
        // New video loaded — signal auto-advance
        chrome.storage.local.get(['autoAdvancePending'], (d) => {
          chrome.storage.local.set({ autoAdvancePending: (d.autoAdvancePending || 0) + 1 });
        });
      }
    }
  }, 1500);

  // ── SRT Parser ────────────────────────────────────────────────────────────
  function parseSRT(raw) {
    const cues = [];
    const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = text.trim().split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      let ti = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) { ti = i; break; }
      }
      if (ti === -1) continue;
      const m = lines[ti].match(
        /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/
      );
      if (!m) continue;
      const start = +m[1]*3600000 + +m[2]*60000 + +m[3]*1000 + +m[4];
      const end   = +m[5]*3600000 + +m[6]*60000 + +m[7]*1000 + +m[8];
      const t = lines.slice(ti+1).join('\n').replace(/<[^>]+>/g, '').trim();
      if (t) cues.push({ start, end, text: t });
    }
    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  function renderLoop() {
    animFrameId = requestAnimationFrame(renderLoop);
    if (!isActive || !fontReady || subtitleData.length === 0) return;

    const v = getVideo();
    if (!v) return;

    ensureOverlay();
    const el = textEl();
    if (!el) return;

    const now = v.currentTime * 1000 - offsetMs;

    // Binary search
    let lo = 0, hi = subtitleData.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const c = subtitleData[mid];
      if (now >= c.start && now <= c.end) { found = mid; break; }
      else if (now < c.start) hi = mid - 1;
      else lo = mid + 1;
    }

    if (found !== currentCueIdx) {
      currentCueIdx = found;
      if (found === -1) {
        el.style.opacity = '0';
        el.innerText = '';
      } else {
        el.innerText = subtitleData[found].text;
        el.style.opacity = '1';
      }
    }
  }

  function startLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(renderLoop);
  }

  // ── Message handler ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    switch (msg.type) {

      case 'LOAD_SUBTITLE': {
        const cues = parseSRT(msg.srtContent);
        if (!cues.length) {
          sendResponse({ ok: false, error: 'Could not parse SRT — check format.' });
          return true;
        }
        subtitleData  = cues;
        currentCueIdx = -1;
        isActive      = true;
        createOverlay();
        startLoop();
        sendResponse({ ok: true, cueCount: cues.length });
        break;
      }

      case 'SET_OFFSET':
        offsetMs = msg.offsetMs;
        currentCueIdx = -1;
        sendResponse({ ok: true });
        break;

      case 'SET_AUTO_ADVANCE':
        autoAdvance = msg.enabled;
        sendResponse({ ok: true });
        break;

      case 'SYNC_NOW': {
        cachedVideo = null;
        const v = getVideo();
        if (!v) { sendResponse({ ok: false, error: 'No video on this page.' }); return true; }
        offsetMs = v.currentTime * 1000 - msg.targetMs;
        currentCueIdx = -1;
        sendResponse({ ok: true, offsetMs });
        break;
      }

      case 'GET_VIDEO_TIME': {
        const v = getVideo();
        sendResponse({ ok: !!v, currentMs: v ? v.currentTime * 1000 : 0 });
        break;
      }

      case 'TOGGLE_ACTIVE': {
        isActive = msg.active;
        const w = findOverlay();
        if (w) w.style.display = isActive ? 'block' : 'none';
        if (isActive) currentCueIdx = -1;
        sendResponse({ ok: true });
        break;
      }

      case 'CLEAR_SUBTITLE': {
        subtitleData  = [];
        isActive      = false;
        currentCueIdx = -1;
        const el = textEl();
        if (el) { el.innerText = ''; el.style.opacity = '0'; }
        sendResponse({ ok: true });
        break;
      }

      case 'PING':
        sendResponse({ ok: true });
        break;
    }
    return true;
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  // Load font first, THEN restore state and start loop.
  // This is the fix for the "subtitle shows as selected but text not visible
  // after page reload" bug — the font was not ready when the first frame rendered.
  async function bootstrap() {
    createOverlay();
    await waitForFont();     // ensure Cairo is loaded before any rendering
    startLoop();

    // Restore persisted subtitle
    chrome.storage.local.get(['activeSubtitle', 'offsetMs', 'autoAdvance'], (data) => {
      if (data.activeSubtitle) {
        subtitleData  = parseSRT(data.activeSubtitle);
        offsetMs      = data.offsetMs || 0;
        autoAdvance   = !!data.autoAdvance;
        isActive      = true;
        currentCueIdx = -1;
      }
    });
  }

  bootstrap();

})();
