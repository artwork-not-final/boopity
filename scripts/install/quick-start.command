#!/bin/sh
# Included at the TOP LEVEL of the generated Mac download, not run from source.
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
status=0
sh "$root/scripts/start-docker.sh" --quick-start || status=$?
# Keep errors visible when Finder launches a new Terminal window.
if [ -t 0 ] && [ -t 1 ]; then
  printf '\n%s' 'Press Return to finish. '
  IFS= read -r answer || true
fi
exit "$status"
