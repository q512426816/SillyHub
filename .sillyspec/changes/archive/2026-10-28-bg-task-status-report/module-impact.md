---
author: qinyi
created_at: 2026-10-28 01:25:00
generated_by: agent-handwritten
---

# 模块影响分析（Module Impact）— 2026-10-28-bg-task-status-report

> 骨架命令不可用（变更无 diff），按 CLI 提示手写。归属按 _module-map.yaml 各子项目 paths 判定。

## 文件 × 模块归属

| 文件 | 模块 | 影响任务 | 说明 |
|---|---|---|---|
| sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | sillyhub-daemon | task-02 | 日志解析器扩展（新段类型） |
| sillyhub-daemon/src/agent-event-schema.ts | sillyhub-daemon | task-02 | 段/事件类型注册 |
| sillyhub-daemon/src/interactive/session-manager/events.ts | sillyhub-daemon | task-03 | 段消费+桥标记 |
| sillyhub-daemon/src/daemon.ts | sillyhub-daemon | task-03 | 桥拦截+client 调用 |
| sillyhub-daemon/src/hub-client.ts | sillyhub-daemon | task-03 | notifyBgTaskFinal 方法 |
| backend/app/modules/daemon/router/notify.py | backend | task-04 | 新端点+越权+发布 |
| backend/app/modules/daemon/schema.py | backend | task-04 | DTO |
| frontend/src/lib/daemon/session-sse.ts | frontend | task-05/06 | 信封类型消费 |
| frontend/src/components/agent-log/ 渲染群（task-01 定位精确组件） | frontend | task-05/06 | 条目翻转+计数 |
| frontend/src/lib/api-types.ts | frontend | task-07 | gen:types 产物 |
| sillyhub-daemon/src/api-types.ts | sillyhub-daemon | task-07 | gen:types 产物（闸门⑨） |
| 各侧 __tests__ | 各自模块 | task-02~06 | 测试同卡 |

## 模块依赖关系摘要

- 三子项目联动但方向单一：daemon（上报）→ backend（落库+发布）→ frontend（消费）；无反向依赖。
- backend 动点集中 daemon 模块（notify.py/schema.py），不触 agent/agent_sessions 模块（评审 gap-4 修正后的口径）。
- 风险集中面：hub-client/daemon.ts（消息主链路——上报失败须不阻塞主链路，全局硬约束）；gen:types 双端同步（daemon-ci 闸门⑨ fail-closed）。
- 前端活动渲染组件待 task-01 定位（存在性已证，候选 agent-log 渲染群）。

## 未匹配清单

无——全部文件归属三子项目模块。
