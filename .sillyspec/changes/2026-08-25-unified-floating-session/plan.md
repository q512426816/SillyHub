---
author: qinyi
created_at: 2026-08-25 03:14:00
change: 2026-08-25-unified-floating-session
plan_level: full
---

# 实现计划（Plan）：统一智能悬浮会话 v1

## Wave 1
- task-01

## Wave 2（依赖 task-01）
- task-02

## Wave 3（依赖 task-02）
- task-03

## Wave 4（无依赖，可与 W1-3 并行）
- task-04

## Wave 5（依赖 task-04）
- task-05

## Wave 6（依赖 task-03、task-05）
- task-06

## Wave 7（依赖 task-05、task-06）
- task-07

## Wave 8（依赖全部）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 schema + 页面上下文前导构建器 | W1 | P0 | — | FR-5, D-005 | PageContextCreateBlock + build_page_context_preamble |
| task-02 | create 路径注入 + 后端测试 | W1 | P0 | task-01 | FR-5 | 前导链 [变更,页面,简报] + 展示层干净断言 |
| task-03 | openapi + gen:types 再生成 | W1 | P0 | task-02 | 规则 21 | api-types.ts + openapi.json 提交 |
| task-04 | 壳层 store + 单测 | W2 | P0 | — | FR-1, FR-2, FR-3, D-002 | zustand 壳态（R6 合规） |
| task-05 | 悬浮宿主组件 + 布局挂载 + 测试 | W2 | P0 | task-04 | FR-1, FR-2, FR-3, FR-4, D-001/003/004 | 球/抽屉/胶囊/互斥/上下文条 |
| task-06 | SessionPanel + daemon.ts 透传 | W3 | P0 | task-03 | FR-5, D-006 | 两处最小增量，缺省零回归 |
| task-07 | PPM 智能入口 + URL 派生 hook | W3 | P0 | task-05, task-06 | FR-6 | 行按钮唤起 + use-page-session-context |
| task-08 | 全量回归 + verify 落盘 | W4 | P0 | 全部 | 验收基线 | pytest/vitest/tsc/eslint |

## 关键路径
task-01 → task-02 → task-03 →（task-04 → task-05）→（task-06 → task-07）→ task-08。

## 全局验收标准
1. 任意 dashboard 页悬浮球可用，最小化跨页保活，门户路由互斥生效。
2. PPM 发起团队携带服务端回查的【页面上下文】，用户消息展示干净。
3. backend daemon+ppm pytest / frontend vitest / tsc / eslint 全绿。
