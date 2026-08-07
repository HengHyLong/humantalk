#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
quickstart_dir="$script_dir/quickstart"
# shellcheck disable=SC1091
source "$quickstart_dir/_helpers.sh"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/start_unified.sh [--production] [--mock]
  bash scripts/start_unified.sh --dev [--mock]
  bash scripts/start_unified.sh --backend local --model MODEL [--api-port PORT] [--web-port PORT]
  bash scripts/start_unified.sh --backend omnirt --model MODEL --omnirt URL [--api-port PORT] [--web-port PORT]

Options:
  --production       Production mode (default): build Web/Admin and serve with HTTPS.
  --dev              Development mode: run Vite development servers over HTTP without SSL.
  --mock             Use the built-in Mock backend. No model weights or OmniRT required.
  --backend BACKEND  One of: mock, local, omnirt, direct_ws.
  --model MODEL      Model name whose backend should be overridden, for example quicktalk.
  --omnirt URL       OmniRT base URL, for example http://127.0.0.1:9000.
  --api-port PORT    OpenTalking API / unified backend port.
  --web-port PORT    WebUI port (development or production preview).
  --host HOST        WebUI bind host. API host can still be set with OPENTALKING_API_HOST.
  --env FILE         Source a quickstart env file before starting services.
  --help             Show this help.

Examples:
  bash scripts/start_unified.sh
  bash scripts/start_unified.sh --dev --mock
  bash scripts/start_unified.sh --backend local --model quicktalk
  bash scripts/start_unified.sh --backend omnirt --model flashtalk --omnirt http://127.0.0.1:9000
USAGE
}

backend=""
model=""
omnirt_url=""
api_port=""
web_port=""
web_host=""
env_file=""
run_mode="production"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --production|--prod)
      run_mode="production"
      shift
      ;;
    --dev|--development)
      run_mode="development"
      shift
      ;;
    --mock)
      backend="mock"
      shift
      ;;
    --backend)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --backend" >&2
        exit 2
      fi
      backend="$2"
      shift 2
      ;;
    --model)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --model" >&2
        exit 2
      fi
      model="$2"
      shift 2
      ;;
    --omnirt)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --omnirt" >&2
        exit 2
      fi
      omnirt_url="$2"
      shift 2
      ;;
    --api-port|--api_port)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
        exit 2
      fi
      api_port="$2"
      shift 2
      ;;
    --web-port|--web_port)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
        exit 2
      fi
      web_port="$2"
      shift 2
      ;;
    --host)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --host" >&2
        exit 2
      fi
      web_host="$2"
      shift 2
      ;;
    --env)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --env" >&2
        exit 2
      fi
      env_file="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "$env_file" ]]; then
  if [[ ! -f "$env_file" ]]; then
    echo "Env file not found: $env_file" >&2
    exit 2
  fi
  export OPENTALKING_QUICKSTART_ENV="$env_file"
else
  env_file="${OPENTALKING_QUICKSTART_ENV:-$quickstart_dir/env}"
fi
quickstart_source_env "$env_file"

backend="${backend:-${OPENTALKING_START_BACKEND:-mock}}"
model="${model:-${OPENTALKING_START_MODEL:-${OPENTALKING_DEFAULT_MODEL:-}}}"
backend="$(printf '%s' "$backend" | tr '[:upper:]' '[:lower:]')"
case "$backend" in
  mock|local|omnirt|direct_ws) ;;
  *)
    echo "Invalid backend: $backend" >&2
    echo "Expected one of: mock, local, omnirt, direct_ws" >&2
    exit 2
    ;;
esac

env_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

prepare_production_app() {
  local app_dir="$1"
  local label="$2"
  local production_env="$app_dir/.env.production"
  local production_example="$app_dir/.env.production.example"
  if [[ ! -f "$production_env" ]]; then
    if [[ ! -f "$production_example" ]]; then
      echo "$label production config is missing: $production_env" >&2
      exit 1
    fi
    cp "$production_example" "$production_env"
    echo "Created $production_env from its production template."
  fi
  local key_path="$(env_value "$production_env" HTTPS_KEY_PATH)"
  local cert_path="$(env_value "$production_env" HTTPS_CERT_PATH)"
  key_path="${key_path:-./ssl/ai.oaii.cn.key}"
  cert_path="${cert_path:-./ssl/ai.oaii.cn_bundle.pem}"
  [[ "$key_path" = /* ]] || key_path="$app_dir/$key_path"
  [[ "$cert_path" = /* ]] || cert_path="$app_dir/$cert_path"
  if [[ ! -f "$key_path" || ! -f "$cert_path" ]]; then
    echo "$label HTTPS certificate is not ready." >&2
    echo "  key:  $key_path" >&2
    echo "  cert: $cert_path" >&2
    echo "Update $production_env before starting production." >&2
    exit 1
  fi
}

if [[ "$run_mode" == "development" ]]; then
  export OPENTALKING_WEB_DEV_SERVER=1
  export OPENTALKING_ADMIN_DEV_SERVER=1
else
  export OPENTALKING_WEB_DEV_SERVER=0
  export OPENTALKING_ADMIN_DEV_SERVER=0
  prepare_production_app "$script_dir/../apps/web" "Web"
  prepare_production_app "$script_dir/../apps/admin" "Admin"
  public_web_url="$(env_value "$script_dir/../apps/admin/.env.production" VITE_PUBLIC_WEB_URL)"
  if [[ -z "$public_web_url" || "$public_web_url" == *"localhost"* || "$public_web_url" == *"127.0.0.1"* ]]; then
    echo "Admin production VITE_PUBLIC_WEB_URL must be a visitor-accessible HTTPS URL." >&2
    echo "Update $script_dir/../apps/admin/.env.production before starting production." >&2
    exit 1
  fi
  if [[ "$public_web_url" != https://* ]]; then
    echo "Admin production VITE_PUBLIC_WEB_URL must start with https://: $public_web_url" >&2
    exit 1
  fi
fi

echo "OpenTalking startup mode: $run_mode"

stop_frontend_mode_mismatch() {
  local pid_file="$1"
  local label="$2"
  local app_dir="$3"
  [[ -f "$pid_file" ]] || return 0
  local pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
    return 0
  fi
  local command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  local mismatched=0
  if [[ "$run_mode" == "production" && "$command_line" == *"--mode development"* ]]; then
    mismatched=1
  elif [[ "$run_mode" == "development" && "$command_line" == *"preview --mode production"* ]]; then
    mismatched=1
  fi
  if [[ "$run_mode" == "production" && "$mismatched" == "0" ]]; then
    local changed_file="$(find "$app_dir/src" "$app_dir/package.json" "$app_dir/package-lock.json" "$app_dir/vite.config.ts" "$app_dir/.env.production" -newer "$pid_file" -print -quit 2>/dev/null || true)"
    if [[ -n "$changed_file" ]]; then
      echo "$label production source/config changed: $changed_file"
      mismatched=1
    fi
  fi
  if [[ "$mismatched" == "1" ]]; then
    echo "Restarting $label because its running mode does not match $run_mode."
    kill "$pid"
    for _ in {1..20}; do
      kill -0 "$pid" >/dev/null 2>&1 || break
      sleep 0.1
    done
    rm -f "$pid_file"
  fi
}

effective_web_port="${web_port:-${OPENTALKING_WEB_PORT:-5173}}"
effective_admin_port="${OPENTALKING_ADMIN_PORT:-5174}"
effective_home="${DIGITAL_HUMAN_HOME:-$(cd -- "$script_dir/../.." && pwd)}"
stop_frontend_mode_mismatch "$effective_home/run/opentalking-web-$effective_web_port.pid" "Web" "$script_dir/../apps/web"
stop_frontend_mode_mismatch "$effective_home/run/opentalking-admin-$effective_admin_port.pid" "Admin" "$script_dir/../apps/admin"

restart_api_if_code_changed() {
  local effective_api_port="${api_port:-${OPENTALKING_API_PORT:-${OPENTALKING_UNIFIED_PORT:-8000}}}"
  local pid_file="$effective_home/run/opentalking-api-$effective_api_port.pid"
  [[ -f "$pid_file" ]] || return 0
  local pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    rm -f "$pid_file"
    return 0
  fi
  local changed_file="$(find "$script_dir/../apps/api" "$script_dir/../opentalking" -type f -name '*.py' -newer "$pid_file" -print -quit 2>/dev/null || true)"
  local restart_reason=""
  if [[ -n "$changed_file" ]]; then
    restart_reason="source changed: $changed_file"
  else
    local openapi_document="$(curl --max-time 3 -fsS "http://127.0.0.1:$effective_api_port/openapi.json" 2>/dev/null || true)"
    local required_route
    for required_route in \
      '"/exhibitions/{exhibition_id}/entities"' \
      '"/api/v1/admin/event/images/upload"' \
      '"/api/v1/admin/event/exhibits/{record_id}/survey"' \
      '"/api/v1/public/exhibit-surveys/{token}"'; do
      if [[ "$openapi_document" != *"$required_route"* ]]; then
        restart_reason="running API is missing required route $required_route"
        break
      fi
    done
  fi
  [[ -n "$restart_reason" ]] || return 0
  echo "Restarting API because $restart_reason"
  kill "$pid"
  for _ in {1..40}; do
    kill -0 "$pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  rm -f "$pid_file"
}

restart_api_if_code_changed

start_args=()
web_args=()
if [[ -n "$api_port" ]]; then
  start_args+=(--api-port "$api_port")
  web_args+=(--api-port "$api_port")
fi
if [[ -n "$web_port" ]]; then
  web_args+=(--web-port "$web_port")
fi
if [[ -n "$web_host" ]]; then
  web_args+=(--host "$web_host")
fi

start_admin() {
  local admin_dir="$script_dir/../apps/admin"
  local admin_host="${web_host:-${OPENTALKING_WEB_HOST:-0.0.0.0}}"
  local admin_port="${OPENTALKING_ADMIN_PORT:-5174}"
  local admin_backend_port="${api_port:-${VITE_BACKEND_PORT:-${OPENTALKING_API_PORT:-${OPENTALKING_UNIFIED_PORT:-8000}}}}"
  local admin_api_base="${OPENTALKING_ADMIN_API_BASE:-/api}"
  local repo_root="$(cd -- "$script_dir/.." && pwd)"
  local digital_human_home="${DIGITAL_HUMAN_HOME:-$(cd -- "$repo_root/.." && pwd)}"
  local run_dir="$digital_human_home/run"
  local log_dir="$digital_human_home/logs"
  local pid_file="$run_dir/opentalking-admin-$admin_port.pid"
  local log_file="$log_dir/opentalking-admin-$admin_port.log"
  local admin_dev_server="${OPENTALKING_ADMIN_DEV_SERVER:-${OPENTALKING_WEB_DEV_SERVER:-0}}"
  local admin_scheme="https"
  local admin_curl_args=(--max-time 2 -fsS)
  if [[ "$admin_dev_server" == "1" ]]; then
    admin_scheme="http"
  else
    admin_curl_args+=(-k)
  fi
  local admin_url="$admin_scheme://127.0.0.1:$admin_port"

  mkdir -p "$run_dir" "$log_dir"

  if [[ -f "$pid_file" ]]; then
    local old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      echo "OpenTalking admin is already running: pid=$old_pid port=$admin_port"
      echo "Log: $log_file"
      return 0
    fi
    rm -f "$pid_file"
  fi

  if quickstart_port_in_use "$admin_port"; then
    if curl "${admin_curl_args[@]}" "$admin_url/" 2>/dev/null | grep -Fq '<title>四川博览集团数字人项目</title>'; then
      echo "OpenTalking admin is already running: port=$admin_port"
      echo "  url:  $admin_url"
      return 0
    fi
    echo "OpenTalking admin port $admin_port is already in use." >&2
    echo "Stop the existing service first, or choose another OPENTALKING_ADMIN_PORT." >&2
    quickstart_describe_port "$admin_port" >&2 || true
    return 1
  fi

  # Keep node_modules in sync with package-lock.json on every startup. Merely
  # checking whether the directory exists leaves deployments with stale
  # dependencies after package.json changes (for example the qrcode runtime
  # dependency used by the event survey page).
  echo "Installing admin dependencies with npm ci ..."
  if ! (cd "$admin_dir" && npm ci >>"$log_file" 2>&1); then
    echo "Failed to install admin dependencies. Last log lines:" >&2
    tail -80 "$log_file" >&2 || true
    return 1
  fi

  if [[ "$admin_dev_server" != "1" ]]; then
    echo "Building OpenTalking admin"
    if ! (cd "$admin_dir" && VITE_API_BASE="$admin_api_base" npm run build >>"$log_file" 2>&1); then
      echo "OpenTalking admin build failed. Last log lines:" >&2
      tail -80 "$log_file" >&2 || true
      return 1
    fi
  fi

  echo "Starting OpenTalking admin"
  echo "  admin: $admin_dir"
  echo "  url:   $admin_url"
  echo "  log:   $log_file"
  echo "  api:   http://127.0.0.1:$admin_backend_port"
  (
    cd "$admin_dir"
    export VITE_BACKEND_PORT="$admin_backend_port"
    export VITE_API_BASE="$admin_api_base"
    if [[ "$admin_dev_server" == "1" ]]; then
      quickstart_detach "$log_file" ./node_modules/.bin/vite --mode development --host "$admin_host" --port "$admin_port" --strictPort >"$pid_file"
    else
      quickstart_detach "$log_file" ./node_modules/.bin/vite preview --mode production --host "$admin_host" --port "$admin_port" --strictPort >"$pid_file"
    fi
  )

  local pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    echo "Failed to capture OpenTalking admin pid." >&2
    return 1
  fi

  for _ in {1..60}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "OpenTalking admin exited during startup. Last log lines:" >&2
      tail -80 "$log_file" >&2 || true
      rm -f "$pid_file"
      return 1
    fi
    if curl "${admin_curl_args[@]}" "$admin_url" >/dev/null 2>&1 \
      && curl "${admin_curl_args[@]}" "$admin_url/api/models" >/dev/null 2>&1; then
      echo "OpenTalking admin is up: $admin_url"
      return 0
    fi
    sleep 1
  done

  echo "OpenTalking admin did not become ready in 60s. Last log lines:" >&2
  tail -80 "$log_file" >&2 || true
  return 1
}

if [[ "$backend" == "mock" ]]; then
  if ((${#start_args[@]})); then
    bash "$quickstart_dir/start_opentalking.sh" --mock "${start_args[@]}"
  else
    bash "$quickstart_dir/start_opentalking.sh" --mock
  fi
  if ((${#web_args[@]})); then
    bash "$quickstart_dir/start_frontend.sh" "${web_args[@]}"
  else
    bash "$quickstart_dir/start_frontend.sh"
  fi
  start_admin
  echo ""
  echo "Open the app:"
  if [[ "${OPENTALKING_WEB_DEV_SERVER:-0}" == "1" ]]; then
    echo "  http://127.0.0.1:${web_port:-${OPENTALKING_WEB_PORT:-5173}}"
  else
    echo "  https://127.0.0.1:${web_port:-${OPENTALKING_WEB_PORT:-5173}}"
  fi
  if [[ "${OPENTALKING_ADMIN_DEV_SERVER:-${OPENTALKING_WEB_DEV_SERVER:-0}}" == "1" ]]; then
    echo "  Admin: http://127.0.0.1:${OPENTALKING_ADMIN_PORT:-5174}"
  else
    echo "  Admin: https://127.0.0.1:${OPENTALKING_ADMIN_PORT:-5174}"
  fi
  echo ""
  echo "Select mock / driverless mode to test without a real driver model."
  exit 0
fi

if [[ -z "$model" ]]; then
  echo "--model is required when --backend is $backend." >&2
  exit 2
fi

model_env_name="OPENTALKING_$(printf '%s' "$model" | tr '[:lower:]-' '[:upper:]_')_BACKEND"
export "$model_env_name=$backend"
export OPENTALKING_DEFAULT_MODEL="$model"

if [[ "$backend" == "omnirt" ]]; then
  if [[ -n "$omnirt_url" ]]; then
    start_args+=(--omnirt "$omnirt_url")
  elif [[ -z "${OMNIRT_ENDPOINT:-}" ]]; then
    echo "--omnirt URL is required for --backend omnirt unless OMNIRT_ENDPOINT is set." >&2
    exit 2
  fi
fi

if [[ -n "$omnirt_url" && "$backend" != "omnirt" ]]; then
  export OMNIRT_ENDPOINT="$omnirt_url"
fi

if [[ "$backend" == "local" && "$model" == "musetalk" ]]; then
  export OMNIRT_ENDPOINT=""
  export OPENTALKING_OMNIRT_ENDPOINT=""
  export OPENTALKING_MUSETALK_DEVICE="${OPENTALKING_MUSETALK_DEVICE:-cuda:0}"
  export OPENTALKING_TORCH_DEVICE="${OPENTALKING_TORCH_DEVICE:-$OPENTALKING_MUSETALK_DEVICE}"
  bash "$quickstart_dir/prepare_local_musetalk.sh"
fi

if [[ "$backend" == "local" && "$model" == "quicktalk" ]]; then
  export OMNIRT_ENDPOINT=""
  export OPENTALKING_OMNIRT_ENDPOINT=""
  if [[ "$(uname -s)" == "Darwin" && -z "${OPENTALKING_QUICKTALK_DEVICE:-}" && -z "${OPENTALKING_TORCH_DEVICE:-}" ]]; then
    quicktalk_mac_device="$("$script_dir/../.venv/bin/python" - <<'PY' 2>/dev/null || true
import platform
import sys

if sys.platform == 'darwin' and platform.machine().lower() in {'arm64', 'aarch64'}:
    try:
        import torch

        print('mps' if torch.backends.mps.is_available() else 'cpu')
    except Exception:
        print('cpu')
PY
)"
    quicktalk_mac_device="${quicktalk_mac_device:-cpu}"
    export OPENTALKING_QUICKTALK_DEVICE="$quicktalk_mac_device"
    export OPENTALKING_TORCH_DEVICE="$quicktalk_mac_device"
    echo "Apple Silicon QuickTalk local defaults: OPENTALKING_QUICKTALK_DEVICE=$quicktalk_mac_device"
    echo "Install macOS QuickTalk dependencies with: uv sync --extra dev --extra models --extra quicktalk-cpu --python 3.11"
  fi
fi

bash "$quickstart_dir/start_opentalking.sh" "${start_args[@]}"
bash "$quickstart_dir/start_frontend.sh" "${web_args[@]}"
start_admin

echo ""
echo "Open the app:"
if [[ "${OPENTALKING_WEB_DEV_SERVER:-0}" == "1" ]]; then
  echo "  http://127.0.0.1:${web_port:-${OPENTALKING_WEB_PORT:-5173}}"
else
  echo "  https://127.0.0.1:${web_port:-${OPENTALKING_WEB_PORT:-5173}}"
fi
if [[ "${OPENTALKING_ADMIN_DEV_SERVER:-${OPENTALKING_WEB_DEV_SERVER:-0}}" == "1" ]]; then
  echo "  Admin: http://127.0.0.1:${OPENTALKING_ADMIN_PORT:-5174}"
else
  echo "  Admin: https://127.0.0.1:${OPENTALKING_ADMIN_PORT:-5174}"
fi
echo ""
echo "Default model: $model"
echo "Backend override: $model_env_name=$backend"
