# docs 文档体系重组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `docs/` 重组为开发者主线、玩家主线、流程文档和历史归档四层结构，并合并重复的当前主文档。

**Architecture:** 通过一次性目录重构和文档主线收敛完成整理。当前有效文档集中到 `docs/dev` 与 `docs/player`，任务流转文档集中到 `docs/process`，历史设计与参考资料下沉到 `docs/archive`，同时批量修复仓库内的路径引用。

**Tech Stack:** Markdown, shell file operations, ripgrep, git

---

### Task 1: 建立新目录骨架并写入口文档

**Files:**
- Create: `docs/README.md`
- Create: `docs/dev/README.md`
- Create: `docs/player/README.md`
- Create: `docs/process/README.md`
- Create: `docs/archive/README.md`

- [ ] Step 1: 创建 `dev/player/process/archive` 目录
- [ ] Step 2: 新建总入口与分区 README
- [ ] Step 3: 在 README 中明确当前主文档与历史目录边界

### Task 2: 迁移并整理当前有效主文档

**Files:**
- Create: `docs/dev/项目概览.md`
- Modify: `docs/dev/服务端API.md`
- Create: `docs/dev/客户端CLI.md`
- Create: `docs/dev/client-web.md`
- Modify: `docs/dev/agent-gateway.md`
- Create: `docs/dev/server现状与差距.md`
- Create: `docs/player/玩法指南.md`
- Create: `docs/player/上手与验证.md`
- Create: `docs/player/已知问题与回归.md`

- [ ] Step 1: 迁移保留型主文档到 `docs/dev` 与 `docs/player`
- [ ] Step 2: 用新文档合并架构/现状/Web/上手类重复内容
- [ ] Step 3: 在玩家文档中收口 CLI 与 Web 的上手入口

### Task 3: 下沉流程文档与历史资料

**Files:**
- Modify: `docs/process/任务要求.txt`
- Move: `docs/process/task/*` -> `docs/process/task/`
- Move: `docs/process/running_task/*` -> `docs/process/running_task/`
- Move: `docs/process/detail/*` -> `docs/process/detail/`
- Move: `docs/process/finished_task/*` -> `docs/process/finished_task/`
- Move: `docs/process/rules/*` -> `docs/process/rules/`
- Move: `docs/process/prompt/*` -> `docs/process/prompt/`
- Move: `docs/archive/design/*` -> `docs/archive/design/`
- Move: root historical docs -> `docs/archive/...`

- [ ] Step 1: 将任务流转相关目录统一归入 `docs/process`
- [ ] Step 2: 将旧设计、旧调研、参考资料归入 `docs/archive`
- [ ] Step 3: 将试玩截图迁移到 `docs/player/assets/`

### Task 4: 批量修复路径引用

**Files:**
- Modify: `工作记录.md`
- Modify: `develop_tools/agent_loop.py`
- Modify: `develop_tools/test_minimax_exec.py`
- Modify: `docs/**/*.md`
- Modify: `docs/**/*.txt`

- [ ] Step 1: 批量替换旧路径到新路径
- [ ] Step 2: 手工修正当前主文档中的交叉引用
- [ ] Step 3: 确保自动化脚本指向 `docs/process`

### Task 5: 验证整理结果

**Files:**
- Verify only

- [ ] Step 1: 检查新目录树是否符合目标结构
- [ ] Step 2: 搜索是否仍残留旧主文档路径
- [ ] Step 3: 检查关键入口文档是否可互相导航
