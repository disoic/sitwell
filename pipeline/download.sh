#!/usr/bin/env bash
# Downloads one file, patiently. Every error is retried with pauses in between, a refused
# connection included: curl's plain --retry skips refused connections, and a single refusal
# from Geofabrik on 15 November 2026 stopped a whole build. If it still fails, it says in
# plain words what went wrong (on GitHub, as an error on the run's page).
#   bash pipeline/download.sh URL OUTPUT [what, e.g. "Switzerland"]
#   TRIES (default 6) and PAUSE (seconds between tries, default 30) set the patience.
set -uo pipefail
url="$1"; out="$2"; what="${3:-$(basename "$out")}"
tries="${TRIES:-6}"; pause="${PAUSE:-30}"

rc=0
curl --no-progress-meter -fL --connect-timeout 20 \
  --retry "$((tries - 1))" --retry-delay "$pause" --retry-all-errors \
  -A "Sitwell map build (https://github.com/disoic/sitwell)" \
  -o "$out" "$url" || rc=$?
[ "$rc" -eq 0 ] && exit 0

case "$rc" in
  6) why="the server's name couldn't be looked up" ;;
  7) why="the connection was refused or the server couldn't be reached" ;;
  18) why="the download stopped partway" ;;
  22) why="the server answered with an error, so the file may have moved" ;;
  28) why="the connection timed out" ;;
  35) why="the secure connection couldn't be set up" ;;
  52|56) why="the connection broke off" ;;
  *) why="curl reported error $rc" ;;
esac
host=$(printf '%s' "$url" | sed -E 's#^[a-zA-Z]+://([^/]+).*#\1#')
secs=$(( (tries - 1) * pause ))
if [ "$secs" -lt 90 ]; then span="$secs second$([ "$secs" -eq 1 ] || echo s)"; else span="about $(( (secs + 30) / 60 )) minutes"; fi
msg="Couldn't download $what from $host: $why (curl error $rc). Tried $tries times over $span."
if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error title=Map download failed::$msg"; else echo "$msg" >&2; fi
rm -f "$out"
exit "$rc"
