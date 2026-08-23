---
author: qinyi
created_at: 2026-08-23 21:35:00
plan_level: full
change: 2026-08-23-repo-native-spec-backfill
---

# 实现计划（Plan）— 修复 repo-native spec 回灌断链

## Wave 分组与依赖

### Wave 1｜双线独立基础（可并行）
- task-01
- task-02

依赖说明：两任务零代码交集（task-01 主仓 backend，task-02 工具仓 sillyspec），Wave 内无依赖；task-01 是断链根修，task-02 是存量免疫地基。

### Wave 2｜CLI 消费点接入
- task-03

依赖说明：消费 task-02 产出的 isSelfReferentialSpecRoot/isPlatformMode helper（契约见 task-02 卡片 goal；不重复实现判定）。

### Wave 3｜发版生效
- task-04

依赖说明：task-02/03 合入且 npm test 绿后发版 3.27.3 + 全局重装；消除"发版前持续中毒"窗口（design 风险 2）。

### Wave 4｜端到端闭环
- task-05

依赖说明：task-01 模板落盘 + task-04 生效 CLI；纯验证任务（verify 阶段承载）。

## 执行期操作项（非任务卡）

- execute 每步前检查本仓库 `.sillyspec-platform.json`/`.sillyspec-platform-managed` 是否被活跃平台会话重写（CLI 3.27.3 装前窗口，Design Grill needs_thinking ③）；发现即删并记录。
- 工具仓改动独立 git commit（task-04 内执行），本仓库变更目录产物 git add 不自动 commit（流程惯例）。

## 复杂度分类

```
change_key: 2026-08-23-repo-native-spec-backfill
plan_level: full
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: false
```

依据：跨仓变更（SillyHub backend + sillyspec 工具仓，design 文件清单 8 文件）；不动变更状态机/阶段流转；任务链 task-03→02、task-04→02/03、task-05→01/04 线性可序（Wave 1 双任务可并行但无并行必要，单执行流足够）；无 UI/schema/权限变更，独立审查已过（brainstorm review-2026-08-23-212848 PASS）。
