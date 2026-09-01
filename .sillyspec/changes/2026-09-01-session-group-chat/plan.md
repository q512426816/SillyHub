---
author: qinyi
created_at: 2026-09-02 00:20:00
change: 2026-09-01-session-group-chat
plan_level: full
---

# 实现计划（Plan）：会话群聊

## Spike 前置验证
无——方案已经过设计核对（18 项假设源码验证）与 Design Grill 两轮独立审查，无遗留技术不确定性；直接进 Wave。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 1-2；后端触发管线与前端列表向导无文件交集）
- task-03
- task-07

## Wave 4（依赖 Wave 3；run_sync | router/events/group-typing | 前端成员面板，无文件交集）
- task-05
- task-06
- task-09

## Wave 5（依赖 Wave 4；互@检测挂接已完成的 turn_completed | 前端群聊面板，无文件交集）
- task-04
- task-08

## Wave 6（端到端收口，依赖全部）
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据模型与迁移 | W1 | P0 | — | FR-01/02/03, D-007/008/009 | session_kind 列 + agent_run_logs.metadata 列 + 两新表 + alembic 单文件 + DTO + gen:types |
| task-02 | 群管理服务与权限分支 | W2 | P0 | task-01 | FR-01/02/03/04, D-003 | group router/service（CRUD/成员/上限/解散）+ _require_group_member + 集中校验改造（session/service.py + permission_service.py + file_artifacts.py + router.py）；自带模块测试 |
| task-03 | 群消息与 @触发管线 | W3 | P0 | task-01, task-02 | FR-05/06/07/08, D-001/004/010 | 载体 run + @解析 + 影子懒建（grants 授权）+ 注入组装（简报+群摘要）+ 忙轮排队；自带模块测试 |
| task-04 | 互@协作护栏与热切换 | W5 | P0 | task-03, task-05 | FR-10/11, D-006/004 | turn_completed 互@检测 + Redis 护栏（链去重/深度/限频）+ 六要素 diff 热切换分支；自带模块测试 |
| task-05 | 桥接投影 | W4 | P0 | task-03 | FR-09, D-008/011 | run_sync 两改动点：事务内双写投影行（新 PK）+ 群频道事件（投影行 id）+ turn_completed 成员身份；自带模块测试 |
| task-06 | 实时通道（typing/presence/audience） | W4 | P0 | task-02 | FR-12/13, D-012 | SSE 生成器多路订阅合流 + typing 端点/agent typing + presence key + agent_sessions:changed audience；自带模块测试 |
| task-07 | 前端群列表与建群向导 | W3 | P0 | task-01, task-02 | FR-01/04 | SessionsPortal 群分区（/api/group-chats 供数）+ 建群向导 + API 客户端；自带组件测试 |
| task-08 | 前端群聊面板 | W5 | P0 | task-05, task-06, task-07 | FR-05/09/12/13 | group-chat-panel：平铺时间线全局排序 + 成员身份气泡 + SSE 消费（typing 分支/resync）；自带组件测试 |
| task-09 | 前端成员面板与 @补全 | W4 | P1 | task-02, task-07 | FR-14/15 | 成员面板（在线/移除/六要素卡片/热切换弹窗/重置记忆）+ mention-popover member 扩展；自带组件测试 |
| task-10 | daemon 回归 + 真实 e2e 验证 | W6 | P0 | task-01..09 | AC-01~07, NFR-05 | stage 透传回归 + 本机 Docker 部署 + 浏览器实测全链路（建群→@触发→流式回复→刷新回放→typing→热切换→权限） |

## 关键路径
task-01 → task-03 → task-05 → task-08 → task-10

## 全局验收标准
1. 相关模块测试全绿（**每个 task 自带其模块/组件测试**（task-02~09，CLAUDE.md 规则 5 写测试→写实现→跑测试）+ task-10 daemon 回归；按 local.yaml test_strategy=module 只跑命中模块，不全量）
2. 真实 e2e（task-10）：本机 Docker 部署后浏览器实测 requirements AC-01~AC-07 全部通过
3. 单聊/quick-chat/团队会话现有行为零回归（kind='chat' 路径不动 + 现有相关测试全绿；共享源文件 session/service.py、run_sync/service.py、router.py、permission_service.py 改动的既有测试由对应 task 负责回归）
4. ruff/mypy/tsc 零错误；api-types.ts/openapi.json 同步提交

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03 | AC-01（@路由+独立记忆） |
| D-002@v1 | task-03, task-05 | AC-01（影子桥接全链路） |
| D-003@v1 | task-02 | AC-05（参与者权限） |
| D-004@v1 | task-02, task-04 | AC-04（六要素+热切换） |
| D-005@v1 | task-03 | AC-01/02（平等成员+人格即角色） |
| D-006@v1 | task-04 | AC-03（互@协作+护栏） |
| D-007@v1 | task-01, task-03 | 影子不挂 parent（模型+懒建） |
| D-008@v1 | task-05 | AC-01（双写投影+刷新回放一致） |
| D-009@v1 | task-01, task-02 | 昵称全局唯一约束 |
| D-010@v1 | task-03 | 影子懒建 grants 授权分支 |
| D-011@v1 | task-08 | AC-01（平铺时间线排序） |
| D-012@v1 | task-04, task-06 | AC-06（typing 不落库不进上下文） |
