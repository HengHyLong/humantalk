# 数字人待机循环调试记录

2026-10-08，服务器 `120.94.216.59`，部署目录 `/srv/humantalk`。
对象：数字人2K-9/28，头像 ID `custom-数字人2K-9-28-20260928-013812-156`。

## 原因

实际运行路径为 QuickTalk 后端待机解码后经 WebRTC 推流。原待机视频为
1440×1920、30fps、150 帧、5 秒。首尾面部位置存在偏差：固定面部区域的
首尾平均绝对像素差为 19.48，普通相邻帧平均差为 2.36。

原播放代码另外将末尾 8 帧逐步叠加到固定第一帧。提取画面显示眼睛和嘴部
发生重影，因此仅关闭淡化不能同时解决素材首尾的跳变。

## 已部署修改

- 保留原视频，生成 `source/motions/idle/idle_seamless_pingpong_25fps_lowdelay.mp4`。
  使用正放和倒放循环，去掉倒放段重复的两个端点，共 248 帧、25fps、9.92 秒。
- 采用 H.264 CRF 16、无 B 帧的低延迟编码，输出为 1080×1440，与当前推流一致。
- 将这个头像的 idle/listen/think 素材指向生成的视频，讲话素材保持原配置。
- 增加头像 metadata 的 `idle_loop_crossfade_frames` 设置。该头像设为 0，
  保留准备好的原始循环帧；未设置的头像继续使用原环境变量及默认 8 帧行为。
- 对显式关闭混帧的素材，在支持的 OpenCV 版本中使用单解码线程，减少回跳时
  的帧线程缓冲延迟。
- 本地代码同步修改，服务器修改通过局部补丁完成，保留了此前已有的其他修改。
- 已重启 API，并检查其健康状态正常。

## 验证

- 相关单元测试：12 项通过。
- 实际素材解码：连续两轮，循环第一帧内容完全一致。
- 新素材首尾面部差为 1.85，处于普通相邻帧变化量范围；原素材为 19.48。
- 回跳解码耗时约 31.5ms，原方案约 58–61ms；帧间隔为 40ms。
- 真实 WebRTC 测试：收到 510 帧、20.36 秒媒体，覆盖两个循环；所有视频
  时间戳严格递增，相邻步长均为 40ms；测试会话已关闭。
- 素材 HTTP Range 请求返回 206，MIME 为 video/mp4；服务日志确认加载了
  248 帧、25fps、9.92 秒的新待机视频。
- 本地和服务器 `_LoopingIdleVideo` 类的 AST 哈希一致。

验证范围是服务器解码、素材接口和真实 WebRTC 接收端。没有替用户现场浏览器
完成肉眼验收。测试中的网络接收间隔仍有波动（95 分位约 72ms，最大约
131ms），因此这些结果不代表所有网络或客户端卡顿均已消除。

## 备份与恢复

服务器备份目录：`/srv/humantalk/logs/idle-seam-backup-20261008-182328/`。
其中 `synthesis_runner.py` 和 `manifest.json` 是修改前的文件；原素材始终保留。
恢复时将这两个文件分别复制回代码文件和上述头像的 manifest，然后重启 API。
生成的视频可保留，不影响恢复后的播放路径。

调试接入脚本未保存 SSH 密码。服务器验证数据保存在
`/srv/humantalk/.deploy/idle-seam-verification.json` 和
`/srv/humantalk/.deploy/idle-rtc-smoke.json`。

## 在其他部署上复现

自定义头像素材和运行时 manifest 按仓库既有规则忽略，不随代码推送。
可用下面的 FFmpeg 命令从原待机素材生成循环；根据目标头像调整尺寸和帧率。
两次 trim 分别移除反向播放时重复的末帧和首帧。

```bash
ffmpeg -nostdin -n -i original_idle.mp4 \
  -filter_complex '[0:v]scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440,fps=25,split=2[f][r];[f]setpts=PTS-STARTPTS[forward];[r]trim=start_frame=1,reverse,trim=start_frame=1,setpts=PTS-STARTPTS[back];[forward][back]concat=n=2:v=1:a=0[v]' \
  -map '[v]' -an -c:v libx264 -preset medium -tune zerolatency \
  -crf 16 -pix_fmt yuv420p -threads 8 -g 25 -movflags +faststart \
  idle_seamless_pingpong_25fps_lowdelay.mp4
```

备份头像 manifest 后，将所需 `metadata.motion_clips` 记录中的 `path`
改为生成文件相对头像目录的路径，并设置 `metadata.idle_loop_crossfade_frames`
为数值 `0`。重建会话后验证效果。倒放方案会将循环时长变为约原时长的两倍，
适用于动作较轻的待机素材；对方向明确的动作应重新制作自然首尾相接的视频。
