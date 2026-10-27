---
author: qinyi
created_at: 2026-10-26 23:20:30
plan_level: full
execution_mode: main
---

# 实施计划（Plan）— 2026-10-26-mobile-four-page-layout-fix

## 复杂度分类

```
plan_level: full
reason: 11 个实现卡（>8）、跨前端多组件域（daemon 会话组件/changes 组件/mobile 外壳/m 页面）、W2/W3 文件正交可并行、PC 零回归硬约束需逐 Wave 治理
estimated_files: 18
cross_module: true
has_schema_change: false
has_state_machine_change: false
needs_parallel_execution: true
needs_human_review: false
```

> execution_mode=main（R7/R8 对撞实证：单任务均 <30min 的样式分支改动，直写快 3.6×；派发税不划算）。并行收益经并批表达而非子代理派发。

## 全局硬约束

- **PC 端零回归（FR-10，用户原话硬验收）**：全部共用组件 desktop 分支样式不变；每个共用组件改动必须携带 mobile 行为用例 + desktop 锚定用例双覆盖。
- **改动锁 mobile 分支**：所有新 prop（mobile/variant）缺省值 = 既有行为（false/"desktop"），desktop/dialog/悬浮宿主路径一行不动。
- **仅跑相关测试面**（NFR-02/规则 0）：daemon sessions / changes / mobile 套件 + tsc + eslint，全量归 CI。
- **行号基线漂移防御**：design.md 行号以 HEAD 97d478090 时点核对；本仓多 agent 并行，执行时一律以符号定位（组件名/常量名/testid）为准，不盲信行号。

## FR 映射

FR-07→task-01、FR-08→task-02+task-10、FR-01→task-03+task-05、FR-02→task-04+task-05、FR-04→task-06、FR-03→task-07、FR-05→task-08、FR-06→task-09、FR-09→task-11、FR-10→全局硬约束（各共用组件卡 verify 的 desktop 锚定用例 + verify 阶段回归核对）。逐卡明细见 tasks/task-NN.md 的 requirement_ids。

## Wave 划分

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-03
- task-04
- task-06
- task-07
- task-08

## Wave 2（依赖前序 Wave）
- task-05
- task-09
- task-10
- task-11

## Review Focus 盲区清单（隐含面）

W4 不设卡：相关面回归核对（tsc+eslint+PC 零回归）是 verify 阶段职责（探针核验+测试对账），用户真机复验为 verify 收尾动作——按 D-006@v1 纪律不立仪式卡。

- safe-area `env(safe-area-inset-bottom)` 在桌面浏览器移动模拟下恒 0——避让值退化为基础值时仍须足够覆盖 TabBar+缓冲，不能只在真机下成立；承接 task-01。
- TurnSegmentViews 的 TurnLiveMarquee 挂载点服务 dialog/悬浮宿主（desktop 形态）——透传 prop 缺省路径若误传 mobile 会改 PC 悬浮面板行为；承接 task-05（desktop 锚定用例必须覆盖悬浮宿主形态的间接断言）。
- 数字缩写口径未规格化会各卡各自实现——统一：≥10000 → `(n/1000).toFixed(1)k`（78,489→78.5k，99,999→100.0k 可接受），desktop 永不缩写；承接 task-04（导出纯函数供复用）。
- FAB 让位留白与外壳 pb 避让叠加计算——列表容器已在 main（pb 避让 TabBar）内，FAB `bottom-24` 悬浮其上，留白须覆盖「FAB 底边 − 卡片底边」最小净距，否则双层叠加下仍遮挡；承接 task-11。
- 密度收紧合并信息行（负责人+路径同行）在超长路径下溢出换行——合并行必须 truncate 单行；承接 task-10。

## 覆盖矩阵（decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~11 全部（mobile 分支机制为统一技术路线） | 各卡 mobile 用例 + desktop 锚定用例双绿 |
| D-002@v1 | task-02（密度规约走 m-app 选择器而非全局断点）、task-03~08（prop 分支而非响应式类） | 代码评审：无 sm:/md: 断点类新增于共用组件 desktop 路径 |
| D-003@v1 | 全局（不新建移动组件套件，仅既有组件加分支） | 文件变更清单无 NEW: 移动组件文件 |
