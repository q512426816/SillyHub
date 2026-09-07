---
author: qinyi
created_at: 2026-09-07 11:20:00
scale: large
tier: independent
---

# 设计文档（Design）— 变更中心冲突对比弹窗 + quick 条目 ql 编号展示

## 1. 背景

变更中心「平台同步」处理区（2026-09-04-conflict-resolve-entry 落地）目前只列出冲突名 + 「保本地/取平台」两个按钮，用户裁决时**看不到双方内容差异**，只能凭变更名盲选——选错方向就把新内容覆盖成旧内容。本机当前挂着的 3 条真实冲突（2026-09-02-changes-overview-card、quick-62e1d5fb、quick-aac62562）各涉及 164~183 个文件，盲裁风险极高。

另一个可用性问题：quick 类冲突条目标题显示 `quick-62e1d5fb` 这种会话 ID，用户完全不认识；用户能认的编号是 QUICKLOG 块头的 ql 编号（如 `ql-20260907-006-2972`）。

已核实的数据链路事实（探查结论）：

- 冲突清单来自 daemon 心跳：`sillyspec-manager.collectStatusOnce()` 跑 `progress show --json`，`pending_conflicts[]` 仅投影 `change/created_at/type` 三字段（sillyspec-manager.ts:1174-1205），backend 落 `daemon_instances.sillyspec_status` 零改写透传（router.py:774-800），前端 `DaemonHeartbeatSillySpecConflict`（api-types.ts:12752）同三字段。
- 本地冲突内容痕迹在 daemon 机器 `.sillyspec/.runtime/spec-sync-conflict-<change>.json`：`{change, kind, created_at, server_versions, conflicting_paths[], auto_followed?, note}`，conflicting_paths 即需对比的文件集（实测 quick-62e1d5fb 164 条、changes-overview-card 183 条）。
- 平台侧内容：spec 树在 spec_workspace 的 `spec_root` 目录（默认 `{spec_data_root}/{workspace_id}`，路径即冲突清单里的相对路径）；进度在 platform_sync 六表，已有读端点 `GET /api/platform-sync/changes/{name}/progress`（router.py:312-330，返回裸六表 + last_pushed_at）。
- daemon↔backend 已有请求/响应式 RPC 通道：`ws_hub.send_rpc(daemon_id, method, params, timeout)`（ws_hub.py:495）+ daemon `registerRpcHandler`（ws-client.ts:411），explorer 文件浏览器（explorer/service.py:272 `_send_explorer_rpc` ↔ file-rpc.ts explorerReadFile）是成熟先例。
- quick 名 ↔ ql 编号映射只在 daemon 机器本地 `.sillyspec/.runtime/quick-sessions/<quick-名>/guard.json` 的 `quicklogId` 字段（实测 quick-1ed69695/guard.json:123）；`.runtime/` 在上传排除集内，平台侧拿不到。
- 前端无 diff 库；有手写 unified-diff 渲染（git-log/file-tree.tsx parseUnifiedDiff/DiffBody）与 antd Modal 先例（file-preview-modal.tsx）。

## 2. 设计目标

1. 冲突行加「查看对比」入口，弹窗内左侧本地内容、右侧平台内容、差异高亮，用户核对后在弹窗内裁决（保本地/取平台）。
2. 弹窗展示双方「最后更新时间」，较旧一侧给出方向性提示。
3. 裁决按钮从冲突行收进弹窗（D-002@v1 用户拍板：要在此弹窗才能选择），行上只留「查看对比」。
4. quick 类冲突条目标题显示 ql 编号（【ql-YYYYMMDD-NNN-后缀】快速修复 + 小字原始 ID），普通变更仍显示变更名（D-004@v1）。
5. 进度类冲突弹窗用关键信息对比表（D-003@v1），不甩原始 JSON。

## 3. 非目标

- 不做逐文件分别裁决：裁决粒度仍是整个变更（resolve 通道语义不变）。
- 不做冲突内容的心跳快照/缓存：每次查看实时拉取（D-001@v1 方案A），查看必须机器在线（裁决本身也要求在线，不新增限制）。
- 不改外部 sillyspec CLI 源码（不在本仓）；ql 编号由 daemon 读 guard.json 补报，不改 CLI 的 progress show 输出。
- 不改 09-04 变更已建的裁决通道（WS fire-and-forget + 命令结果回显）与 ghost 清理。
- 不做二进制文件 diff：非 utf8 文件按「无法文本对比」占位展示。
- 不变更移动端镜像页交互结构（PlatformSyncSection compact 模式复用同一弹窗组件）。

## 4. 拆分判断

单变更不拆：三端改动共享同一对新契约（1 个 RPC 方法 + 1 个 REST 端点 + 心跳字段 ql_id），拆开留半成品契约。与活跃变更冲突面核查：agent-liveness-states/arch-large-file-split/pi-task-events 碰 daemon 的 session/task-runner 区与本变更的 sillyspec-manager + RPC 注册区不重叠；conflict-resolve-entry 已进 verify 收尾，本变更建在其已合入的裁决通道之上，只加不改。

## 5. 总体方案

通道选型 = D-001@v1 方案A：复用 explorer 先例的请求/响应 RPC（`ws_hub.send_rpc` ↔ daemon `registerRpcHandler`），区别于一写即忘的裁决通道。diff 计算放后端（Python `difflib`，零新依赖），前端纯渲染。

### Phase 1 — Daemon：本地快照 RPC + ql_id 心跳补报

1. `sillyspec-manager.ts` 新增 `conflictSnapshot(change, kind)`：
   - spec 根定位复用 `_sillyspecStatusRoot`（claim 观察到的 workspace 主仓根，runResolve 同款）；无根 → RpcError `no_spec_root`。
   - 冲突记录按 kind 分文件名（CLI 实证）：spec-tree → `<根>/.sillyspec/.runtime/spec-sync-conflict-<change>.json`（sync.js:1173-1192，含 conflicting_paths/created_at）；progress → `sync-conflict-<change>.json`（sync.js:1094/1143）。
   - spec-tree：逐路径读 `<根>/.sillyspec/<path>`（realpath 落点必须在根内——file-rpc.ts explorer 系列同款校验；单文件 >256KB 截断置 `truncated`；非 utf8 → `binary:true` 不带内容；总路径 >300 截断）。逐文件带 `mtime`。
   - **聚合体积帽**（Grill B2 修订，WS 帧 websockets 默认 16MB 上限）：files 内容总字节 >4MB 时截断——路径按信噪比排序（`changes/<change>/` 本变更目录文件优先，`changes/archive/` 旧归档最后），溢出路径只带元信息不带内容并置 `truncated:true`。
   - progress：CLI `progress show --json` 的 `--json` 分支忽略 `--change`、恒回全局 envelope（外部 CLI index.js:329-341 实测），故 `execFile sillyspec ['progress','show','--json']`（runProgressJsonDefault 形态，windowsHide，超时走既有配置）后由 daemon 自行从 `data.changes[]` 过滤该 change 条目；可用字段 = current_stage/stage_label/last_active/steps.{total,completed}（无「当前步骤」明细）。
   - ql_id：`quick-*` 名 best-effort 读 `.sillyspec/.runtime/quick-sessions/<change>/guard.json` 的 `quicklogId`；读不到/非 quick → 缺省 null。
   - `local_updated_at`：spec-tree 取冲突文件 mtime 最大值（无文件则冲突记录 created_at）；progress 取进度条目的 last_active。
2. `daemon.ts` 新增 `_registerSillySpecRpcHandler(ws)`：`registerRpcHandler('sillyspec_conflict_snapshot', ...)` → 调 sillyspec-manager；注册点挂在 `_registerExplorerRpcHandler` 旁（daemon.ts:5091 区）。
3. 心跳补报：`collectStatusOnce`（sillyspec-manager.ts:437）在 `buildSillySpecStatusSummary`（:1174-1205，纯函数不落 fs）返回后做后处理：对 quick-* 名同步读 guard.json 补 `ql_id` 字段（best-effort，单文件读失败仅缺省该条，不阻断心跳）。

### Phase 2 — Backend：compare 编排端点 + 服务端 diff

1. 新端点 `GET /api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare?kind=spec-tree|progress&workspace_id=<uuid>`（router.py，挂 sillyspec-resolve 旁）：
   - 权限同裁决端点：`RuntimeAdminUser` + `_get_owned_instance`（越权 404）；`change` 白名单正则复用同款；`workspace_id` 校验当前用户是该 workspace 成员（平台侧 spec_root/progress 定位所需）。**前端无权限用户不渲染「查看对比」按钮**（Grill B1 修订：compare 数据与裁决同一权限集合，「无权限看对比」在契约上不可达，统一为同权限）。
   - 机器离线/RPC 超时（15s，显式传，send_rpc 默认 10s 不够）→ 504 同 DaemonRuntimeOffline 范式。
2. compare service（新文件 `backend/app/modules/daemon/sillyspec_compare.py`）：
   - 并行：`hub.send_rpc(daemon_id,'sillyspec_conflict_snapshot',...)` + 平台侧读取。
   - 平台侧 spec-tree：SpecWorkspaceService 拿 spec_root，按 daemon 回的 conflicting_paths 逐路径读内容 + 文件 mtime；**containment 校验**（Grill B3 修订：daemon 是半可信端）——逐路径拒绝对 `..` 段、resolve 落点必须在 spec_root 内（spec_workspace/service.py:1486-1504 同款范式），越界路径按平台侧缺失处理不读取。`platform_updated_at` = 这些文件 mtime 最大值。
   - 平台侧 progress：`PlatformSyncService.get_progress(name=change)`（router.py:312 同款服务调用），`platform_updated_at` = last_pushed_at。
   - spec-tree 比对：逐路径分类 `modified / local_only / platform_only / identical`（Grill B4 修订枚举方向：**local_only=本地有而平台没有/平台侧缺失或读取被拒**，**platform_only=平台有而本地缺失**；双侧均缺失的路径从清单剔除并计数入 `dropped_paths`）；modified 文本对用 `difflib.SequenceMatcher` 出对齐行 `[{type: equal|delete|insert, local_lineno, local_text, platform_lineno, platform_text}]`（replace 段展开成 delete+insert 相邻行）。**本地 truncated 无 content 的文件不出 diff_rows**（status 按元信息分类，前端显示截断提示，避免全 insert 的方向信号失真——Grill 复审残留 gap）。截断护栏：单文件 diff ≤5000 行（超出置该文件 `diff_truncated`）、整响应 JSON ≤2MB（超出按文件倒序丢 diff_rows 并置 `response_truncated`）。
   - progress 比对：双方进度 JSON 归一化成对比行 `[{label, local_value, platform_value, differ}]`，字段白名单对齐 daemon 可得字段（当前阶段/阶段标签/步骤进度 completed/total/最近活跃/ql_id/ghost 标记），本地缺失字段显式「—」。
3. `DaemonHeartbeatSillySpecConflict` DTO 加可选 `ql_id: str | None`（router.py:312-321 三字段处），透传不改写语义不变。
4. schema 落地后跑 `pnpm gen:types` 同步 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（CLAUDE.md:36 硬规则）。

### Phase 3 — Frontend：行改造 + 对比弹窗

1. `lib/daemon.ts` 加 `getSillySpecConflictCompare(instanceId, change, kind, workspaceId)`。
2. `platform-sync-section.tsx` 冲突行改造：
   - 标题：`ql_id` 存在 → `【{ql_id}】快速修复` + 小字 `<code>{change}</code>`；否则变更名。
   - 行上补冲突发生时间（`created_at` 已有字段）与涉及文件数（弹窗数据回来前不显示文件数——文件数在弹窗头部展示）。
   - 按钮收敛：移除行内保本地/取平台，只留「查看对比」；机器离线时禁用并 tooltip「机器离线，无法读取本地内容」。
3. 新组件 `components/changes/conflict-compare-modal.tsx`（antd Modal，对齐 file-preview-modal.tsx 先例；原型 prototype-conflict-diff-compare.html）：
   - 打开即 react-query 拉 compare 端点（`enabled: open`，loading/失败重试态）。
   - 头部时间条：本地/平台最后更新时间，较旧一侧橙色提示方向后果（「取平台将回退」/「保本地将回退平台较新内容」）。
   - spec-tree 模式：左栏文件清单（徽章：修改/仅本地/仅平台/相同，默认「只看差异」可切「全部」；排序与后端一致：本变更目录在前、archive 沉底，头部展示「涉及 N 个文件，其中归档 M 个」）+ 右栏 side-by-side 渲染后端算好的对齐行（本地行删除红 `bg-error/10`、平台行新增绿 `bg-success/10`，语义 token 不手写 hex）；`binary` 文件显示「二进制文件无法文本对比」占位，`local_truncated`/`diff_truncated` 显示截断提示条。
   - progress 模式：关键信息对比表（三列：对比项/本地/平台，differ 行橙色高亮）。
   - 底部裁决条：后果说明文案 + 「保本地」（primary）/「取平台」（danger）按钮 → 复用 `triggerMachineSillySpecResolve` + 既有 STRATEGY_TEXT 确认弹窗（modal.confirm 先例）；下发成功关闭弹窗，回显走既有 sillyspec_command_result 链路。
4. 权限：「查看对比」按钮与弹窗裁决按钮同走 `useMachineSyncActionAccess`——无权限用户（非机器所有者且非平台管理员）行上不渲染「查看对比」（冲突清单本身保持只读可见，与现状一致）；compare 端点侧同集合 404 兜底（Grill B1 修订，两端权限契约统一）。
5. `changes-overview-card.tsx` 的只读冲突清单同步显示 ql 编号（同标题规则），不改其只读定位。

## 6. 文件变更清单

### backend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router.py | 新增 compare 端点 + 请求/响应 DTO；`DaemonHeartbeatSillySpecConflict` 加 `ql_id` 可选字段（producer=daemon 心跳投影 → backend 落 daemon_instances.sillyspec_status 整包透传 → GET /machines → consumer=前端冲突行标题/弹窗标题） |
| 新增 | backend/app/modules/daemon/sillyspec_compare.py | compare 编排 service：send_rpc 取本地快照 + 平台侧 spec_root/progress 读取 + difflib 比对与截断护栏 |
| 新增 | backend/app/modules/daemon/tests/test_sillyspec_compare.py | 端点权限（owner/admin/越权 404）、change 白名单、离线 504、diff 行计算（modified/local_only/platform_only/identical）、progress 对比行归一化、截断护栏、ql_id 透传 |
| 重新生成 | backend/openapi.json + frontend/src/lib/api-types.ts | `pnpm gen:types`（新端点 + ql_id 字段） |

### sillyhub-daemon

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | 新增 conflictSnapshot(change, kind)（冲突记录读取 + 文件内容/进度快照 + ql_id + local_updated_at）；collectStatusOnce pending_conflicts 投影补 ql_id（producer=guard.json quicklogId → 心跳 pending_conflicts[].ql_id → consumer=backend DTO/前端标题） |
| 修改 | sillyhub-daemon/src/daemon.ts | 新增 _registerSillySpecRpcHandler 注册 sillyspec_conflict_snapshot（producer=RPC params → consumer=conflictSnapshot；响应经 daemon ws-client.ts `_sendRpcResult`（ws-client.ts:616-627）回 backend） |
| 新增 | sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts | RPC 分发、冲突记录缺失/损坏、realpath 防逃逸、大小/路径截断、ql_id 有/无、progress 提取、无 spec 根报错 |

### frontend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/daemon.ts | getSillySpecConflictCompare（consumer=弹窗 react-query） |
| 修改 | frontend/src/components/changes/platform-sync-section.tsx | 冲突行：ql 标题规则 + 发生时间 + 按钮收敛为「查看对比」（离线禁用） |
| 新增 | frontend/src/components/changes/conflict-compare-modal.tsx | 对比弹窗（时间条/文件清单/side-by-side diff/进度对比表/裁决条） |
| 新增 | frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx | 两种模式渲染、差异高亮、裁决按钮权限、loading/失败态 |
| 修改 | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | 适配行改造（按钮移除、ql 标题、查看对比入口） |
| 修改 | frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx | 总览卡 ql 标题单测（ql_id 存在/缺失两分支） |
| 修改 | frontend/src/components/workspace/changes-overview-card.tsx | 只读冲突清单标题同步 ql 编号规则 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md | 模块文档：新 RPC sillyspec_conflict_snapshot + 心跳 ql_id 补报 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.md | 模块文档：compare 端点 + DaemonHeartbeatSillySpecConflict 增量 ql_id |

## 7. 接口定义

### 7.1 RPC（backend → daemon，经 ws_hub.send_rpc）

```jsonc
// method: "sillyspec_conflict_snapshot"
// params:  { "change": "quick-62e1d5fb", "kind": "spec-tree" | "progress" }
// result:
{
  "change": "quick-62e1d5fb",
  "kind": "spec-tree",
  "ql_id": "ql-20260904-002-62e1",          // quick 会话有映射时，否则 null
  "conflict_created_at": "2026-09-04T00:35:27.490Z",
  "local_updated_at": "2026-09-04T08:35:27+08:00",   // 冲突文件 mtime 最大值 / 进度 last_active
  "files": [                                 // kind=spec-tree 时非空；按信噪比排序（本变更目录优先，archive 最后）
    { "path": "changes/xxx/design.md", "content": "...", "mtime": "...", "size": 1234,
      "truncated": false, "binary": false, "missing": false }
    // truncated=true 且 content 缺省 = 被单文件 256KB 或聚合 4MB 帽截断
  ],
  "progress": null                           // kind=progress 时为该 change 的进度条目（daemon 从全局 envelope data.changes[] 过滤）
}
```

### 7.2 REST（frontend → backend）

`GET /api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare?kind=spec-tree|progress&workspace_id=<uuid>`

```jsonc
// 200 SillySpecConflictCompareResponse
{
  "change": "quick-62e1d5fb",
  "kind": "spec-tree",
  "ql_id": "ql-20260904-002-62e1",
  "conflict_created_at": "...",
  "local_updated_at": "...", "platform_updated_at": "...",
  "response_truncated": false,
  "dropped_paths": 0,   // 双侧均缺失被剔除的路径计数（B4 修订）
  "files": [  // spec-tree
    { "path": "...", "status": "modified|local_only|platform_only|identical",
      "local_mtime": "...", "platform_mtime": "...",
      "local_truncated": false, "local_missing": false,   // 本地侧截断/缺失信号透出（diff 基于截断内容时用户须知）
      "diff_rows": [ { "type": "equal|delete|insert",
                       "local_lineno": 14, "local_text": "...",
                       "platform_lineno": null, "platform_text": null } ],
      "diff_truncated": false, "binary": false }
  ],
  "progress_rows": [  // progress（字段白名单：当前阶段/阶段标签/步骤进度/最近活跃/ql_id/ghost）
    { "label": "当前阶段", "local_value": "⚡ 波次执行", "platform_value": "📐 实现计划", "differ": true }
  ]
}
// 404 机器/变更越权；422 change 白名单不通过；504 机器离线/RPC 超时
```

### 7.3 心跳 DTO 增量

`DaemonHeartbeatSillySpecConflict { change, created_at, type, ql_id?: str | None }`（其余语义不变，backend 零改写透传）。

## 7.5 生命周期契约表

本变更涉及 daemon 与 heartbeat 关键词，契约表如下（全部为只读/透传，无状态机迁移）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| compare RPC 请求 | backend | daemon | rpc_id, method=sillyspec_conflict_snapshot, change, kind | 无（只读快照，不进任何状态机） |
| snapshot RPC 响应 | daemon | backend | rpc_id, files[]/progress, ql_id, local_updated_at | 无（resolve_rpc 履约，失败→504 不落地） |
| 心跳上报（ql_id 补报） | daemon | backend | pending_conflicts[].change/created_at/type/ql_id | daemon_instances.sillyspec_status 整包直写（既有语义） |
| resolve 裁决下发 | backend | daemon | change, strategy（keep_local/take_platform） | 冲突解除（既有 09-04 通道语义，本变更不改动） |

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 大冲突（183 文件）RPC/响应体积超限 | 中 | 四道护栏：单文件 256KB + 路径 300 + **RPC 腿聚合 4MB（daemon 侧，低于 WS 帧 16MB 上限）** + REST 响应 2MB/diff 5000 行每文件，截断处显式标记（Grill B2 修订） |
| RPC 超时/机器离线导致弹窗长时间 loading | 中 | 显式 15s 超时 → 504；前端离线禁用入口 + 失败态可重试 |
| 平台侧按半可信 daemon 回报的路径读服务器目录 | 中 | backend 逐路径 containment 校验（拒 `..`、resolve 落点在 spec_root 内，spec_workspace 同款），daemon 侧 realpath 双保险（Grill B3 修订） |
| 存量冲突信噪比低（实测 164 条全是 archive 旧归档） | 中 | 文件清单默认「只看差异」+ 排序本变更目录在前/archive 沉底 + 头部展示「涉及 N 个文件（其中归档 M 个）」；diff 准确但裁决判断仍需用户结合变更名 |
| ql_id 对存量 quick 冲突不可得（guard.json 已清理，QUICKLOG 无会话名引用可反查） | 低 | 兜底显示原始 ID + 提示文案；新产生的 quick 冲突 guard.json 仍在时可正常显示 |
| local_updated_at 受 mtime 污染（git 操作刷新 mtime） | 低 | 时间条文案明示「本地时间取自文件修改时间，仅辅助参考」；不与平台时间做强先后断言 |
| 旧记录 take-platform 语义差异（note 显示早期 CLI 不支持） | 低 | 裁决通道既有行为不变；本变更只加对比视图，裁决后果文案沿用既有 STRATEGY_TEXT |

## 9. 自审

- 完成契约对照：design/proposal/requirements/tasks 四件套归属本阶段+步骤8产出；生命周期契约表已含（§7.5）；文件变更清单含字段数据流标注（§6）；风险登记（§8）；自审节（本节）。
- 字段透传链逐跳核对：ql_id（daemon guard.json → 心跳投影 → backend DTO → api-types → 前端标题）✅；compare 数据（daemon conflictSnapshot → send_rpc result → compare service 归一化 → REST DTO → api-types → 弹窗渲染）✅。
- 与既有变更关系：建在 conflict-resolve-entry 已合入通道上，只加不改；无代码重叠活跃变更。
- 用户决策落盘：D-001~D-004 在 decisions.md，本设计逐条对齐（方案A/收进弹窗/对比表/ql 编号）。
