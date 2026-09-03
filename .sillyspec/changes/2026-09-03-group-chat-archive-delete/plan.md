---
plan_level: full
author: qinyi
created_at: 2026-09-03 16:58:00
---

# 实现计划（Plan）：群聊归档与删除（对齐会话语义）

## Spike 前置验证

无 Spike——全部核心链路（会话侧 archive/delete 先例、end_group 收口链、
SSE 信号通道、群分区数据源、gen:types 流程）在 brainstorm 阶段经独立 Grill
子代理逐行核实（review-2026-09-03-163216，含 2 fail+3 gap 修正记录）。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03

## Wave 4（依赖前序 Wave，双线并行：后端测试 / 前端类型与 lib）
- task-04
- task-05

## Wave 5（依赖前序 Wave）
- task-06

## Wave 6（依赖前序 Wave）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 数据层：agent_group_chats 迁移加 archived_at 列 + AgentGroupChat 模型字段 + GroupChatRead 暴露 | W1 | P0 | — | FR-01, FR-02, D-01@v1 | 照 20260903090000 迁移先例；down_revision 接执行时实测 head |
| task-02 | backend service：archive/unarchive/delete_group（_get_group_locked 行锁+幂等+SSE 信号）+ delete 双置位与影子日志分支旁路封堵 + list_groups archived 三态过滤 | W2 | P0 | task-01 | FR-01, FR-02, FR-03, FR-04, FR-05, D-01@v1 | delete 复用 end_group 幂等收口链不重写 |
| task-03 | backend router：POST archive/unarchive + DELETE 软删三端点 + 列表 archived Query（HTTP 默认 False） | W3 | P0 | task-02 | FR-01, FR-02, FR-03, FR-04, FR-05 | 端点薄层照 /sessions/{id}/archive 先例 204 |
| task-04 | backend 测试：归档/取消归档幂等与权限、删除收口与双置位与旁路封堵、三态过滤（HTTP 默认防泄漏锚点）、SSE 信号 | W4 | P0 | task-02, task-03 | FR-01, FR-02, FR-03, FR-04, FR-05 | 落点 test_group_chat_management.py 增补 |
| task-05 | 前端类型与 lib：pnpm gen:types（node_modules 预检）+ daemon.ts 三函数与 listGroupChats archived 参数 + group-chat-panel presence 显式 archived:null | W4 | P0 | task-03 | FR-04 | openapi.json+api-types.ts 同 change 提交 |
| task-06 | 前端列表交互：GroupChatRow hover 操作（归档/取消归档/删除）+ 已归档徽标与降调 + 归档视图数据源（queryKey 视图维度）+ portal 群回调接线 | W5 | P0 | task-05 | FR-01, FR-02, FR-03, FR-04 | 全部照 SessionRow/会话回调先例 |
| task-07 | 前端测试：群行 hover 按钮渲染/aria、已归档徽标与按钮二选一、归档视图拉取 archived=true、删除确认 Modal、回调 invalidate 与清选中态 | W6 | P0 | task-06 | FR-01, FR-02, FR-03, FR-04 | 落点 session-list-panel.test.tsx 增补 |

## 关键路径
task-01 → task-02 → task-03 → task-05 → task-06 → task-07（后端纵贯线→前端消费线）；
task-04（后端测试）挂 task-02/03 后与 task-05 并行。

## 全局验收标准
1. 后端新增用例 + 前端新增用例全绿（仅跑相关测试文件，全量留 CI）
2. 归档/取消归档/删除三操作幂等，权限边界（普通成员 403 / 非成员 404）有断言
3. 删除活跃群后：影子会话与群时间线均 ended 且群行+时间线行双 deleted_at；成员读路径 404（含影子日志分支旁路封堵回归）
4. `GET /group-chats` 无参不含已归档群（防泄漏锚点）；`?archived=true` 仅已归档；显式 null 全量
5. 前端：群行操作视觉与会话行同构；归档视图徽标/降调/「＋」隐藏；被操作群是选中群时清选中态
6. `pnpm gen:types` 产物（backend/openapi.json + frontend/src/lib/api-types.ts）与端点实现同 change 提交，无手写类型
7. 既有测试零回归（test_group_chat_management.py 既有用例 + session-list-panel 既有用例 + daemon.test.ts 群函数区）
