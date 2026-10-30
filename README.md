# Sitwell

Find a lovely spot to linger: benches, picnic tables and toilets, described by what is around them.

## What is in this repository

| Folder | What it is |
|---|---|
| `app/` | The web app: `index.html`, `styles.css`, `app.js` (map, panel, spot card, rating, invitations, search), `present.js` (what the app says about a spot), `data.js` (reads the spot files), `guide.js` (your field guide and its souvenirs), plus MapLibre and the IBM Plex fonts, hosted with the app. |
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

`node test/check-guide.js` checks the field guide's souvenir rules and passport.

`check-core.js` checks that the spatial indexes give exactly the brute-force answers, that the sunset rays behave on lakes, ponds, coastlines and islands, and that grouping matches the prototype. The workflow runs it before every build.

`node test/check-present.js [data dir]` checks the app's logic (sun positions, season wording, the score) and, given built spot files, prints sample summaries and a "best right now" ranking. The workflow runs it after each build, so the job log shows real Swiss and Croatian summaries.

`pipeline/test/compare-old.js` compares the pipeline with the prototype's own core (`old-core.js`, copied unchanged from the prototype) on the same map data. Run it on a small extract listed in `pipeline/test/regions.test.json`. Utrecht, Monaco and Liechtenstein, from public test files on GitHub, all match: the same grouping, the same summaries and the same estimates. The only differences are intended ones, such as the sea now counting as water.

## Adding a country

Add an entry to `pipeline/regions.json`: its code, its ISO country code, and its Geofabrik `.osm.pbf` and `.poly` addresses. A region owns the squares whose centre lies inside its country boundary. Any other square is left to the app's live fallback.

## The app

The first version follows the approved sketch:
- **Main screen:** the map with "Best right now" in a panel; the panel's top line changes with the moment (sunset soon, rain, heat, cold and clear, dark).
- **Getting around:** Walking or Cycling, switching itself when you ride, plus filters and place search.
- **The spot card:** Go, Meet me here and Save.
- **Arriving at a spot:** after you've stayed within reach of a spot for 10 minutes, Sitwell asks how it is. The time counts even if you close the app and open it again; moving more than 50 m away starts it again. It doesn't ask about toilets, or about a spot you rated in the last 12 hours. GPS can be 20–30 m out, so "Not this spot?" lists the other spots within reach, with their distance and direction. You rate with one tap, then add tags if you like. The "Check in and rate" button on a spot's card works at once, without waiting.
- **Invitation page:** a friend opens it without installing anything.
- **My spots:** what you saved and rated.

Check-ins are saved in the prototype's format and storage, so earlier ratings show up as hearts and in My spots. New check-ins carry no raccoon snacks yet; the game will count them from this history once its new rules are settled.

The map is OpenFreeMap's calm "positron" style, recoloured to Sitwell's palette. The weather and sunset sky come from Open-Meteo, with your position rounded to about a kilometre.

Open the site with `?test` to check in anywhere, which is handy for trying things at home.

`node test/smoke.js site/data` drives the whole app in a simulated browser with real spot files (it needs `npm install jsdom`). It covers live squares, adding a bench and the install offer.

### Outside the covered countries

Where no static square exists, the phone asks Overpass for that square: one request per square, nearest first, one at a time. It measures the spots with the same core, so the results match the static files (`test/check-live.js` checks this). The phone keeps them for 14 days.

Nothing goes back to GitHub, so a country gets static files only when it's listed in `pipeline/regions.json`. Switzerland, Croatia and Slovenia are listed now.

### Adding a missing bench

Under My spots there's an "Add a missing bench" button. When you stand somewhere with no bench mapped within 40 m, the full list offers it too. You:
1. Move the map so the cross sits on the bench, within 40 m of where you stand and at least 15 m from any mapped seat.
2. Say what it is, then rate it.

You can add up to 10 a day. Its surroundings are measured with one Overpass request. It's saved in the prototype's format and stays on your phone until Sitwell has accounts. "Tell OpenStreetMap" opens a note there, so it can be mapped for everyone.

### Home screen and offline

The app has a manifest, icons and a service worker (`app/sw.js`):
- **Pages, scripts and styles** come fresh from the network when there is one, so updates show up at once. Without a connection, the saved copies are used.
- **Fonts, icons and MapLibre** are kept on the phone.
- **Map tiles** you've looked at are kept too, up to 800.
- **Spot files** are kept by the app itself.

After a first rating, the app offers adding it to the home screen: Android shows its install prompt, iPhone gets the "Share, then Add to Home Screen" hint. It also asks the browser to keep your history (`navigator.storage.persist`).

If the service worker ever misbehaves, `sw.js` explains in its first lines how to switch it off for everyone.

On iPhone, the app on the home screen keeps its own storage, separate from Safari's, so it starts empty. My spots has **Copy my history** and **Paste history** to move it across. They work the same between browsers, and for the later move to `sitwellapp.com`.

### When the sun really goes

Sunset spots, the ones with open water toward the sunset, carry a horizon profile. It says how high the land rises in each direction between 230° and 310°, out to 50 km. It allows for the Earth's curve and for the air bending light near the horizon, and leaves out the first 250 m.

The pipeline builds the profiles from the free [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles): bare-earth heights in Europe from EU-DEM, read as Terrarium PNG tiles, no account needed. Attribution is shown in the app.

Terrain doesn't change, so each spot's profile is reused from the previous build while the spot hasn't moved. Only new sunset spots download tiles. If tiles can't be fetched, those spots simply keep the official sunset time.

The app works out each day when the sun drops behind the profile (`sunGone` in `present.js`). A Zürichhorn-like ridge test gives 37–39 minutes before the official sunset. That time drives:
- the spot card ("Tonight the sun leaves this spot at 18:05, behind the hills…");
- the evening ranking and the suns on the map;
- whether a spot counts as "over the water";
- the "Before sunset" meeting time.

Spots without a profile, such as live squares outside the three countries, show the official time with a note to come a bit early.

`node test/check-horizon.js` serves a made-up world (`test/dem-server.js`) and checks the profiles and timing.

### Your field guide

The round button at the top opens your field guide:
- **Pages:** one per spot you've rated or added.
- **Souvenirs:** a shelf of the kinds you've found.
- **Saved for later:** spots you've saved.
- **Passport:** for example "Zürich: 3 of 34 neighbourhoods".

Each page shows when you found the spot, your stars, its summary, your tags and any souvenir. A page can be shared as a picture with a link (`#spot=…`) that opens the spot for whoever receives it.

Souvenirs, from `app/guide.js`:
- Your first spot in each kind of setting gives its souvenir: a pebble by a lake, a feather by a river, a seashell by the sea, a dragonfly by a pond, a pinecone in the woods, a pressed flower in a park, a postcard at a viewpoint, an old coin near a landmark, a checked napkin at a picnic table.
- After that, about one new spot in five gives one. Which spots do is fixed per spot, so rating the same bench again doesn't help.
- A sunset spot rated in the hour before sunset gives a watercolour of the sunset.
- The first new spot of each autumn, spring and winter gives a chestnut, blossom or frost.

Everything is worked out from your history, read from the summary sentences, so ratings made in the prototype count too.

After a week without a new page, the panel suggests a promising spot nearby that you haven't rated ("a wish"). You can dismiss it for the day.

The raccoon is not part of this version; it stays in the old `bench-finder` repository.

## Not done yet

- Shared ratings with Supabase. With them come signed discoveries ("Found by …"), a souvenir for meeting a friend at a spot, and one for being the first to rate a spot.

- Sunset behind hills: precomputed terrain horizons from an elevation model.
- User-added benches, merged into the nightly build once Supabase exists.
- The app rewrite, which reads these files.
