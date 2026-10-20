// Same-origin by default (Flask serves this folder). Set window.COMICK_API_BASE
// before this script to point a separately hosted frontend at the API.
const API_BASE = window.COMICK_API_BASE || '';
const STORAGE_KEY = 'comick-flow-v2';
const PAGE_SIZE = 24;

const SORT_LABELS = {
  popular: 'Populaires',
  latest: 'Dernières mises à jour',
  rating: 'Mieux notés',
  new: 'Nouveautés',
};

const LANG_FLAGS = { fr: 'FR', en: 'EN', 'es-la': 'ES', es: 'ES', 'pt-br': 'PT', it: 'IT', de: 'DE' };

const view = document.getElementById('view');
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchSuggest = document.getElementById('searchSuggest');
const langSelect = document.getElementById('langSelect');

const memo = new Map();
let renderToken = 0;

// ---------- persistent state (per browser) ----------

const store = loadStore();

function loadStore() {
  const empty = { lang: 'fr,en', saver: false, favorites: {}, read: {}, history: {} };
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return empty;
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode / quota: the app still works, it just won't remember.
  }
}

function mangaRef(manga) {
  return { id: manga.id, title: manga.title, cover: manga.cover, status: manga.status };
}

function isFavorite(id) {
  return Boolean(store.favorites[id]);
}

function toggleFavorite(manga) {
  if (isFavorite(manga.id)) delete store.favorites[manga.id];
  else store.favorites[manga.id] = { ...mangaRef(manga), addedAt: Date.now() };
  saveStore();
}

function readSet(mangaId) {
  return new Set(store.read[mangaId] || []);
}

function markRead(manga, chapter) {
  const read = readSet(manga.id);
  read.add(chapter.id);
  store.read[manga.id] = [...read];
  store.history[manga.id] = {
    ...mangaRef(manga),
    chapterId: chapter.id,
    chapterLabel: chapterLabel(chapter),
    at: Date.now(),
  };
  saveStore();
}

// ---------- helpers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function img(url) {
  return url ? `${API_BASE}/api/img?url=${encodeURIComponent(url)}` : '';
}

async function api(path, { cache = true } = {}) {
  if (cache && memo.has(path)) return memo.get(path);
  const request = fetch(`${API_BASE}/api${path}`).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Erreur ${response.status}`);
    }
    return response.json();
  });
  if (cache) {
    memo.set(path, request);
    request.catch(() => memo.delete(path));
  }
  return request;
}

function chapterLabel(chapter) {
  const number = chapter.number ? `Chapitre ${chapter.number}` : 'Oneshot';
  return chapter.title ? `${number} — ${chapter.title}` : number;
}

function timeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 60) return `il y a ${Math.max(minutes, 1)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `il y a ${days} j`;
  const months = Math.round(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.round(months / 12);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

function parseHash() {
  const [path, queryString = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(queryString) };
}

function loading(text = 'Chargement…') {
  return `<div class="state"><div class="spinner"></div><p>${esc(text)}</p></div>`;
}

function errorState(error, retry = true) {
  return `<div class="state error"><p>${esc(error.message || error)}</p>${retry ? '<button class="btn" onclick="route()">Réessayer</button>' : ''}</div>`;
}

function card(manga) {
  const read = store.read[manga.id]?.length;
  return `
    <a class="card" href="#/manga/${manga.id}" title="${esc(manga.title)}">
      <div class="card-cover">
        ${manga.cover ? `<img src="${img(manga.cover)}" alt="" loading="lazy" />` : `<span class="cover-fallback">${esc(manga.title.slice(0, 2))}</span>`}
        ${manga.status ? `<span class="badge">${esc(manga.status)}</span>` : ''}
        ${read ? `<span class="badge badge-read">${read} lu${read > 1 ? 's' : ''}</span>` : ''}
      </div>
      <p class="card-title">${esc(manga.title)}</p>
      ${manga.tags?.length ? `<p class="card-meta">${esc(manga.tags.slice(0, 2).join(' · '))}</p>` : ''}
    </a>`;
}

// ---------- views ----------

async function renderHome(token) {
  const history = Object.values(store.history).sort((a, b) => b.at - a.at).slice(0, 12);
  view.innerHTML = `
    <section class="hero">
      <p class="eyebrow">Tout MangaDex, directement</p>
      <h1>Clique sur un manga, lis-le.</h1>
      <p class="hero-text">Recherche n'importe quel titre, ouvre sa fiche et lance la lecture sans rien importer.</p>
    </section>
    ${history.length ? `
      <section class="row">
        <div class="row-head"><h2>Continuer la lecture</h2><a href="#/library">Tout voir</a></div>
        <div class="continue-list">
          ${history.map((item) => `
            <a class="continue-item" href="#/read/${item.chapterId}">
              ${item.cover ? `<img src="${img(item.cover)}" alt="" loading="lazy" />` : ''}
              <div><p class="card-title">${esc(item.title)}</p><p class="card-meta">${esc(item.chapterLabel)}</p></div>
            </a>`).join('')}
        </div>
      </section>` : ''}
    ${Object.keys(SORT_LABELS).map((sort) => `
      <section class="row">
        <div class="row-head"><h2>${SORT_LABELS[sort]}</h2><a href="#/browse?sort=${sort}">Tout voir</a></div>
        <div class="row-scroll" id="row-${sort}">${loading()}</div>
      </section>`).join('')}
  `;

  await Promise.all(Object.keys(SORT_LABELS).map(async (sort) => {
    const target = document.getElementById(`row-${sort}`);
    try {
      const result = await api(`/manga?sort=${sort}&limit=18&lang=${store.lang}`);
      if (token !== renderToken) return;
      target.innerHTML = result.data.map(card).join('') || '<p class="muted">Rien pour le moment.</p>';
    } catch (error) {
      if (token === renderToken) target.innerHTML = errorState(error);
    }
  }));
}

async function renderBrowse(token, query) {
  const q = query.get('q') || '';
  const requested = query.get('sort');
  const sort = SORT_LABELS[requested] || (q && requested === 'relevance') ? requested : q ? 'relevance' : 'popular';
  const tag = query.get('tag') || '';
  const page = Math.max(1, Number(query.get('page')) || 1);

  const link = (changes) => {
    const params = new URLSearchParams({ sort, ...(q && { q }), ...(tag && { tag }), ...changes });
    if (params.get('page') === '1') params.delete('page');
    for (const [key, value] of [...params]) if (!value) params.delete(key);
    return `#/browse?${params}`;
  };

  view.innerHTML = `
    <div class="page-head">
      <h1>${q ? `Résultats pour « ${esc(q)} »` : 'Catalogue'}</h1>
      <div class="sort-tabs">
        ${q ? `<a class="chip ${sort === 'relevance' ? 'active' : ''}" href="${link({ sort: 'relevance', page: '' })}">Pertinence</a>` : ''}
        ${Object.entries(SORT_LABELS).map(([key, label]) => `<a class="chip ${key === sort ? 'active' : ''}" href="${link({ sort: key, page: '' })}">${label}</a>`).join('')}
      </div>
    </div>
    <div id="tagChips" class="tag-chips"></div>
    <div id="browseGrid" class="grid">${loading()}</div>
    <div id="pager" class="pager"></div>
  `;

  api('/tags').then((tags) => {
    if (token !== renderToken) return;
    const genres = tags.filter((item) => item.group === 'genre' || item.group === 'theme');
    document.getElementById('tagChips').innerHTML = [
      `<a class="chip small ${!tag ? 'active' : ''}" href="${link({ tag: '', page: '' })}">Tous les genres</a>`,
      ...genres.map((item) => `<a class="chip small ${item.id === tag ? 'active' : ''}" href="${link({ tag: item.id, page: '' })}">${esc(item.name)}</a>`),
    ].join('');
  }).catch(() => {});

  try {
    const params = new URLSearchParams({ sort, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, lang: store.lang });
    if (q) params.set('q', q);
    if (tag) params.set('tags', tag);
    const result = await api(`/manga?${params}`);
    if (token !== renderToken) return;

    document.getElementById('browseGrid').innerHTML = result.data.length
      ? result.data.map(card).join('')
      : '<div class="state"><p>Aucun manga trouvé dans ces langues. Essaie « Toutes » en haut à droite.</p></div>';

    const lastPage = Math.max(1, Math.ceil(Math.min(result.total, 10000) / PAGE_SIZE));
    document.getElementById('pager').innerHTML = lastPage > 1 ? `
      ${page > 1 ? `<a class="btn" href="${link({ page: page - 1 })}">← Précédent</a>` : '<span></span>'}
      <span class="muted">Page ${page} / ${lastPage}</span>
      ${page < lastPage ? `<a class="btn" href="${link({ page: page + 1 })}">Suivant →</a>` : '<span></span>'}` : '';
  } catch (error) {
    if (token === renderToken) document.getElementById('browseGrid').innerHTML = errorState(error);
  }
}

function renderLibrary() {
  const favorites = Object.values(store.favorites).sort((a, b) => b.addedAt - a.addedAt);
  const history = Object.values(store.history).sort((a, b) => b.at - a.at);
  view.innerHTML = `
    <div class="page-head"><h1>Ma bibliothèque</h1></div>
    <section class="row">
      <div class="row-head"><h2>Favoris (${favorites.length})</h2></div>
      <div class="grid">${favorites.length ? favorites.map(card).join('') : '<p class="muted">Ajoute des favoris depuis la fiche d’un manga.</p>'}</div>
    </section>
    <section class="row">
      <div class="row-head"><h2>Historique</h2>${history.length ? '<button class="link-btn" id="clearHistory">Effacer</button>' : ''}</div>
      <div class="continue-list">
        ${history.length ? history.map((item) => `
          <a class="continue-item" href="#/read/${item.chapterId}">
            ${item.cover ? `<img src="${img(item.cover)}" alt="" loading="lazy" />` : ''}
            <div><p class="card-title">${esc(item.title)}</p><p class="card-meta">${esc(item.chapterLabel)} · ${timeAgo(item.at)}</p></div>
          </a>`).join('') : '<p class="muted">Aucune lecture pour le moment.</p>'}
      </div>
    </section>
  `;
  document.getElementById('clearHistory')?.addEventListener('click', () => {
    store.history = {};
    saveStore();
    renderLibrary();
  });
}

async function renderManga(token, mangaId) {
  view.innerHTML = loading('Chargement du manga…');
  let manga;
  try {
    manga = await api(`/manga/${mangaId}`);
  } catch (error) {
    if (token === renderToken) view.innerHTML = errorState(error);
    return;
  }
  if (token !== renderToken) return;

  let sortDesc = true;
  let filter = '';
  let chapters = null;

  const metaItem = (label, value) => (value ? `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>` : '');

  view.innerHTML = `
    <section class="detail">
      <div class="detail-bg" style="background-image:url('${img(manga.cover)}')"></div>
      <div class="detail-cover">${manga.cover ? `<img src="${img(manga.cover)}" alt="" />` : ''}</div>
      <div class="detail-info">
        <p class="eyebrow">${esc([manga.demographic, manga.year].filter(Boolean).join(' · ') || 'Manga')}</p>
        <h1>${esc(manga.title)}</h1>
        ${manga.altTitles.length ? `<p class="alt-titles">${esc(manga.altTitles.slice(0, 3).join(' · '))}</p>` : ''}
        <dl class="meta-grid">
          ${metaItem('Statut', manga.status)}
          ${metaItem('Note', manga.rating ? `★ ${manga.rating} / 10` : '')}
          ${metaItem('Suivis', manga.follows ? manga.follows.toLocaleString('fr-FR') : '')}
          ${metaItem('Auteur', manga.authors.join(', '))}
          ${metaItem('Dessin', manga.artists.filter((name) => !manga.authors.includes(name)).join(', '))}
        </dl>
        <div class="tags">${manga.tags.map((tagName) => `<span class="tag">${esc(tagName)}</span>`).join('')}</div>
        <div class="detail-actions">
          <a id="startBtn" class="btn primary disabled" href="#">Chargement des chapitres…</a>
          <button id="favBtn" class="btn">${isFavorite(manga.id) ? '★ Favori' : '☆ Ajouter aux favoris'}</button>
        </div>
        <div class="external-links">
          <a href="${manga.mangadex}" target="_blank" rel="noopener">MangaDex</a>
          ${manga.anilist ? `<a href="${manga.anilist}" target="_blank" rel="noopener">AniList</a>` : ''}
          ${manga.mal ? `<a href="${manga.mal}" target="_blank" rel="noopener">MyAnimeList</a>` : ''}
        </div>
      </div>
    </section>
    ${manga.description ? `<section class="synopsis"><h2>Synopsis</h2><p>${esc(manga.description).replace(/\n+/g, '<br>')}</p></section>` : ''}
    <section class="chapters">
      <div class="row-head">
        <h2 id="chapterCount">Chapitres</h2>
        <div class="chapter-tools">
          <input id="chapterFilter" type="search" placeholder="N° ou titre…" />
          <button id="chapterSort" class="btn">↓ Récents</button>
        </div>
      </div>
      <div id="chapterList">${loading('Récupération des chapitres…')}</div>
    </section>
  `;

  document.getElementById('favBtn').addEventListener('click', (event) => {
    toggleFavorite(manga);
    event.currentTarget.textContent = isFavorite(manga.id) ? '★ Favori' : '☆ Ajouter aux favoris';
  });

  const drawChapters = () => {
    const list = document.getElementById('chapterList');
    const read = readSet(manga.id);
    const needle = filter.trim().toLowerCase();
    let items = needle
      ? chapters.filter((chapter) => `${chapter.number ?? ''} ${chapter.title}`.toLowerCase().includes(needle))
      : chapters;
    if (sortDesc) items = [...items].reverse();
    list.innerHTML = items.length ? items.map((chapter) => `
      <a class="chapter ${read.has(chapter.id) ? 'read' : ''}" href="#/read/${chapter.id}">
        <span class="chapter-lang">${LANG_FLAGS[chapter.lang] || esc(chapter.lang)}</span>
        <span class="chapter-name">${esc(chapterLabel(chapter))}${chapter.volume ? ` <small>Vol. ${esc(chapter.volume)}</small>` : ''}</span>
        <span class="chapter-group">${esc(chapter.group || '')}</span>
        <span class="chapter-time">${timeAgo(chapter.publishedAt)}</span>
      </a>`).join('') : '<p class="muted">Aucun chapitre ne correspond.</p>';
  };

  document.getElementById('chapterFilter').addEventListener('input', (event) => {
    filter = event.target.value;
    if (chapters) drawChapters();
  });
  document.getElementById('chapterSort').addEventListener('click', (event) => {
    sortDesc = !sortDesc;
    event.currentTarget.textContent = sortDesc ? '↓ Récents' : '↑ Anciens';
    if (chapters) drawChapters();
  });

  try {
    chapters = await api(`/manga/${manga.id}/chapters?lang=${store.lang}`);
  } catch (error) {
    if (token === renderToken) document.getElementById('chapterList').innerHTML = errorState(error);
    return;
  }
  if (token !== renderToken) return;

  document.getElementById('chapterCount').textContent = `Chapitres (${chapters.length})`;
  const startBtn = document.getElementById('startBtn');
  if (!chapters.length) {
    startBtn.textContent = 'Aucun chapitre lisible';
    document.getElementById('chapterList').innerHTML = `
      <div class="state"><p>Aucun chapitre disponible dans la langue choisie (souvent le cas des séries licenciées).</p>
      <p class="muted">Essaie « Toutes » dans le sélecteur de langue, ou lis-le sur <a href="${manga.mangadex}" target="_blank" rel="noopener">MangaDex</a>.</p></div>`;
    return;
  }

  const resume = store.history[manga.id];
  const resumeChapter = resume && chapters.find((chapter) => chapter.id === resume.chapterId);
  startBtn.classList.remove('disabled');
  startBtn.href = `#/read/${(resumeChapter || chapters[0]).id}`;
  startBtn.textContent = resumeChapter ? `▶ Reprendre · ${chapterLabel(resumeChapter).split(' — ')[0]}` : '▶ Commencer la lecture';
  drawChapters();
}

async function renderReader(token, chapterId) {
  document.body.classList.add('reading');
  view.innerHTML = loading('Ouverture du chapitre…');

  let manga;
  let chapters;
  let pages;
  try {
    const info = await api(`/chapter/${chapterId}`);
    [manga, chapters, pages] = await Promise.all([
      api(`/manga/${info.mangaId}`),
      api(`/manga/${info.mangaId}/chapters?lang=${store.lang}`).catch(() => []),
      api(`/chapter/${chapterId}/pages${store.saver ? '?saver=1' : ''}`, { cache: false }),
    ]);
    // The chapter may be in a language outside the current preference (e.g. opened from history).
    if (!chapters.some((chapter) => chapter.id === chapterId)) {
      chapters = [...chapters, { ...info, publishedAt: null }].sort((a, b) => Number(a.number) - Number(b.number));
    }
  } catch (error) {
    if (token === renderToken) view.innerHTML = errorState(error);
    return;
  }
  if (token !== renderToken) return;

  const index = chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapter = chapters[index];
  const prev = chapters[index - 1];
  const next = chapters[index + 1];
  markRead(manga, chapter);

  const nav = (position) => `
    <div class="reader-nav ${position}">
      ${prev ? `<a class="btn" href="#/read/${prev.id}">← Précédent</a>` : '<span class="btn disabled">← Précédent</span>'}
      <select class="chapter-select" aria-label="Choisir un chapitre">
        ${chapters.map((item) => `<option value="${item.id}" ${item.id === chapterId ? 'selected' : ''}>${esc(chapterLabel(item))}</option>`).join('')}
      </select>
      ${next ? `<a class="btn primary" href="#/read/${next.id}">Suivant →</a>` : `<a class="btn" href="#/manga/${manga.id}">Fin · retour à la fiche</a>`}
    </div>`;

  view.innerHTML = `
    <div class="reader">
      <div class="reader-bar">
        <a class="reader-back" href="#/manga/${manga.id}">← ${esc(manga.title)}</a>
        <span class="muted">${esc(chapterLabel(chapter))} · ${pages.pages.length} pages</span>
        <label class="saver-toggle"><input type="checkbox" id="saverToggle" ${store.saver ? 'checked' : ''} /> Économie de données</label>
      </div>
      ${nav('top')}
      <div class="reader-pages">
        ${pages.pages.map((src, i) => `<img src="${img(src)}" alt="Page ${i + 1}" loading="${i < 3 ? 'eager' : 'lazy'}" />`).join('')}
      </div>
      ${nav('bottom')}
    </div>
  `;
  window.scrollTo(0, 0);

  view.querySelectorAll('.chapter-select').forEach((select) => {
    select.addEventListener('change', (event) => { location.hash = `#/read/${event.target.value}`; });
  });
  document.getElementById('saverToggle').addEventListener('change', (event) => {
    store.saver = event.target.checked;
    saveStore();
    route();
  });
  view.querySelectorAll('.reader-pages img').forEach((page) => {
    page.addEventListener('error', () => {
      // @Home nodes sometimes fail; one retry with a cache-buster usually lands on a working one.
      if (page.dataset.retried) return;
      page.dataset.retried = '1';
      page.src = `${page.src}&retry=${Date.now()}`;
    });
  });

  readerKeys = (event) => {
    if (event.target.matches('input, select, textarea')) return;
    if (event.key === 'ArrowRight' && next) location.hash = `#/read/${next.id}`;
    if (event.key === 'ArrowLeft' && prev) location.hash = `#/read/${prev.id}`;
  };
}

let readerKeys = null;
document.addEventListener('keydown', (event) => readerKeys?.(event));

// ---------- router ----------

async function route() {
  const token = ++renderToken;
  const { parts, query } = parseHash();
  const [page, id] = parts;

  document.body.classList.remove('reading');
  readerKeys = null;
  hideSuggest();
  document.querySelectorAll('.nav-links a').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === (page || 'home'));
  });
  if (page !== 'read') window.scrollTo(0, 0);

  if (page === 'manga' && id) return renderManga(token, id);
  if (page === 'read' && id) return renderReader(token, id);
  if (page === 'browse') return renderBrowse(token, query);
  if (page === 'library') return renderLibrary();
  return renderHome(token);
}

// ---------- search with live suggestions ----------

let suggestTimer = null;

function hideSuggest() {
  searchSuggest.classList.add('hidden');
  searchSuggest.innerHTML = '';
}

searchInput.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) return hideSuggest();
  suggestTimer = setTimeout(async () => {
    try {
      const result = await api(`/manga?sort=relevance&limit=8&q=${encodeURIComponent(q)}`);
      if (searchInput.value.trim() !== q) return;
      searchSuggest.innerHTML = result.data.length
        ? result.data.map((manga) => `
            <a class="suggest-item" href="#/manga/${manga.id}">
              ${manga.cover ? `<img src="${img(manga.cover)}" alt="" />` : '<span></span>'}
              <span><strong>${esc(manga.title)}</strong><small>${esc([manga.status, manga.year].filter(Boolean).join(' · '))}</small></span>
            </a>`).join('') + `<a class="suggest-all" href="#/browse?q=${encodeURIComponent(q)}">Voir tous les résultats →</a>`
        : '<p class="muted suggest-empty">Aucun résultat.</p>';
      searchSuggest.classList.remove('hidden');
    } catch {
      hideSuggest();
    }
  }, 300);
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/browse?q=${encodeURIComponent(q)}`;
  searchInput.blur();
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.search-box')) hideSuggest();
  if (event.target.closest('.suggest-item, .suggest-all')) searchInput.value = '';
});

langSelect.value = store.lang;
if (langSelect.value !== store.lang) langSelect.value = store.lang = 'fr,en';
langSelect.addEventListener('change', () => {
  store.lang = langSelect.value;
  saveStore();
  route();
});

window.addEventListener('hashchange', route);
route();
