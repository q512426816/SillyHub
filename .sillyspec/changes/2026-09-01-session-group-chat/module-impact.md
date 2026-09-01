# 模块影响分析（Module Impact）— 会话群聊（多用户多 Agent 同会话）

---
author: qinyi
created_at: 2026-09-02 00:35:00
change: 2026-09-01-session-group-chat
---

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| agent（backend） | 修改 | model.py 加 session_kind/metadata 列与两张群表模型；schema.py 群聊 DTO；placement.py pinned grants 授权分支参数；file_artifacts.py 群成员分支；新增群聊测试 |
| daemon（backend） | 修改+新增 | 新增 modules/daemon/group/（router/service：群 CRUD/成员/消息/触发/护栏/typing）；session/service.py 权限分支+载体 run+热切换；run_sync/service.py 桥接投影两改动点；router.py SSE 校验分支+群消息端点+audience 过滤；session_events.py payload 扩展；permission_service.py 群分支；新增群聊测试 |
| frontend_components | 修改+新增 | 新增 components/group-chat/（group-chat-panel/create-group-wizard/member-panel）；sessions-portal.tsx 群分区入口；session-list-panel.tsx 群分桶；daemon/session-mention-popover.tsx member 判别联合；新增组件测试 |
| frontend_lib | 修改 | lib/daemon.ts 群聊 API 客户端+typing 上报+SSE typing 分支；lib/api-types.ts gen 重生成 |
| sillyhub-daemon | 修改（极小） | interactive/session-manager.ts 仅 stage='group_member' 标识透传回归验证（预期零/极小改动） |
| models（backend 共享基座） | 依赖变更 | 无直接改动；新表模型继承 models/base.py 基类（依赖不変） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/migrations/versions/<ts>_group_chat.py（新） | alembic 迁移脚本目录，_module-map 无对应模块（基建产物）；随 task-01 产出并提交 |
| backend/openapi.json | gen 产物（gen:types 同步提交纪律），非手写源码 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/agent.md` | 更新 agent 模块卡（session_kind/群表模型/placement grants 分支/file_artifacts 群分支） | pending |
| `modules/daemon.md` | 更新 daemon 模块卡（group/ 新子域/群消息触发/桥接投影/SSE 多路订阅/audience） | pending |
| `modules/frontend_components.md` | 更新前端组件模块卡（group-chat/ 三组件/portal 群分区/mention 扩展） | pending |
| `modules/frontend_lib.md` | 更新前端 lib 模块卡（群聊 API 客户端/SSE typing 分支） | pending |
| `modules/daemon.changelog.md` | 视 daemon TS 实际改动决定追加条目（预期无逻辑改动则 skipped） | pending |
| `_module-map.yaml` | 更新映射（新增 daemon/group/ 路径与 frontend group-chat 组件路径） | pending |
