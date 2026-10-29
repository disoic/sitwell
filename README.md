# Sitwell

Find a lovely spot to linger: benches, picnic tables and toilets, described by what is around them.

## What is in this repository

| Folder | What it is |
|---|---|
| `app/` | The web app: `index.html`, `styles.css`, `app.js` (map, panel, spot card, rating, invitations, search), `present.js` (what the app says about a spot), `data.js` (reads the spot files), plus MapLibre and the IBM Plex fonts, hosted with the app. `prototype.html` is the previous version, kept during the switch-over. |
| `core/core.js` | The shared core: measures each spot's surroundings, groups seats into spots, writes and reads the spot files. Runs in the browser and in Node. |
| `pipeline/` | Builds the spot files from OpenStreetMap. |
| `.github/workflows/site.yml` | Builds and publishes the site. |

## How the site is built

GitHub Pages serves the **`site` branch**, which the workflow writes. Never edit that branch by hand. It holds the app, `core.js`, and the spot files under `data/v1/`.

- **On the 1st and 15th of each month**, and whenever you start it by hand: the workflow downloads Switzerland and Croatia from Geofabrik, reduces them to what Sitwell uses, builds the spot files, and publishes.
- **On every push to `main`**: the app is republished together with the spot files already online. Nothing is rebuilt.

Unchanged squares come out byte-identical, so each publish uploads only what changed, and the `site` branch stays a single commit. A build that fails publishes nothing, so the old site stays online.

After each build, the job page shows a summary: spots per country, how many are near water or face open water at sunset, and which squares and seats changed.

## One-time setup

1. Push this repository to GitHub (public, so GitHub Actions and Pages are free).
2. Under **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**.
3. Under **Actions**, open **Site**, choose **Run workflow**, and leave "Rebuild" ticked. The first run creates the `site` branch.
4. Under **Settings → Pages**, set the source to **Deploy from a branch**, branch **`site`**, folder **`/ (root)`**.
5. For your own domain, later: put a file named `CNAME` containing `sitwellapp.com` in the repository root. The workflow copies it into the site.

Keep using the same address and the prototype's saved history on your phone stays where it is. Browsers keep saved data per web address (domain), so moving to `sitwellapp.com` later needs a one-time export.

## The spot files

| File | Holds |
|---|---|
| `data/v1/coverage.json` | Which blocks exist, with a fingerprint of each block's index. |
| `data/v1/b/<block>.json` | One block of 8 × 8 squares: which squares are covered (64-bit mask), and the fingerprint of each square that has spots. |
| `data/v1/s/<square>.json` | The finished spots of one square of about 3.3 km. |

Each spot record has:
- its id (the first seat's OpenStreetMap id) and kind;
- its centre and members;
- cleaned tags: backrest, armrest, material, roof, seats, lighting, facing direction, and for toilets fee and opening hours;
- its measurements `m`, in whole metres rounded up, with "none within reach" left out;
- `rays`: open water along each sunset bearing, 230° to 310° every 5°, when the spot is near water;
- `place`: an index into the square's passport places.

`core.unpackSpot()` turns a record back into the object the summary functions use.

A phone needs only a handful of squares, about 6 KB each in a busy city once compressed. It re-downloads a square only when its fingerprint changes. Where no square is covered, the app falls back to live Overpass queries, using the same core.

## Running it yourself

You need Node 18 or newer and `osmium-tool` (`sudo apt install osmium-tool`, or `brew install osmium-tool`).

```
bash pipeline/prepare.sh                # downloads and reduces every region into work/
node pipeline/build.js --out site/data  # builds the spot files
```

Each step can also be run on its own:
- `bash pipeline/reduce.sh any.osm.pbf work/XX.geojsonseq` reduces one extract.
- `--only CH` builds just one region.
- `--prev old/data` compares the build with an earlier one.

## Tests

```
node pipeline/test/check-core.js
```

This checks that the spatial indexes give exactly the brute-force answers, that the sunset rays behave on lakes, ponds, coastlines and islands, and that grouping matches the prototype. The workflow runs it before every build.

`node test/check-present.js [data dir]` checks the app's logic (sun positions, season wording, the score) and, given built spot files, prints sample summaries and a "best right now" ranking. The workflow runs it after each build, so the job log shows real Swiss and Croatian summaries.

`pipeline/test/compare-old.js` compares the pipeline with the prototype's own core (`old-core.js`, copied unchanged from the prototype) on the same map data. Run it on a small extract listed in `pipeline/test/regions.test.json`. Utrecht, Monaco and Liechtenstein, from public test files on GitHub, all match: the same grouping, the same summaries and the same estimates. The only differences are intended ones, such as the sea now counting as water.

## Adding a country

Add an entry to `pipeline/regions.json`: its code, its ISO country code, and its Geofabrik `.osm.pbf` and `.poly` addresses. A region owns the squares whose centre lies inside its country boundary. Any other square is left to the app's live fallback.

## The app

The first version follows the approved sketch:
- **Main screen:** the map with "Best right now" in a panel; the panel's top line changes with the moment (sunset soon, rain, heat, cold and clear, dark).
- **Getting around:** Walking or Cycling, switching itself when you ride, plus filters and place search.
- **The spot card:** Go, Meet me here and Save.
- **Arriving at a spot:** you rate it with one tap, then add tags if you like.
- **Invitation page:** a friend opens it without installing anything.
- **My spots:** what you saved and rated.

Check-ins are saved in the prototype's format and storage, so earlier ratings show up as hearts and in My spots. New check-ins carry no raccoon snacks yet; the game will count them from this history once its new rules are settled.

The map is OpenFreeMap's calm "positron" style, recoloured to Sitwell's palette. The weather and sunset sky come from Open-Meteo, with your position rounded to about a kilometre.

Open the site with `?test` to check in anywhere, which is handy for trying things at home.

`node test/smoke.js site/data` drives the whole app in a simulated browser with real spot files (it needs `npm install jsdom`).

## Not done yet

- Outside Switzerland and Croatia: the live Overpass fallback (the app currently says those areas aren't covered yet).
- Adding a missing bench, installing to the home screen, and offline use.

- Sunset behind hills: precomputed terrain horizons from an elevation model.
- User-added benches, merged into the nightly build once Supabase exists.
- The app rewrite, which reads these files.
