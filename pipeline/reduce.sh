#!/usr/bin/env bash
# Reduces an OpenStreetMap extract to what Sitwell uses and exports it as GeoJSON lines.
#   bash pipeline/reduce.sh input.osm.pbf work/CH.geojsonseq
set -euo pipefail
in="$1"; out="$2"
dir="$(cd "$(dirname "$0")" && pwd)"
tmp="${out%.geojsonseq}"
osmium tags-filter --no-progress --overwrite -e "$dir/filter.txt" -o "$tmp.main.osm.pbf" "$in"
# Named footpaths and pedestrian streets ("on a promenade") need two conditions: path type and a name.
osmium tags-filter --no-progress --overwrite -o "$tmp.paths.osm.pbf" "$in" w/highway=pedestrian,footway,path
osmium tags-filter --no-progress --overwrite -o "$tmp.named.osm.pbf" "$tmp.paths.osm.pbf" w/name
osmium merge --no-progress --overwrite -o "$tmp.osm.pbf" "$tmp.main.osm.pbf" "$tmp.named.osm.pbf"
osmium export --no-progress --overwrite -c "$dir/osmium-export.json" -f geojsonseq -x print_record_separator=false \
  -u type_id -o "$out" "$tmp.osm.pbf"
rm -f "$tmp.main.osm.pbf" "$tmp.paths.osm.pbf" "$tmp.named.osm.pbf" "$tmp.osm.pbf"
