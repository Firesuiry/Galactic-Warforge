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

- `docs/design/00-总设计.md`
- `docs/design/04-物流与生产系统.md`
- `docs/design/05-能源与电网系统.md`
- `docs/design/07-戴森球系统.md`
- `docs/design/08-战斗与防御系统.md`
- `docs/design/09-命令事件与可见性系统.md`
- `docs/server现状详尽分析报告.md`
- `docs/finished_task/` 下的已完成任务清单
