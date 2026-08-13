---
title: quick 独立阶段实现计划
change_key: 2026-08-12-quick-independent-stage
stage: plan
scale: large
created_at: 2026-08-12T22:05:00+08:00
author: WhaleFall
---

# Plan: quick 独立阶段实现计划

## 概述

让 quick 类型变更为 SillySpec 独立辅助阶段，全套适配。详见 [design.md](./design.md)。

**关键验证结论**（plan 阶段确认，降低实现风险）：
- `manual_dispatch`（router.py:879）是 **generic** 的：`get_config_for_stage(current_stage)` → `dispatch(target_stage=current_stage)`。**加 STAGE_AGENT_CONFIG.quick 配置后，quick 变更调 POST /dispatch 自动派发，无需改派发逻辑。**
- 完成态由 `dispatch` 内部 `sync_stage_status` 更新（agent run completed → stages.quick.status）。前端 `config_enabled` 控制触发按钮显示。

## Wave 分组

### Wave 1：后端阶段系统（基础，无依赖）

- [x] task-01: model.py StageEnum 加 QUICK
  - 文件：`backend/app/modules/change/model.py`
  - `StageEnum` 加 `QUICK = "quick"`；新增 `spec_auxiliary_stages()` 返回 `[QUICK]`；`spec_stages()` 不变；`TRANSITIONS` 不变
- [x] task-02: dispatch.py STAGE_AGENT_CONFIG 加 quick 配置
  - 文件：`backend/app/modules/change/dispatch.py`
  - 依赖：task-01（引用 `StageEnum.QUICK.value`）
  - `STAGE_AGENT_CONFIG` 加 `QUICK` 配置（prompt=quick.md, read_only=False, requires_worktree=False）
  - 风险：`dispatch.py:46` 断言 spec_stages()==STAGE_ORDER——spec_stages 不含 quick，断言保持成立

### Wave 2：后端创建分流（依赖 Wave 1）

- [x] task-03: proxy.py+service.py 创建分流
  - 文件：`backend/app/modules/change_writer/proxy.py` + `service.py`
  - 依赖：task-01（stage 值合法性）
  - 创建 Change 时 `change_type=="quick"` → `current_stage="quick"` + `stages={"quick":{"status":"pending"}}`；否则 brainstorm（保持 ql-006）
- [x] task-04: 后端单测
  - 文件：`backend/app/modules/change_writer/tests/test_classifier.py`
  - 依赖：task-03
  - 扩展测试：quick 描述→current_stage=quick；feature→brainstorm；spec_auxiliary_stages 含 QUICK

### Wave 3：前端适配（独立，可与 Wave 1/2 并行）

- [x] task-05: 列表页 quick 标签
  - 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`
  - `STAGE_LABEL` 加 `quick:"快速任务"`；`STAGE_KIND` 加 `quick:"warning"`
- [x] task-06: 详情页 quick 操作区
  - 文件：`frontend/src/components/changes/detail/change-stage-actions.tsx`
  - 组件顶部加 quick 早返回分支：⚡快速修复标题 + 档案选择器 + 触发智能体 + 完成态，不渲染主线推进/gate/团队
  - 兼容性：change-stage-header.tsx WORKFLOW_STAGES 不含 quick（步骤条已兼容）；page.tsx STATUS_BADGE 已有 quick（已兼容）

### Wave 4：端到端验证 + 遗留端点修复（依赖全部）

- [x] task-07: 端到端验证
  - 依赖：task-01~06 全部
  - 创建 quick 变更→current_stage=quick；列表显示「快速任务」；详情页显示 quick 操作区；主线变更不受影响
- [x] task-08: 修 change_writer/router.py:62 遗留 brainstorm 覆盖
  - 文件：`backend/app/modules/change_writer/router.py`
  - 独立审查 Gap 1 发现：`/changes/create` 端点在 create_change 后无条件 `current_stage='brainstorm'` 覆盖
  - 前端实际走 `/changes/proxy-create`（不经此路径），**不阻塞当前 feature**，但为一致性补 `if change.change_type!='quick'` 守卫，避免遗留端点把 quick 变更回退为 brainstorm

## 依赖关系图

```
Wave1: task-01 ──→ task-02
          │
          ↓
Wave2: task-03 ──→ task-04

Wave3: task-05  (独立)
       task-06  (独立)

Wave4: task-07  (依赖全部)
```

## 覆盖矩阵（需求 → task）

| 需求 | task |
|------|------|
| FR-01 创建分流 | task-03 |
| FR-02 StageEnum 扩展 | task-01 |
| FR-03 dispatch 支持 quick | task-02（generic 复用，仅加配置） |
| FR-04 列表页 quick 标签 | task-05 |
| FR-05 详情页 quick 操作区 | task-06 |
| FR-06 完成态判定 | task-06（前端推导，无后端改动） |
| NFR-01 向后兼容 | task-01/02（主线零改动） |
| NFR-02 无 DB 迁移 | 全部（current_stage 字符串列） |

## 可行性校验

- ✅ 无循环依赖
- ✅ 无 DB 迁移（current_stage 是 String 列）
- ✅ 主线逻辑零改动（spec_stages/TRANSITIONS/主线 dispatch 不变）
- ✅ manual_dispatch generic 复用已验证（router.py:875-887 get_config_for_stage + dispatch target_stage=current_stage）
- ✅ 前端向后兼容（步骤条/STATUS_BADGE 已兼容 quick）
- ✅ Gap 2 已验证：SillySpec quick 写 sillyspec.db（progress.js:685 UPDATE changes.current_stage + :698 INSERT stages），sync_stage_status 能读到，完成态判定成立
- ⚠️ Gap 1 已纳入 task-08：router.py:62 brainstorm 覆盖是遗留端点 bug，前端走 proxy-create 不经此路径，不阻塞 feature，task-08 补守卫保持一致

## 实现路径

→ `sillyspec run execute --change 2026-08-12-quick-independent-stage`
