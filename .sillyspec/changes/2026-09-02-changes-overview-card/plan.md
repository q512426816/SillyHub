---
plan_level: full
---

# 实现计划（Plan）：工作台「活跃变更总览」卡片（B'）

## Spike 前置验证

无 Spike——核心技术链路（spawn 源码直连 CLI 获取 envelope、心跳载荷先例、Machine JSON 列先例）均已在 brainstorm 阶段实测或逐行核实（见 design.md §3/§5 与 review.json checklist）。

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖前序 Wave）
- task-03
- task-04

## Wave 3（依赖前序 Wave）
- task-05

## Wave 4（依赖前序 Wave）
- task-06

## Wave 5（依赖前序 Wave）
- task-07

## Wave 6（依赖前序 Wave）
- task-08

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 数据层：Machine.sillyspec_status 列 + 迁移 + 心跳/读取 schema | W1 | P0 | — | FR-05, FR-07 | None=清除语义注释锚定 sillyspec_update 权威注释 |
| task-02 | daemon 采集与上报：config 间隔/超时 + 采集器（spawn+三态矩阵+32KB 截断）+ 心跳组装 | W1 | P0 | — | FR-02, FR-03, FR-04 | cwd=workspace.root_path 主仓根；execFile 数组形参 |
| task-03 | backend 接口层：心跳落库（null 置 NULL）+ 机器视图嵌套透出 + 单测 | W2 | P0 | task-01 | FR-05, NFR-01 | 既有心跳消费者回归用例 |
| task-04 | daemon 测试：三态矩阵全覆盖（成功/null 能力缺失/瞬态保留快照）+ 截断降级 | W2 | P0 | task-02 | FR-03, FR-04, NFR-02 | fixture 容忍 readable/command；更新既有 daemon-heartbeat-sillyspec.test.ts 深比较断言（心跳 body 追加字段后必破） |
| task-05 | 前端类型链：pnpm gen:types（node_modules 预检）+ lib/daemon.ts 读取扩展 | W3 | P0 | task-03 | FR-07 | tsc 0 错误 |
| task-06 | 前端卡片：changes-overview-card 组件 + 组件测试 | W4 | P0 | task-05 | FR-01, NFR-03 | 原型 v2 视觉基准；占位/过期态 |
| task-07 | 工作台挂载：/workspaces/[id] page 挂卡片 + 引导跳变更中心 | W5 | P0 | task-06 | FR-01, FR-06 | SectionCard 网格区 |
| task-08 | 三端集成验收：卡片数据与同刻 CLI 直连一致 + null 占位/过期标记实测 | W6 | P0 | task-07 | 全部 FR | integration-critical 证据采集（verify 输入） |

## 关键路径
task-01 → task-03 → task-05 → task-06 → task-07 → task-08（后端纵贯线决定最短交付周期；task-02/04 为 daemon 侧线，汇于 task-08）

## 全局验收标准
1. 后端新增单测 + 前端组件测试全绿（仅跑相关测试，全量留 CI）
2. 三端真实联调：工作台卡片与同刻 CLI 直连 `progress show --json` 一致（不断言动态计数）
3. null 占位态（sillyspec 未装/版本低）与数据过期标记（瞬态失败保留快照）实测可见
4. 既有心跳消费者（ws_hub/机器卡）回归用例不受新增字段影响
5. api-types.ts 为生成产物；旧配置/旧版 daemon 心跳（无新字段）行为不变
