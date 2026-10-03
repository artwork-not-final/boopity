# Sourced by the shared launcher, only for the generated local Quick Start bundle.
# These constants are also checked against the generated Compose configuration.
quick_project=boopity-quick-start
quick_port=3000
quick_volume="${quick_project}_boopity-data"

quick_fail() { printf '%s\n' "$1" >&2; exit 1; }

quick_start_runtime() {
  [ -f "$root/BUNDLE.json" ] || quick_fail 'Use Start Boopity from the extracted Quick Start download. This folder is not a Quick Start bundle.'
  # Finder-launched Terminal windows may not have Docker's CLI on PATH.
  if ! command -v docker >/dev/null 2>&1 && [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then
    PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
    export PATH
  fi
  command -v docker >/dev/null 2>&1 || quick_fail 'Open Docker Desktop first, then double-click Start Boopity again. Docker Desktop must be installed on this Mac.'
  [ -z "${SSH_CONNECTION:-}${SSH_CLIENT:-}${SSH_TTY:-}" ] || quick_fail 'Quick Start is for this computer. For a server installation, follow the hosting guide in Read Me.'
  if [ -n "${DOCKER_CONTEXT:-}" ]; then
    endpoint=$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
  else
    endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}
  fi
  case "$endpoint" in
    unix://*) ;;
    *) quick_fail 'Docker is pointing to another computer or could not be found. Select your local Docker Desktop connection, then open Start Boopity again.' ;;
  esac
  if ! operating_system=$(docker info --format '{{.OSType}}' 2>/dev/null) || [ "$operating_system" != linux ]; then
    quick_fail 'Docker is not ready. Open Docker Desktop, wait until it is running, then double-click Start Boopity again.'
  fi
  # The download is self-contained: never read a nearby .env or Compose override.
  unset COMPOSE_FILE COMPOSE_ENV_FILES COMPOSE_PROFILES COMPOSE_PROJECT_NAME
  COMPOSE_DISABLE_ENV_FILE=true
  export COMPOSE_DISABLE_ENV_FILE
}

quick_start_preflight() {
  # Refuse to adopt someone else's container or volume under our stable name.
  project_containers=$(docker ps --all --no-trunc --filter "label=com.docker.compose.project=$quick_project" --format '{{.ID}}') || quick_fail 'Could not check the existing installation. Check Docker Desktop and try again.'
  [ "$project_containers" = "$existing" ] || quick_fail 'The Quick Start name is already used by another Docker installation. Nothing was changed. Keep using its original launcher.'
  if [ -z "$existing" ]; then
    # A stopped manual/source Compose install still owns its usual address.
    other_installations=$(docker ps --all --no-trunc --filter 'label=com.docker.compose.service=boopity' --format '{{.ID}}') || quick_fail 'Could not check other Boopity installations. Nothing was changed.'
    for installation in $other_installations; do
      ports=$(docker inspect "$installation" --format '{{range index .HostConfig.PortBindings "3000/tcp"}}{{println .HostPort}}{{end}}') || quick_fail 'Could not check an existing installation. Nothing was changed.'
      if printf '%s\n' "$ports" | grep -Fxq "$quick_port"; then
        quick_fail "Boopity is already installed for port $quick_port, even if it is stopped. Use its original launcher or start that container in Docker Desktop. Quick Start has not created a second installation or changed your data."
      fi
    done
  fi
  volume=$(docker volume ls --filter "name=^${quick_volume}$" --format '{{.Name}}') || quick_fail 'Could not check saved data. Check Docker Desktop and try again.'
  if [ -n "$volume" ]; then
    [ "$volume" = "$quick_volume" ] || quick_fail 'The saved-data location is unexpected. Nothing was changed.'
    label=$(docker volume inspect "$volume" --format '{{index .Labels "org.boopity.quick-start"}}') || quick_fail 'Could not check saved data. Nothing was changed.'
    [ "$label" = 1 ] || quick_fail 'Existing data was found, but it does not belong to Quick Start. Nothing was changed. Keep using the original installation.'
    [ -n "$existing" ] || quick_fail 'Your saved data is still here, but its container is missing. Nothing was reset. Follow the recovery guide in Read Me before reconnecting it.'
  elif [ -n "$existing" ]; then
    quick_fail 'The existing installation is missing its expected data volume. Nothing was reset. Follow the recovery guide in Read Me.'
  fi
  running=false
  if [ -n "$existing" ]; then
    identity=$(docker inspect "$existing" --format '{{index .Config.Labels "org.boopity.quick-start"}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}:{{.Name}}{{end}}{{end}}|{{range index .HostConfig.PortBindings "3000/tcp"}}{{.HostIp}}:{{.HostPort}}{{end}}') || quick_fail 'Could not check the existing container. Nothing was changed.'
    [ "$identity" = "1|volume:$quick_volume|127.0.0.1:$quick_port" ] || quick_fail 'The existing container uses different settings. Nothing was changed. Keep using its original launcher.'
    running=$(docker inspect "$existing" --format '{{.State.Running}}') || quick_fail 'Could not check whether Boopity is running.'
  fi
  listeners=$(docker ps --no-trunc --filter "publish=$quick_port" --format '{{.ID}}') || quick_fail 'Could not check the local port. Check Docker Desktop and try again.'
  if [ -n "$listeners" ] && [ "$listeners" != "$existing" ]; then
    quick_fail "Port $quick_port is already being used. If Boopity is already installed, open http://localhost:$quick_port or use its original launcher. Otherwise close the app using that port and try again. Nothing was replaced."
  fi
  if [ "$running" != true ] && command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$quick_port" -sTCP:LISTEN >/dev/null 2>&1; then
    quick_fail "Port $quick_port is already being used by another app. Close that app, or use your existing Boopity installation, then try again. Nothing was replaced."
  fi
}

quick_start_binding() {
  binding=$(compose port boopity 3000 2>/dev/null || true)
  [ "$binding" = "127.0.0.1:$quick_port" ] || quick_fail 'The local address is unexpected. No private setup link was requested. Use the original installation settings.'
}
