"""Pytest process-wide setup for the Windows development environment."""

from __future__ import annotations

import os


# pymatting imports numba through rembg. Its first cache write can block for a
# long time in Windows temporary directories (especially under antivirus
# scanning), even though these tests do not need compiled numba kernels. Keep
# this scoped to pytest; production processes retain normal numba behavior.
os.environ.setdefault("NUMBA_DISABLE_JIT", "1")
