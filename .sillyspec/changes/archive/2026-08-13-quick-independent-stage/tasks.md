---
title: quick 独立阶段任务分解
change_key: 2026-08-12-quick-independent-stage
status: draft
created_at: 2026-08-12T21:35:00+08:00
author: WhaleFall
---

# Tasks: quick 独立阶段

## Wave 1：后端阶段系统（基础）

### task-01：StageEnum 加 QUICK
- [ ] 文件：`backend/app/modules/change/model.py`
- [ ] `StageEnum` 加 `QUICK = "quick"`
- [ ] 新增 `spec_auxiliary_stages()` 返回 `[QUICK]`
- [ ] `spec_stages()` 不变（仍主线 5 阶段）
- [ ] `TRANSITIONS` 不变
- [ ] 验证：`spec_stages()==STAGE_ORDER` 断言保持成立

### task-02：dispatch 加 quick 配置
- [ ] 文件：`backend/app/modules/change/dispatch.py`
- [ ] `STAGE_AGENT_CONFIG` 加 `StageEnum.QUICK.value` 配置
  - `prompt_template="quick.md"`, `phase="Quick"`, `read_only=False`, `requires_worktree=False`
- [ ] 验证 STAGE_ORDER 断言（dispatch.py:46）不受影响

## Wave 2：后端创建分流

### task-03：change_writer 创建分流
- [ ] 文件：`backend/app/modules/change_writer/proxy.py`
- [ ] 文件：`backend/app/modules/change_writer/service.py`
- [ ] 创建 Change 时：`change_type=="quick"` → `current_stage="quick"`
- [ ] 否则 `current_stage="brainstorm"`（保持 ql-006 行为）
- [ ] `stages` 字段同步用 initial_stage
- [ ] 日志 current_stage 同步

### task-04：后端单测
- [ ] 文件：`backend/app/modules/change_writer/tests/test_classifier.py` 扩展或新建
- [ ] 测：描述含 quick 关键词 → change_type=quick → current_stage=quick
- [ ] 测：描述无 quick 关键词 → change_type=feature → current_stage=brainstorm
- [ ] 测：`StageEnum.spec_auxiliary_stages()` 含 QUICK

## Wave 3：前端适配

### task-05：列表页 quick 标签
- [ ] 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`
- [ ] `STAGE_LABEL` 加 `quick: "快速任务"`
- [ ] `STAGE_KIND` 加 `quick: "warning"`

### task-06：详情页 quick 操作区
- [ ] 文件：`frontend/src/components/changes/detail/change-stage-actions.tsx`
- [ ] 组件顶部加 quick 早返回分支
- [ ] quick 分支：⚡ 快速修复标题 + 档案选择器 + 触发智能体 + 完成态
- [ ] 不渲染主线推进/gate/团队
- [ ] tsc 通过

## Wave 4：验证

### task-07：端到端验证
- [ ] 创建 quick 类型变更 → current_stage=quick
- [ ] 列表页显示「快速任务」
- [ ] 详情页显示 quick 简化操作区
- [ ] 主线变更不受影响

## 依赖

```
task-01 → task-02（dispatch 引用 StageEnum.QUICK）
task-01 → task-03（创建分流用 stage 值）
task-03 → task-04（测试创建分流）
task-05、task-06 独立（前端）
task-07 依赖全部
```
