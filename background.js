// SubStream — Background Service Worker
// Handles SubDL API requests (CORS proxy) and subtitle downloads

const SUBDL_BASE = 'https://api.subdl.com/api/v1';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SUBDL_SEARCH') {
    searchSubDL(msg.params)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'SUBDL_DOWNLOAD') {
    downloadSubtitle(msg.url)
      .then(text => sendResponse({ ok: true, text }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function searchSubDL(params) {
  // Build query — SubDL wants api_key as a query param, NOT a header
  const url = new URL(`${SUBDL_BASE}/subtitles`);
  url.searchParams.set('api_key', params.api_key);
  url.searchParams.set('languages', 'AR');
  url.searchParams.set('subs_per_page', '30');

  // Map popup params to SubDL API fields
  if (params.film_name)      url.searchParams.set('film_name', params.film_name);
  if (params.imdb_id)        url.searchParams.set('imdb_id', params.imdb_id);
  if (params.tmdb_id)        url.searchParams.set('tmdb_id', params.tmdb_id);
  if (params.season_number)  url.searchParams.set('season_number', params.season_number);
  if (params.episode_number) url.searchParams.set('episode_number', params.episode_number);
  if (params.type)           url.searchParams.set('type', params.type);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SubDL ${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json();
}

async function downloadSubtitle(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
