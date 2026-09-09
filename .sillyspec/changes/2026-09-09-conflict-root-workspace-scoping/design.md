---
author: qinyi
created_at: 2026-09-09T20:58:00
scale: large
---

# 设计文档（Design）— 冲突对比/裁决按工作区取根（单槽位投毒根治）

> 依据：`docs/sillyspec/conflict-compare-wrong-status-root.md`（根因实证与已定稿
> 根治口径）；决策 D-001@v1（方案 A：全链强制 workspace_id + daemon 映射查根）。

## 1. 背景

2026-09-09 实证：冲突对比 502（`conflict_record_missing`）。根因是**半改造**——
列表（心跳采集）已于 2026-09-08 工作区级化（`_sillyspecStatusRoots` 映射），但
对比 RPC `sillyspec_conflict_snapshot` 与裁决指令 `SILLYSPEC_RESOLVE` 仍走
**单槽位** `_sillyspecStatusRoot`。该单槽位被「无 workspaceId 的 claim、
rootPath=Temp」投毒后（`~/.sillyhub/daemon/sillyspec-status-root.json` 落盘
Temp），对比在 Temp 下找冲突记录必失败；更危险的是**裁决会在 Temp 下执行
sillyspec CLI**（写操作、错误 cwd）。

代码锚点（2026-09-09 已逐一对源码验证）：

| 锚点 | 位置 | 现状 |
|---|---|---|
| RPC handler 只透传 change/kind | `sillyhub-daemon/src/daemon.ts` `_registerSillySpecRpcHandler`（L6313 起，handler 在 L6320-6325） | 无 workspace_id |
| RESOLVE 消息 case | `sillyhub-daemon/src/daemon.ts`（L6615-6633） | payload 仅 change/strategy |
| `_routeSillySpecResolve` | `sillyhub-daemon/src/daemon.ts`（L6719-6732） | 签名无 workspaceId |
| statusCwd 单槽位注入 | `sillyhub-daemon/src/daemon.ts`（L1959） | `() => this._sillyspecStatusRoot` |
| `conflictSnapshot` 用 `_statusCwd()` | `sillyhub-daemon/src/sillyspec-manager.ts`（L1131-1153） | 单槽位；空→`no_spec_root` |
| `_requireCommandPrecondition`（runResolve 前置） | `sillyhub-daemon/src/sillyspec-manager.ts`（L1001-1026） | `_statusCwd()` 单槽位 |
| `_noteSillySpecStatusRoot` 投毒入口 | `sillyhub-daemon/src/daemon.ts`（L4690-4740） | workspaceId null/undefined 时仍覆盖单槽位 |
| compare RPC 只发 {change,kind} | `backend/app/modules/daemon/sillyspec_compare.py` `_fetch_snapshot`（L371-400） | workspace_id 仅平台侧用 |
| resolve 请求体/WS payload | `backend/app/modules/daemon/router/machines.py`（L240-283）、`ws_hub.py send_sillyspec_resolve`（L428-445） | 仅 change/strategy |
| 前端弹窗 workspaceId 未下传 | `frontend/src/components/changes/conflict-compare-modal.tsx`（L61 prop 已有） | resolve 请求不带 |

## 2. 设计目标（FR）

- **FR-01**：对比 RPC `sillyspec_conflict_snapshot` 与裁决指令
  `daemon:sillyspec_resolve` 全链携带 `workspace_id`（REST 请求体 → WS payload →
  daemon 消息 → manager 方法），前端弹窗下传。
- **FR-02**：daemon 按 `_sillyspecStatusRoots.get(workspaceId)` 解析根；**映射未
  命中不得回退单槽位**——对比抛 RpcError `workspace_root_unknown`；裁决记
  `failed` 命令结果（同语义文案），不 spawn。
- **FR-03**：无 `workspace_id` 的旧调用形态（legacy 客户端）保留单槽位读路径
  （`no_spec_root` 语义不变）——新路径一律按工作区。
- **FR-04（辅防）**：`_noteSillySpecStatusRoot` 中 workspaceId 为 null/undefined
  的 claim **不再覆盖单槽位**；合法 UUID claim 保持「映射+单槽位」双写（「正确
  claim 洗白单槽位」的临时绕过机制由此保留）。
- **FR-05**：resolve 端点补 workspace 成员校验（复用 compare 的
  `PermissionDenied` 判定范式，写操作防越权）。
- **FR-06（可选）**：backend 502 网关文案对 `workspace_root_unknown` /
  `conflict_record_missing` 映射准确提示（替代误导性「请稍后重试」）。

## 3. 非目标

- `sillyspec_ghost_cleanup` 不动（机器级、无工作区上下文，明确范围外）。
- 不做 Temp 目录黑名单（根因文档明确「拒 Temp 不能当主修——错根不只有 Temp」）。
- 不改心跳采集 / `statusTargets` / `sillyspec_status_map`（已工作区级化，无恙）。
- 无 UI 布局/结构/流程变化，HTML 原型跳过（纯数据流改动）。

## 4. 拆分判断

单一功能目标（按工作区取根）横切 daemon/backend/frontend/OpenAPI 四层，但层间
是同一契约的两端实现，拆开会留半改造中间态（正是本 bug 的成因模式）——不拆，
单 change 三 Phase 交付。

## 5. 总体方案

### Phase 1 — Daemon：根解析通道 + 防投毒

**1.1 新增按工作区查根的注入。** `daemon.ts` 构造 SillySpecManager 处
（L1953-1973）追加注入：

```ts
statusRootFor: (workspaceId) =>
  this._sillyspecStatusRoots.get(workspaceId)?.rootPath ?? null,
```

映射未命中返回 null（由调用方决定报错语义），**不在解析器内部回退单槽位**。

**1.2 `conflictSnapshot(change, kind, workspaceId?)`**
（sillyspec-manager.ts）：workspaceId 非空 → `statusRootFor` 查根，null 时抛
`RpcError('workspace_root_unknown', '该工作区尚未被本机会话认领…')`；workspaceId
为空 → 沿用 `_statusCwd()` 单槽位（legacy，`no_spec_root` 语义不变）。

**1.3 `runResolve(change, strategy, workspaceId?)` + `_requireCommandPrecondition`**：
同 1.2 解析规则（`_requireCommandPrecondition` 的 workspaceId 形参**可选**，
`runGhostCleanup` 不传 → 走 legacy 单槽位，语义不变，sillyspec-manager.ts
L893 为唯一调用位）；映射未命中 → `recordCommandResult({state:'failed', error:
'该工作区尚未被本机会话认领，无法执行 sillyspec 命令'})`，返回 null 不 spawn
（fire-and-forget 无回执，错误经心跳 `sillyspec_command_result` 回传，对齐现有
`no_spec_root` 处理位）。`SillySpecCommandExecutor` 最小接口签名同步
（daemon.ts L1454；可选参数不破坏 L6800 duck-type 探测）。

**1.4 RPC handler / RESOLVE case 透传。** 两处入口透传可选 `workspace_id`
（非字符串/缺省归一空串 = legacy，对齐 runtime.* 惯例）：
`_registerSillySpecRpcHandler`（L6320）→ `conflictSnapshot(change, kind, wsId)`；
`case MSG.SILLYSPEC_RESOLVE`（L6615）→ `_routeSillySpecResolve(change, strategy, wsId)`
→ `runResolve(change, strategy, wsId)`。

**1.5 防投毒（FR-04）。** `_noteSillySpecStatusRoot`（L4690）：
`workspaceId` null/undefined 分支下**不再执行单槽位覆盖与落盘**
（`if (!workspaceId) return;` 于映射逻辑之前；合法 UUID 路径的双写保持不变）。
非 UUID 的 warn+return 已存在，不动。

### Phase 2 — Backend：契约补齐 + 越权防护

**2.1 compare RPC 透传（FR-01）。** `SillySpecCompareService.compare()` 把
workspace_id 传给 `_fetch_snapshot(instance_id, change, kind, workspace_id)`，
RPC params 变为 `{change, kind, workspace_id}`（str 化）。

**2.2 resolve 契约（FR-01/FR-05）。**
- `MachineSillySpecResolveRequest` 加必填 `workspace_id: uuid.UUID`。
- `ws_hub.send_sillyspec_resolve(daemon_id, change, strategy, workspace_id)`，
  payload 加 `workspace_id`。
- 端点 `trigger_machine_sillyspec_resolve`：透传 + **成员校验**。校验实现：
  `sillyspec_compare.py` 的 `_ensure_workspace_member` 公开为
  `ensure_workspace_member`（compare 内部调用点同步改名），并加可选
  `action` 参数（缺省 `"查看"`，文案 `f"仅工作区成员可{action}该冲突对比。"`）——
  resolve 传 `"对"`/`"下发裁决"` 动作词，避免复用时文案语义错位；端点实例化
  `SillySpecCompareService(session)` 复用——同一权限集合（compare 端点
  docstring 已声明此口径），不复制查询逻辑。

**2.3（FR-06，可选任务）** `DaemonRpcRemoteGatewayError` 构造处按
`daemon_code` 分叉文案：`workspace_root_unknown` → 「该工作区尚未被本机认领，
请先在该工作区发起一次会话」；`conflict_record_missing` → 「冲突记录已失效，
请刷新列表」；其余维持现状。

### Phase 3 — Frontend + 契约同步

- 后端契约变更后：`pnpm gen:types` 重新生成 `frontend/src/lib/api-types.ts` +
  `backend/openapi.json`（含 `sillyhub-daemon/src/api-types.ts` 同源检查）。
- `conflict-compare-modal.tsx`：裁决下发构造 `MachineSillySpecResolveRequest`
  时加 `workspace_id: workspaceId`（prop 已有，L61）；`machines.ts`
  `triggerMachineSillySpecResolve` 签名不变（body 类型自动更新）。
- `platform-sync-section.tsx` 无需改（resolve 调用在弹窗内，D-002@v1）。

## 6. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| sillyhub-daemon/src/sillyspec-manager.ts | 修改 | conflictSnapshot / runResolve / _requireCommandPrecondition workspaceId 参数化 + workspace_root_unknown；statusRootFor 注入（Deps + 构造） |
| sillyhub-daemon/src/daemon.ts | 修改 | statusRootFor 注入；RPC handler 透传；RESOLVE case + _routeSillySpecResolve + SillySpecCommandExecutor 签名透传；_noteSillySpecStatusRoot 防投毒 |
| sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts | 修改 | 映射取根 / 未命中抛错 / legacy 回退断言 |
| sillyhub-daemon/tests/sillyspec-platform-command.test.ts | 修改 | runResolve 按 ws 取根 / 未命中 failed 不 spawn 断言 |
| sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts | 修改 | 无 ws claim 不覆盖单槽位 / 有 ws 双写不变断言 |
| backend/app/modules/daemon/sillyspec_compare.py | 修改 | _fetch_snapshot 加参透传；_ensure_workspace_member → ensure_workspace_member（公开 + 可选 action）；（FR-06）502 文案分叉 |
| backend/app/modules/daemon/ws_hub.py | 修改 | send_sillyspec_resolve 加 workspace_id |
| backend/app/modules/daemon/router/machines.py | 修改 | MachineSillySpecResolveRequest 加必填字段；端点成员校验 + 透传 |
| backend/app/modules/daemon/tests/test_sillyspec_compare.py | 修改 | RPC params 带 workspace_id 断言 |
| backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py | 修改 | resolve 必填 + 成员校验 403 + payload 透传断言 |
| backend/openapi.json | 生成 | gen:types 产物同步 |
| frontend/src/components/changes/conflict-compare-modal.tsx | 修改 | resolve body 加 workspace_id |
| frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx | 修改 | resolve 请求带 workspace_id 断言 |
| frontend/src/lib/api-types.ts | 生成 | gen:types 产物同步 |

## 7. 接口定义（变更后）

### 7.1 RPC `sillyspec_conflict_snapshot`（backend → daemon）

```jsonc
// 请求（新增 workspace_id；空串 = legacy 单槽位，仅旧客户端）
{ "change": "<name>", "kind": "spec-tree|progress", "workspace_id": "<uuid>" }
// daemon 错误码新增：workspace_root_unknown（映射未命中，不回退单槽位）
// 既有错误码不变：no_spec_root（legacy 无根）、conflict_record_missing
```

### 7.2 WS 指令 `daemon:sillyspec_resolve`（Server → Daemon，fire-and-forget）

```jsonc
// payload（新增 workspace_id；缺省 = legacy 单槽位）
{ "change": "<name>", "strategy": "keep_local|take_platform", "workspace_id": "<uuid>" }
// 失败经心跳 sillyspec_command_result 回传：state=failed,
// error 含「尚未被本机会话认领」语义（workspace_root_unknown）
```

### 7.3 REST `POST /api/daemon/machines/{id}/sillyspec-resolve`

```jsonc
// 请求体（workspace_id 必填，UUID）
{ "change": "<name>", "strategy": "keep_local|take_platform", "workspace_id": "<uuid>" }
// 新增 403 PermissionDenied：非 workspace 成员（文案「仅工作区成员可对该冲突下发裁决。」）
// 其余不变：404 归属 / 422 校验 / 504 DaemonRuntimeOffline
```

### 7.4 compare REST `GET .../compare`：无变化（workspace_id 查询参数已有，仅 RPC 腿新增透传）

### 7.5 生命周期契约表

本变更涉及 daemon / claim / heartbeat 关键词，契约表如下（均为参数透传 + 根解析变化，
无 lease/run 状态机迁移；resolve 的 fire-and-forget 回传链沿用既有通道，仅新增
一种 failed 终态语义）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| compare RPC 请求 | backend | daemon | rpc_id, method=sillyspec_conflict_snapshot, change, kind, workspace_id（新） | 无（只读快照；workspace_id 非空且映射未命中 → RpcError workspace_root_unknown，不落地） |
| snapshot RPC 响应 | daemon | backend | rpc_id, files[]/progress, ql_id, local_updated_at | 无（既有语义不变） |
| resolve 裁决下发 | backend | daemon | change, strategy, workspace_id（新，REST 必填→WS payload） | 无状态机；daemon 侧新增：workspace_id 非空且映射未命中 → 结果槽记 failed（尚未认领语义），不 spawn |
| 裁决结果心跳回传 | daemon | backend | sillyspec_command_result: action/change/strategy/state/error | 既有回显链（waiting 徽章→终态）不变，新增 failed 文案形态 |
| claim 学习（旁路观察） | daemon | daemon（本地） | workspaceId, rootPath | 无状态机；FR-4 后：无 workspaceId 不再写单槽位（映射/落盘行为见 §5.1.5） |

## 8. 错误语义表（daemon → backend → 前端）

| daemon 侧 | 触发条件 | backend 映射 | 前端可见 |
|---|---|---|---|
| `workspace_root_unknown` | 带非空 ws 且映射未命中 | 502（FR-06 后文案「尚未被本机认领」） | 对比弹窗错误态 |
| `no_spec_root` | legacy 无 ws 且单槽位空 | 502（现状不变） | 对比弹窗错误态 |
| `conflict_record_missing` | 根正确但记录被清 | 502（FR-06 后文案「记录已失效」） | 对比弹窗错误态 |
| 心跳 `sillyspec_command_result` failed「尚未认领」 | 裁决 ws 未命中 | 心跳回显链路（现状机制） | 变更中心 waiting 徽章转失败 |

## 9. 风险登记

| 风险 | 缓解 |
|---|---|
| daemon 落盘映射经 LRU(8) 淘汰后 workspace_id 查不到 | 语义即「未认领」：用户在该工作区再开一次会话即恢复（claim 重登记）；文案已提示 |
| 旧 daemon + 新 backend：resolve payload 带新字段 | daemon 入口按「未知字段忽略 + 缺省空串 = legacy」容错（归一化写法天然兼容）；本项目未上线不承诺跨版本 |
| 新 daemon + 旧 backend：resolve 不带 workspace_id | FR-03 legacy 单槽位读路径保留；单槽位已由 FR-04 防投毒，被污染风险已封死 |
| `_ensure_workspace_member` 公开改名波及 compare 调用点/测试 | 单文件内私有方法改名，调用点仅 compare() 一处 + 测试内若有直调同步改 |
| FR-04 后 daemon 从未有合法 UUID claim 时单槽位恒 null → legacy `sillyspec_status` 心跳字段恒缺 | 防投毒的预期代价（收紧语义）；新路径按 workspace 走 `status_map` 不受影响，且本平台前端列表已消费 `status_map` |

## 10. 自审

- **是否根治**：对比与裁决的根均改由 workspace 声明式定位，映射未命中显式报错
  不静默回退——单槽位投毒不再影响新路径；FR-04 封死投毒入口保护 legacy 路径。
  ✓
- **是否引入新半改造**：三端 + OpenAPI 同 change 内一次交付，契约两端同步。✓
- **YAGNI**：未加 Temp 黑名单、未动 ghost_cleanup、未做缓存/预取。✓
- **兼容性**：Windows/macOS/Linux 无新增平台面（纯参数透传 + Map 查询）。✓
- **测试债**：三端既有测试文件均在，新增断言落位于既有套件，不新开框架。✓
- **依据可溯**：全部锚点行号已对源码复核（2026-09-09）；决策 D-001@v1 落盘。✓
