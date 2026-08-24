# QuickTalk Local 单机部署

适用：你希望 OpenTalking 直接在本进程内加载 QuickTalk adapter，不先引入独立 OmniRT 服务。这是验证自定义 avatar、本地 STT/TTS 和实时数字人链路的推荐起点。

## 1. 安装依赖

```bash title="终端"
# 改成你自己的部署根目录
export DIGITAL_HUMAN_HOME=/path/to/digital_human
export OPENTALKING_HOME="$DIGITAL_HUMAN_HOME/opentalking"
mkdir -p "$DIGITAL_HUMAN_HOME"
if [ ! -d "$OPENTALKING_HOME/.git" ]; then
  git clone https://github.com/datascale-ai/opentalking.git "$OPENTALKING_HOME"
fi
export OPENTALKING_MODEL_ROOT="$DIGITAL_HUMAN_HOME/models"

# 网络较慢时先设置镜像。
export UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export UV_HTTP_TIMEOUT=300
export UV_LINK_MODE=copy

cd "$OPENTALKING_HOME"
uv sync --extra dev --extra models --extra quicktalk-cuda --python 3.11
source .venv/bin/activate
```

## 2. 准备权重

local adapter 的资产根必须包含 `checkpoints/` 目录。推荐放在统一模型目录 `$OPENTALKING_MODEL_ROOT/quicktalk`。

```text
$OPENTALKING_MODEL_ROOT/quicktalk/
  checkpoints/
    quicktalk.pth
    repair.npy
    chinese-hubert-large/
      pytorch_model.bin
    auxiliary/models/buffalo_l/ 或 auxiliary_min/
      det_10g.onnx
```

如果已有旧资产包以 `hdModule/checkpoints/` 组织，可以把 `OPENTALKING_QUICKTALK_ASSET_ROOT` 指向 `hdModule` 的父目录或 `hdModule` 本身，adapter 会自动归一化到实际包含 `checkpoints/` 的目录。

## 3. 配置

```env title=".env"
OPENTALKING_QUICKTALK_BACKEND=local
OPENTALKING_QUICKTALK_ASSET_ROOT=$OPENTALKING_MODEL_ROOT/quicktalk
OPENTALKING_QUICKTALK_WORKER_CACHE=1
OPENTALKING_TORCH_DEVICE=cuda:0
```

Avatar 不必一开始就是 `model_type=quicktalk`。当前 OpenTalking 已经把 Avatar 和模型选择解耦：只要 Avatar 目录里有 `metadata.source_video`、`metadata.source_image`、`reference.png` 或 `preview.png`，QuickTalk prewarm 就会自动生成本模型需要的模板视频和人脸缓存。

如果你已经维护专用 QuickTalk Avatar，也可以在 manifest 中显式声明：

```json title="manifest.json"
{
  "model_type": "quicktalk",
  "metadata": {
    "asset_root": "$OPENTALKING_MODEL_ROOT/quicktalk",
    "template_video": "$OPENTALKING_MODEL_ROOT/quicktalk/templates/custom.mp4"
  }
}
```

## 4. 启动

```bash title="终端"
cd "$OPENTALKING_HOME"
bash scripts/start_unified.sh --backend local --model quicktalk --api-port 8000 --web-port 5173
```

打开 `http://localhost:5173`，选择一个正脸清晰、带 `reference.png` 或 `source_video` 的 Avatar，例如内置 `singer`，再选择 `quicktalk` 模型。首次启动会先预热 Avatar Cache，耗时取决于 GPU 和人脸检测速度。

## 5. 启动或重启前端

上一步的 `scripts/start_unified.sh` 已经会启动 WebUI。若只需要重启前端，或后端已经在 `8000` 端口运行，另开终端执行：

```bash title="终端"
cd "$OPENTALKING_HOME"
bash scripts/quickstart/start_frontend.sh --api-port 8000 --web-port 5173 --host 0.0.0.0
```

远程服务器部署时，把本地浏览器端口映射到服务器 `5173`，再打开 `http://127.0.0.1:5173`。

## 6. 准备 Avatar Cache

QuickTalk 会为每个 avatar 生成运行缓存。缓存来源优先级是 manifest 中的 `metadata.quicktalk.template_video`、`metadata.source_video`，然后是目录下的 `idle.mp4`、`source.mp4`，最后是 `metadata.source_image`、`reference.png`、`preview.png` 等图片：

- `examples/avatars/<avatar>/quicktalk/template_<width>x<height>.mp4`
- `examples/avatars/<avatar>/quicktalk/face_cache_v3_<width>x<height>.npz`

需要提前准备时运行：

```bash title="终端"
cd "$OPENTALKING_HOME"
opentalking-prepare-cache \
  --model quicktalk \
  --avatars-root examples/avatars \
  --quicktalk-asset-root "$OPENTALKING_MODEL_ROOT/quicktalk" \
  --device cuda:0 \
  --model-backend pth \
  --verify
```

## 7. 验证

```bash title="终端"
curl -s http://127.0.0.1:8000/models | python3 -m json.tool
```

期望：

```json
{"id":"quicktalk","backend":"local","connected":true,"reason":"local_runtime"}
```

## 8. 使用 NVIDIA NVENC 输出全高清视频

模型运行在 CUDA 上不代表 WebRTC 会自动使用 GPU 编码。默认 aiortc 会使用软件编码器；如需降低 1080×1920 实时会话的 CPU 编码压力，先确认服务器 FFmpeg/PyAV 支持 `h264_nvenc`：

```bash title="终端"
ffmpeg -hide_banner -encoders | grep h264_nvenc
python - <<'PY'
import av
print(av.codec.Codec("h264_nvenc", "w"))
PY
```

然后配置：

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

服务启动并建立 WebRTC 会话后，日志应出现 `WebRTC H.264 encoder active: codec=h264_nvenc`。如果驱动、PyAV 或 NVENC 会话不可用，OpenTalking 会记录原因并自动回退到 `libx264`。NVENC 只降低最终视频压缩开销；如果 `FlashTalk live generate` 日志中的模型生成耗时已经超过对应音频时长，仍需降低模型实时输出尺寸或帧率。

`AUDIO2VIDEO_PLAYBACK_AUDIO_RESERVE_MS` 用于避免等待视频队列时耗尽旧音频。日志中的 `audio_buffer_ms=等待前->等待后->新音频入队后` 可以确认背压期间没有提前播放新音频；等待后的数值通常会停在储备线附近。`av_queue_skew_ms` 是音频减视频的排队时长估算，持续为较大正数表示音频积压更多，持续为较大负数表示视频积压更多。数值提高会增强抗抖动能力，也会增加一定播放缓冲。
