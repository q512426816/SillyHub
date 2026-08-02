---
author: qinyi
created_at: 2026-08-02 00:18:30
change: 2026-08-01-proxy-create-race-fix
---

# 需求规格（Requirements）— proxy-create 并发竞态 500 修复

## 角色

| 角色 | 说明 |
|---|---|
| daemon-client 工作区用户 | 在绑定 daemon 的工作区创建变更（走 proxy-create 路径） |
| backend | `proxy_create_change` + spec-sync reparse 协调双表写入 |
| daemon | 写 `changes/<key>/` 文件 + completeChangeWrite 回执 + postSpecSync 整树回灌 |

## 功能需求

### FR-01: proxy-create 不再 500（消除 changes 表并发）
覆盖决策：D-001@v2, D-006@v1
**Given** daemon-client 工作区绑定在线 daemon
**When** 用户 `POST /changes/proxy-create` 创建变更
**Then** 返回 201 + Change 落库，不抛 `ux_changes_workspace_key` UniqueViolation

**Given** proxy 已占坑 Change（commit，先于 daemon_change_write 下发）
**When** daemon postSpecSync 触发 reparse 到达
**Then** reparse `_fetch_existing_changes` 命中占坑行 → `_apply_parsed`(update)，不 `_build_change`(created)

### FR-02: change_documents 表无并发撞键（消除 docs 同源竞态）
覆盖决策：D-001@v2, D-006@v1
**Given** proxy 占坑时已建 Change + 全部 ChangeDocument（step3 commit）
**When** daemon 回执 done
**Then** proxy 路不再 INSERT docs（step6）；change_documents 表仅 reparse 单路串行写，无 `ux_change_docs_type_path` 撞键

**Given** proxy 返回响应
**Then** DB 已有该 change 的 docs（详情页不空）

### FR-03: proxy 状态权威（owner_id 守卫）
覆盖决策：D-002@v1
**Given** proxy/worktree-lease 创建的 Change 行（owner_id 非空，current_stage=draft）
**When** spec-sync reparse `_apply_parsed` 处理该行
**Then** 不用文件推断覆盖 current_stage（`row.owner_id is None` 守卫）

**Given** 扫描创建的历史行（owner_id=None）
**When** reparse 处理
**Then** 按现逻辑覆盖 current_stage（行为不变）

### FR-04: 极端并发撞键兜底
覆盖决策：D-004@v1
**Given** 占坑 commit 与 reparse created 极端并发同 change_key
**When** reparse `_session.add(row)` 撞 `ux_changes_workspace_key`
**Then** catch IntegrityError → 重查 existing_by_key → 转 `_apply_parsed`(update)，不抛 500

### FR-05: 失败回滚
覆盖决策：D-005@v1
**Given** daemon 写盘 failed 或 proxy 等回执超时（60s）
**When** proxy 检测到失败/超时
**Then** 独立 session DELETE 占坑 Change（FK ON DELETE CASCADE 级联删 docs），抛 ChangeWriteError/超时错，无孤儿行

### FR-06: 中文标题 change_key 可读
覆盖决策：D-003@v1
**Given** 用户填中文标题（如「测试」）
**When** `_build_change_key` 生成 change_key
**Then** slug 保留中文（「测试」），英文小写，剔除标点/Windows 文件名非法字符 `\/:*?"<>|`；末尾 uuid 后缀保唯一

**Given** 纯标点/空标题
**When** 生成 change_key
**Then** slug 兜底「untitled」

## 非功能需求

- **兼容性**：server-local `/changes/create`、历史 `owner_id=None` 行回归无破坏性变化（worktree lease stage 行为变化已显式承认，语义更对）。
- **可回退**：proxy 占坑失败（DB 异常）→ 抛错不下发 daemon_change_write，无副作用。
- **可测试**：单测覆盖占坑 / 双表不撞键 / 回滚 / 中文 / owner_id 守卫 / IntegrityError 转 update。
- **无 schema 变更**：复用 `owner_id` 既有列 + 既有唯一键。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v2 | FR-01, FR-02 | 占坑 Change+docs 消除双表竞态 |
| D-002@v1 | FR-03 | owner_id 守卫保护 proxy 创建行 stage |
| D-003@v1 | FR-06 | 中文 change_key unicode 正则 + .lower() |
| D-004@v1 | FR-04 | IntegrityError 防御落点 _reparse created |
| D-005@v1 | FR-05 | 失败回滚幽灵变更策略 |
| D-006@v1 | FR-01, FR-02 | 竞态=占坑+串行；既有 doc_type 不一致 R-05 不修 |
