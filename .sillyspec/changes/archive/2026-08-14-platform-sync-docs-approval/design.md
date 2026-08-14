---
author: qinyi
created_at: 2026-08-14 21:25:00
revised_at: 2026-08-14 21:40:00
scale: large
risk_level: contract-required
review_round: 1 (Design Grill round-1: specVerdict/qualityVerdict pass，UB-1 P1 占位行守卫 + UB-2/UB-3 P2 已吸收修订)
---

# 设计文档（Design）— platform_sync 契约缺口端点（documents + approval）

## 1. 背景

2026-08-14 全接口实测发现 platform_sync 模块存在两个 CLI 契约缺口：sillyspec CLI（`sync.js`）声称调用的两个端点后端从未实现（`sync.js:959` 注释 `// TBD-hub-api: 端点路径/body 以 SillyHub 实际 API 为准` 表明是预留未对齐契约）：

1. **`POST /api/changes/{name}/documents`**（syncDocuments，`sync.js:442-497`）：推四件套（proposal/design/requirements/tasks.md）全文。现状 404 → CLI best-effort warn `文档同步请求失败` 静默失败，`sillyspec platform sync-docs` 命令不可用。
2. **`POST /api/changes/{name}/approval`**（approve/reject，`sync.js:944-996`）：提交审批决定。现状 405（后端只有 GET）→ CLI 置 `process.exitCode=1`，**`sillyspec platform approve/reject` 必失败**（非 best-effort，D-006@v1 显式用户动作失败必须可见）。

连带效应：CLI `checkApproval`（execute 启动审批门控）GET 到的永远是后端硬编码的 `{status:"approved"}`（`router.py:120-137`），平台侧没有任何途径把 rejected 状态传给 CLI——审批门控形同虚设。CLI 侧门控实际位置 `run/command.js:1113-1129`（rejected→exit(1) 在 1117-1119）。

不涉及生命周期契约：本变更不触碰 session/lease/agent_run/daemon/lifecycle 状态机，仅是 REST 端点 + 存储列扩展。

## 2. 设计目标

- `POST /api/changes/{name}/documents` 实现并返回 200，`sillyspec platform sync-docs` 端到端可用。
- `POST /api/changes/{name}/approval` 实现并落库，`sillyspec platform approve/reject` 端到端可用。
- `GET /api/changes/{name}/approval` 改读库：rejected 后 CLI execute 启动被真正阻断（现有 rejected→exit(1) 门控路径生效）。
- 三个写入方（CLI push progress / POST documents / POST approval）单写者纪律，互不覆盖。

## 3. 非目标（Non-Goals）

- 不做审批策略配置化（谁可审批/多级审批）——单 token 即审批，写 decided_by 审计。
- 不做 documents 下行 GET 端点——CLI 无消费方（sync.js 只推不拉文档）。
- 不动 change 模块 review 四端点与前端审批卡——那是 `2026-08-14-change-center-conversation-driven` 的范围（其 T-05/T-06 改 change 模块审批语义，与本变更 platform_sync 模块无文件重叠）。
- 不改 sillyspec 仓任何代码——后端照 CLI 字面契约实现（D-004@v1）。

## 4. 总体方案

### 4.1 数据模型（model.py + 一个 migration）

`platform_change_progress` 表加两个 JSON NULL 列（D-002@v1 / D-003@v1）：

```
platform_change_progress
├─ id, workspace_id, change_name        （现有）
├─ latest_progress   JSON   （CLI push progress 写）
├─ last_pushed_at / last_pusher          （现有）
├─ documents         JSON   NULL  ← 新增：{"proposal.md": "全文", ...} 扁平 map
├─ approval          JSON   NULL  ← 新增：{status, reason, decided_at, decided_by}
└─ updated_at                            （现有，所有写入方都刷新）
```

approval 结构：`{"status": "approved"|"rejected", "reason": str|null, "decided_at": "<ISO8601>", "decided_by": "<User.username>"}`。`decided_by` 取 `require_platform_sync` 解包的权威 `User.username`（三路径 token 均反查真实 User，UB-2 裁定：**不用** `X-SillySpec-User` header fallback——该 header 客户端可伪造，审批审计字段不得回落到可伪造来源）。

**占位行守卫（Grill UB-1 修订）**：documents/approval 的 INSERT 占位行 `latest_progress=NULL`。为守住「现有 3 端点行为不变」：
- `get_progress`：`latest_progress IS NULL` 时返回 None（router 维持 404，占位行视为「无进度」）——否则 CLI `triggerPull` 拉到 200 空态经 `pm.import` 会 DELETE 本地 stages 不重建（progress.js:583-606），存在清空本地进度库的数据损失链路；
- `list_lightweight`：过滤 `latest_progress IS NULL` 的占位行（列表不多出 current_stage=null 项）。

migration：alembic `batch_alter_table('platform_change_progress')` add_column documents/approval（JSON nullable），revision 时间戳取当前，down_revision 对齐最新 head（落实现时用 `alembic heads` 确认）。

### 4.2 端点契约（router.py + schema.py）

**① POST /api/changes/{name}/documents**
- 鉴权：`require_platform_sync`（与现有 3 端点同构；shpsync_ 派生 workspace_id 隔离）。
- body（`DocumentsSyncRequest`）：扁平 map `{"proposal.md": str, ...}`，键限四件套白名单 `{"proposal.md","design.md","requirements.md","tasks.md"}`，值必须 str；空 map / 含白名单外键 / 值非 str → 422。
- 语义：按 `(workspace_id, change_name)` 复合键 upsert `documents` 列（整列替换，全量同步语义）；行不存在则 INSERT 占位（latest_progress 保持 NULL）。
- 200：`{"synced": <N>, "change_name": <name>}`。

**② POST /api/changes/{name}/approval**
- 鉴权：同上。
- body（`ApprovalSubmitRequest`）：`{"decision": "approved"|"rejected"（过去式，sync.js:961 字面）, "reason": str|None}`（reason 必须 optional default None——CLI approved 分支 body 整个不含 reason 键，sync.js:963）；非法 decision → 422。
- 语义：按复合键 upsert `approval` 列，`decided_at=now(UTC)`、`decided_by` 取 token 对应用户名（fallback `X-SillySpec-User` header）；行不存在则 INSERT 占位。重复提交=覆盖（后写赢，与 CLI 多次 approve/reject 语义一致）。
- 200：`{"status": "ok", "decision": <decision>, "change_name": <name>}`。

**③ GET /api/changes/{name}/approval（改造现有端点）**
- 读该行 approval 列：
  - 行不存在 / approval 列 NULL → 200 `{status:"approved", reason:"no approval record; default-approved"}`（**保持 ql-20260812-001-6eb8 兼容语义**：change 可能尚未上行 progress，不能 404 卡死 CLI）。注意占位行（仅 documents/approval 有值）也走此分支——GET approval **不受**占位行守卫影响，审批记录一旦写入即可读。
  - 有记录 → 200 `{status: <approved|rejected>, reason: <reason>}`。
- rejected → CLI `checkApproval` 返回 rejected → execute 启动 `exit(1)` 硬阻断（现有门控路径 run/command.js:1113-1129 无需改动）。

### 4.3 单写者纪律（service.py）

`upsert_progress` 现有"查行→有则 UPDATE / 无则 INSERT"重构为**定向列**：
- push progress：UPDATE 只 SET `latest_progress, last_pushed_at, last_pusher, updated_at`；INSERT 只带这些列（approval/documents 留 NULL）。
- `upsert_documents`（新）：UPDATE 只 SET `documents, updated_at`。
- `set_approval`（新）：UPDATE 只 SET `approval, updated_at`。
- 三者共享 `_find_row(workspace_id, change_name)`（现有，`col.is_(None)` 处理 NULL 过渡期）。
- **下行守卫（UB-1）**：`get_progress` 对 `latest_progress IS NULL` 的占位行返回 None（router 维持 404）；`list_lightweight` 过滤占位行。此二处是现有查询行为的**收窄而非扩展**，对「现有 3 端点行为不变」的准确表述为：对已有真实进度数据的行为完全不变。

### 4.4 效果链与验收路径

```
sillyspec platform reject <change> --reason "..."
  → POST approval {decision:"rejected", reason}
  → 落 approval 列
sillyspec run execute（CLI 启动）
  → GET approval → {status:"rejected", reason}
  → command.js:1071-1080 rejected → exit(1) 真正阻断 ✅
```

### 4.5 兼容性

- GET approval 对无记录行为不变（approved 放行），存量 CLI execute 门控零回归。
- 现有 3 端点行为不变（upsert_progress 改定向列对外不可见）。
- `pnpm gen:types`：openapi 新增 2 端点 schema，`api-types.ts` + `openapi.json` 同步提交。

## 5. 文件变更清单（File Changes）

| 文件 | 变更 |
|---|---|
| `backend/app/modules/platform_sync/model.py` | PlatformChangeProgressORM 加 documents/approval 两 JSON 列 |
| `backend/app/modules/platform_sync/schema.py` | DocumentsSyncRequest / ApprovalSubmitRequest / DocumentsSyncOk / ApprovalSubmitOk |
| `backend/app/modules/platform_sync/service.py` | upsert_progress 定向列重构 + upsert_documents / set_approval / get_approval_record |
| `backend/app/modules/platform_sync/router.py` | 2 新 POST 端点 + GET approval 改读库 |
| `backend/migrations/versions/<新>.py` | add documents + approval columns |
| `backend/app/modules/platform_sync/tests/test_router.py` | 新端点 + GET 三态 + 422/401 + 单写者回归 + **占位行守卫回归**（documents INSERT 后 GET progress 仍 404 / GET /changes 不多占位项 / 随后 push progress 正常 UPDATE 不撞键） |
| `frontend/src/lib/api-types.ts` | gen:types 再生成 |
| `backend/openapi.json` | gen:types 再生成 |

**不修改文件说明**：sillyspec 仓 `docs/sillyspec/platform-interface-map.md` §2 的"后端未实现"标注撤除属跨仓文档同步，在 task-07 端到端验证通过后手动完成（不在主仓 task allowed_paths 覆盖范围；该文档是本次实测发现缺口的记录源，已随本变更前置标注 404/405 现状）。

## 6. 接口定义

### 6.1 POST /api/changes/{name}/documents

```
Authorization: Bearer shpsync_...
Content-Type: application/json

{"proposal.md": "# ...\n全文", "design.md": "...", "tasks.md": "...", "requirements.md": "..."}
→ 200 {"synced": 4, "change_name": "2026-08-14-xxx"}
→ 422 （空 map / 键不在白名单 / 值非 str）
→ 401 （token 无效）
```

### 6.2 POST /api/changes/{name}/approval

```
Authorization: Bearer shpsync_...
{"decision": "rejected", "reason": "设计有缺口"}
→ 200 {"status": "ok", "decision": "rejected", "change_name": "2026-08-14-xxx"}
→ 422 （decision 不在 approved/rejected）
→ 401
```

### 6.3 GET /api/changes/{name}/approval（改造）

```
无记录 → 200 {"status": "approved", "reason": "no approval record; default-approved"}
有记录 → 200 {"status": "rejected", "reason": "设计有缺口"}
```

## 7. 风险登记（Risk Register）

| 风险 | 等级 | 缓解 |
|---|---|---|
| upsert_progress 重构改坏现有推送（409/冲突检测路径） | P1 | 现有 test_router.py 回归全跑 + 定向列只增不减语义等价 |
| migration revision 撞另一活跃 change（spec-sync-visibility W3 未完） | P1 | 落实现时 `alembic heads` 确认单 head；撞则改时间戳收敛（fix-platform-progress-pk 先例） |
| documents 列加大 JSON 行（四件套全文可达几百 KB） | P2 | latest_progress 本就是同量级 JSON；无索引/查询需求，纯存储 |
| 跨 workspace 同名 change 审批互串 | P2 | 复合键含 workspace_id（token 派生），与现有隔离同构 |
| conversation-driven change 的投影收敛 T-03 也写 platform_change_progress | P2 | 它写 latest_progress（upsert），本变更定向列改造恰好保证其不冲 approval——两者兼容且互补 |

## 8. 自审（Self-Review）

- [x] 契约与 CLI 字面逐条核对（documents 扁平 map sync.js:460-488；approval 过去式 decision sync.js:961-963；URL/方法/鉴权头与现有端点同构）
- [x] GET approval 兼容语义保持（无记录 approved 放行，不 404）——直接引用 ql-20260812-001-6eb8 的教训
- [x] 单写者纪律三方向覆盖（progress/documents/approval 各自定向列）
- [x] 与在途 change 边界声明：conversation-driven（change 模块+前端）、spec-sync-visibility（spec_workspace+daemon）均无文件重叠；唯一共享是 platform_change_progress 表，定向列改造与其 T-03 upsert 语义兼容
- [x] migration 冲突风险已登记缓解
- [x] D-001@v1 / D-002@v1 / D-003@v1 / D-004@v1 全部在设计中体现并引用
- [x] Grill round-1 修订吸收：UB-1 占位行守卫（get_progress NULL→404 + list 过滤）、UB-2 decided_by 权威 username 去 header fallback、UB-3 行号修正（command.js→run/command.js:1113-1129）+ reason optional
- 自审存疑项（decided_by 格式）已由 Grill 裁定：User.username（str）
