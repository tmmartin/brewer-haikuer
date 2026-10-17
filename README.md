# Brewer Haikuer

Static archive of @brewer_haikuer's Milwaukee Brewers game-recap haiku (2009–2024).

- `index.html`, `styles.css`, `app.js`: the site (no build step)
- `data/haiku.json`: haiku database, matched to the MLB schedule
- Game summaries load live from the MLB Stats API in the browser

Run locally: `python3 -m http.server`, then open http://localhost:8000

Before launch: remove the `noindex` meta tag in `index.html`.
