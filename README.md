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
./server -config config-dev.yaml -map-config map.yaml
```
- 生产端口（默认 `8080`）
```bash
cd server
go build -o server ./cmd/server
./server -config config.yaml -map-config map.yaml
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
- 动作类：`scan_galaxy [id]` `scan_system <id>` `scan_planet <id>` `raw <json>`
- 工具类：`switch [player_id] [key]` `events [count]` `status` `help [command]` `clear` `quit` / `exit`

**备注**
- CLI 会持续打印 SSE 事件（tick 等），输出较多属正常现象。
