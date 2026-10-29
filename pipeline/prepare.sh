#!/usr/bin/env bash
# Downloads each region's extract and outline from Geofabrik and reduces it.
#   bash pipeline/prepare.sh                    (all regions in pipeline/regions.json)
#   REGIONS=other.json WORK=dir bash pipeline/prepare.sh
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="${WORK:-work}"
mkdir -p "$WORK"
REGIONS="${REGIONS:-pipeline/regions.json}"
node -e 'for (const r of require(require("path").resolve(process.argv[1])).regions) if (r.url) console.log(r.code, r.url, r.poly || "-")' "$REGIONS" |
while read -r code url poly; do
  echo "== $code"
  curl -sSfL --retry 3 -o "$WORK/$code.osm.pbf" "$url"
  if [ "$poly" != "-" ]; then curl -sSfL --retry 3 -o "$WORK/$code.poly" "$poly"; fi
  ls -lh "$WORK/$code.osm.pbf"
  bash pipeline/reduce.sh "$WORK/$code.osm.pbf" "$WORK/$code.geojsonseq"
  rm -f "$WORK/$code.osm.pbf"
  ls -lh "$WORK/$code.geojsonseq"
done
