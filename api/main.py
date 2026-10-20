import os
import re
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

import mangadex
from mangadex import MangaDexError

WEB_DIR = Path(__file__).resolve().parent.parent / 'web'
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
LANG_RE = re.compile(r'^[a-z]{2}(-[a-z]{2})?$')
# Only MangaDex hosts can be fetched through /api/img, so it can't be abused as an open proxy.
IMAGE_HOSTS = ('uploads.mangadex.org', '.mangadex.network', '.mangadex.org')

app = Flask(__name__, static_folder=None)
CORS(app)


def _uuid(value):
    if not UUID_RE.match(value or ''):
        raise MangaDexError('identifiant invalide')
    return value


def _langs():
    langs = [lang.strip() for lang in request.args.get('lang', 'fr,en').split(',')]
    return [lang for lang in langs if LANG_RE.match(lang)] or ['fr', 'en']


@app.errorhandler(MangaDexError)
def handle_mangadex_error(exc):
    status = 404 if str(exc) in ('introuvable', 'identifiant invalide') else 502
    return jsonify({'detail': str(exc)}), status


@app.get('/api/health')
def health():
    return jsonify({'status': 'ok'})


@app.get('/api/manga')
def browse():
    tags = [tag for tag in request.args.get('tags', '').split(',') if UUID_RE.match(tag)]
    langs = _langs() if request.args.get('lang') else None
    return jsonify(mangadex.list_manga(
        sort=request.args.get('sort', 'popular'),
        query=request.args.get('q', '').strip()[:100],
        tags=tags,
        langs=langs,
        offset=request.args.get('offset', 0, type=int),
        limit=request.args.get('limit', 24, type=int),
    ))


@app.get('/api/tags')
def tags():
    return jsonify(mangadex.list_tags())


@app.get('/api/manga/<manga_id>')
def manga_detail(manga_id):
    return jsonify(mangadex.get_manga(_uuid(manga_id)))


@app.get('/api/manga/<manga_id>/chapters')
def manga_chapters(manga_id):
    return jsonify(mangadex.get_chapters(_uuid(manga_id), _langs()))


@app.get('/api/chapter/<chapter_id>')
def chapter_info(chapter_id):
    return jsonify(mangadex.get_chapter_info(_uuid(chapter_id)))


@app.get('/api/chapter/<chapter_id>/pages')
def chapter_pages(chapter_id):
    pages = mangadex.get_chapter_pages(_uuid(chapter_id), request.args.get('saver') == '1')
    return jsonify({'chapterId': chapter_id, 'pages': pages})


@app.get('/api/img')
def image_proxy():
    url = request.args.get('url', '')
    parsed = urlparse(url)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or not any(host == h.lstrip('.') or host.endswith(h) for h in IMAGE_HOSTS):
        return jsonify({'detail': 'hôte non autorisé'}), 400
    try:
        upstream = mangadex.fetch_image(url)
    except Exception:
        return jsonify({'detail': 'image indisponible'}), 502
    if upstream.status_code != 200:
        upstream.close()
        return jsonify({'detail': 'image indisponible'}), upstream.status_code
    return Response(
        upstream.iter_content(64 * 1024),
        content_type=upstream.headers.get('Content-Type', 'image/jpeg'),
        headers={'Cache-Control': 'public, max-age=86400'},
    )


@app.get('/')
@app.get('/<path:path>')
def frontend(path='index.html'):
    if path.startswith('api/'):
        return jsonify({'detail': 'route inconnue'}), 404
    if not (WEB_DIR / path).is_file():
        path = 'index.html'
    return send_from_directory(WEB_DIR, path)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8001))
    app.run(host='127.0.0.1', port=port, debug=os.environ.get('FLASK_DEBUG') == '1', threaded=True)
