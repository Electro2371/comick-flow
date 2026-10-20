"""Thin MangaDex client used by the Flask proxy.

MangaDex doesn't send CORS headers, so the browser can't call it directly:
every request goes through here. Nothing is imported into a local database,
manga, chapters and pages are fetched live (with a short in-memory cache) so
any title on MangaDex can be opened straight from a click.
"""
import threading
import time

import requests

API = 'https://api.mangadex.org'
COVERS = 'https://uploads.mangadex.org/covers'
USER_AGENT = 'ComickFlow/2.0 (+https://github.com/Electro2371/comick-flow)'
FEED_PAGE_SIZE = 500
MAX_FEED_PAGES = 10  # 5000 chapters, enough for the longest series
CONTENT_RATINGS = ['safe', 'suggestive']

SORTS = {
    'popular': {'order[followedCount]': 'desc'},
    'latest': {'order[latestUploadedChapter]': 'desc'},
    'rating': {'order[rating]': 'desc'},
    'new': {'order[createdAt]': 'desc'},
    'relevance': {'order[relevance]': 'desc'},
}

STATUS_LABELS = {
    'completed': 'Terminé',
    'ongoing': 'En cours',
    'hiatus': 'En pause',
    'cancelled': 'Annulé',
}

_session = requests.Session()
_session.headers['User-Agent'] = USER_AGENT
_cache = {}
_cache_lock = threading.Lock()


class MangaDexError(Exception):
    pass


def _get(path, params=None, ttl=300):
    key = (path, tuple(sorted((k, str(v)) for k, v in _flatten(params or {}))))
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]

    try:
        response = _session.get(f'{API}{path}', params=params, timeout=20)
        if response.status_code == 404:
            raise MangaDexError('introuvable')
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise MangaDexError(str(exc)) from exc

    with _cache_lock:
        _cache[key] = (now + ttl, payload)
        if len(_cache) > 2000:
            for stale in [k for k, v in _cache.items() if v[0] <= now]:
                del _cache[stale]
    return payload


def _flatten(params):
    for key, value in params.items():
        if isinstance(value, (list, tuple)):
            for item in value:
                yield key, item
        else:
            yield key, value


def _pick_lang(values, langs=('fr', 'en', 'ja-ro', 'ja')):
    if not isinstance(values, dict) or not values:
        return None
    for lang in langs:
        if values.get(lang):
            return values[lang].strip()
    return next(iter(values.values())).strip()


def _title(attrs):
    titles = attrs.get('title') or {}
    if titles.get('en') or titles.get('fr'):
        return _pick_lang(titles, ('fr', 'en'))
    # Main title is often romanized (e.g. "Na Honjaman Level-Up"); prefer an
    # English/French alt title so cards show the name people actually know.
    for lang in ('fr', 'en'):
        for alt in attrs.get('altTitles') or []:
            if alt.get(lang):
                return alt[lang].strip()
    return _pick_lang(titles) or 'Sans titre'


def _relationship(item, rel_type):
    return [rel for rel in item.get('relationships') or [] if rel.get('type') == rel_type]


def _cover_url(item, size='512'):
    for rel in _relationship(item, 'cover_art'):
        file_name = (rel.get('attributes') or {}).get('fileName')
        if file_name:
            return f"{COVERS}/{item['id']}/{file_name}.{size}.jpg"
    return None


def _tags(attrs):
    return [_pick_lang(tag['attributes']['name'], ('fr', 'en')) for tag in attrs.get('tags') or []]


def _summary(item):
    attrs = item.get('attributes') or {}
    return {
        'id': item['id'],
        'title': _title(attrs),
        'cover': _cover_url(item, '256'),
        'status': STATUS_LABELS.get(attrs.get('status'), attrs.get('status') or ''),
        'year': attrs.get('year'),
        'tags': _tags(attrs)[:4],
        'contentRating': attrs.get('contentRating'),
        'lastChapter': attrs.get('lastChapter') or None,
        'languages': attrs.get('availableTranslatedLanguages') or [],
    }


def list_manga(sort='popular', query='', tags=None, langs=None, offset=0, limit=24):
    params = {
        'limit': max(1, min(limit, 100)),
        'offset': max(0, min(offset, 9900)),
        'includes[]': ['cover_art'],
        'contentRating[]': CONTENT_RATINGS,
        'hasAvailableChapters': 'true',
        **SORTS.get(sort, SORTS['popular']),
    }
    if query:
        params['title'] = query
    if tags:
        params['includedTags[]'] = tags
    if langs:
        params['availableTranslatedLanguage[]'] = langs
    payload = _get('/manga', params, ttl=600)
    return {
        'total': payload.get('total', 0),
        'offset': payload.get('offset', 0),
        'limit': payload.get('limit', limit),
        'data': [_summary(item) for item in payload.get('data', [])],
    }


def list_tags():
    payload = _get('/manga/tag', ttl=86400)
    tags = [
        {
            'id': item['id'],
            'name': _pick_lang(item['attributes']['name'], ('fr', 'en')),
            'group': item['attributes'].get('group'),
        }
        for item in payload.get('data', [])
    ]
    return sorted(tags, key=lambda tag: (tag['group'] != 'genre', tag['name']))


def get_manga(manga_id):
    item = _get(
        f'/manga/{manga_id}',
        {'includes[]': ['cover_art', 'author', 'artist']},
        ttl=1800,
    ).get('data')
    if not item:
        raise MangaDexError('introuvable')

    attrs = item.get('attributes') or {}
    stats = {}
    try:
        stats = _get(f'/statistics/manga/{manga_id}', ttl=1800).get('statistics', {}).get(manga_id, {})
    except MangaDexError:
        pass
    rating = (stats.get('rating') or {}).get('bayesian')

    def names(rel_type):
        return [(rel.get('attributes') or {}).get('name') for rel in _relationship(item, rel_type) if rel.get('attributes')]

    links = attrs.get('links') or {}
    return {
        **_summary(item),
        'cover': _cover_url(item, '512'),
        'tags': _tags(attrs),
        'altTitles': [next(iter(alt.values())) for alt in attrs.get('altTitles') or []][:6],
        'description': _pick_lang(attrs.get('description') or {}, ('fr', 'en')) or '',
        'authors': names('author'),
        'artists': names('artist'),
        'demographic': attrs.get('publicationDemographic'),
        'originalLanguage': attrs.get('originalLanguage'),
        'rating': round(rating, 2) if rating else None,
        'follows': stats.get('follows'),
        'anilist': f"https://anilist.co/manga/{links['al']}" if links.get('al') else None,
        'mal': f"https://myanimelist.net/manga/{links['mal']}" if links.get('mal') else None,
        'mangadex': f'https://mangadex.org/title/{manga_id}',
    }


def _chapter_number(chapter):
    try:
        return float(chapter['number'])
    except (TypeError, ValueError):
        return float('inf')


def get_chapters(manga_id, langs):
    """Every readable chapter of a manga in the requested languages.

    When several uploads exist for the same chapter number (different groups
    or languages), the first language in `langs` wins, so a reader asking for
    "fr,en" gets French where it exists and English to fill the gaps.
    """
    raw = []
    for page in range(MAX_FEED_PAGES):
        payload = _get(
            f'/manga/{manga_id}/feed',
            {
                'limit': FEED_PAGE_SIZE,
                'offset': page * FEED_PAGE_SIZE,
                'translatedLanguage[]': langs,
                'order[volume]': 'asc',
                'order[chapter]': 'asc',
                'includes[]': ['scanlation_group'],
                'contentRating[]': ['safe', 'suggestive', 'erotica', 'pornographic'],
            },
            ttl=600,
        )
        data = payload.get('data', [])
        raw.extend(data)
        if len(data) < FEED_PAGE_SIZE or len(raw) >= payload.get('total', 0):
            break

    priority = {lang: index for index, lang in enumerate(langs)}
    best = {}
    for item in raw:
        attrs = item.get('attributes') or {}
        # External chapters (official sites) and DMCA'd ones can't be served by @Home.
        if attrs.get('externalUrl') or attrs.get('isUnavailable') or not attrs.get('pages'):
            continue
        groups = [(rel.get('attributes') or {}).get('name') for rel in _relationship(item, 'scanlation_group')]
        chapter = {
            'id': item['id'],
            'number': attrs.get('chapter'),
            'volume': attrs.get('volume'),
            'title': attrs.get('title') or '',
            'lang': attrs.get('translatedLanguage'),
            'pages': attrs.get('pages'),
            'publishedAt': attrs.get('readableAt') or attrs.get('publishAt'),
            'group': ', '.join(filter(None, groups)) or None,
        }
        key = chapter['number'] if chapter['number'] is not None else item['id']
        current = best.get(key)
        if current is None or priority.get(chapter['lang'], 99) < priority.get(current['lang'], 99):
            best[key] = chapter

    return sorted(best.values(), key=lambda chapter: (_chapter_number(chapter), chapter['publishedAt'] or ''))


def get_chapter_pages(chapter_id, data_saver=False):
    # @Home base URLs expire after ~15 min, keep the cache well below that.
    payload = _get(f'/at-home/server/{chapter_id}', ttl=300)
    chapter = payload['chapter']
    folder, files = ('data-saver', chapter['dataSaver']) if data_saver else ('data', chapter['data'])
    return [f"{payload['baseUrl']}/{folder}/{chapter['hash']}/{name}" for name in files]


def get_chapter_info(chapter_id):
    item = _get(f'/chapter/{chapter_id}', {'includes[]': ['manga']}, ttl=1800).get('data')
    if not item:
        raise MangaDexError('introuvable')
    attrs = item.get('attributes') or {}
    manga = _relationship(item, 'manga')
    return {
        'id': item['id'],
        'number': attrs.get('chapter'),
        'title': attrs.get('title') or '',
        'lang': attrs.get('translatedLanguage'),
        'mangaId': manga[0]['id'] if manga else None,
    }


def fetch_image(url):
    return _session.get(url, timeout=30, stream=True)
