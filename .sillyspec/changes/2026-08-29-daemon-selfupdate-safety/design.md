---
author: qinyi
created_at: 2026-08-29 14:26:40
scale: large
tier: independent
---

# daemon SELF_UPDATE 安全层增强 — 设计文档

## 背景

现有 SELF_UPDATE 链路（`daemon.ts:3997-4031` → `preflight.ts:184 runDaemonSelfUpdate / :308 respawnDaemonAndExit`）：WS 指令 → 下载 bundle 原子替换 → `stop()` → detached 拉起新进程 → 旧进程退出（拉起失败保活）。四项缺口（源自 2026-08-29 multica self_reload 调研，对照证据 multica auto_update.go/self_reload_test.go）：

1. **无任务保护**：stop 直接打断在跑轮次/batch 任务（multica 用空闲屏障+推迟解决；其"拉起失败保活"我们已有、是反向优势）
2. **无更新所有权仲裁**：多入口（指令/未来定时器）可双写；一次失败后无状态释放语义
3. **无磁盘旁路探测**：外部部署工具换 bundle/降级/指令丢失场景无感知
4. **pending 不可见**：升级被推迟时运维无处可看

multica 两条实证经验纳入：**不做 drain-hook 状态机**（第一版锚 lease 致永久 parked 已删）——推迟用「每轮从零重探测」轻量定时器；**探测失败≠版本变化**（替换窗口自杀防御）。

## 设计目标

1. SELF_UPDATE 到达或磁盘版本变更时，**仅进行中**（在跑 interactive 轮次 + 在跑 batch lease）才推迟；空闲即升级，升级不打断任何进行中工作
2. 推迟期间状态可见：本地 `status` 命令 + 平台机器页横幅（跨 daemon/backend/frontend 三端）
3. 磁盘旁路探测默认开：外部替换/降级 10 分钟内跟进；探测失败绝不触发重启
4. 更新全生命周期有所有权仲裁；一切失败路径可恢复（下一条指令可再触发）；保留拉起失败保活

## 非目标（Non-Goals）

- 不做进程内热重载（multica selfReload 同为优雅退出+继任进程，无此语义）
- 不做 pending-restart 状态机/drain hook（multica 反面教训）
- 不做新版本健康门控/自动回退（旧进程不等继任者 ready；服务端 stale 清扫兜底——与 multica 一致）
- 不做 GitHub release 轮询自更新（服务端 manifest 是唯一分发源，指令+磁盘探测已覆盖）
- 不改下载替换的原子性实现（preflight 现有 tmp+rename 保留）
- 宿主管理器豁免（pm2/Docker 看护场景）不做——本仓库部署形态为裸进程+自拉起

## 决策/方案选择（D-xxx）

详见 `decisions.md`（唯一真相源 D-001~D-006）：D-001 仅进行中算忙（空闲会话经挂起/恢复链路无损穿越）；D-002 无限等空闲 30s 复查；D-003 磁盘探测默认开（600s 可配 0 关）；D-004 方案 A3 完整形态（含三端透传）；D-005 保留保活+补失败释放；D-006 设计整体确认。

## 总体方案（S1-S5）

### S1 — daemon 更新编排器

**单入口 `tryUpdate(reason: 'server_command' | 'disk_change')`**（daemon.ts 新方法组）：

```
tryUpdate(reason) ──所有权占位（_updateBusy=true，已占则本次忽略记日志）──▶
   ├─ 忙？_isBusyForUpdate()：sessionManager 存在「在跑轮次」（SessionState.status==='running'）
   │   或 taskRunner 存在「在跑 batch lease」（_controllers 非空）
   │   ├─ 是 → 释放所有权 + 记 pending（reason+目标版本+当前版本）+ 排 30s 复查定时器
   │   │        （无限等 D-002；重探=完整重跑 tryUpdate 每轮从零，无状态机；
   │   │          离开推迟态（升级执行/noop/异常）必清定时器——否则 noop 后 30s 死循环）
   │   └─ 否 → 按 reason 分流（Grill B2 修正）：
   │        ├─ server_command → 现有升级链：runDaemonSelfUpdate（下载原子替换，noop 释放结束）
   │        │    → ★终检（Grill B3）：下载完成、stop() 之前重跑 _isBusyForUpdate()，
   │        │      忙则回到推迟路径（终检与 stop 首动作间无 await，竞态窗口收敛毫秒级）
   │        │    → stop()（含 suspend-batch 挂起——空闲会话无损穿越 D-001）
   │        │    → respawnDaemonAndExit（交接）
   │        └─ disk_change → 不下载不查 manifest，直接 stop() → respawn 到盘上版本
   │             （操作者换文件即意图——multica trySelfReload 同款语义；否则磁盘降级/
   │             盘≠manifest 场景会被 runDaemonSelfUpdate 的防降级/noop 挡成永不收敛）
   └─ 一切非「交接排定」路径（noop/下载失败/异常/终检回推迟）→ 释放所有权+清 pending 文件
```

**所有权与定时器生命周期**（Grill M05/M19 补全）：进入推迟=释放所有权+排 `_updateRetryTimer`（unref）；离开推迟态=清定时器；交接排定后所有权持有到进程退出。pending 期间新触发只刷新目标版本不叠定时器；reason 取最新触发（server_command 与 disk_change 等价，谁后到显示谁）。**respawn 失败路径**（Grill M07）：spawn 在 stop() 之后，失败时进程已停摆（WS/心跳已关）——「保活」指进程不退出待人工/看护介入，backend 45s 判 offline 可见；释放所有权仅为语义自洽（无消费者）。

- 现有 `MSG.SELF_UPDATE` case 改为调 `void this._tryUpdate('server_command')`（fire-and-forget，指令无需回执——现状如此）
- 复查定时器：`_updateRetryTimer`（unref；新指令到达时若已有 pending 仅刷新目标版本，不叠定时器）
- 忙判定读取口：sessionManager 暴露 `hasRunningTurn()`（status==='running'；'reconnecting' 为恢复中间态不算忙）、taskRunner 暴露 `hasActiveLease()`（_controllers 非空；**TaskRunnerLike 接口可选化**——缺省视为不忙，照 cancel/runChangeWrite 的可选方法先例防砸碎测试 mock，Grill M14）。change-write 在途不算忙：被打断靠既有 60s gc 收敛（已明示接受）

### S2 — 磁盘旁路探测（Grill B1 修正：读文件不 spawn）

- 比对基准必须是 `BUILD_ID`（git sha+时间戳，`src/build-id.ts`，respawn 后新进程内存中的就是它）——**不能**用 `--version`（实测输出 DAEMON_VERSION semver `0.1.1`，与 BUILD_ID 不同源恒不等，Grill 实跑证伪）
- 探测方式：读 bundle 文件（`DAEMON_BIN_DIR/DAEMON_BUNDLE_NAME`，与 respawn 加载同一文件）按 `BUILD_ID\s*=\s*["']([^"']+)` 正则提取（gen-build-id.mjs 生成格式明确为 regex 兼容而设计；纯读文件零子进程开销，R2/R7 的 spawn 开销论证随之作废）
- 常驻轻量循环（daemon.ts，`setInterval` unref）：每 `self_reload_check_interval_sec`（config.ts 新增，默认 600，0=关闭）比对提取值与内存 `BUILD_ID`
- **任何差异（含降级）→ `void _tryUpdate('disk_change')`**；dev 构建（BUILD_ID='dev'）跳过探测
- **探测失败（读文件失败/正则不中/任一侧为空）≠ 版本变化**：记 debug 日志不动作（防替换窗口半写文件自杀——tmp+rename 原子替换下窗口极小，防御性保留）

### S3 — 可见性（daemon 侧）

- pending 期间写 `~/.sillyhub/daemon/pending-update.json`：`{reason, current_version, target_version, since}`（原子写沿用 session-store-persistence 的 tmp+rename 惯例）；升级执行/取消时删除
- `sillyhub-daemon status` 命令（cli.ts）读该文件追加展示「等待空闲升级：盘上 X 运行 Y（原因 Z，since …）」
- **启动清残留**（Grill M15）：daemon 启动时发现 pending-update.json 且与现状矛盾（盘上 BUILD_ID==内存 BUILD_ID，即升级已完成）即删除——防删除失败导致的本地 status 永久误导
- 升级执行后前端横幅残留约 30-60s（最后一拍心跳→新进程首拍心跳 15s→前端 15s 轮询）——已接受时延
- 心跳请求体新增可选 `pending_update: {reason, current_version, target_version}`——**仅 pending 期间携带**（无 pending 不带字段，旧 backend 兼容）

### S4 — backend 透传

- `daemon_instances` 新增列 `pending_update`（JSON nullable，NULL=无）+ alembic 迁移（`backend/migrations/versions/`）
- 心跳端点（`POST /heartbeat`）接收可选 `pending_update`：有则 upsert 该列，无则置 NULL（升级已执行/取消的清除路径）。注意：**「无字段=清除」与本端点兄弟字段（version/build_id 非空才覆盖）语义相反，刻意为之**——单机单 daemon 无新旧进程交错，靠「无字段」显式清除才能收敛
- since 语义（Grill M11）：upsert 时**已存在同内容 pending 保留原 since**（防退化成最后心跳时间）——首次落库盖 since=now
- `GET /machines` 与 `GET /runtimes/page` 响应透出 `pending_update` 字段（机器级）

### S5 — 前端展示

- MachineCard（`frontend/src/components/daemon/` 机器卡组件）三状态同一横幅位（对照原型 prototype-machine-update-status.html）：
  - `pending_update.reason==='server_command'` → warning 横幅「等待空闲后自动升级（每 30s 复查）」+ 副行（原因+版本对比）
  - `reason==='disk_change'` → info 横幅「检测到程序文件已更新，等待空闲自动加载」+ 副行（来源说明）
  - pending 期间「自更新」按钮禁用（title 说明）
- 数据源：`useDaemonMachines` 既有轮询（15s）自然刷新，无需新通道

### 三端类型收口

backend openapi 再导出 → daemon/frontend `pnpm gen:types`（心跳 body/机器响应新字段）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| SELF_UPDATE 指令（忙） | backend WS | daemon tryUpdate | version | _updateBusy 占位→释放；写 pending-update.json；心跳带 pending_update |
| SELF_UPDATE 指令（空闲） | backend WS | daemon tryUpdate | version | 占位→下载替换→**stop 前终检忙判定（B3）**→stop（挂起会话）→respawn（持锁到退出） |
| 终检发现新忙 | daemon tryUpdate | — | — | 回推迟路径：释放所有权+记 pending+重排 30s 定时器 |
| respawn 拉起失败 | daemon | — | — | 进程已 stop 停摆保活（不退出）；释放所有权（语义自洽）；backend 45s 判 offline 可见 |
| 磁盘版本差异 | daemon 探测循环 | tryUpdate | — | 同上两行（reason=disk_change） |
| 推迟复查（30s） | daemon 定时器 | tryUpdate | — | 忙则再记 pending；空闲则升级 |
| 升级 noop/失败 | daemon | — | — | 释放所有权+删 pending 文件+心跳字段消失（backend 置 NULL） |
| 心跳携带 pending_update | daemon | backend /heartbeat | reason/当前/目标版本 | daemon_instances.pending_update upsert（带 since） |
| 心跳无 pending_update | daemon | backend /heartbeat | — | pending_update 置 NULL（清除） |
| 机器视图查询 | 前端 | backend /machines、/runtimes/page | — | 响应含 pending_update（nullable） |

## 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/daemon.ts | tryUpdate 编排器/忙判定/复查定时器/磁盘探测循环/心跳携带 pending_update |
| 修改 | sillyhub-daemon/src/preflight.ts | runDaemonSelfUpdate 增加目标版本回传（供 pending 记录）或等价接口 |
| 修改 | sillyhub-daemon/src/config.ts | self_reload_check_interval_sec 配置（默认 600，0=关） |
| 修改 | sillyhub-daemon/src/cli.ts | status 命令读 pending-update.json 展示 |
| 修改 | sillyhub-daemon/src/hub-client.ts | heartbeat 请求体可选 pending_update 字段 |
| 修改 | backend/app/modules/daemon/model.py | DaemonInstance.pending_update JSON nullable 列 |
| 新增 | backend/migrations/versions/202608291500_add_daemon_pending_update.py | 建列迁移（backend/migrations/versions/ 实际目录） |
| 修改 | backend/app/modules/daemon/router.py | 心跳接收落库+machines/runtimes/page 透出 |
| 修改 | backend/app/modules/daemon/runtime/service.py | heartbeat_daemon 落 pending_update upsert/清除 |
| 修改 | frontend/src/components/daemon/machine-card.tsx | 三状态横幅+「升级 daemon」按钮禁用扩展（Grill M12 核实：文件属实 332 行，按钮在 234-246 行已有 disabled 可扩展） |
| 修改 | frontend/src/lib/daemon.ts | DaemonMachineRead 手写接口（非 api-types 透出，Grill M13）补 pending_update 字段 |
| 重新生成 | backend/openapi.json | openapi 再导出 |
| 重新生成 | sillyhub-daemon/src/api-types.ts | gen:types |
| 重新生成 | frontend/src/lib/api-types.ts | gen:types |

## 接口定义

**心跳请求体扩展**（daemon → backend）：
```
POST /api/daemon/heartbeat
body { daemon_local_id, providers[], started_at?,
       pending_update?: { reason: 'server_command'|'disk_change',
                          current_version: string, target_version: string } }
```

**机器视图响应扩展**（backend → frontend）：
```
GET /api/daemon/machines → items[].pending_update?: { reason, current_version, target_version, since } | null
GET /api/daemon/runtimes/page → 同款机器级字段
```

**配置常量**：`self_reload_check_interval_sec` 默认 600（0=关闭）；探测超时 10s；复查间隔 30s；pending-update.json 路径 `~/.sillyhub/daemon/pending-update.json`。

## 风险登记（Risk Register）

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | 忙判定竞态：下载窗口内新启动 turn/lease 被 stop 打断 | 中 | **stop 前终检**（B3 修正，窗口收敛毫秒级）+推迟路径每轮重探自愈；集成用例覆盖「忙→推迟→空闲→升级」与「下载窗口插入新任务→终检回推迟」 |
| R2 | bundle 半写/正则不中导致探测误判 | 低 | 探测失败≠版本变化（只漏检不误杀）；tmp+rename 原子替换下窗口极小 |
| R3 | pending 文件残留（升级后未清）误导 status/心跳 | 低 | 升级执行/取消双路径删文件+**daemon 启动清矛盾残留**（M15）；心跳无字段 backend 置 NULL 双保险 |
| R4 | 三端类型联动（心跳 body 变更） | 低 | 字段可选向后兼容；同一变更内三端 gen:types |
| R5 | daemon_instances 加列与并行变更撞迁移 | 中 | 提交前 alembic heads 单 head 检查，撞车 re-parent（本仓 4 个 merge 迁移先例） |
| R6 | pending 期间触发重发叠定时器/noop 后 30s 死循环 | 低 | 已 pending 仅刷新目标不叠定时器；离开推迟态必清定时器（S1 生命周期约定） |
| R7 | disk_change 直启路径被误触发（bundle 意外损坏但 BUILD_ID 恰可提取且不同） | 低 | 提取失败/空值不动作；直启前 stop 含挂起（会话无损）；manifest 源（server_command）不受影响 |

## 自审（Self-Review）

- 章节完整性：背景/目标/非目标/决策/总体方案/生命周期契约表/文件清单/接口/风险/自审——齐全 ✓
- 决策引用：D-001（忙定义→S1）、D-002（推迟→S1）、D-003（探测→S2）、D-004（A3→S3-S5）、D-005（保活+释放→S1）、D-006（整体确认）——全部当前版本引用 ✓
- 生命周期契约表：涉及 daemon/lease/session/lifecycle 关键词，10 行矩阵覆盖全部新增状态转移 ✓
- 原型：机器卡三状态组件级变化，prototype-machine-update-status.html 已产出 ✓
- Grill 交叉审查（独立子代理 19 项矩阵）：3 阻断已修——B1 探测改读文件提取 BUILD_ID（--version 输出 semver 不同源，实跑证伪）；B2 disk_change 独立直启路径（不下载不查 manifest，multica trySelfReload 同款）；B3 stop 前终检忙判定；其余 M04-M19 语义补全（所有权/定时器生命周期、respawn 失败停摆语义、启动清残留、since 保留、文件清单补 lib/daemon.ts、可选方法接口先例、原型文案）全部修订入上文 ✓
- 自审存疑 1（机器卡组件名）：Grill 核实 machine-card.tsx 属实（332 行）解除 ✓；存疑 2 随 B1 修正作废（无 spawn）✓
- 规模判定：跨三端、新增列+迁移、状态编排——scale=large 四件套齐 ✓
