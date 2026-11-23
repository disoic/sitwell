#!/usr/bin/env bash
# Downloads each region's extract and outline from Geofabrik and reduces it.
#   bash pipeline/prepare.sh                    (all regions in pipeline/regions.json)
#   REGIONS=other.json WORK=dir bash pipeline/prepare.sh
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="${WORK:-work}"
mkdir -p "$WORK"
REGIONS="${REGIONS:-pipeline/regions.json}"
node -e 'for (const r of require(require("path").resolve(process.argv[1])).regions) if (r.url) console.log(r.code, r.url, r.poly || "-", r.name || r.code)' "$REGIONS" |
while read -r code url poly name; do
  echo "== $code ($name)"
  # Patient downloads: every error is retried for a few minutes (see download.sh).
  bash pipeline/download.sh "$url" "$WORK/$code.osm.pbf" "$name"
  if [ "$poly" != "-" ]; then bash pipeline/download.sh "$poly" "$WORK/$code.poly" "$name's outline"; fi
  ls -lh "$WORK/$code.osm.pbf"
  bash pipeline/reduce.sh "$WORK/$code.osm.pbf" "$WORK/$code.geojsonseq"
  rm -f "$WORK/$code.osm.pbf"
  ls -lh "$WORK/$code.geojsonseq"
done
