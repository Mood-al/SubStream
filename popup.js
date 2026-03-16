// SubStream — Popup JS

(async function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  let currentOffsetMs   = 0;
  let apiKey            = '';
  let activeSubtitleName = '';
  let folderFiles       = {};   // { filename: srtText } — persisted
  let folderOrder       = [];   // sorted filenames for auto-advance
  let autoAdvance       = false;
  let searchMode        = 'title';
  let advancePollBase   = 0;    // last seen autoAdvancePending value

  // ── Init ─────────────────────────────────────────────────────────────────
  const stored = await chrome.storage.local.get([
    'apiKey','offsetMs','activeSubtitleName','savedOffsets',
    'subSettings','folderFiles','autoAdvance','autoAdvancePending'
  ]);

  apiKey             = stored.apiKey || '';
  currentOffsetMs    = stored.offsetMs || 0;
  activeSubtitleName = stored.activeSubtitleName || '';
  folderFiles        = stored.folderFiles || {};
  autoAdvance        = !!stored.autoAdvance;
  advancePollBase    = stored.autoAdvancePending || 0;
  folderOrder        = Object.keys(folderFiles).sort();

  document.getElementById('apiKey').value = apiKey;
  document.getElementById('autoAdvanceToggle').checked = autoAdvance;
  updateOffsetDisplay();
  updateFooter();
  loadSavedOffsetsList();
  applyStoredSettings(stored.subSettings);

  if (folderOrder.length > 0) {
    document.getElementById('advanceRow').style.display = 'flex';
    renderFolderLibrary();
  }

  // ── Auto-advance polling ──────────────────────────────────────────────────
  // content.js increments autoAdvancePending when video ends; we poll for it
  chrome.storage.onChanged.addListener((changes) => {
    if (!autoAdvance) return;
    if (changes.autoAdvancePending) {
      const newVal = changes.autoAdvancePending.newValue || 0;
      if (newVal > advancePollBase) {
        advancePollBase = newVal;
        advanceToNextSubtitle();
      }
    }
  });

  async function advanceToNextSubtitle() {
    if (!activeSubtitleName || folderOrder.length === 0) return;
    const idx = folderOrder.indexOf(activeSubtitleName);
    if (idx === -1 || idx >= folderOrder.length - 1) return; // already last

    const nextName = folderOrder[idx + 1];
    const srtText  = folderFiles[nextName];
    if (!srtText) return;

    await activateSubtitle(srtText, nextName, 'localStatus');
    // Switch to local tab to show which file is now active
    switchTab('local');
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name)
    );
    document.querySelectorAll('.tab-content').forEach(c => {
      const isTarget = c.id === 'tab-' + name;
      c.classList.toggle('hidden', !isTarget);
      c.classList.toggle('active', isTarget);
    });
  }

  // ── Toggle active ─────────────────────────────────────────────────────────
  document.getElementById('toggleActive').addEventListener('change', async (e) => {
    await sendToContent({ type: 'TOGGLE_ACTIVE', active: e.target.checked });
  });

  // ── Auto-advance toggle ───────────────────────────────────────────────────
  document.getElementById('autoAdvanceToggle').addEventListener('change', async (e) => {
    autoAdvance = e.target.checked;
    await chrome.storage.local.set({ autoAdvance });
    await sendToContent({ type: 'SET_AUTO_ADVANCE', enabled: autoAdvance });
  });

  // ═══════════════════════════════════════════════
  // SEARCH TAB
  // ═══════════════════════════════════════════════

  document.querySelectorAll('.seg').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      searchMode = btn.dataset.searchMode;
      document.getElementById('searchByTitle').classList.toggle('hidden', searchMode !== 'title');
      document.getElementById('searchByID').classList.toggle('hidden', searchMode === 'title');
    });
  });

  document.getElementById('btnSearch').addEventListener('click', doSearch);

  async function doSearch() {
    if (!apiKey) {
      showStatus('searchStatus', '⚠ Save your SubDL API key in Settings first.', 'error');
      return;
    }

    // Build params — api_key must be present, background will put it in query string
    const params = { api_key: apiKey, type: 'all' };

    if (searchMode === 'title') {
      const title = document.getElementById('searchTitle').value.trim();
      if (!title) { showStatus('searchStatus', 'Enter a title.', 'error'); return; }
      params.film_name = title;
      const s = document.getElementById('searchSeason').value;
      const e = document.getElementById('searchEpisode').value;
      if (s) params.season_number = s;
      if (e) params.episode_number = e;
    } else {
      const id = document.getElementById('searchID').value.trim();
      if (!id) { showStatus('searchStatus', 'Enter an ID.', 'error'); return; }
      if (searchMode === 'imdb') params.imdb_id = id;
      if (searchMode === 'tmdb') params.tmdb_id = id;
      const s = document.getElementById('searchSeasonID').value;
      const e = document.getElementById('searchEpisodeID').value;
      if (s) params.season_number = s;
      if (e) params.episode_number = e;
    }

    showStatus('searchStatus', '<span class="spinner"></span> Searching SubDL…', 'loading');
    document.getElementById('searchResults').classList.add('hidden');

    const res = await chrome.runtime.sendMessage({ type: 'SUBDL_SEARCH', params });
    if (!res.ok) { showStatus('searchStatus', '⚠ ' + res.error, 'error'); return; }

    const subs = res.data?.subtitles || [];
    if (!subs.length) { showStatus('searchStatus', 'No Arabic subtitles found.', 'info'); return; }

    hideStatus('searchStatus');
    renderSearchResults(subs);
  }

  function renderSearchResults(subs) {
    const list = document.getElementById('searchResults');
    list.innerHTML = '';
    list.classList.remove('hidden');
    subs.slice(0, 20).forEach(sub => {
      const meta = [
        sub.season_number  ? `S${String(sub.season_number).padStart(2,'0')}` : null,
        sub.episode_number ? `E${String(sub.episode_number).padStart(2,'0')}` : null,
        sub.release_name
      ].filter(Boolean).join(' · ');

      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <div class="result-info">
          <div class="result-name" title="${esc(sub.release_name||'')}">${esc(sub.release_name||'Untitled')}</div>
          <div class="result-meta">${esc(meta)} · AR</div>
        </div>
        <button class="result-load">Load</button>`;
      item.querySelector('.result-load').addEventListener('click', async (e) => {
        const btn = e.target; btn.textContent = '…';
        await loadSubtitleFromURL(sub.url, sub.release_name || 'subtitle', btn);
      });
      list.appendChild(item);
    });
    showStatus('searchStatus', `Found ${subs.length} subtitle(s). Showing top 20.`, 'info');
  }

  async function loadSubtitleFromURL(url, name, btn) {
    const fullUrl = url.startsWith('http') ? url : 'https://dl.subdl.com' + url;
    const res = await chrome.runtime.sendMessage({ type: 'SUBDL_DOWNLOAD', url: fullUrl });
    if (!res.ok) {
      showStatus('searchStatus', '⚠ Download error: ' + res.error, 'error');
      if (btn) btn.textContent = 'Load'; return;
    }
    try {
      const srtText = await unzipFirstSRT(res.text);
      const ok = await activateSubtitle(srtText, name, 'searchStatus');
      if (btn) { btn.textContent = ok ? 'Loaded' : 'Load'; if (ok) btn.classList.add('loaded'); }
    } catch (e) {
      showStatus('searchStatus', '⚠ Unzip error: ' + e.message, 'error');
      if (btn) btn.textContent = 'Load';
    }
  }

  async function unzipFirstSRT(dataUrl) {
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    let off = 0;
    while (off < bytes.length - 4) {
      if (view.getUint32(off, true) === 0x04034b50) {
        const fnLen    = view.getUint16(off+26, true);
        const exLen    = view.getUint16(off+28, true);
        const compSz   = view.getUint32(off+18, true);
        const comp     = view.getUint16(off+8, true);
        const fn       = new TextDecoder().decode(bytes.slice(off+30, off+30+fnLen));
        const dataOff  = off+30+fnLen+exLen;
        if (/\.(srt|sub|vtt)$/i.test(fn)) {
          let fb = bytes.slice(dataOff, dataOff+compSz);
          if (comp === 8) {
            const ds = new DecompressionStream('deflate-raw');
            const w = ds.writable.getWriter(), r = ds.readable.getReader();
            w.write(fb); w.close();
            const chunks = []; while (true) { const {done,value} = await r.read(); if (done) break; chunks.push(value); }
            const tot = chunks.reduce((n,c)=>n+c.length,0);
            fb = new Uint8Array(tot); let p=0;
            for (const c of chunks) { fb.set(c,p); p+=c.length; }
          }
          return new TextDecoder('utf-8').decode(fb);
        }
        off = dataOff + compSz;
      } else { off++; }
    }
    throw new Error('No SRT/SUB file in archive');
  }

  // ═══════════════════════════════════════════════
  // LOCAL TAB
  // ═══════════════════════════════════════════════

  const dropZone = document.getElementById('singleDropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor='var(--accent)'; });
  dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor=''; });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault(); dropZone.style.borderColor='';
    const f = e.dataTransfer.files[0]; if (f) await loadSingleFile(f);
  });
  fileInput.addEventListener('change', async () => {
    if (fileInput.files[0]) await loadSingleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  async function loadSingleFile(file) {
    showStatus('localStatus', '<span class="spinner"></span> Reading…', 'loading');
    const text = await readText(file);
    await activateSubtitle(text, file.name, 'localStatus');
  }

  document.getElementById('btnLoadFolder').addEventListener('click', () => {
    document.getElementById('folderInput').click();
  });

  document.getElementById('folderInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files).filter(f => /\.(srt|sub|vtt)$/i.test(f.name));
    if (!files.length) { showStatus('localStatus', 'No SRT files in folder.', 'error'); return; }

    showStatus('localStatus', `<span class="spinner"></span> Reading ${files.length} files…`, 'loading');
    folderFiles = {};
    for (const f of files) folderFiles[f.name] = await readText(f);
    folderOrder = Object.keys(folderFiles).sort();

    try { await chrome.storage.local.set({ folderFiles }); }
    catch (_) { /* quota */ }

    document.getElementById('advanceRow').style.display = 'flex';
    renderFolderLibrary();
    showStatus('localStatus', `✓ ${files.length} file(s) loaded. Click one to activate.`, 'success');
    e.target.value = '';
  });

  function renderFolderLibrary() {
    const list = document.getElementById('folderLibrary');
    list.innerHTML = '';
    list.classList.remove('hidden');

    if (!folderOrder.length) { list.classList.add('hidden'); return; }

    folderOrder.forEach((name, idx) => {
      const isCurrent = name === activeSubtitleName;
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <div class="result-info">
          <div class="result-name" title="${esc(name)}">${esc(name)}</div>
          <div class="result-meta">Local · ${idx+1}/${folderOrder.length}</div>
        </div>
        <button class="result-load${isCurrent?' loaded':''}">${isCurrent?'Active':'Load'}</button>`;

      item.querySelector('.result-load').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        if (btn.classList.contains('loaded')) return;
        const srt = folderFiles[name];
        if (!srt) { showStatus('localStatus', `⚠ Missing content for "${name}".`, 'error'); return; }
        btn.textContent = '…';
        const ok = await activateSubtitle(srt, name, 'localStatus');
        if (ok) {
          list.querySelectorAll('.result-load').forEach(b => { b.textContent='Load'; b.classList.remove('loaded'); });
          btn.textContent = 'Active'; btn.classList.add('loaded');
        } else {
          btn.textContent = 'Load';
        }
      });
      list.appendChild(item);
    });
  }

  function readText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsText(file, 'utf-8');
    });
  }

  // ═══════════════════════════════════════════════
  // TIMING TAB
  // ═══════════════════════════════════════════════

  document.getElementById('nudgeMinus1000').addEventListener('click', () => nudge(-1000));
  document.getElementById('nudgeMinus500').addEventListener('click',  () => nudge(-500));
  document.getElementById('nudgePlus500').addEventListener('click',   () => nudge(500));
  document.getElementById('nudgePlus1000').addEventListener('click',  () => nudge(1000));

  async function nudge(delta) {
    currentOffsetMs += delta;
    await saveOffset();
    await sendToContent({ type: 'SET_OFFSET', offsetMs: currentOffsetMs });
    updateOffsetDisplay();
  }

  document.getElementById('btnApplyOffset').addEventListener('click', async () => {
    const v = parseInt(document.getElementById('customOffset').value);
    if (isNaN(v)) { showStatus('timingStatus','Enter a valid number.','error'); return; }
    currentOffsetMs = v;
    await saveOffset();
    await sendToContent({ type: 'SET_OFFSET', offsetMs: currentOffsetMs });
    updateOffsetDisplay();
    showStatus('timingStatus', `✓ Offset set to ${v}ms`, 'success');
  });

  document.getElementById('btnSyncNow').addEventListener('click', async () => {
    const h  = parseInt(document.getElementById('syncH').value)  || 0;
    const m  = parseInt(document.getElementById('syncM').value)  || 0;
    const s  = parseInt(document.getElementById('syncS').value)  || 0;
    const ms = parseInt(document.getElementById('syncMs').value) || 0;
    const targetMs = h*3600000 + m*60000 + s*1000 + ms;
    const res = await sendToContent({ type: 'SYNC_NOW', targetMs });
    if (!res?.ok) { showStatus('timingStatus', res?.error || 'No video playing?', 'error'); return; }
    currentOffsetMs = res.offsetMs;
    await saveOffset();
    updateOffsetDisplay();
    showStatus('timingStatus', `✓ Synced! Offset: ${fmtOffset(currentOffsetMs)}`, 'success');
  });

  document.getElementById('btnSaveOffset').addEventListener('click', async () => {
    const key = document.getElementById('showKey').value.trim();
    if (!key) { showStatus('timingStatus','Enter a show key.','error'); return; }
    const s = (await chrome.storage.local.get('savedOffsets')).savedOffsets || {};
    s[key] = currentOffsetMs;
    await chrome.storage.local.set({ savedOffsets: s });
    loadSavedOffsetsList();
    showStatus('timingStatus', `✓ Saved for "${key}"`, 'success');
  });

  document.getElementById('btnLoadOffset').addEventListener('click', async () => {
    const key = document.getElementById('showKey').value.trim();
    if (!key) { showStatus('timingStatus','Enter a show key.','error'); return; }
    const s = (await chrome.storage.local.get('savedOffsets')).savedOffsets || {};
    if (!(key in s)) { showStatus('timingStatus', `No saved offset for "${key}"`, 'error'); return; }
    currentOffsetMs = s[key];
    await saveOffset();
    await sendToContent({ type: 'SET_OFFSET', offsetMs: currentOffsetMs });
    updateOffsetDisplay();
    showStatus('timingStatus', `✓ Loaded ${fmtOffset(currentOffsetMs)} for "${key}"`, 'success');
  });

  function loadSavedOffsetsList() {
    chrome.storage.local.get('savedOffsets', ({ savedOffsets }) => {
      const el = document.getElementById('savedOffsets');
      if (!savedOffsets || !Object.keys(savedOffsets).length) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden'); el.innerHTML = '';
      Object.entries(savedOffsets).forEach(([key, val]) => {
        const row = document.createElement('div');
        row.className = 'saved-offset-row';
        row.innerHTML = `
          <span class="saved-offset-key">${esc(key)}</span>
          <span class="saved-offset-val">${fmtOffset(val)}</span>
          <div class="saved-offset-actions">
            <button class="use">Use</button>
            <button class="del">✕</button>
          </div>`;
        row.querySelector('.use').addEventListener('click', async () => {
          currentOffsetMs = val; await saveOffset();
          await sendToContent({ type: 'SET_OFFSET', offsetMs: currentOffsetMs });
          updateOffsetDisplay();
          document.getElementById('showKey').value = key;
          showStatus('timingStatus', `✓ Applied ${fmtOffset(val)}`, 'success');
        });
        row.querySelector('.del').addEventListener('click', async () => {
          const s2 = (await chrome.storage.local.get('savedOffsets')).savedOffsets || {};
          delete s2[key]; await chrome.storage.local.set({ savedOffsets: s2 }); loadSavedOffsetsList();
        });
        el.appendChild(row);
      });
    });
  }

  // ═══════════════════════════════════════════════
  // SETTINGS TAB
  // ═══════════════════════════════════════════════

  document.getElementById('btnSaveKey').addEventListener('click', async () => {
    apiKey = document.getElementById('apiKey').value.trim();
    await chrome.storage.local.set({ apiKey });
    showStatus('settingsStatus', '✓ API key saved.', 'success');
  });

  const fsSlider  = document.getElementById('fontSize');
  const fsVal     = document.getElementById('fontSizeVal');
  const posSlider = document.getElementById('subPosition');
  const posVal    = document.getElementById('subPositionVal');
  const bgSlider  = document.getElementById('bgOpacity');
  const bgVal     = document.getElementById('bgOpacityVal');

  fsSlider.addEventListener('input',  () => { fsVal.textContent  = fsSlider.value  + 'px'; updateStyle(); });
  posSlider.addEventListener('input', () => { posVal.textContent = posSlider.value + '%';  updateStyle(); });
  bgSlider.addEventListener('input',  () => { bgVal.textContent  = bgSlider.value  + '%';  updateStyle(); });

  async function updateStyle() {
    const s = { fontSize: fsSlider.value, position: posSlider.value, bgOpacity: bgSlider.value };
    await chrome.storage.local.set({ subSettings: s });
    const tab = await getActiveTab(); if (!tab) return;
    chrome.scripting.insertCSS({ target: { tabId: tab.id }, css:
      `#substream-overlay { bottom: ${s.position}% !important; }
       #substream-text { font-size: ${s.fontSize}px !important; background: rgba(0,0,0,${s.bgOpacity/100}) !important; }`
    });
  }

  function applyStoredSettings(s) {
    if (!s) return;
    if (s.fontSize)   { fsSlider.value  = s.fontSize;   fsVal.textContent  = s.fontSize   + 'px'; }
    if (s.position)   { posSlider.value = s.position;   posVal.textContent = s.position   + '%';  }
    if (s.bgOpacity)  { bgSlider.value  = s.bgOpacity;  bgVal.textContent  = s.bgOpacity  + '%';  }
  }

  document.getElementById('btnClearAll').addEventListener('click', async () => {
    await chrome.storage.local.clear();
    await sendToContent({ type: 'CLEAR_SUBTITLE' });
    folderFiles = {}; folderOrder = []; activeSubtitleName = ''; currentOffsetMs = 0; autoAdvance = false;
    document.getElementById('autoAdvanceToggle').checked = false;
    document.getElementById('advanceRow').style.display = 'none';
    document.getElementById('folderLibrary').innerHTML = '';
    document.getElementById('folderLibrary').classList.add('hidden');
    updateOffsetDisplay(); updateFooter(); loadSavedOffsetsList();
    showStatus('settingsStatus', '✓ All data cleared.', 'success');
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  document.getElementById('btnClearSub').addEventListener('click', async () => {
    await sendToContent({ type: 'CLEAR_SUBTITLE' });
    activeSubtitleName = '';
    await chrome.storage.local.remove(['activeSubtitle', 'activeSubtitleName']);
    updateFooter();
    if (folderOrder.length) renderFolderLibrary();
  });

  // ═══════════════════════════════════════════════
  // CORE: activateSubtitle
  // ═══════════════════════════════════════════════

  async function activateSubtitle(srtText, name, statusId = 'localStatus') {
    const tab = await getActiveTab();
    if (!tab) {
      showStatus(statusId, '⚠ Open the streaming site first.', 'error');
      return false;
    }

    // Ping content script — inject if not alive
    const ping = await safeSend(tab.id, { type: 'PING' });
    if (!ping?.ok) {
      showStatus(statusId, '<span class="spinner"></span> Injecting…', 'loading');
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
        await delay(500);
      } catch (_) {
        showStatus(statusId, '⚠ Cannot inject here. Go to the streaming page and try again.', 'error');
        return false;
      }
    }

    // Persist for SPA navigation / page reload
    await chrome.storage.local.set({ activeSubtitle: srtText, activeSubtitleName: name, offsetMs: currentOffsetMs });

    const res = await safeSend(tab.id, { type: 'LOAD_SUBTITLE', srtContent: srtText });
    if (!res) {
      showStatus(statusId, '⚠ Page unreachable — refresh the streaming tab.', 'error');
      return false;
    }
    if (!res.ok) {
      showStatus(statusId, '⚠ ' + (res.error || 'Parse error'), 'error');
      return false;
    }

    activeSubtitleName = name;
    updateFooter();
    showStatus(statusId, `✓ "${name}" — ${res.cueCount} cues`, 'success');
    await safeSend(tab.id, { type: 'SET_OFFSET', offsetMs: currentOffsetMs });
    await safeSend(tab.id, { type: 'SET_AUTO_ADVANCE', enabled: autoAdvance });
    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  // Wraps sendMessage to ALWAYS read lastError synchronously (silences Chrome's error)
  function safeSend(tabId, msg) {
    return new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(tabId, msg, response => {
          void chrome.runtime.lastError; // read synchronously to suppress console error
          resolve(response || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  async function sendToContent(msg) {
    const tab = await getActiveTab();
    return tab ? safeSend(tab.id, msg) : null;
  }

  async function saveOffset() {
    await chrome.storage.local.set({ offsetMs: currentOffsetMs });
  }

  function updateOffsetDisplay() {
    document.getElementById('offsetDisplay').textContent = fmtOffset(currentOffsetMs);
    document.getElementById('customOffset').value = currentOffsetMs;
  }

  function updateFooter() {
    const el = document.getElementById('activeSubInfo');
    el.textContent = activeSubtitleName ? '▶ ' + activeSubtitleName : 'No subtitle loaded';
    el.classList.toggle('loaded', !!activeSubtitleName);
  }

  function fmtOffset(ms) {
    return `${ms >= 0 ? '+' : '-'}${(Math.abs(ms)/1000).toFixed(1)} s`;
  }

  function showStatus(id, html, type) {
    const el = document.getElementById(id);
    el.innerHTML = html; el.className = `status-msg ${type}`; el.classList.remove('hidden');
  }

  function hideStatus(id) { document.getElementById(id).classList.add('hidden'); }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

})();
