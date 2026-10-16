---
author: qinyi
created_at: 2026-10-16 16:55:45
generated_by: sillyspec-design-init
scale: "large"  # 依据=用户显式要求完整流程（用户指令「开 change …先 brainstorm」开启本 change）+ 多阶段治理实测发生（Design Grill 独立设计评审：首轮 fail → 修订 → 增量复审 pass）。技术轴如实声明：任务以顺序依赖为主、单会话可吞吐——Wave 证据不成立（跨端/顺序依赖不算 large），large 仅以上述两据保留。
---

# 设计文档（Design）— 2026-10-16-conflict-full-tree-compare

<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效 -->

## 背景

跨多个变更的全量 spec 同步冲突在机器侧按 CLI 归因口径落盘为
`spec-sync-conflict-full-tree.json`（`attributeChangeLabel` 仅在冲突只涉及**一个**变更名时用该名，
跨 ≥2 个变更名返回 `full-tree`）；平台对比端点按单变更名拼 `spec-sync-conflict-<change>.json`
读取（`sillyhub-daemon/src/sillyspec-manager.ts:2376-2392`），文件名对不上 → 这类行的「查看对比」
恒 502 `conflict_record_missing`。生产实证（2026-10-16，腾讯云真栈）：注册表 open 行
`2026-10-13-fire-unitadd-form-import`（7 个路径跨 2 个变更名）对比恒 502；行只能等下一次全绿推送
自动关闭（`backend/app/modules/spec_workspace/service.py:1366-1390`），刷新列表无效；失败卡文案
固定「机器可能离线或对比读取超时（504）」（`frontend/src/components/changes/conflict-compare-modal.tsx:260-277`），
与真实原因无关。完整排查记录：`docs/sillyspec/conflict-compare-full-tree-label-mismatch.md`。

## 设计目标

- 让「跨变更全量冲突」行的对比在平台上真正可用：后端在 `<change>` 记录缺失时以 `full-tree` 记录
  兜底，**只呈现所请求变更的范围**并标注来源（FR-01/FR-02）。
- 失败卡按真实错误码分支，`conflict_record_missing` 不再误报「离线/504」（FR-03）。
- 给注册表冲突行一个手动关闭出口「标记已处理」，解决行滞留（FR-04）。
- 契约同步零落后：openapi 与两份 api-types 同 change 提交（FR-05）。

## 非目标

- 不改裁决（保本地/取平台）链路：跨变更记录的裁决需要 CLI 改记录匹配口径（CLI 按 `cf.change`
  匹配，`listConflictFiles` 见 `/c/nvm4w/nodejs/node_modules/sillyspec/src/sync.js:2296-2319`），
  本变更不碰，界面文案不承诺可裁决（D-002）。
- 不做 daemon 侧读取改动、不新增 daemon RPC（D-001/D-011）；不改 CLI 推送负载与记录命名（D-010）。
- 不重构冲突行渲染/归因（沿用 `registryVersionRows` 既有归因）；
  不改 `spec_conflicts` 表结构与现有自动关闭契约。

## 拆分判断

不拆分、不走批量模式：单变更即可交付（后端 3 文件 / 前端 3 文件 / 类型 3 文件 / 原型 3 文件），
无「模板 × 数据」重复形态。

## 总体方案

### Phase 1 — 后端兜底与裁剪（`backend/app/modules/daemon/sillyspec_compare.py`）

1. 重构 `_fetch_snapshot`（`sillyspec_compare.py:410-454`）：抽出内层「按记录名取快照」
   （参数为 `record_label`，发既有 `sillyspec_conflict_snapshot` RPC，params 仍为
   `{change, kind, workspace_id}`），供主取与兜底共用。
2. 兜底判据（D-009）：仅当 `kind == "spec-tree"` 且主取失败为
   `DaemonRpcRemoteError.code == "conflict_record_missing"` 时，以 `record_label="full-tree"`
   **再取一次**（不递归、最多一次）。
3. 归属校验与裁剪（D-006@v2/D-012）：daemon 快照（`SillySpecConflictSnapshot`，`sillyhub-daemon/src/sillyspec-manager.ts:346-359`）
   **没有 `conflicting_paths` 字段**——记录读取时 daemon 已将其截 300 并转成 `files[]`
   （`sillyhub-daemon/src/sillyspec-manager.ts:1617-1690`）。因此校验与裁剪一律以 `files[].path`
   为输入（与 `_build_spec_tree_compare` 的实际消费面一致，`backend/app/modules/daemon/sillyspec_compare.py:478-547`）；
   匹配规则为**段边界前缀**——`changes/<change>/` 或 `changes/archive/<change>/`
   （`<change>` 后必须紧跟 `/`，防 `foo` 误吞 `foobar` 类前缀）；命中后：
   - `files[]` 过滤为属于该变更的路径（entry 保持完整，字段不裁剪）；
   - 其余顶层字段（`conflict_created_at`/`local_updated_at`/`ql_id` 等）原样保留；
   - 附来源元数据：`record_label="full-tree"`、`covered_changes`（对过滤前的 `files[].path` 做
     `changes/(archive/)?<名>/` 归因去重的变更名集合）、`path_total`（**兜底快照返回的路径总数**，
     受 daemon 300 路径帽截断，非记录真实总数——后者在平台侧不可得）。
   未命中（`files[]` 中无一条属于该变更）→ 原样抛出主取的 `conflict_record_missing`（错误路径与现状一致）。
4. 响应 schema（`backend/app/modules/daemon/router/machines.py:536-553`
   `SillySpecConflictCompareResponse`）新增三个**可选**字段：`record_label: str | None = None`、
   `covered_changes: list[str] = []`（默认空）、`path_total: int | None = None`；旧字段不变。
5. 文案（D-005）：`_GATEWAY_MESSAGE_BY_CODE["conflict_record_missing"]`（`sillyspec_compare.py:60-63`）
   改为「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。」（原「冲突记录已失效，
   请刷新冲突列表。」给了无效建议——刷新不关闭注册表行）。
6. 测试（`backend/app/modules/daemon/tests/test_sillyspec_compare.py` 追加）：
   - 兜底命中：mock `send_rpc` 调用序列（第一次抛 `conflict_record_missing`、第二次返回 full-tree 记录）
     → 断言两次调用、`record_label/covered_changes/path_total` 与裁剪后的文件清单；
   - 段边界：记录只含 `changes/foobar/…` 时请求 `<change>=foo` → 不命中（原错误）；
   - `kind=progress` 不触发兜底；主取成功不发生第二次 RPC；
   - 文案断言更新（既有 `("conflict_record_missing", "冲突记录已失效")` 用例改新文案）。

### Phase 2 — 前端（失败卡分支 + 关闭入口 + 来源提示）

1. `frontend/src/lib/spec-workspaces.ts`：新增 `resolveSpecConflict(workspaceId, conflictId, status = "resolved")`
   → `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`，body `{"status": status}`
   （后端契约：`backend/app/modules/spec_profile/schema.py:69-73` `SpecConflictResolve`）。
2. `frontend/src/components/changes/conflict-compare-modal.tsx`：
   - 失败卡（:260-277）改为按错误码分支（D-004/D-012），匹配键**必须**是 `details.daemon_code`
     （外层 `ApiError.code` 在 daemon 业务失败时恒为 `HTTP_502_DAEMON_RPC_REMOTE`，不可作分支键；
     透传链见 `backend/app/modules/daemon/sillyspec_compare.py:439-454`）：
     `details.daemon_code === "conflict_record_missing"` → 文案「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。」
     （服务端 message 以小字附注），**不渲染「重试」**；
     `details.daemon_code === "workspace_root_unknown"` → 「该工作区尚未被本机认领，请先在该工作区发起一次会话后重试。」，不渲染「重试」；
     外层 `code ∈ {HTTP_504_DAEMON_RUNTIME_OFFLINE, HTTP_504_DAEMON_RPC_TIMEOUT}`（机器离线 / RPC 超时，
     `backend/app/modules/daemon/runtime/service.py:83-99`）→ 保留「机器离线或响应超时（504），请确认数据源机器在线后重试。」+「重试」；
     其余（其他 daemon_code / 未知错误）→ 「读取机器侧冲突快照失败，请稍后重试。」+「重试」。
   - 兜底命中（响应 `record_label === "full-tree"`）时在弹窗主体顶部插入一行来源提示（样式对齐既有
     `response_truncated` 提示条位置，`:287-291`）；旧后端无该字段时自动不显示。
3. `frontend/src/components/changes/platform-sync-section.tsx`：
   - `registryVersionRows`（:336-368）行对象补 `id`（注册表行主键）；
   - 行按钮区（:880-930 区域，`access.canOperate && !succeeded`）对**注册表行**（`row.id` 存在）新增
     「标记已处理」按钮 → `modal.confirm` 二次确认 → `resolveSpecConflict` → 成功 `notify` +
     invalidate `["platform-sync-section","spec-conflicts",workspaceId]`（键 = `[...QUERY_KEY_ROOT,"spec-conflicts",workspaceId]`，
     `QUERY_KEY_ROOT = ["platform-sync-section"]`，`frontend/src/components/changes/platform-sync-section.tsx:90,277`）→ 行消失。
     确认文案必须写明关闭范围：**关闭的是整条注册表记录**——一条记录可能含多个变更名（现网案例含
     `fire-unitadd-form-import` 与 `fire-unitadd-relayout`），按行 id 关闭会连带关闭并列展示的兄弟行；
     并声明「不改本机文件，冲突若仍存在则下次同步会重新登记」（D-012）。
   - 墓碑行（isTomb）与机器快照行不提供该按钮（前者有「收敛本机目录」，后者无注册表行可关）。
4. 测试：
   - `frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx`：四臂文案/按钮断言 + 来源提示断言；
   - `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx`：注册表行渲染「标记已处理」、
     确认后调用 `resolveSpecConflict`、成功后行消失、只读视角不可见。

### Phase 3 — 契约同步与验收

- 规则 21：后端 schema 改动后同 change 内跑 `pnpm gen:types`（前端）与 `pnpm -C sillyhub-daemon gen:types`，
  提交 `backend/openapi.json` + `frontend/src/lib/api-types.ts` + `sillyhub-daemon/src/api-types.ts`。
  （前端 node_modules 半坏时先 `pnpm install --force`——本次已按规则 21 修复过。）
- 本地测试：backend compare 用例族 + 前端两个测试文件 + 本改动面 lint/typecheck（不跑全量，规则 0）。
- 部署真机复验（D-008）：部署腾讯云生产后用现网 `2026-10-13-fire-unitadd-form-import` 行验证——
  对比可打开且只含该变更 4 个路径、来源提示正确、失败卡分支正确、「标记已处理」可用且行消失。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/sillyspec_compare.py | `_fetch_snapshot` 抽内层 + full-tree 兜底重取 + 段边界归属校验与裁剪 + 来源元数据 + conflict_record_missing 文案 |
| 修改 | backend/app/modules/daemon/router/machines.py | compare 响应 schema 新增 record_label/covered_changes/path_total 三可选字段（producer=backend，consumer=前端 modal） |
| 修改 | backend/app/modules/daemon/tests/test_sillyspec_compare.py | 兜底命中/未命中/不触发/文案用例 |
| 修改 | frontend/src/lib/spec-workspaces.ts | 新增 resolveSpecConflict 客户端函数 |
| 修改 | frontend/src/components/changes/conflict-compare-modal.tsx | 失败卡按 `details.daemon_code`/外层 code 四臂分支 + full-tree 来源提示条 |
| 修改 | frontend/src/components/changes/platform-sync-section.tsx | registry 行带 id + 「标记已处理」入口与确认流 |
| 修改 | frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx | 分支/来源提示用例 |
| 修改 | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | 关闭入口用例 |
| 新增 | NEW:frontend/src/components/prototype/conflict-sync-states-view.tsx | 真码原型视图（三界面态 fixture） |
| 修改 | frontend/scripts/prototype-build.mjs | VIEWS 登记 conflict-sync-states-view |
| 新增 | NEW:frontend/prototype-dist/conflict-sync-states.html | 原型编译产物（入仓对账，重编译 git diff 为空） |
| 新增 | NEW:.sillyspec/changes/2026-10-16-conflict-full-tree-compare/prototype-conflict-sync-states.html | 变更目录原型产物（execute 注入契约） |
| 修改 | backend/openapi.json | gen:types 产物 |
| 修改 | frontend/src/lib/api-types.ts | gen:types 产物 |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types 产物（规则 21 daemon 同款义务） |

## 接口定义

### HTTP：GET `/api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare`
（既有端点 `backend/app/modules/daemon/router/machines.py:576-610`）响应新增：
```
SillySpecConflictCompareResponse:
  ...既有字段不变...
  record_label: str | None = None      # 命中兜底时为 "full-tree"，主取命中/旧后端为 null
  covered_changes: list[str] = []      # 兜底记录覆盖的变更名集合（按路径归因去重）
  path_total: int | None = None        # 兜底快照返回的路径总数（受 daemon 300 路径帽截断，非记录真实总数；供前端提示「展示 M / 快照 N」）
```

### HTTP：POST `/api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`
（既有端点 `backend/app/modules/spec_workspace/router.py:459-495`，本变更仅前端接线）
```
request : {"status": "resolved", "details_json": null}   # SpecConflictResolve，backend/app/modules/spec_profile/schema.py:69-73
response: SpecConflictRead（含最新 status）
权限    : WORKSPACE_WRITE
```

### daemon RPC：`sillyspec_conflict_snapshot`（既有，不改协议）
```
params: {change: str, kind: "spec-tree"|"progress", workspace_id: str}
兜底调用: change="full-tree"（记录名，而非变更名）——daemon 按任意 label 拼记录文件名读取，行为既有
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 冲突快照读取（主） | backend compare 编排 | daemon `sillyspec_conflict_snapshot` | change/kind/workspace_id | 无（只读） |
| 冲突快照读取（兜底） | backend compare 编排 | daemon 同上（change=`full-tree`） | 同上 | 无（只读，最多一次） |
| 注册表行手动关闭 | 前端（可操作者二次确认） | backend `POST /spec-conflicts/{id}/resolve` | workspace_id/conflict_id/status=resolved | spec_conflicts.status: open→resolved |
| 注册表行自动关闭（现状不变） | daemon 推送 apply_ops 全绿 | backend `_close_open_sync_conflicts` | workspace_id | open→resolved |

## 数据模型

- 表结构无变更、无迁移：`spec_conflicts` 仅复用既有 `status="resolved"` 值；`details_json` 结构不变。
- 非持久化契约变更：compare 响应 DTO 新增三个可选字段（见接口定义）。

## 兼容策略（brownfield 必填）

- 未部署的后端 + 新前端：新前端拿到旧响应（无新字段）→ 来源提示不渲染，失败卡分支按 `daemon_code`
  （旧后端已透传 `details.daemon_code`）照常生效。
- 新后端 + 旧前端：旧前端忽略新字段；失败卡文案仍为旧固定文案（无回归）。
- 旧 daemon：兜底只是「以另一个记录名调既有 RPC」，无需 daemon 升级；记录缺失且无 full-tree 记录时
  错误路径与现状完全一致（同样的 502 与同样的 message）。
- 未兜底命中时行为不变；`kind=progress` 与主取成功路径完全不走新分支。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 路径归属前缀误配（`foo` 吞 `foobar`）导致把别的变更文件混入对比 | P1 | 段边界匹配（`changes/(archive/)?<change>/`，名字后必须 `/`）；测试含 foo/foobar 陷阱用例 |
| R-02 | full-tree 记录路径多，daemon 侧读取帽（300 路径 / 4MB 聚合）截断 → 对比可能缺部分路径；`path_total` 只是快照返回数、非记录真实总数 | P2 | 沿用既有帽；来源提示按「快照返回 N 个路径，本次展示与 `<change>` 相关的 M 个」措辞，不声称记录总数；「记录真实总数不可得」为已知边界（>300 路径时属该变更的路径可能被帽截掉→表现为缺路径，不回归） |
| R-03 | 可操作者误关仍真实存在的冲突行 | P2 | 确认文案说明「不改本机文件，冲突仍在则下次同步会重新登记」；仅置 resolved 不删行；行会随下次冲突推送重新 upsert |
| R-04 | 规则 21 类型同步遗漏（前端/daemon 两份 api-types） | P1 | Phase 3 固定动作：gen:types ×2 并提交 openapi + 两份 api-types；对账 |
| R-05 | 新增常驻原型视图进入每次 prototype:build 产物集 | P2 | 产物入仓对账（重编译 git diff 空）；D-007@v2 记退役判据 |
| R-06 | 兜底多一次 RPC 往返（仅缺失场景） | P3 | 只在 `conflict_record_missing` 触发且最多一次；超时沿用既有 RPC 预算 |
| R-07 | 注册表一条记录拆成多条展示行（逐变更名），按行 id 关闭会连带关闭兄弟变更名行 | P1 | 确认文案写明关闭范围（整条注册表记录）；不做逐变更名粒度关闭（后端 resolve 按行 id，语义即整条） |
| R-08 | 兜底命中时 `ql_id` 恒为 null（full-tree 非 quick 名）且 archive 路径在 daemon 侧排序沉底 | P3 | 保真损失接受：`ql_id=null` 只影响行内标题展示回退为变更名（既有渲染分支）；排序只影响读取顺序、不影响对比内容 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01；Phase 1 兜底位点（后端） | 已覆盖 |
| D-002@v1 | 非目标（裁决不修） | 已覆盖 |
| D-003@v1 | FR-04；Phase 2.3 | 已覆盖 |
| D-004@v1 | FR-03；Phase 2.2 失败卡分支 | 已覆盖 |
| D-005@v1 | FR-03；Phase 1.5 文案 | 已覆盖 |
| D-006@v2 | FR-02；Phase 1.3 裁剪与来源元数据（输入面=`files[].path`，提示条不可关闭）、Phase 2.2 | 已覆盖（supersedes D-006@v1） |
| D-007@v2 | 交付物（原型）；Phase 3 产物对账 | 已覆盖（supersedes D-007@v1） |
| D-008@v1 | 成功标准；Phase 3 部署复验 | 已覆盖 |
| D-009@v1 | FR-01/FR-02；Phase 1 兜底判据（仅 spec-tree、只一次） | 已覆盖 |
| D-010@v1 | 非目标（落选方案 B） | 已覆盖 |
| D-011@v1 | 非目标（落选方案 C） | 已覆盖 |
| D-012@v1 | 交叉审查修订：快照输入面=`files[].path`、失败卡分支键=`details.daemon_code`、invalidate 键=`platform-sync-section`、关闭连带范围、`path_total` 语义 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large 附依据）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-012，其中 D-006 用 v2、D-007 用 v2）
- [x] 涉及 daemon/lifecycle 关键词 → 已含「生命周期契约表」（四条事件矩阵）
- [x] UI 原型分级核对：涉前端文件，原型已生成 `.sillyspec/changes/2026-10-16-conflict-full-tree-compare/prototype-conflict-sync-states.html`
      （真码形态：`frontend/src/components/prototype/conflict-sync-states-view.tsx` + `pnpm prototype:build` 产物；
      素材来源：token=themes.ts/globals.css CSS 变量、组件方言=既有 Tailwind class 与生产文案复刻、入口=变更目录原型文件）
- [x] 不确定的问题：无；R-02 的「超帽时来源提示注明展示数」为设计取舍（P2，实现时以既有帽实测为准）
