#!/bin/bash
# Run the Unpad bridge on your own Mac as a launchd user agent.
# Usage: scripts/bridge-service.sh install [--tailnet] | uninstall | status
# The bridge starts at login. Use --tailnet to also reach it from other Tailscale devices.
# A failed install leaves the new job loaded and exits non-zero. Run install again from a good commit.
set -euo pipefail

label=com.samuelzhang.filler-cut-bridge
port=18931
tailnet=false
if [ "${2:-}" = "--tailnet" ]; then tailnet=true; fi
case "$#:${1:-}:${2:-}" in
  1:install:|2:install:--tailnet|1:uninstall:|1:status:) ;;
  *) echo "usage: $0 install [--tailnet] | uninstall | status" >&2; exit 2 ;;
esac
repo=$(cd "$(dirname "$0")/.." && pwd)
live="$HOME/.pi/agent/filler-cut/bridge-live"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/filler-cut-bridge.log"
domain="gui/$(id -u)"

loaded() {
  launchctl print "$domain/$label" >/dev/null 2>&1
}

job_pid() {
  launchctl print "$domain/$label" 2>/dev/null | awk '/^\tpid = /{print $3}'
}

# True only when the process that listens on the port is the launchd job and it answers as the bridge.
# Another program on the port must never pass, because install then serves that port to the tailnet.
healthy() {
  local pid
  pid=$(job_pid)
  [ -n "$pid" ] || return 1
  [ "$(lsof -nP -iTCP@127.0.0.1:"$port" -sTCP:LISTEN -t 2>/dev/null)" = "$pid" ] || return 1
  curl -fsS -m 3 --noproxy '*' "http://127.0.0.1:$port/health" 2>/dev/null | grep -q '"selectorVersion"'
}

wait_healthy() {
  for _ in $(seq 1 50); do
    if healthy; then return 0; fi
    sleep 0.2
  done
  echo "the launchd job did not answer as the bridge on port $port; see $log" >&2
  return 1
}

wait_unloaded() {
  for _ in $(seq 1 50); do
    if ! loaded; then return 0; fi
    sleep 0.2
  done
  echo "launchd still has $label loaded" >&2
  return 1
}

# Prints what the tailnet HTTPS port proxies to, or nothing when the port is not served.
serve_backend() {
  tailscale serve status --json 2>/dev/null | python3 -c '
import json, sys
port = sys.argv[1]
web = (json.load(sys.stdin) or {}).get("Web") or {}
for host, site in web.items():
    if host.endswith(":" + port):
        handlers = site.get("Handlers", {})
        root = handlers.get("/", {}).get("Proxy") if list(handlers) == ["/"] else None
        print(root or json.dumps(handlers, sort_keys=True))
' "$port"
}

# Refuses to adopt or remove a route on this port that points anywhere but the bridge.
check_serve() {
  local backend
  backend=$(serve_backend)
  if [ -n "$backend" ] && [ "$backend" != "http://127.0.0.1:$port" ]; then
    echo "tailnet port $port already proxies to $backend; not touching it" >&2
    return 1
  fi
}

served() {
  [ "$(serve_backend)" = "http://127.0.0.1:$port" ]
}

xml() {
  printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

install() {
  # The service runs a checkout of its own, so edits in the working repo never reach a restart.
  if $tailnet; then
    check_serve
  elif command -v tailscale >/dev/null && served; then
    echo "The bridge already has a tailnet route. Use install --tailnet to keep it, or remove it with tailscale serve --https=$port off." >&2
    return 1
  fi
  bun_path=$(command -v bun || true)
  pi_path=$(command -v pi || true)
  service_path="$(dirname "$pi_path"):$HOME/.pi/agent/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  for tool in "$bun_path" "$pi_path"; do
    if [ ! -x "$tool" ]; then
      echo "Bun and Pi must both be on PATH" >&2
      return 1
    fi
  done
  commit=$(git -C "$repo" rev-parse HEAD)
  if [ -e "$live" ]; then
    if ! git -C "$repo" worktree list --porcelain | grep -qx "worktree $live"; then
      echo "$live exists and is not this repo's service checkout; not touching it" >&2
      return 1
    fi
    if [ -n "$(git -C "$live" status --porcelain)" ]; then
      echo "$live has local changes; remove them before installing" >&2
      return 1
    fi
    git -C "$live" checkout -q --detach "$commit"
  else
    git -C "$repo" worktree add -q --detach "$live" "$commit"
  fi

  mkdir -p "$(dirname "$plist")" "$(dirname "$log")"
  cat > "$plist.tmp" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$(xml "$bun_path")</string>
		<string>bridge/server.ts</string>
	</array>
	<key>WorkingDirectory</key><string>$(xml "$live")</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>HOME</key><string>$(xml "$HOME")</string>
		<key>PATH</key><string>$(xml "$service_path")</string>
		<key>PORT</key><string>$port</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>5</integer>
	<key>StandardOutPath</key><string>$(xml "$log")</string>
	<key>StandardErrorPath</key><string>$(xml "$log")</string>
</dict>
</plist>
PLIST
  plutil -lint "$plist.tmp" >/dev/null
  mv "$plist.tmp" "$plist"

  # Reload so a changed plist or a new commit takes effect. Both steps are safe to repeat.
  # bootout returns before launchd has dropped the job, and bootstrap fails until it has.
  if loaded; then launchctl bootout "$domain/$label"; fi
  wait_unloaded
  launchctl bootstrap "$domain" "$plist"
  wait_healthy

  if $tailnet && ! served; then
    tailscale serve --bg --https="$port" "http://127.0.0.1:$port" >/dev/null
  fi
  status
}

uninstall() {
  if loaded; then launchctl bootout "$domain/$label"; fi
  wait_unloaded
  rm -f "$plist"
  if command -v tailscale >/dev/null && backend=$(serve_backend); then
    if [ "$backend" = "http://127.0.0.1:$port" ]; then
      tailscale serve --https="$port" off >/dev/null
    fi
  else
    echo "Could not check the optional tailnet route on port $port." >&2
  fi
  if [ -d "$live" ]; then
    git -C "$repo" worktree remove "$live"
  fi
  echo "removed $label and $live; the log and the data directory stay"
}

status() {
  if loaded; then
    echo "launchd: $label loaded, pid $(job_pid)"
  else
    echo "launchd: $label not loaded"
  fi
  if healthy; then
    echo "local: $(curl -fsS -m 3 --noproxy '*' "http://127.0.0.1:$port/health")"
  else
    echo "local: the launchd job is not answering as the bridge on port $port"
  fi
  if ! command -v tailscale >/dev/null || ! backend=$(serve_backend); then
    echo "tailnet: status unavailable"
  elif [ -n "$backend" ]; then
    echo "tailnet: port $port proxies to $backend"
  else
    echo "tailnet: port $port is not served"
  fi
  if [ -d "$live" ]; then
    echo "commit: $(git -C "$live" rev-parse --short HEAD)"
  fi
}

"$1"
