#!/bin/sh
# Double-click on macOS; Docker must already be running.
exec sh "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/start-docker.sh" "$@"
