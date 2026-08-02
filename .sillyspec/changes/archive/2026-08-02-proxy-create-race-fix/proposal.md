---
author: qinyi
created_at: 2026-08-02 00:18:30
change: 2026-08-01-proxy-create-race-fix
---

# 提案书（Proposal）— proxy-create 并发竞态 500 修复

## 动机

daemon-client 工作区创建变更接口 `POST /changes/proxy-create` 必报 500，用户无法在该类工作区创建变更。根因是并发竞态：proxy 落库 Change/docs 与 daemon 整树回灌 reparse 抢同一 change_key / (change_id,doc_type,path) 撞两张表的唯一键。

## 关键问题（现有方案为何不够）

1. **changes 表并发撞键**：`proxy_create_change` 等回执后落库 Change，与 daemon `postSpecSync` 的 reparse `_build_change`(created) 并发 INSERT 同 change_key，撞 `ux_changes_workspace_key` → `UniqueViolation` 500。
2. **change_documents 表同源竞态**（Design Grill r1 发现）：proxy 落库 docs 与 reparse `_sync_docs` INSERT docs 并发撞 `ux_change_docs_type_path`（被 changes 表 500 遮蔽，未触发但同源）。
3. **状态语义不一致**：parser 对新变更推断 `current_stage=brainstorm`，proxy 写死 `draft`，reparse `_apply_parsed` 会把 draft 覆盖成 brainstorm。
4. **中文标题编号不可读**：`_build_change_key` 的 `[^a-z0-9]` 把中文全过滤成 `untitled`。

## 变更范围

- 重构 `proxy_create_change` 时序：下发前先**占坑 Change + 全部 ChangeDocument**，回执后不再写 docs，失败/超时删占坑行回滚。
- `_apply_parsed` 加 `owner_id is None` 守卫保护 proxy 创建行 stage；`_reparse` created 加 IntegrityError 防御转 update。
- `_build_change_key` 改 unicode 感知正则 + `.lower()`。

## 不在范围内（Non-Goals）

- 不改 daemon-client 变更「创建后不自动 dispatch brainstorm」的既有语义（保持 draft）。
- 不改 spec-sync / reparse 整体机制。
- 不碰前端、不改 DB schema、不加 migration。
- **不修既有 doc_type 不一致**（`master/request` vs `MASTER/requirements`，R-05，不导致 500）。
- 不处理 daemon-client spec 同步链路其余已知断裂。

## 成功标准（可验证）

- daemon-client 工作区创建变更（含中文标题）返回 201，不再 500。
- 同一 change_key / (change_id,doc_type,path) 不被两路并发写入（changes + change_documents 两表唯一键无冲突）。
- proxy 返回时 DB 已有 Change + docs（详情页不空）。
- daemon 写失败/超时 → 占坑 Change + docs 回滚，无孤儿。
- 中文标题 change_key 保留原字（如「测试」→ `changes/2026-08-02-测试-xxx/`）。
- server-local `/changes/create` 与历史 `owner_id=None` 行无破坏性变化（worktree lease stage 不再被文件推断覆盖，已显式承认）。
