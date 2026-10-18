# AGENTS.md — 智能体行为准则

## 1. 激进式演进

最高准则：**追求最优雅的实现。**

- 不为兼容旧接口写适配层（Adapter）或包装函数（Wrapper）。
- 现有接口挡路就直接改它的定义和所有调用点；宁可改 10 处调用，也不在核心逻辑里留一次权宜之计（Hack）。
- 模块间少耦合，实现简单直接，不绕圈子，不做过度的错误处理。

## 2. API 文档

- 改了 server API 的行为 → 更新 `docs/dev/服务端API.md`；改了 client-cli 命令 → 更新 `docs/dev/客户端CLI.md`。
- 两份文档的命令一览由 `python3 scripts/gen_command_docs.py` 生成，`python3 scripts/command_coverage.py --check` 检查是否过期。

## 3. 测试与交付

- 测试通过才算完成；完成后合并到 main 并推送远程。
- 在 `tmp/` 下写 md 测试报告，含逐步骤操作截图，供用户审阅。
- 临时文件一律放项目下的 `tmp/` 文件夹。
- client-web 的改动要在浏览器里实际看：建造、兵力调配等操作能否正常进行，当前局势能否正确显示。

## 4. 沟通与记录

- 回复用户用中文，简洁。
- 操作路径、注意事项、用户要求、需要记住的东西简洁记到项目根 `note.md`；长的放 `docs/guide/`，在 note 里引用。
- 复杂任务可以开子智能体承担实现和测试，节约主智能体的上下文。

## 5. 通知用户

只有主代理在最终完工时通知；需要用户协助时也可以通知，但尽量自己解决。子代理不通知。

```bash
curl -s -X POST https://wxpusher.zjiecode.com/api/send/message/simple-push \
  -H 'Content-Type: application/json' \
  -d '{"content":"<p>正文（html，只写 body 内部）</p>","summary":"摘要（≤100 字）","contentType":2,"spt":"<项目根 .env 里的 WXPUSH_SPT_TOKEN>"}'
```

## 6. 环境

- Go：`/home/firesuiry/sdk/go1.25.0/bin`，受限环境加 `GOCACHE=/tmp/gw-go-cache GOTOOLCHAIN=local`。
- `apply_patch` 可能不正常，失败一次就换方式写文件。
- 投稿 B 站用 biliup：用法见 `.agents/skills/biliup/SKILL.md`，cookie 在 `develop_tools/biliup/cookies.json`（不提交）。
