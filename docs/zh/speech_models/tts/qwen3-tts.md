# Qwen3-TTS 本地部署

Qwen3-TTS 通过 OpenTalking 的 `local_qwen3_tts` provider 接入。它以本地 HTTP sidecar 运行，适合需要 Qwen3-TTS Base 复刻音色能力的私有化场景。

## 适用场景

- 需要本地 Qwen3-TTS Base 生成或复刻音色。
- 希望 TTS runtime 与 OpenTalking 主进程隔离。
- 已准备参考音频和参考文本，能够满足 Base 模型的 voice clone 输入要求。

## 权重准备

```bash title="终端"
cd "$OPENTALKING_HOME"
mkdir -p ./avatar_models/local-audio

uv pip install -U "huggingface_hub[cli]"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"

hf download Qwen/Qwen3-TTS-12Hz-0.6B-Base \
  --local-dir ./avatar_models/local-audio/Qwen__Qwen3-TTS-12Hz-0.6B-Base
```

## Sidecar 环境

Qwen3-TTS 建议使用独立 venv，避免与 OpenTalking 主环境的依赖冲突：

```bash title="终端"
cd "$OPENTALKING_HOME"
uv venv .venv-qwen3-tts --python 3.11
source .venv-qwen3-tts/bin/activate
uv pip install -e ".[local-qwen3-tts-service]"
```

## 配置项

```env title=".env"
OPENTALKING_TTS_DEFAULT_PROVIDER=local_qwen3_tts
OPENTALKING_LOCAL_QWEN3_TTS_SERVICE_URL=http://127.0.0.1:19091/synthesize
OPENTALKING_LOCAL_QWEN3_TTS_MODEL_DIR=./avatar_models/local-audio/Qwen__Qwen3-TTS-12Hz-0.6B-Base
OPENTALKING_LOCAL_QWEN3_TTS_DEVICE=cuda:0
OPENTALKING_LOCAL_QWEN3_TTS_DTYPE=bfloat16
OPENTALKING_LOCAL_QWEN3_TTS_PRELOAD=1
OPENTALKING_LOCAL_QWEN3_TTS_REF_AUDIO=/path/to/reference.wav
OPENTALKING_LOCAL_QWEN3_TTS_REF_TEXT=参考音频对应的文本
```

## 启动命令

先启动 Qwen3-TTS sidecar：

```bash title="终端"
cd "$OPENTALKING_HOME"
source .venv-qwen3-tts/bin/activate
python scripts/local_qwen3_tts_service.py --host 127.0.0.1 --port 19091
```

另开终端启动 OpenTalking：

```bash title="终端"
cd "$OPENTALKING_HOME"
bash scripts/start_unified.sh --backend mock --model mock --api-port 8000 --web-port 5173
```

## 验证命令

```bash title="终端"
curl -fsS http://127.0.0.1:19091/health
curl -s -X POST http://127.0.0.1:19091/synthesize \
  -H 'content-type: application/json' \
  -d '{"text":"你好，这是一次 Qwen3-TTS 本地测试。"}' \
  --output /tmp/qwen3-tts-test.wav
```

## 常见错误

| 现象 | 处理 |
|------|------|
| `reference audio and reference text` 报错 | Base 模型需要参考音频和参考文本；配置 `REF_AUDIO` 与 `REF_TEXT`。 |
| 模型目录找不到 | 检查 `OPENTALKING_LOCAL_QWEN3_TTS_MODEL_DIR` 是否指向下载目录。 |
| 依赖冲突 | 使用独立 `.venv-qwen3-tts`，不要把 sidecar 依赖装进主 `.venv`。 |


## 后台切换与三方案对比

后台“声音配置”和“实时测试”支持 `edge`、`local_cosyvoice`、`local_qwen3_tts`。
Qwen3-TTS 的音色 ID 使用 `local-default`，对应 sidecar 中配置的参考音频与文本；
它与百炼云端 `dashscope` 是不同的 provider。

在运行配置中选择 `local_qwen3_tts`，服务地址填写完整的
`http://127.0.0.1:19091/synthesize`，模型填写 `Qwen/Qwen3-TTS-12Hz-0.6B-Base`。
保存会校验 sidecar 的 `/health`，并持久化模型与地址。服务端参考音频配置
保存在 sidecar 环境中，不能只在后台填写音色名称代替部署。

建议将两种本地 TTS 放在独立虚拟环境，监听回环地址，并用进程管理器自动重启。
多 GPU 环境可通过 sidecar 的 `CUDA_VISIBLE_DEVICES` 隔离 TTS 与口型生成；
设置为物理 GPU 1 后，sidecar 内部设备应填写 `cuda:0`。

对比时使用相同短句、展商介绍和路线文本，分别记录冷启动、预热后的首个 PCM
耗时、合成总耗时、音频时长、失败次数，以及数字人实际首声与口型时间。
当前 Qwen3 sidecar 整句合成 WAV 后返回；HTTP 使用 StreamingResponse 不等于
模型增量输出。Dify 逐句调度仍可用，但每句话须等待该句合成完毕。
CosyVoice 可增量返回 PCM，Edge 依赖在线服务。试听 WAV 可供人工比较音质，
时间指标不能代替音质评价。测试完成前保持原有默认 provider，避免影响观众。

设置 `OPENTALKING_LOCAL_QWEN3_TTS_PRELOAD=1` 可在启动时加载并预热，完成后才接受请求，避免首位访客承担冷启动耗时。
