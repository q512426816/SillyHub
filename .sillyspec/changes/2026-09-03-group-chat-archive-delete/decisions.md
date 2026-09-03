---
author: qinyi
created_at: 2026-09-03 16:51:16
---

# Decisions — 2026-09-03-group-chat-archive-delete

## D-01@v1：群聊归档/删除的实现形态（方案选择）

- type: architecture
- source: user
- question: 群聊的归档和删除操作按哪种形态实现？
- answer: **方案 A：完全镜像会话（单聊）既有模式**——群级 `archived_at` 置位/清除 + 软删 `deleted_at` 置位，权限门复用群主/workspace admin（`_require_group_owner`），已归档群复用会话「已归档会话」筛选视图。
- evidence: 用户原始指令「群聊功能要有个归档和删除操作，和会话一样」（2026-09-03 会话）。

### 方案对比（brainstorm step4）

| 维度 | 方案 A：镜像会话（群级标志位） | 方案 B：按成员个人归档 | 方案 C：删除走硬删 |
|---|---|---|---|
| 核心思路 | `agent_group_chats` 加 `archived_at` 列；删除置既有 `deleted_at`；归档/删除都是群主/admin 操作，全员同视图 | `agent_group_members` 行加个人 `archived_at`，每个成员独立「我的归档视图」 | 删除时物理 DELETE 群行（FK CASCADE 清成员），归档同 A |
| 优势 | 与会话语义完全一致（模型注释已预告「对齐 AgentSession 语义」）；改动面最小；`deleted_at` 三处过滤已就位只缺置位链路 | 尊重成员个人收纳意愿，互不影响 | 数据即时清除 |
| 劣势 | 群主归档对全员生效（成员侧无个人收纳粒度） | 新列挂成员表 + 列表查询按成员行过滤 + 幂等/权限面翻倍，复杂度高；群是共享实体，与「和会话一样」诉求偏离 | 破坏既有软删审计口径（会话 2026-07-11 起 D-003 已改软删保留审计）；群时间线/成员配置历史全丢 |
| 结论 | ✅ 采用 | ❌ 否决（YAGNI：当前单人主用场景无此粒度诉求） | ❌ 否决（与平台软删审计惯例冲突） |

### 覆盖/违反的既有决策

- 无违反。`AgentGroupChat` 模型注释（`backend/app/modules/agent/model.py:1223-1232`）明确「软删（deleted_at）与之正交（对齐 AgentSession.ended_at/deleted_at 语义）」——本方案是该预留语义的首次消费，非新造口径。
