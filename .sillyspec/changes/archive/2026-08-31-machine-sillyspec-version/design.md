---
author: qinyi
created_at: 2026-08-31 08:10:00
scale: large
tier: independent
---

# 机器列表 sillyspec 版本显示与远程升级 — 设计文档

## 背景

机器列表（`frontend/src/app/(dashboard)/runtimes/page.tsx` 机器卡）已展示 daemon 版本并支持「升级 daemon」全链路（REST `POST /api/daemon/machines/{id}/self-update` → WS `daemon:self_update` → daemon preflight 自更新）。但每台机器上还装有 sillyspec CLI（npm 全局包，spec 流程依赖），其版本对运维不可见：

1. **版本不可见**：daemon 启动 preflight（`sillyhub-daemon/src/preflight.ts:248-287 runSillySpecCheck`）会探测本机 `sillyspec --version` 与 `npm view sillyspec version` 并在落后时执行 `npm install -g sillyspec@latest`，但结果只写日志，不上报后端；`daemon_instances` 表与机器卡均无 sillyspec 版本字段。
2. **运行期无法升级**：sillyspec 无自升级命令；daemon 启动后若 npm 上发布了新版本，只能等 daemon 下次重启（preflight）才能升级，运行期间平台无法触发。
3. **机器上可能未安装**：preflight 启动时 npm 不可达则保持未安装（spec 流程将失败），平台无感知也无远程补装手段。

## 设计目标

1. 机器卡显示每台机器的 sillyspec 版本徽标：已最新（常色）/ 落后（橙色「当前 → 最新」高亮）/ 未安装（红色），落后时「升级 sillyspec」按钮同步高亮。
2. 支持手动远程升级：机器卡按钮 → 后端 → WS 指令 → daemon 执行 `npm install -g sillyspec@latest`，始终升到 latest。
3. 升级过程可见：升级中 / 机器忙推迟 / 成功 / 失败（含原因）四态横幅，完成后版本徽标随心跳自动刷新（用户已确认）。
4. 运行期自动定期升级（用户已确认）：daemon 每小时自动探测 npm 最新版并升级，机器忙时推迟（每 30s 复查空闲即执行），不打断运行中的会话/任务。
5. 兼容三平台（Windows/Linux/macOS）：探测与升级复用 preflight 已验证的 spawn+超时杀树链路（`runWithTreeKill`，Windows `taskkill /T /F`）。

## 非目标（Non-Goals）

- 不做指定版本安装/降级（始终 `sillyspec@latest`；降级需求走机器本地手动 npm）。
- 不做离线机器指令排队（`daemon_control_commands` 表）：daemon 每次启动 preflight 本就自动升级 sillyspec，离线排队与之冗余（D-001@v1 否决方案 B）。
- 不改 daemon 自身自更新链路（SELF_UPDATE / pending_update 语义不动）。
- 不改 sillyspec CLI 本身（无自升级命令是上游现状）。
- 不做 RPC 同步等待升级结果（npm install 常超 10s RPC 超时，D-001@v1 否决方案 C）。

## 总体方案

方案 A（D-001@v1）：版本与升级状态随 register/heartbeat 心跳上报（仿 `pending_update` 透传链）；手动升级走 WS 即时消息 `daemon:sillyspec_update`（仿 `daemon:self_update`，fire-and-forget）；自动升级由 daemon 本机定时器执行。

### 数据流

```
daemon sillyspec-manager（探测缓存 + 升级状态机 + 1h 自动循环）
   │ register/heartbeat body（版本字段 + sillyspec_update 状态）
   ▼
backend daemon_instances（3 新列） ── GET /api/daemon/machines ──▶ DaemonMachineRead
   │                                                                │
   │ POST /machines/{id}/sillyspec-update                           ▼
   ▼                                                        机器卡徽标/按钮/横幅
ws_hub.send_sillyspec_update ──WS──▶ daemon case SILLYSPEC_UPDATE ──▶ requestUpgrade()
```

### 1. daemon 侧（sillyhub-daemon）

**新模块 `src/sillyspec-manager.ts`**（核心状态与执行器，可注入依赖供测试）：

- 探测：`probeLocal()` = spawn `sillyspec --version`（输出 trim 后为 semver 或失败）；`probeLatest()` = spawn `npm view sillyspec version`，结果缓存 10 分钟（TTL 内复用）。复用 `preflight.ts` 的 `runCmd`/`runWithTreeKill` 基建（必要时从 preflight 导出，避免复制）。
- 升级执行：`runUpgrade()` = spawn `npm install -g sillyspec@latest`（复用/对齐 `installSillySpec` 实现），成功后重新 `probeLocal()` 得到新版本。
- 状态机（内存态，daemon 重启即重置为 idle，可接受——重启后 preflight 已保证最新）：

| state | 进入条件 | 上报 |
|---|---|---|
| `idle` | 初始 / 终态展示窗口结束 | 不带 sillyspec_update 键 |
| `running` | 升级 spawn 开始 | `{state:'running', trigger, from_version, to_version?}` |
| `deferred` | 收到升级请求但机器忙（`_isBusyForUpdate()`） | `{state:'deferred', ...}`，每 30s 复查，空闲即转 running |
| `success` | 安装成功且新版本确认 | 上报保留 10 分钟后回 idle |
| `failed` | 安装失败/新版本探测失败 | 带 `error` 摘要，保留 10 分钟后回 idle |

- 并发仲裁：in-flight 门（running/deferred 期间新请求仅记日志去重，同 CLEANUP 惯例）。
- 自动循环：`_sillyspecLoop`（daemon.ts 三循环旁新增第四循环）：每 `sillyspec_update_interval_sec` 秒执行「probeLatest + probeLocal → 落后 or 未安装 → requestUpgrade('auto')」；间隔为 config.json 字段（默认 3600，`0` = 关闭，形状对齐既有 `self_reload_check_interval_sec`——config.ts 间隔类字段均走 config.json，不引入 env 覆盖先例，Design Grill F13）；忙时同走 deferred。
- 启动衔接：preflight `runSillySpecCheck` 行为不变（启动门保留）；daemon 启动注册前由 manager 做一次探测（版本 + latest）使 register 报文即带版本。

**协议与上报接线**：

- `src/protocol.ts`：`MSG.SILLYSPEC_UPDATE = 'daemon:sillyspec_update'`（Server→Daemon，payload `{}`，fire-and-forget）。
- `src/hub-client.ts`：`register()` 追加可选参 `sillyspec?: { version: string|null, latest_version: string|null }`（键仅在知道时携带）；`heartbeat()` 追加可选末位参 `sillyspec?: { version?: string|null, latest_version?: string|null, update?: SillySpecUpdateState|null }`——`update` 键存在才携带（null/无状态 = backend 清除，与 `pending_update` 同款反向语义），version/latest 键缺省 = backend 保留（与 `daemon_version/build_id` 兄弟字段同款语义）。
- `src/daemon.ts`：`_handleMessage` 加 `case MSG.SILLYSPEC_UPDATE`（对齐 SELF_UPDATE :4875 写法，`void manager.requestUpgrade('server_command')`）；心跳拍 `_sendHeartbeatOnce` 从 manager 取快照透传；注册 `_registerDaemon` 带 manager 快照。

### 2. backend 侧

- `app/modules/daemon/protocol.py`：`DAEMON_MSG_SILLYSPEC_UPDATE = "daemon:sillyspec_update"`（先改后端，daemon 侧逐字对齐——protocol.md 改动纪律）。
- `app/modules/daemon/ws_hub.py`：`send_sillyspec_update(daemon_id) -> bool`（仿 `send_cleanup`）。
- `app/modules/daemon/router.py`：
  - `POST /machines/{instance_id}/sillyspec-update`（RuntimeAdminUser + `_get_owned_instance` 归属校验；离线/发送失败 504 `DaemonRuntimeOffline`；返回 `{"sent": True}`——npm latest 由 daemon 自行探测，后端不代查）。
  - heartbeat 内联 DTO（:230-282）加 `sillyspec_version: str|None`（非 None 覆盖、None 保留，兄弟字段语义）、`sillyspec_latest_version: str|None`（同上）、`sillyspec_update: DaemonHeartbeatSillySpecUpdate|None`（None=清除，pending_update 反向语义）；register DTO（schema.py `DaemonRegisterRequest`）加同名 version/latest 字段，但**落库语义为直接落值（含 null，无条件写）**——对齐既有先例 `runtime/service.py:240-242`（`instance.version = daemon_version` 不判 None），也是「本机卸载 sillyspec 后 daemon 重启」能把 NULL 落库、机器卡显示未安装红徽标的唯一路径（Design Grill F1 / D-002@v1）。
  - 心跳/注册 handler 将字段透传 `RuntimeService.heartbeat_daemon/register_daemon` upsert。
  - 机器列表组装函数 `_build_machine_read`（router.py:634）**显式构造** 3 个新字段（该函数逐字段构造、不走 model_validate，仅加 schema 字段会静默丢字段，Design Grill F2）；`sillyspec_update` 用嵌套类型化模型 `MachineSillySpecUpdateRead`（仿 `MachinePendingUpdateRead` :560），避免前端拿到裸 dict。
- `app/modules/daemon/model.py` `DaemonInstance` 加 3 列：`sillyspec_version: str|None(50)`、`sillyspec_latest_version: str|None(50)`、`sillyspec_update: dict|None(JSON)`（backend 首落库盖 `since`，同 pending_update）。
- `app/modules/daemon/schema.py` `DaemonMachineRead` 加 3 同名字段（`from_attributes` 直读）。
- Alembic 迁移 `backend/migrations/versions/20260831XXXXXX_add_daemon_sillyspec_fields.py`（仿 `202608291500_add_daemon_pending_update.py`，add_column ×3）。

### 3. frontend 侧

- `src/lib/daemon.ts`：`DaemonMachineRead` TS 类型经 `pnpm gen:types` 再生；新增 `triggerMachineSillySpecUpdate(instanceId)`（POST sillyspec-update）。
- `src/components/daemon/machine-card.tsx`：
  - meta 行 daemon 版本后加 sillyspec 徽标三形态（常色 `sillyspec 3.27.11` / 橙色 `sillyspec 3.26.15 → 3.27.11` + 「有新版本」小标签 / 红色 `sillyspec 未安装`）；semver 比较用本地小工具函数（split 数字段比较，不引第三方库）。
  - 按钮组加「升级 sillyspec」（btnOutlineTiny 同款；离线 / running / deferred 禁用并 title 说明；落后时橙色高亮；未安装文案「安装 sillyspec」；failed 文案「重试升级」）。
  - pending_update 横幅槽（:314-356）之后加 sillyspec_update 横幅：running=info 旋转、deferred=warning、success=success、failed=destructive（带 error 摘要），色阶走主题语义 token。
- `src/app/(dashboard)/runtimes/page.tsx`：`handleSillySpecUpgrade` handler（modal.confirm 确认后调 API + refetch），MachineCard 传参 `onUpgradeSillySpec`。
- 刷新沿用 `useDaemonMachines` 15s 轮询，不加新通道。

## 接口定义

### WS 消息（Server→Daemon）

```json
{ "type": "daemon:sillyspec_update", "payload": {} }
```

fire-and-forget（无回执，同 CLEANUP）；旧 daemon default 分支仅 warn（protocol.md 兼容惯例）。

### REST

`POST /api/daemon/machines/{instance_id}/sillyspec-update` → `{"sent": true}`；错误：403/404（归属）、504 DaemonRuntimeOffline。

### heartbeat/register body 扩展（daemon→backend）

```json
{
  "sillyspec_version": "3.26.15",
  "sillyspec_latest_version": "3.27.11",
  "sillyspec_update": {
    "state": "running",            // running | deferred | success | failed
    "trigger": "server_command",   // server_command | auto
    "from_version": "3.26.15",
    "to_version": "3.27.11",       // success 时必带；running/deferred 可空
    "error": null                   // failed 时必带（截断至 200 字符）
  }
}
```

`state` 用 `str` 不收紧成 Literal（心跳是保活通道，宁宽勿断——与 `DaemonHeartbeatPendingUpdate.reason` 同决策）；`since` 由 backend 落库时盖。

### DB（daemon_instances 新列）

| 列 | 类型 | 语义 |
|---|---|---|
| `sillyspec_version` | VARCHAR(50) NULL | 本机 sillyspec 版本；null=未安装或未知 |
| `sillyspec_latest_version` | VARCHAR(50) NULL | daemon 探测到的 npm 最新版；null=未知 |
| `sillyspec_update` | JSON NULL | 升级状态机快照；null=无进行中/近期升级 |

### DaemonMachineRead 扩展

`+ sillyspec_version: str|None`、`+ sillyspec_latest_version: str|None`、`+ sillyspec_update: MachineSillySpecUpdateRead|None`（嵌套类型化，非裸 dict）。

## 生命周期契约表

| 对象/字段 | 产生 | 更新 | 消亡 |
|---|---|---|---|
| daemon 侧 manager 内存状态 | 启动探测 / 升级触发 | 状态机流转；deferred 每 30s 复查 | 终态展示 10 分钟后回 idle；进程退出即失 |
| `sillyspec_update` 列 | 心跳携带状态时 upsert（首写盖 since） | 每轮心跳覆盖 | 心跳无该键即置 NULL（pending_update 同款） |
| `sillyspec_version/latest` 列 | register 直接落值（含 null，无条件写，D-002@v1） | 心跳非 None 时覆盖（兄弟字段语义：缺省/null=保留——Pydantic 下二者不可区分，D-002@v1） | 仅 register 落 null（本机卸载后重启）；daemon 离线保留旧值（机器卡显示最后上报值） |
| WS `daemon:sillyspec_update` | 用户点按钮 | —（一次性） | daemon 离线即失败 504，不重投（preflight 兜底） |
| 机器卡徽标/横幅 | 轮询数据驱动 | 15s 轮询刷新 | 横幅随 sillyspec_update 置 NULL 消失；徽标常驻 |

## 文件变更清单

| 文件 | 变更 |
|---|---|
| `sillyhub-daemon/src/sillyspec-manager.ts` | 新增（探测/状态机/升级执行/自动循环核心） |
| `sillyhub-daemon/src/protocol.ts` | +`SILLYSPEC_UPDATE` 常量与 MsgType 联合 |
| `sillyhub-daemon/src/hub-client.ts` | register/heartbeat 追加 sillyspec 可选参 |
| `sillyhub-daemon/src/daemon.ts` | +`_sillyspecLoop`、心跳/注册接线、`case SILLYSPEC_UPDATE` |
| `sillyhub-daemon/src/preflight.ts` | 导出 `runCmd`/`installSillySpec` 供 manager 复用（行为不变） |
| `sillyhub-daemon/src/config.ts` | +`sillyspec_update_interval_sec`（config.json 字段，默认 3600，0=关） |
| `sillyhub-daemon/tests/config.test.ts` | DEFAULT_CONFIG 精确键断言 29→30（Plan Review PL-02） |
| `sillyhub-daemon/tests/sillyspec-manager.test.ts` | 新增（状态机/忙推迟/缓存/TTL/终态窗口） |
| `sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts` | 新增（心跳 body 键存在性语义；仿 daemon-heartbeat-pending.test.ts） |
| `sillyhub-daemon/tests/protocol-session-contract.test.ts` | EXPECTED map +`SILLYSPEC_UPDATE`（双侧契约镜像，Design Grill F12） |
| `backend/app/modules/daemon/protocol.py` | +`DAEMON_MSG_SILLYSPEC_UPDATE` |
| `backend/app/modules/daemon/ws_hub.py` | +`send_sillyspec_update` |
| `backend/app/modules/daemon/router.py` | +sillyspec-update 端点；heartbeat DTO+register 透传；`_build_machine_read`（:634）显式传 3 新字段 |
| `backend/app/modules/daemon/schema.py` | register DTO / `DaemonMachineRead` / `MachineSillySpecUpdateRead`（嵌套类型化）加字段 |
| `backend/app/modules/daemon/model.py` | `DaemonInstance` +3 列 |
| `backend/app/modules/daemon/runtime/service.py` | register/heartbeat upsert 3 字段 |
| `backend/app/modules/daemon/service.py` | facade 透传（如需） |
| `backend/migrations/versions/20260831*_add_daemon_sillyspec_fields.py` | 新增迁移 |
| `backend/tests/modules/daemon/test_protocol_session_contract.py` | +sillyspec_update 字面量契约断言 |
| `backend/app/modules/daemon/tests/test_machine_sillyspec.py` | 新增（task-02 落库语义 + task-03 端点/视图，仿 test_pending_update_upsert.py / test_machines_router.py） |
| `frontend/src/lib/api-types.ts` | gen:types 再生（+3 字段） |
| `frontend/src/lib/daemon.ts` | +`triggerMachineSillySpecUpdate` |
| `frontend/src/components/daemon/machine-card.tsx` | 徽标/按钮/横幅 |
| `frontend/src/app/(dashboard)/runtimes/page.tsx` | handler + 传参 |
| `frontend/src/components/daemon/__tests__/machine-card-sillyspec.test.tsx` | 新增（徽标三形态/按钮禁用态/横幅四态） |
| `backend/openapi.json` | gen:types 联动提交 |

模块文档同步（archive 阶段执行，登记在此备忘）：sillyhub-daemon `protocol.md`/`daemon.md`/`preflight.md`/`config.md`、backend daemon 模块卡、frontend 相应页卡。

## 风险登记

| # | 风险 | 缓解 |
|---|---|---|
| R1 | npm install 期间新 spawn 的 sillyspec 子进程读到半安装包 | 升级前查忙（`_isBusyForUpdate` 三臂：恢复在途+运行中轮次+活跃 lease），忙时 deferred；已运行进程脚本已加载不受替换影响（spec-sync 模块文档已确认运行期升级无需重启）。残余 TOCTOU 窗口：查忙通过后 install 进行中（≤120s）新接受任务可能 spawn 到半安装包——该任务 init 前 `sillyspec --version` 门控（spec-sync.ts:1595）失败为可重试软失败，概率低接受（Design Grill F11） |
| R2 | `npm view` 每 10 分钟缓存 + 每小时安装对 npm registry 的低频压力 | 频率极低（单机 2 spawn/小时），可忽略 |
| R3 | 旧后端 + 新 daemon：心跳多带字段被 Pydantic 忽略；旧 daemon + 新后端：字段缺省不覆盖（version/latest）不误清除（update 缺省=清除为设计语义） | 字段语义显式区分兄弟/pending 两种模式，双侧注释锚定 |
| R4 | 升级成功但 `probeLocal` 失败导致状态卡 running | probe 失败按 failed 上报（带原因），版本列保留旧值；下轮自动循环自愈 |
| R5 | Windows npm.cmd spawn 超时挂孙进程 | 复用 preflight `runWithTreeKill`（taskkill /T /F 已验证） |
| R6 | 前端 15s 轮询窗口内状态滞后（点击后短暂无反馈） | 接受（与「升级 daemon」现状一致）；running 态按钮即时禁用由本地 optimistic 状态先行 |
| R7 | 原型分级为「建议生成」 | 已生成 `prototype-machine-sillyspec.html`（8 场景双主题） |

## 决策引用

- D-001@v1（accepted，architecture）：方案 A 全对齐既有模式；B/C 否决理由见 decisions.md。
- D-002@v1（accepted，consistency，design-grill）：sillyspec 版本字段 register 直接落值（含 null）/ 心跳非 None 才覆盖的双通道语义。

## 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 三用户确认决策（过程可见/高亮/自动定期）全部落实 | ✅ 横幅四态+徽标高亮+1h 自动循环 |
| 协议纪律（先 backend 后 daemon、逐字对齐、双侧契约单测） | ✅ 文件清单含双侧测试（backend + TS 镜像） |
| 心跳字段语义与既有两模式对齐不混淆 | ✅ version/latest=兄弟语义，update=pending 语义，接口定义显式声明；register 直接落值（D-002@v1） |
| 不破坏既有测试（heartbeat body 键缺省不变） | ✅ 全部可选参数追加末位，undefined 键不出现 |
| 三平台兼容 | ✅ 复用 runWithTreeKill；npm/.cmd 处理走既有链路 |
| 前端类型不手写 | ✅ gen:types 再生 + openapi.json 提交 |
| 自审存疑①：终态 10 分钟保留窗口 | ✅ Design Grill F14 裁定接受（15s 轮询仅需 ≥45s 可见，超配无副作用） |
| 自审存疑②：自动升级间隔 1h | ✅ Design Grill F15 裁定接受（安装仅落后时发生，0=off 逃生） |

### Design Grill 修订回填记录（2026-08-31，独立审查 agent_966cb864）

审查结论 passed（specVerdict=pass / qualityVerdict=fail 仅因两处 P1 局部缺陷，已当场修订）：F1 register 落值语义（→D-002@v1，已改 §2/生命周期表）；F2 `_build_machine_read` 显式组装 + `MachineSillySpecUpdateRead` 嵌套类型（已改 §2/文件清单）；F12 TS 契约镜像测试（已入文件清单）；F13 config.json 字段模式（已改 §1/config.ts 行）；F11 R1 TOCTOU 残余窗口（已补）；F16 行号 230-282（已改）。无 P0/P1 Unresolved Blocker。
