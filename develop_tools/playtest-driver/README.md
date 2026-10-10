# 试玩驱动（playtest-driver）

一个常驻的 Playwright 页面，加一个本地 HTTP 端口。你把一段 JS 发过去，它就在页面上执行。给分层试玩的层代理共用，不用每层重写。

这套脚本源自第 13 轮（`tmp/playtest-1013/`）的驱动。流程见 [存档点回归测试指南](../../docs/guide/存档点回归测试.md) 第 9 节。

## 启动

```bash
cd develop_tools/playtest-driver
export PT_OUT=/home/firesuiry/develop/siliconWorld/tmp/playtest-<轮次>/layers   # 截图和 actions.log 写到这里
GALLIUM_DRIVER=d3d12 LD_LIBRARY_PATH=/usr/lib/wsl/lib nohup node driver.mjs > $PT_OUT/driver.out 2>&1 &
PT_OUT=$PT_OUT nohup node eventlog.mjs > /dev/null 2>&1 &      # 可选：把事件增量记到 events.jsonl（读档后会自动重置）
```

- 默认网页地址 `http://127.0.0.1:4196`（vite preview），服务端 `http://127.0.0.1:19630`。可以用 `P1V_WEB` 和 `P1V_SERVER` 覆盖。
- 浏览器以 p1（`key_player_1`）登录，视口 1200×1000，用 headless Chromium + Vulkan 硬件渲染。
- **层结束时要关掉 driver 进程**（用具体 PID kill），保证同一时间只有一个浏览器。

## 发送命令

```bash
curl -s localhost:4198 --data-binary @snippet.js
```

片段是一个 async 函数体，作用域里有四个对象：

- `page`：Playwright 页面。
- `L`：lib.mjs。`get / scene / summary / cmd / shot / tilePos / tileAbs / clickTile / card / focus / buildingsOf / waitFor / open3d / sleep`。
- `G`：helpers.mjs。`build / buildOnce / buildNear / withdraw / handcraft / state / look / home / aim / clickTile / rightClickTile / hitCanvas / freeTiles / fb / openDrawer / closeDrawer / selectBuilding / mecha / jobBusy / jobWait / debugShow / ensureBar / resetView`。
- `S`：`S.errors` 收集页面报错和 HTTP 4xx/5xx。

用 `return` 返回结果。每次执行的片段都会追加到 `$PT_OUT/actions.log`，方便复现。

**driver 是单线程的**，一个片段卡住，后面所有请求都会排队。长任务用 `curl -m <秒>` 设超时，并且放到后台跑。

## 第 13 轮踩过的坑

- **任何 `page.goto` 之后都要先 `await L.open3d(page)`**，再等 2–3 秒。导航会销毁 `window.__planetThree`，`G.aim` / `G.clickTile` 依赖它。
- **按 Esc 会取消选中**。给单位下令的循环里不要按 Esc。
- **机甲站在目标格上时，点这一格会点到机甲**。先把机甲挪开，或者换一格。
- 抽屉的 tab（工作台、选中对象、生产、活动流）要在**抽屉展开**后才能点。只要地图上选中了实体，抽屉就会被强制切到「选中对象」。
- **研究站**：设了生产配方就不再算研究站。研究要用空配方（研究模式）。研究站必须在电塔无线范围（4 格）内。
- **电磁矩阵不能手搓**，只能用制造台生产。制造台输出槽上限 3 个，要及时取出。背包上限 200 格。
- 读档后要等约 50 tick 再判断现象。读档后页面会自动刷新，选中状态和表单都会被清掉。
