# QuickTalk Local Deployment

Use this path when OpenTalking should load the QuickTalk adapter in-process instead of introducing OmniRT first.

```bash title="Terminal"
# Change this to your deployment root
export DIGITAL_HUMAN_HOME=/path/to/digital_human
export OPENTALKING_HOME="$DIGITAL_HUMAN_HOME/opentalking"
mkdir -p "$DIGITAL_HUMAN_HOME"
if [ ! -d "$OPENTALKING_HOME/.git" ]; then
  git clone https://github.com/datascale-ai/opentalking.git "$OPENTALKING_HOME"
fi
export OPENTALKING_MODEL_ROOT="$DIGITAL_HUMAN_HOME/models"

# Set mirrors first when package downloads are slow.
export UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export UV_HTTP_TIMEOUT=300
export UV_LINK_MODE=copy

cd "$OPENTALKING_HOME"
uv sync --extra dev --extra models --extra quicktalk-cuda --python 3.11
source .venv/bin/activate
```

Prepare a QuickTalk local asset root that contains `checkpoints/quicktalk.pth`, `checkpoints/repair.npy`, HuBERT files, and InsightFace assets.

The avatar does not need to start as `model_type=quicktalk`. OpenTalking decouples avatar selection from model selection: if an avatar has `metadata.source_video`, `metadata.source_image`, `reference.png`, or `preview.png`, QuickTalk prewarm can generate the template video and face cache it needs. Dedicated QuickTalk avatars can still declare `metadata.quicktalk.template_video` explicitly.

Then start:

```bash title="Terminal"
export OPENTALKING_QUICKTALK_BACKEND=local
export OPENTALKING_QUICKTALK_ASSET_ROOT="$OPENTALKING_MODEL_ROOT/quicktalk"
export OPENTALKING_QUICKTALK_WORKER_CACHE=1
export OPENTALKING_TORCH_DEVICE=cuda:0
cd "$OPENTALKING_HOME"
bash scripts/start_unified.sh --backend local --model quicktalk --api-port 8000 --web-port 5173
```

Open `http://localhost:5173`, choose a clear front-facing avatar such as the built-in `singer`, and select the `quicktalk` model. The first run prewarms the avatar cache before the session starts.

## Frontend Startup

`scripts/start_unified.sh` starts the WebUI as well as the OpenTalking API. To restart only the frontend while the API is already running on port `8000`, use a second terminal:

```bash title="Terminal"
cd "$OPENTALKING_HOME"
bash scripts/quickstart/start_frontend.sh --api-port 8000 --web-port 5173 --host 0.0.0.0
```

For a remote server, forward your local browser port to the server `5173`, then open `http://127.0.0.1:5173`.

Verify:

```bash title="Terminal"
curl -s http://127.0.0.1:8000/models | python3 -m json.tool
```

## NVIDIA NVENC for Full-HD WebRTC Output

Running the model on CUDA does not automatically move WebRTC encoding to the GPU. Verify that the server's FFmpeg/PyAV build exposes `h264_nvenc`:

```bash title="Terminal"
ffmpeg -hide_banner -encoders | grep h264_nvenc
python - <<'PY'
import av
print(av.codec.Codec("h264_nvenc", "w"))
PY
```

Then configure:

```env title=".env"
OPENTALKING_WEBRTC_VIDEO_ENCODER=nvenc
OPENTALKING_WEBRTC_VIDEO_CODEC=h264
OPENTALKING_WEBRTC_NVENC_DEVICE=0
OPENTALKING_WEBRTC_NVENC_PRESET=p1
OPENTALKING_WEBRTC_NVENC_TUNE=ull
OPENTALKING_WEBRTC_VIDEO_START_BITRATE=4000000
OPENTALKING_WEBRTC_VIDEO_MAX_BITRATE=8000000
OPENTALKING_QUICKTALK_MAX_LONG_EDGE=1920
OPENTALKING_QUICKTALK_FPS=20
AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS=1200
```

After a WebRTC session starts, the log should contain `WebRTC H.264 encoder active: codec=h264_nvenc`. OpenTalking logs the error and falls back to `libx264` if NVENC cannot be initialized. NVENC reduces final video compression cost only; model generation must still complete faster than the corresponding audio duration.

`AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS` prevents video backpressure from draining previously queued audio. The `audio_buffer_ms=before-wait->after-wait->after-new-audio` log confirms that new audio is not played ahead of its matching video; the after-wait value normally settles near the reserve. A larger value improves jitter tolerance at the cost of additional playback buffering.
