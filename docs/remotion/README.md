# SiliconWorld Remotion 视频

这个目录包含一个用于介绍当前 `SiliconWorld` 游戏项目状态的 Remotion 视频工程。

## 使用方式

```bash
npm install
npm run generate:audio
npm run studio
npm run render:intro
npm run render:design
```

渲染结果默认输出到：

```text
out/siliconworld-intro.mp4
out/galactic-war-factory-design.mp4
```

音频资源会生成在：

```text
public/audio/voiceover/
public/audio/bgm/ambient-bed.mp3
public/audio/design/voiceover/
public/audio/design/bgm/war-room-bed.mp3
```

## 视频内容来源

原始素材（`docs/archive/design/*`、`docs/archive/analysis/server现状详尽分析报告.md`、`docs/process/finished_task/`）已删除，可从 git tag `pre-refactor-2026-10` 找回。当前设计见 [architecture](../dev/architecture.md)。
