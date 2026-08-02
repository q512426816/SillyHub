---
author: qinyi
created_at: 2026-08-02 00:01:59
change: 2026-08-01-proxy-create-race-fix
scale: large
tier: independent
risk_level: contract-required
revision: 3（Design Grill 两轮后定稿：r1 补 change_documents 同源竞态 P0-1；r2 误判"占坑 docs → reparse 走 update"，r3 修正为"占坑+串行消除并发"并登记既有 doc_type 不一致 R-05）
---

# 设计文档（Design）— proxy-create 并发竞态 500 修复

## 1. 背景

daemon-client 工作区创建变更接口 `POST /api/workspaces/{id}/changes/proxy-create` 必报 500。真实日志（workspace `daa5894a-8738-4ce6-94ad-0c54297206d6`）：

- `proxy_create_change` 下发 `DaemonChangeWrite(pending)`，daemon 写盘回执 done；
- daemon `runChangeWrite` 在回执后 `postSpecSync` 把含新 `changes/<key>/` 的 spec 整树回灌（`task-runner.ts:2171-2184`：create kind 严格「先 completeChangeWrite 回执，再 syncSpecTreeIfNeeded」）；
- backend 两路并发写库：
  - **回执路**：`proxy._await_change_write_receipt` 轮询发现 done → 落库 `Change(current_stage=draft)` + `ChangeDocument`；
  - **sync 路**：`POST /spec-workspace/sync` → `apply_sync` → `_reparse`（change_key 不在 existing → `_build_change` created）+ `_sync_docs`（INSERT docs）；
- 两路并发 INSERT 同一 change_key 撞 `changes.ux_changes_workspace_key` → `UniqueViolationError` → 500。

**根因**：proxy 的"落库"与 daemon 的"整树回灌 reparse"是两条独立写库路径，`changes` 与 `change_documents` 两张表都存在同源并发（`change_documents` 亦有唯一键 `ux_change_docs_type_path`，migration 202605300900:99 / model.py:189）。附带：parser 对"仅 MASTER.md"推断 `current_stage=brainstorm` 而 proxy 写死 `draft`；`_build_change_key` 把中文标题过滤成 `untitled`。

> **Design Grill 演进**：r1 只防 `changes` 表，遗漏 `change_documents` 表同源竞态（P0-1）。r2 改"占坑建 docs 让 reparse 走 update"，但二审发现论证错误——`proxy._build_files` 硬编码 doc_type `master/request` 与 parser `STANDARD_FILENAMES` key `MASTER/requirements` 不一致，reparse 实际对占坑 master 行 DELETE+INSERT、对 request 行 DELETE，并非 update。r3 修正：**竞态消除的真实机制是「占坑 + 串行」**——占坑 commit 先于 daemon sync，proxy 步骤6 不再 INSERT docs，reparse 单路串行写 docs，与 proxy 路无并发（无论 update 或 DELETE+INSERT 都不撞键）。doc_type 不一致属既有 bug（R-05），不导致 500，本次不修。

## 2. 设计目标

- **G1** 消除 proxy-create 500：`changes` 与 `change_documents` 两张表的唯一键都不被 proxy 路与 reparse 路并发写入。
- **G2** 确立 proxy 为变更创建权威：proxy 落库的 `current_stage=draft` 不被 reparse 覆盖。
- **G3** 失败可回滚：daemon 写失败/超时不留孤儿占坑行（backend 行删，daemon 文件残留有策略）。
- **G4** 中文标题 change_key 可读。

## 3. 非目标（Non-Goals）

- 不改 daemon-client 变更"创建后不自动 dispatch brainstorm"的既有语义（保持 draft）。
- 不改 spec-sync / reparse 整体机制。
- 不碰前端、不改 DB schema、不加 migration。
- **不修既有 doc_type 不一致**（proxy/worktree-lease 用 `master/request`，parser 用 `MASTER/requirements`）——见 R-05，不导致 500，超出本次范围。
- 不处理 daemon-client spec 同步链路其余已知断裂。

## 4. 拆分判断

单变更即可：改动集中在 backend 两模块（change_writer / change），逻辑内聚，无独立可交付子功能。

## 5. 总体方案

### Phase 1 — proxy 占坑 Change + ChangeDocument（核心，`change_writer/proxy.py`）

重构 `proxy_create_change` 时序（当前 `proxy.py:186-309`）：

```
1. get Workspace + resolve_runtime_for_writeback（不变）
2. _build_change_key + _build_files（不变；files 含每项 path/doc_type）
3.【新】INSERT Change 占坑行（current_stage="draft", status="active",
   owner_id=user_id, stages={"draft":...}, change_type=...）
   + INSERT 所有 files 对应的 ChangeDocument（doc_type/path 取自 _build_files，
     exists=True, last_modified_at=now）→ commit
   【占住 changes.ux_changes_workspace_key（防 proxy 与 reparse created 并发）；
    docs 占住 ux_change_docs_type_path 让步骤6 不必再 INSERT docs】
4. INSERT DaemonChangeWrite(pending, kind="create", files) → commit（不变）
5. _await_change_write_receipt（不变，轮询 daemon_change_writes.status）
6. 回执 done → Change + docs 已在步骤3 占坑建好，**proxy 路不再 INSERT docs**
   （关键：消除 proxy 与 reparse _sync_docs 对 change_documents 的并发写入）
7. 回执 failed / 超时 → 独立 session DELETE 占坑 Change 行
   （依赖 change_documents.change_id ON DELETE CASCADE 级联删 docs）→ 抛错
```

**竞态消除机制（核心论证，r3 修正）**：
- **changes 表**：占坑 commit（步骤3）先于 daemon_change_write 下发（步骤4）。daemon 必须经 claim→写盘→complete 多次 round-trip 才触发 postSpecSync（task-runner.ts:2171-2184 实证「先回执后 sync」），物理上不可能赶上占坑 commit → reparse 的 `_fetch_existing_changes` 命中占坑行 → 走 `_apply_parsed`(update)，不再 `_build_change`(created)。极端并发下 reparse created 撞键由 Phase 2b 兜底。
- **change_documents 表**：proxy 步骤6 **不再 INSERT docs**（占坑已建），即 proxy 路完全不写 docs；reparse `_sync_docs` 单路串行处理 docs（对占坑行：proposal 走 update；master 因 doc_type 大小写不一致走 DELETE+INSERT 'MASTER'；request 走 DELETE——见 R-05）。**只有 reparse 一路写 docs，无并发撞键**。占坑建 docs 的目的是让 proxy 返回时 DB 已有 docs（详情页不空），而非"让 reparse 走 update"。

### Phase 2 — reparse 不覆盖 proxy 状态 + created 撞键防御（`change/service.py`）

**2a. owner_id 守卫**：`_apply_parsed`（service.py:1248）改 `if parsed.current_stage is not None and row.owner_id is None: row.current_stage = parsed.current_stage`。proxy/用户创建行（owner_id 非空）stage 不被覆盖。

**2b. R-02 防御落点**：`_reparse` created 分支 `_session.add(row)`（service.py:1066）外包 `try/except IntegrityError`：撞 `ux_changes_workspace_key` → 回滚该 add、重查 existing_by_key、改走 `_apply_parsed`(update)。语义=「撞键即视为已被占坑/他路建过，转 update，不抛错」。与 `apply_sync` 两阶段 try/except（D-006）正交。落点明确在 `_reparse` created 处。

### Phase 3 — 中文 change_key（`change_writer/proxy.py _build_change_key`）

当前（proxy.py:67-71）`re.sub(r"[^a-z0-9]+","-",title.lower())` 把中文全过滤。改为：

```python
slug = re.sub(r"[^\w]+", "-", title.lower(), flags=re.UNICODE).strip("-")[:40] or "untitled"
return f"{date_prefix}-{slug}-{uuid.uuid4().hex[:6]}"
```

保留 `title.lower()`（英文统一小写，与 worktree lease 分支 service.py:117 一致；中文无大小写无副作用）。`\w`(UNICODE) 保留中文/字母/数字，剔除空格/标点/Windows 文件名非法字符。「测试」→`测试`；纯标点→`untitled`。末尾 uuid 后缀保唯一。

### Phase 4 — 失败回滚与边界

- **回滚**：回执 failed/超时 → 独立 session `DELETE Change`（FK CASCADE 级联删 change_documents）。表述统一「DELETE Change 依赖级联」，不显式删 docs。
- **幽灵变更（daemon 文件残留）**：daemon 写盘成功但回执丢失/超时 → proxy 删占坑行，daemon 端 `changes/<key>/` 残留；下次整树 sync reparse created（owner_id=None/brainstorm）重建幽灵。change_key uuid 后缀不阻碍重试；幽灵行可由 owner_id=None + 无 daemon_change_write 关联识别后人工/脚本清理。本次不下发 daemon cleanup（YAGNI）。

### Phase 5 — 测试

- `change_writer/tests/test_proxy.py`：
  - 占坑成功（Change + docs 先于 daemon_change_write 存在）；
  - **并发不撞键**：模拟 daemon sync reparse 与 proxy 并发 → changes 表不撞 ux_changes_workspace_key、change_documents 表不撞 ux_change_docs_type_path（proxy 路不再写 docs，reparse 单路）；
  - proxy 返回时 DB 已有 docs（详情页不空）；
  - 写 failed/超时 → 占坑 Change + docs 回滚（CASCADE 验证）；
  - 中文 change_key 生成 + .lower() 一致；现有在线/离线/超时回归。
- `change/tests/`：`_apply_parsed` owner_id 非空行不覆盖 stage、owner_id=None 行正常覆盖；`_reparse` created 撞键 IntegrityError → 转 update（Phase 2b）。
- 回归：worktree lease 分支 reparse 行为变化（§9）有显式断言。

> 注：不断言"reparse 对占坑 docs 全走 update"——因 R-05 doc_type 不一致，master 实际 DELETE+INSERT、request DELETE。只断言"无并发唯一键冲突 + proxy 返回 docs 存在"。

## 6. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change_writer/proxy.py | `proxy_create_change` 重构时序（步骤3 占坑 Change+docs / 步骤6 不补 / 步骤7 CASCADE 回滚）；`_build_change_key` 中文 unicode 正则 + .lower() |
| 修改 | backend/app/modules/change/service.py | `_apply_parsed` 加 `owner_id is None` 守卫；`_reparse` created 分支加 IntegrityError 防御转 update |
| 修改 | backend/app/modules/change_writer/tests/test_proxy.py | 占坑 / 双表不撞键 / 回滚 / 中文 case + 回归 |
| 修改 | backend/app/modules/change/tests/（_reparse/_apply_parsed 相关） | owner_id 守卫 + IntegrityError 转 update case |

> `_build_files` 的 doc_type（master/request）**不改**——与 worktree lease 分支保持一致，doc_type 不一致登记为 R-05 另行处理。

## 7. 接口定义

`proxy_create_change` 对外签名不变（仍返回 `Change`；router 无改动）：

```python
async def proxy_create_change(
    session: AsyncSession, *,
    workspace_id: uuid.UUID, user_id: uuid.UUID,
    title: str, description: str = "", change_type: str | None = None,
) -> Change: ...
```

内部时序变更（占坑 Change+docs 先于下发）。`_apply_parsed` / `_build_change_key` 签名不变，仅条件/正则变。

## 7.5 生命周期契约表

涉及 daemon / lease / claim / complete 关键词（daemon_change_write 队列 + change/docs 创建时序），必填：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 占坑 change + docs | backend(proxy) | DB(changes + change_documents) | workspace_id, change_key, owner_id, current_stage="draft"; docs(change_id,doc_type,path,exists) | (无) → active/draft + docs 存在 |
| 下发 change-write | backend(proxy) | DB(daemon_change_writes) | workspace_id, runtime_id, change_key, files, kind="create" | (无) → pending |
| claim change-write | daemon | backend | taskId, claimToken | pending → claimed |
| complete change-write | daemon | backend | taskId, claimToken, ok, files[] | claimed → done/failed |
| postSpecSync 回灌 | daemon | backend(apply_sync) | workspaceId, tar(含 changes/<key>/) | changes existing → update（docs 单路串行写，不再与 proxy 并发） |
| 回执 done 收尾 / 回滚 | backend(proxy) | DB | change_id | done → proxy 不写 docs / failed → DELETE Change(CASCADE docs) |

## 8. 数据模型

无表结构/字段变更。复用 `changes`（owner_id/current_stage/stages）、`change_documents`（change_id ON DELETE CASCADE，ux_change_docs_type_path 唯一键）、`daemon_change_writes`。`owner_id` 作「proxy/用户创建行」判据（扫描 `_build_change` 恒 None，proxy/worktree-lease 建行非 None）。

## 9. 兼容策略（brownfield）

- **worktree lease 分支行为变化（显式承认，非零回归）**：server-local `/changes/create`（router.py:39）当 `lease_id` 非空走 worktree lease 分支，建 Change 带 `owner_id=user_id` + `current_stage=draft`，router:62 随后 dispatch 设 brainstorm。修复后这类行 reparse 时 `_apply_parsed` 因 owner_id 非空**不再用文件推断覆盖 stage**。论证可接受：stage 本应由 dispatch/transition 权威写入，文件推断覆盖是历史行为；冻结 dispatch/transition 值语义更对。正常流程 stage 值与文件推断同值无感；仅「未经 dispatch 直接改磁盘产出」边缘场景不再自动同步 stage，属可接受收紧。
- 未触发新路径：proxy-create 占坑仅影响 daemon-client 创建路径；历史 `owner_id=None` 行 reparse 仍按现逻辑覆盖 stage（守卫 `owner_id is None` 为真，行为同前）。
- 回退：proxy 占坑失败（DB 异常）→ 抛错，不下发 daemon_change_write，无副作用。
- 不改变的 API/表：router 端点签名、changes/change_documents/daemon_change_writes schema 均不变。

## 10. 风险登记（Risk）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 占坑行回滚失败（DELETE Change 又异常）→ 孤儿 draft 行；daemon 文件残留 → 下次 sync 重建幽灵变更（owner_id=None/brainstorm） | P1 | 回滚独立 session + try/except log.warning；孤儿/幽灵行因 change_key uuid 后缀不阻碍重试，可由 owner_id=None + 无 daemon_change_write 关联识别后人工/脚本清理；本次不下发 daemon cleanup（YAGNI） |
| R-02 | 极端并发：占坑 commit 与 reparse created 几乎同时撞 changes 唯一键 | P1 | 物理上几乎不可能（task-runner.ts:2171-2184 证 sync 远晚于占坑）；Phase 2b 在 `_reparse` created 处 `_session.add` 外包 try/except IntegrityError → 重查转 update |
| R-03 | owner_id 判据被未来「扫描行也带 owner_id」破坏 | P2 | 当前扫描 `_build_change` 恒 None；若将来扫描需带 owner，改用 stages JSON 标记 source |
| R-04 | 中文 change_key 作为文件路径，少数工具对非 ASCII 路径处理差 | P2 | Windows/Linux/macOS 文件系统均支持 unicode；daemon utf-8 写文件；git 默认 utf-8；保留 uuid 后缀辅助检索 |
| R-05 | **既有 doc_type 不一致**：`proxy._build_files` / worktree lease 用 `master`/`request`，parser `STANDARD_FILENAMES` 用 `MASTER`/`requirements`（spec_paths.py:42-51） | P2 | **不导致 500**（reparse 单路串行，proxy 路不再写 docs）；后果仅 reparse 对占坑 master 行 DELETE+INSERT 'MASTER'、对 request 行 DELETE（doc_type 规整）。本次不修（碰 worktree-lease + request.md 语义超范围）；登记为既有 bug，后续单独变更统一 doc_type 对齐 STANDARD_FILENAMES |

## 11. 决策追踪

见 `decisions.md`：

- **D-001@v2** 方案 A 扩展——占坑 Change + 全部 ChangeDocument — 覆盖 G1，§5 Phase 1
- **D-002@v1** owner_id 区分 proxy/用户创建行 — 覆盖 G2，§5 Phase 2a / §9
- **D-003@v1** 中文 change_key unicode 正则 + .lower() — 覆盖 G4，§5 Phase 3
- **D-004@v1** R-02 IntegrityError 防御落点 — §5 Phase 2b
- **D-005@v1** 失败回滚幽灵变更策略 — §5 Phase 4 / R-01
- **D-006@v1** 竞态消除机制=占坑+串行（非"走 update"）；既有 doc_type 不一致 R-05 本次不修 — §5 Phase 1 论证 / R-05

## 12. 自审（Self-Review）

- [x] 竞态是否真消除（双表）：changes 表靠占坑 commit 先于 reparse（created→update，Phase 2b 兜底撞键）；change_documents 表靠 proxy 步骤6 不再 INSERT docs（reparse 单路串行）。**论证经源码核实**（_sync_docs update/INSERT 分支 service.py:1169-1182；doc_type 不一致 R-05）。
- [x] 状态权威：proxy draft 不被 reparse 覆盖（owner_id 守卫）；worktree lease 行为变化已显式承认。
- [x] 回滚完整：failed/timeout DELETE Change + CASCADE 删 docs，表述统一；幽灵变更有策略。
- [x] R-02 防御落点明确：_reparse created 转 update。
- [x] 中文 key 正则 + .lower() 与 worktree lease 一致。
- [x] 既有 doc_type 不一致登记 R-05，不误判为"走 update"，不在本次修。
- [x] 无 schema 变更：复用 owner_id 既有列 + 既有唯一键。
- [x] 生命周期契约表覆盖 daemon_change_write 全流转 + change/docs 占坑与回滚。
- 待第三轮独立 Design Grill 确认 r3 论证修正到位。
