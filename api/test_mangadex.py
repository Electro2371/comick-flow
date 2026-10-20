import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import mangadex
from main import app


def _chapter(chapter_id, number, lang, **attrs):
    return {
        'id': chapter_id,
        'type': 'chapter',
        'attributes': {
            'chapter': number,
            'translatedLanguage': lang,
            'pages': 10,
            'externalUrl': None,
            'isUnavailable': False,
            'publishAt': '2026-01-01T00:00:00+00:00',
            **attrs,
        },
        'relationships': [{'type': 'scanlation_group', 'attributes': {'name': 'Team'}}],
    }


class TitleTests(unittest.TestCase):
    def test_prefers_english_alt_title_over_romanized_main_title(self):
        attrs = {'title': {'ko-ro': 'Na Honjaman Level-Up'}, 'altTitles': [{'ko': '나 혼자만 레벨업'}, {'en': 'Solo Leveling'}]}
        self.assertEqual(mangadex._title(attrs), 'Solo Leveling')

    def test_falls_back_to_any_title(self):
        self.assertEqual(mangadex._title({'title': {'ja-ro': 'Shingeki'}}), 'Shingeki')


class ChapterFeedTests(unittest.TestCase):
    def test_merges_languages_by_priority_and_skips_unreadable(self):
        feed = {
            'total': 5,
            'data': [
                _chapter('en-1', '1', 'en'),
                _chapter('fr-1', '1', 'fr'),
                _chapter('en-2', '2', 'en'),
                _chapter('ext-3', '3', 'en', externalUrl='https://official.example'),
                _chapter('dmca-4', '4', 'fr', isUnavailable=True),
            ],
        }
        with patch.object(mangadex, '_get', return_value=feed):
            chapters = mangadex.get_chapters('manga', ['fr', 'en'])

        self.assertEqual([c['id'] for c in chapters], ['fr-1', 'en-2'])

    def test_sorts_numerically_not_alphabetically(self):
        feed = {'total': 3, 'data': [_chapter('c10', '10', 'en'), _chapter('c2', '2', 'en'), _chapter('c2.5', '2.5', 'en')]}
        with patch.object(mangadex, '_get', return_value=feed):
            chapters = mangadex.get_chapters('manga', ['en'])

        self.assertEqual([c['number'] for c in chapters], ['2', '2.5', '10'])


class ImageProxyTests(unittest.TestCase):
    def test_rejects_non_mangadex_hosts(self):
        client = app.test_client()
        for url in ('https://evil.com/a.png', 'https://evilmangadex.org/a.png', 'http://uploads.mangadex.org/a.png'):
            self.assertEqual(client.get('/api/img', query_string={'url': url}).status_code, 400, url)

    def test_rejects_invalid_ids(self):
        self.assertEqual(app.test_client().get('/api/manga/not-a-uuid').status_code, 404)


if __name__ == '__main__':
    unittest.main()
