# SiliconWorld (游戏项目)

**概览**
Go 后端 + Node.js CLI 客户端。后端在 `server/`，CLI 在 `client-cli/`。

**环境要求**
- Go 1.20+（用于编译服务端）
- Node.js 18+、npm（用于 CLI）

**启动后端**
- 开发端口（与 CLI 默认一致：`http://localhost:18080`）
```bash
cd server
go build -o server ./cmd/server
./server -config config-dev.yaml
```
- 生产端口（默认 `8080`）
```bash
cd server
go build -o server ./cmd/server
./server -config config.yaml
```

**启动 CLI**
```bash
cd client-cli
npm install
npm run dev
```

**可选环境变量**
- `SW_SERVER`：覆盖服务端地址
```bash
SW_SERVER=http://localhost:8080 npm run dev
```

**CLI 功能与命令**
- 查询类：`health` `metrics` `summary` `galaxy` `system [id]` `planet [id]` `fogmap [id]` `fog [id]`
- 动作类：`build <x> <y> <type>` `move <entity_id> <x> <y>` `attack <attacker_id> <target_id>` `produce <factory_id> <unit_type>` `upgrade <entity_id>` `demolish <entity_id>` `raw <json>`
- 工具类：`switch [player_id] [key]` `events [count]` `status` `help [command]` `clear` `quit` / `exit`

**本次功能测试记录（2026-03-17 UTC）**
测试环境：服务端 `config-dev.yaml`（`localhost:18080`），CLI 默认配置。

已验证（命令 -> 结果）：
- `health / metrics / summary / galaxy / system / planet / fogmap / fog / status / events`：均返回正常结果。
- `build 8 8 mine`：创建新建筑（`b-8`）。
- `upgrade b-3`：矿场升到 `lvl=2`（HP 变为 `200/250`）。
- `produce b-5 worker`：创建新单位（`u-9`，后续又创建 `u-11`）。
- `move u-9 6 9`：单位位置更新为 `(6,9)`。
- `switch p2` 后 `build 6 8 turret`：创建敌方炮塔（`b-10`）。
- `demolish b-8`：建筑从行星列表中消失。

观察到的战斗行为：
- 敌方炮塔 `b-10` 自动攻击并摧毁了 `u-7 / u-9 / u-11`（符合自动防御逻辑）。

未完整验证（原因）：
- `attack`：由于炮塔自动攻击导致攻击者单位被迅速摧毁，未能稳定复现“成功攻击”结果。建议在无敌方自动火力的干净局面下复测（例如先不要建炮塔，或在更远位置测试）。

**备注**
- CLI 会持续打印 SSE 事件（资源变化、tick 等），输出较多属正常现象。
