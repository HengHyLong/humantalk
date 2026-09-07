from pathlib import Path
import shutil
import subprocess

import pytest


def test_unified_residue_discovery_and_port_filtering() -> None:
    bash = shutil.which("bash")
    git_bash = Path("C:/Program Files/Git/bin/bash.exe")
    if git_bash.exists():
        bash = str(git_bash)
    if not bash:
        pytest.skip("bash unavailable")
    source = (Path(__file__).resolve().parents[2] / "scripts/quickstart/stop_all.sh").read_text()
    functions = source[source.index("unified_repo_pids() {"):source.index("stop_vite_port() {")]
    script = r'''
set -euo pipefail
export PATH="/usr/bin:$PATH"
repo_root=/repo
pgrep() {
  printf '%s\n' \
    '11 python -m apps.unified.main' \
    '12 /venv/bin/uvicorn apps.unified.main:create_app --port 8210' \
    '13 python -m uvicorn apps.unified.main:create_app --port=8210' \
    '14 uvicorn unrelated:app --port 8210' \
    '15 opentalking-unified' \
    '16 python -m apps.unified.main' |
    grep -E "$2" | cut -d ' ' -f 1
}
readlink() {
  case "$2" in
    /proc/15/cwd) echo /other ;;
    /proc/16/cwd) return 1 ;;
    *) echo /repo ;;
  esac
}
test "$(unified_repo_pids)" = "$(printf '11\n12\n13')"
# Stub process metadata and stop action: never signal real processes.
unified_repo_pids() { printf '11\n12\n13\n14\n15\n'; }
cat() { echo OPENTALKING_UNIFIED_PORT=8210; }
tr() {
  if [[ "$2" == ' ' ]]; then
    case "$pid" in
      11) echo 'uvicorn apps.unified.main:create_app --port 8210 ' ;;
      12) echo 'uvicorn apps.unified.main:create_app --port=8211 ' ;;
      13) echo 'python -m apps.unified.main ' ;;
      14) echo 'uvicorn apps.unified.main:create_app --port 82100 ' ;;
      15) echo 'python -m apps.unified.main ' ;;
    esac
  else
    if [[ "$pid" == 15 ]]; then cat >/dev/null; else cat; fi
  fi
}
stop_process_pid() { echo "STOP $3"; }
'''
    # Remove only the proc input redirection so the tr stub can supply metadata.
    functions = functions.replace('< "/proc/$pid/cmdline"', '')
    script = functions + script + '\nresult="$(stop_unified_port 8210)"\ntest "$(printf "%s\\n" "$result" | grep "^STOP")" = "$(printf "STOP 11\\nSTOP 13")"\n'
    subprocess.run([bash, "-c", script], check=True, capture_output=True, text=True)
