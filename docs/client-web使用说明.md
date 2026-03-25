# client-web 使用说明

本文档用于说明 `client-web` 的启动、联调、离线样例、调试与回归测试方式。

## 1. 目录关系

- `client-web/`：Web 可视化客户端
- `shared-client/`：CLI 与 Web 共用的 API / SSE / 类型定义
- `docs/服务端API.md`：当前服务端接口契约
- `docs/client-web可视化客户端技术方案.md`：实现背景与任务拆分

## 2. 开发环境启动

### 2.1 安装依赖

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm install
```

### 2.2 启动服务端

当前开发配置使用 `server/config-dev.yaml`，默认监听 `18080`。

```bash
cd /home/firesuiry/develop/siliconWorld/server
env PATH=/home/firesuiry/sdk/go1.25.0/bin:$PATH \
  go run ./cmd/server -config config-dev.yaml -map-config map.yaml
```

默认玩家：

- `p1 / key_player_1`
- `p2 / key_player_2`

### 2.3 启动 Web 客户端

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run dev
```

默认访问地址：

- `http://localhost:5173/login`

`vite.config.ts` 已将以下路径代理到 `http://localhost:18080`：

- `/health`
- `/metrics`
- `/state`
- `/world`
- `/events`
- `/alerts`
- `/commands`
- `/replay`
- `/rollback`
- `/audit`

如果服务端地址不是 `18080`，启动时覆盖代理目标：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
VITE_SW_PROXY_TARGET=http://127.0.0.1:18081 npm run dev
```

## 3. 登录与日常使用

### 3.1 在线服务端模式

登录页默认是“在线服务端”模式：

1. 输入服务地址，通常使用 `http://localhost:5173`
2. 输入 `player_id`
3. 输入 `player_key`
4. 点击“连接并进入总览”

说明：

- 浏览器请求会先打到 Vite，再经 proxy 转发到 Go 服务端
- 登录时会先校验 `/health` 和 `/state/summary`
- 会话保存在浏览器本地存储中，刷新后仍可继续使用

### 3.2 离线样例模式

登录页支持“离线样例”模式，不需要启动服务端：

1. 选择“离线样例”
2. 选择 fixture 场景
3. 点击“打开离线场景”

当前离线样例会覆盖：

- 总览页
- 银河 / 星系 / 行星导航
- 行星地图
- 事件 / 告警
- runtime / networks / catalog
- replay 调试页

## 4. 主要页面能力

### 4.1 总览页

- 查看世界摘要
- 查看玩家统计
- 查看最近事件与告警

### 4.2 星图导航

- `/galaxy`：银河总览
- `/system/:systemId`：恒星系详情
- `/planet/:planetId`：行星观察页

### 4.3 行星观察页

行星页已经支持：

- 地形、资源、建筑、单位、迷雾基础图层
- 物流轨迹图层
- 电网 / 管网 / 施工 / 敌情图层
- 实体详情侧栏
- 事件时间线与告警面板
- SSE 增量同步与补拉
- 命令操作面板
- 调试面板

调试面板可直接执行：

- 重拉行星
- 重拉迷雾
- 补拉事件
- 导出 PNG
- 导出 JSON
- 复制视角链接
- 导出视角 JSON

### 4.4 回放调试页

- 输入 `from_tick` / `to_tick`
- 执行 `/replay`
- 查看 replay digest / snapshot digest / drift 信息

## 5. 调试与组件开发

### 5.1 Storybook

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run storybook
```

当前 Storybook 会加载：

- `src/features/planet-map/PlanetMapCanvas.stories.tsx`
- `src/features/planet-map/PlanetPanels.stories.tsx`

构建静态 Storybook：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run build-storybook
```

### 5.2 Fixtures

fixture 入口在：

- `client-web/src/fixtures/index.ts`
- `client-web/src/fixtures/scenarios/baseline.ts`

用途：

- 离线页面调试
- Storybook 数据复用
- Playwright 视觉回归

## 6. 测试与回归

### 6.1 单元 / 页面测试

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm test
```

当前测试已覆盖：

- 登录
- 总览
- 银河 / 星系 / 行星导航
- 行星页快照拉取与 SSE
- 命令面板提交
- 视角 JSON 导出
- 回放页

### 6.2 构建检查

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run build
```

构建产物输出到：

- `client-web/dist/`

### 6.3 Playwright 视觉回归

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run test:visual
```

更新视觉基线：

```bash
cd /home/firesuiry/develop/siliconWorld/client-web
npm run test:visual:update
```

说明：

- Playwright 会自动启动本地预览服务
- 用例默认走离线 fixture 模式
- 当前基线覆盖总览页、行星地图、回放页

## 7. 当前推荐发布方式

现阶段已经可以直接发布 `client-web/dist/` 静态资源。

推荐方式：

1. 先执行 `npm run build`
2. 将 `dist/` 作为静态资源部署
3. 后续再与 Go 服务端做同源托管整合

如果只做本地开发与测试，继续使用 `npm run dev` 即可。
