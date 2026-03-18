# SiliconWorld 客户端 CLI

**概览**
SiliconWorld 客户端 CLI 以交互式 REPL 的方式运行，连接服务器后可以查询世界状态、执行扫描指令、查看事件流等。

**启动**
1. 进入客户端目录 `client-cli`。
2. 安装依赖：`npm install`。
3. 启动 CLI：`npm run dev`。

**环境变量**
- `SW_SERVER`：服务端地址，默认 `http://localhost:18080`。

**登录与玩家**
CLI 启动后会提示选择玩家：
- 默认玩家：`p1` / `key_player_1`，`p2` / `key_player_2`。
- 也可以输入自定义 `Player ID` 与 `Player Key`。

**实时事件 (SSE)**
CLI 会自动连接 `SSE` 事件流并在终端中实时输出。
- `events [count]` 可以查看最近事件缓冲区（默认 10 条）。
- `switch` 切换玩家时会自动断开并重连事件流。

**命令列表**

查询类：
| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `health` | 无 | 服务端状态与 tick |
| `metrics` | 无 | 运行时指标 |
| `summary` | 无 | 游戏摘要（资源、玩家、地图） |
| `galaxy` | 无 | 星系列表 |
| `system` | `[system_id]` | 系统详情（默认 `sys-1`） |
| `planet` | `[planet_id]` | 行星详情（默认 `planet-1-1`） |
| `fogmap` | `[planet_id]` | 行星迷雾 JSON |
| `fog` | `[planet_id]` | 行星迷雾 ASCII 渲染 |

操作类：
| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `scan_galaxy` | `[galaxy_id]` | 扫描星系（默认 `galaxy-1`） |
| `scan_system` | `<system_id>` | 扫描系统 |
| `scan_planet` | `<planet_id>` | 扫描行星 |
| `raw` | `<json>` | 发送原始指令 JSON |

工具类：
| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `switch` | `[player_id] [key]` | 切换玩家（未知玩家需提供 key） |
| `events` | `[count]` | 显示最近事件（默认 10 条） |
| `status` | 无 | 当前玩家与服务器地址 |
| `help` | `[command]` | 显示帮助 |
| `clear` | 无 | 清屏 |
| `quit` / `exit` | 无 | 退出 |

**常用示例**

启动并连接服务器：
```bash
cd client-cli
npm install
npm run dev
```

切换玩家：
```bash
switch p2
switch custom_player custom_key
```

扫描系统与行星：
```bash
scan_system sys-2
scan_planet planet-2-1
```

发送原始指令：
```bash
raw [{"type":"scan_system","target":{"layer":"system","system_id":"sys-2"}}]
```

**默认值**
- 默认服务器：`http://localhost:18080`
- 默认系统：`sys-1`
- 默认行星：`planet-1-1`
- 默认事件显示数量：`10`

