# 物流站真实回放

此隔离场景预置研究、背包材料和两个标准起始据点：生成 5 颗行星，仅加载 `planet-1-1`、`planet-1-5`。没有预置物流站、运输器实体、货运航次或工厂。所有测试设备通过 CLI 建造，运输器通过 CLI/UI 消耗真实物品安装；这不代表机甲跨星球飞行已实现。

从仓库根目录操作；使用已安装的 Go、client-cli/client-web 依赖。首次运行需要未使用的 `/tmp/sw-logistics-station-playtest-data`；重复回放请复制配置，使用另一个隔离 data_dir。

服务器终端：

```bash
cd server
/home/firesuiry/sdk/go1.25.0/bin/go build -o /tmp/sw-logistics-playtest-server ./cmd/server
/tmp/sw-logistics-playtest-server -config ../scripts/fixtures/logistics-station/config.yaml -map-config ../scripts/fixtures/logistics-station/map.yaml
```

网页终端：

```bash
cd client-web
VITE_SW_PROXY_TARGET=http://127.0.0.1:19498 npm run dev -- --host 127.0.0.1 --port 4188
```

回放终端（仓库根目录）：

```bash
node scripts/playtest-logistics-station-browser.mjs
```

第一阶段验证 UI 安装/接线、仓→带→行星站→无人机→需站→带→仓、缺能/断电停派和恢复，再在目标 200 铁满仓、无人机携带 100 铁等待卸货时调用真实 `save`。先停止服务器，重新编译并用同一配置重新启动，保留原始 data_dir，禁止编辑存档。随后按顺序执行：

```bash
node scripts/playtest-logistics-station-browser.mjs --resume
node scripts/playtest-logistics-station-browser.mjs --interstellar
node scripts/playtest-logistics-station-browser.mjs --station-install
```

`--resume` 验证等待中的货物恢复、450 铁守恒、接通出口和真实返航。`--interstellar` 在两个已加载星球真实建造 ILS，验证普通/曲速各 60 铜运输、回家、站内供能和曲速器往返消耗。`--station-install` 验证 UI 从站内成品安装运输船，背包不重复扣除，再移除空槽。

结果默认写入 `/tmp/sw-logistics-station-review`，包括命令、权威快照、航程采样、浏览器错误和截图。可用 `SW_SERVER`、`SW_LOGISTICS_WEB`、`SW_LOGISTICS_EVIDENCE` 覆盖地址/证据目录。完成后停止两个终端服务。
