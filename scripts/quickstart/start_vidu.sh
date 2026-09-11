#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
default_home="$(cd -- "$repo_root/.." && pwd)"
# shellcheck disable=SC1091
source "$script_dir/_helpers.sh"

quickstart_source_env "${OPENTALKING_QUICKSTART_ENV:-$script_dir/env}"
quickstart_source_env "$repo_root/.env"

export DIGITAL_HUMAN_HOME="${DIGITAL_HUMAN_HOME:-$default_home}"
port="${OPENTALKING_VIDU_PROXY_PORT:-18088}"
run_dir="$DIGITAL_HUMAN_HOME/run"
log_dir="$DIGITAL_HUMAN_HOME/logs"
pid_file="$run_dir/vidu-live-proxy-$port.pid"
log_file="$log_dir/vidu-live-proxy-$port.log"

if [[ ! -f "$repo_root/apps/vidu_proxy/main.py" ]]; then
  echo "Vidu runtime not found: $repo_root/apps/vidu_proxy/main.py" >&2
  exit 1
fi

mkdir -p "$run_dir" "$log_dir"
if [[ -f "$pid_file" ]]; then
  old_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1 \
    && curl --max-time 2 -fsS "http://127.0.0.1:$port/index.html" >/dev/null 2>&1; then
    echo "Vidu Live proxy is already running: pid=$old_pid port=$port"
    exit 0
  fi
  rm -f "$pid_file"
fi

if quickstart_port_in_use "$port"; then
  echo "Vidu Live proxy port $port is already in use." >&2
  quickstart_describe_port "$port" >&2 || true
  exit 1
fi

# OpenTalking API adds the server-side provider key to proxied requests. It is
# therefore absent from this process command line, browser URL, and proxy log.
(
  cd "$repo_root"
  quickstart_detach "$log_file" "$repo_root/.venv/bin/python" -m apps.vidu_proxy.main \
    --addr "127.0.0.1:$port" >"$pid_file"
)

pid="$(cat "$pid_file" 2>/dev/null || true)"
for _ in {1..20}; do
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1 \
    && curl --max-time 2 -fsS "http://127.0.0.1:$port/index.html" >/dev/null 2>&1; then
    echo "Vidu Live proxy is up: http://127.0.0.1:$port"
    echo "OpenTalking endpoint: http://127.0.0.1:$port/proxy/cn"
    echo "Log: $log_file"
    exit 0
  fi
  sleep 0.5
done

echo "Vidu Live proxy failed to start. Last log lines:" >&2
tail -60 "$log_file" >&2 || true
exit 1
