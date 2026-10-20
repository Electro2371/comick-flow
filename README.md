# Comick Flow

Lecteur de manga web branché en direct sur l'API publique de [MangaDex](https://api.mangadex.org/docs/).
Tu cliques sur n'importe quel manga, sa fiche et ses chapitres s'ouvrent, et tu lis. Rien n'est importé avant.

## Fonctionnalités

- **Accueil** : populaires, dernières mises à jour, mieux notés, nouveautés, et « Continuer la lecture »
- **Recherche** dans tout le catalogue MangaDex, avec suggestions pendant la frappe
- **Catalogue** avec filtres par genre/thème, plusieurs tris et une pagination
- **Fiche manga** : couverture, synopsis, auteurs, note et nombre de suivis MangaDex, liens AniList / MyAnimeList
- **Chapitres** fusionnés par langue de préférence (FR puis EN par défaut), avec recherche et tri
- **Lecteur** en défilement vertical, chapitre précédent/suivant (aussi avec les flèches ← →), mode économie de données
- **Favoris, historique et chapitres lus**, enregistrés dans le navigateur (localStorage)

## Lancer l'application

Il faut Python 3.10 ou plus récent.

**Windows** : double-clique sur `start-app.bat`. La première fois, il crée un environnement `.venv` et installe les dépendances, puis il ouvre http://127.0.0.1:8001. Pour arrêter, lance `stop-app.bat`.

**Manuellement** :

```bash
python -m venv .venv
.venv/bin/pip install -r api/requirements.txt   # Windows : .venv\Scripts\pip
cd api
../.venv/bin/python main.py
```

Ouvre ensuite http://127.0.0.1:8001. Pour changer de port, définis la variable `PORT`.

## Architecture

```
api/
  main.py        Flask : routes /api/* et service des fichiers de web/
  mangadex.py    Client MangaDex (cache mémoire, normalisation des données)
  test_mangadex.py
web/
  index.html, app.js, styles.css   SPA sans dépendance, routage par hash
```

MangaDex n'envoie pas d'en-têtes CORS, donc le navigateur ne peut pas l'appeler directement. Le petit serveur Flask sert de proxy, et il relaie aussi les images (couvertures et pages) depuis les seuls domaines MangaDex.

| Route | Rôle |
| --- | --- |
| `GET /api/manga?sort=&q=&tags=&lang=&offset=&limit=` | Liste et recherche (`sort` : popular, latest, rating, new, relevance) |
| `GET /api/tags` | Genres et thèmes |
| `GET /api/manga/<id>` | Fiche détaillée et statistiques |
| `GET /api/manga/<id>/chapters?lang=fr,en` | Chapitres lisibles, fusionnés par langue |
| `GET /api/chapter/<id>` | Infos d'un chapitre (dont le manga parent) |
| `GET /api/chapter/<id>/pages?saver=1` | URLs des pages via MangaDex@Home |
| `GET /api/img?url=` | Proxy d'images limité aux domaines MangaDex |

## Tests

```bash
cd api
python -m unittest -v
```

## Limites

Les séries licenciées (One Piece, par exemple) ont souvent peu de chapitres en FR/EN sur MangaDex, parce que les chapitres officiels sont externes ou retirés. Choisis « Toutes » dans le sélecteur de langue pour élargir la recherche. Les contenus proviennent de MangaDex et de ses groupes de traduction ; ce projet ne fait que les afficher.
