---
author: qinyi
created_at: 2026-08-25 22:38:40
change: 2026-08-25-session-spec-binding
---

# 需求（Requirements）

## 功能需求

### FR-01 自动绑定（会话↔变更，多对多）
会话内执行 `sillyspec run <任意阶段> --change <变更名>` 后，该会话与该变更自动建立多对多关联；一个会话可关联多个变更，一个变更可关联多个会话。绑定幂等（重复执行同命令不产生重复行）。`--change default` 伪键不绑定（D-005@v2，双通道统一守卫）。`sillyspec run quick` 子命令的 `--change` 值是 CLI 内部会话 id，不作变更绑定（D-004）。
- 验收：在会话中跑 `sillyspec run execute --change <现有变更>` → change_session_links 出现 (变更, 会话) 行；变更详情会话卡可见该会话。

### FR-02 自动绑定（会话↔快速修复，多对多）
SillySpec CLI 经 `POST /api/agent-logs` 上报（hub_session_id 命中平台会话）时，按 entry 的 quick_id 自动建立 会话↔快速修复（ql_id）关联；entry 的 change_key 同样落变更关联。无 hub_session_id 的上报按现有逻辑聚合出 tool_report 会话，聚合会话同样落两类关联。绑定幂等；绑定行不要求 quicklog_entries 行已存在（D-001）。
- 验收：会话内跑 `sillyspec run quick ...`（CLI 上报后）→ quicklog_session_links 出现 (workspace, ql_id, 会话) 行；快速修复抽屉可见该会话。

### FR-03 变更侧展示改 M:N
变更详情「会话调试」卡与变更级会话工作台的数据源从 `AgentSession.change_id` 单 FK 改为 `change_session_links`（JOIN agent_sessions，deleted_at IS NULL，last_active_at 倒序）；响应 schema `AgentSessionListItem` 不变；存量单 FK 数据经迁移播种进 links，不丢失。
- 验收：list_change_sessions 对"仅经命令解析绑定（无单 FK）"的会话可见；迁移后原有单 FK 关联仍可见。

### FR-04 快速修复侧展示与弹出会话
- 快速修复详情抽屉新增「关联会话」卡：预览本人最近 3 条（点击 `?session=` 深链直达门户选中态），卡尾「打开会话工作台」进入新路由 `/workspaces/[id]/quicklog/[qlId]/sessions`（QuicklogScope 门户，与变更门户同构）。
- 门户内组头「＋」新建会话自动绑定本快速修复（首句创建请求带 quicklog_id）。
- 数据端点：`GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/sessions`（跨成员可见、软删过滤、标题提取与变更端点同源共享 helper）。
- 验收：抽屉卡渲染/深链/空态；新路由列表仅含绑定本快速修复的会话；新建会话落绑定。

### FR-05 会话列表关联筛选
工作区会话列表（`scope?.kind === "workspace"`）新增「关联」下拉：选项=工作区活跃变更 + 非占位快速修复（分组、可搜索）；选中变更→透传 change_id、选中快速修复→透传 ql_id（服务端 M:N 过滤）；清除恢复。change_id 参数语义从单 FK 精确匹配扩大为 M:N 命中（向后兼容：原命中集是新命中集子集）。
- 验收：选中某变更 → 列表只剩与其关联的会话（含多对多命中）；daemon sessions API 对两参数返回正确命中集。

### FR-06 悬浮会话 quickId
`SessionPreContext` / `FloatingPreContext` 增加 quickId；首句创建请求透传 quicklog_id 落绑定；快速修复标题解析 query 与变更名解析同款。
- 验收：悬浮球在 quickId 上下文发起的会话创建后出现在快速修复关联列表。

## 非功能需求

### NFR-01 兼容性
未跑过 sillyspec 的会话零行为变化；`AgentSessionRead.change_id` 字段继续返回；迁移 downgrade 对称（drop 新表，播种行保留无害）。

### NFR-02 性能
run_sync 绑定钩子仅 sillyspec 命令行触发（低频）；绑定查询有 (workspace_id, change_key) 唯一索引与 links 索引支撑；savepoint best-effort 失败不阻断消息入库。

### NFR-03 跨平台
backend 迁移 dialect 无关（op.create_table + sa.Uuid）；前端/后端代码 Windows/Linux/macOS 兼容（无平台特定调用）。

### NFR-04 类型契约
后端 schema 变更后执行 `pnpm gen:types` 并提交 `api-types.ts` + `backend/openapi.json`（CLAUDE.md 规则 21）。
