# 配送器回放

场景预置科技、材料和6个机器人成品；仓库、配送器、供电设备均由CLI建造。不会注入机器人实体或修改存档。该回放验证已解锁阶段的配送，不代替从采矿到制造机器人的完整科技流程。

从仓库根目录启动服务器（使用未运行过此回放的数据目录；重复运行复制配置并换data_dir）：

```bash
cd server
/home/firesuiry/sdk/go1.25.0/bin/go build -o /tmp/sw-distributor-server ./cmd/server
/tmp/sw-distributor-server -config ../scripts/fixtures/distributor/config.yaml -map-config ../scripts/fixtures/logistics-station/map.yaml
```

另一个终端启动网页：

```bash
cd client-web
VITE_SW_PROXY_TARGET=http://127.0.0.1:19500 npm run dev -- --host 127.0.0.1 --port 4190
```

仓库根目录执行 `node scripts/playtest-distributor-browser.mjs`。证据默认写入本机 `test-results/distributor/`，可使用SW_SERVER、SW_LOGISTICS_WEB、SW_LOGISTICS_EVIDENCE覆盖地址/目录。回放等待真实command_result，验证网页安装扣库存、供方送货、需方取货、机甲补给和余量回收、最终货物守恒及桌面/手机截图。服务端边界测试位于 `server/internal/gamecore/distributor_settlement_test.go`。
