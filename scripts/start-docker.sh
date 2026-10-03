#!/bin/sh
# Local installer launcher. Requires Docker Compose v2, not Node on the host.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
file=compose.yaml
quick_start=false
case "${1:-}" in
  "") ;;
  --image) file=compose.image.yaml ;;
  --quick-start) file=compose.image.yaml; quick_start=true ;;
  *) printf '%s\n' 'Usage: sh scripts/start-docker.sh [--image|--quick-start]' >&2; exit 1 ;;
esac
[ "$#" -le 1 ] || exit 1
if [ "$quick_start" = true ]; then
  # Only the generated download contains this configuration and helper.
  . "$root/scripts/install/quick-start-checks.sh"
  quick_start_runtime
fi
compose() {
  if [ "$quick_start" = true ]; then
    docker compose --env-file /dev/null --project-name "$quick_project" --project-directory "$root" -f "$file" "$@"
  else
    docker compose --project-directory "$root" -f "$file" "$@"
  fi
}
if ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' 'Start Docker first, then run this launcher again.' >&2
  exit 1
fi
printf '%s\n' 'Starting Boopity…'
if ! existing=$(compose ps --all --quiet boopity); then
  printf '%s\n' 'Could not reach your Boopity container. Check that Docker is running and your Compose settings are valid.' >&2
  exit 1
fi
if [ "$quick_start" = true ]; then quick_start_preflight; fi
start_container() {
  if [ -n "$existing" ]; then
    # Opening the app is not an update operation. Preserve its current image/config.
    compose up --detach --no-recreate --no-build --pull never --wait --wait-timeout 180 boopity
  elif [ "$file" = compose.image.yaml ]; then
    compose up --detach --no-build --pull missing --wait --wait-timeout 180 boopity
  else
    compose up --detach --build --wait --wait-timeout 180 boopity
  fi
}
if ! start_container; then
  if [ "$quick_start" = true ]; then
    printf '%s\n' 'Boopity could not start. Check Docker and your internet connection, then open Start Boopity again. If the port is in use, close the other app first. Do not delete any data volumes.' >&2
  fi
  exit 1
fi
if [ "$quick_start" = true ]; then quick_start_binding; fi
printf '%s\n' 'Opening Boopity. If setup is unfinished, this replaces earlier setup links and sessions. Saved details stay.'
if ! entry=$(compose exec -T boopity node --input-type=module - < "$root/scripts/install/setup-entry.mjs" 2>/dev/null); then
  printf '%s\n' 'Boopity could not prepare its setup link. Check your Docker app and try again. Do not delete its data volume.' >&2
  exit 1
fi
# Treat all container output as data. Never eval it or open a non-web URL.
if [ "$(printf '%s\n' "$entry" | wc -l | tr -d ' ')" != 1 ] ||
  ! printf '%s\n' "$entry" | LC_ALL=C grep -Eq '^https?://[^[:space:]<>"]+/(app|setup#setup=[A-Za-z0-9_-]{43})$'; then
  printf '%s\n' 'Boopity returned an unexpected setup link. Nothing was opened.' >&2
  exit 1
fi
if [ "$quick_start" = true ]; then
  case "$entry" in
    "http://localhost:$quick_port/app"|"http://localhost:$quick_port/setup#setup="*) ;;
    *) printf '%s\n' 'Boopity returned an unexpected local address. Nothing was opened.' >&2; exit 1 ;;
  esac
fi
opened=false
browser_port=3000
if [ "$quick_start" = true ]; then browser_port=$quick_port; fi
if [ -n "${DOCKER_CONTEXT:-}" ]; then
  endpoint=$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
else
  endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}
fi
if [ -t 0 ] && [ -t 1 ] && [ "${BOOPITY_OPEN_BROWSER:-}" != false ] &&
  [ -z "${CI:-}${SSH_CONNECTION:-}${SSH_CLIENT:-}${SSH_TTY:-}" ]; then
  case "$endpoint" in
    unix://*)
      binding=$(compose port boopity 3000 2>/dev/null || true)
      case "$entry" in
        http://localhost:"$browser_port"/*|http://127.0.0.1:"$browser_port"/*)
          if [ "$binding" = "127.0.0.1:$browser_port" ]; then
            case "$(uname -s)" in
              Darwin) if open "$entry" >/dev/null 2>&1; then opened=true; fi ;;
              Linux) if command -v xdg-open >/dev/null 2>&1 && xdg-open "$entry" >/dev/null 2>&1; then opened=true; fi ;;
            esac
          fi ;;
      esac ;;
  esac
fi
if [ "$opened" = true ]; then
  printf '%s\n' 'Boopity opened in your browser.'
else
  printf '\nOpen Boopity:\n%s\n' "$entry"
fi
printf '%s\n' 'Keep private setup links to yourself. You can close this window; Boopity keeps running.'
