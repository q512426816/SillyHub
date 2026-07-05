---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-14
title: 简化新建变更表单
wave: W5
priority: P1
estimate: 2h
depends_on: [task-05]
---

# task-14: 简化新建变更表单

## 目标

简化新建变更对话框，只保留需求描述（必填）和模块选择（可选），删除规模/类型等字段。

## 不在范围

- 不修改后端 create API（task-05 已处理）
- 不修改详情页（task-13）

## 输入

- `frontend/src/components/create-change-dialog.tsx`（或类似文件名）

## 产出

- 新建变更对话框组件（改）

## 实现步骤

1. 找到新建变更对话框组件（可能在 components/ 下）
2. 只保留：
   - 需求描述 textarea（必填）
   - 模块选择（可选，下拉）
   - 提交按钮
3. 隐藏/删除：
   - 规模选择（full/quick）
   - change_type 字段
   - 关联组件强制选择
4. 添加提示文案：「Agent 会自动判断影响范围和流程」
5. 确保提交后跳转到变更详情页

## 验收标准

- [ ] 只填需求描述即可创建
- [ ] 模块不选也能创建
- [ ] 页面文案体现 Agent 自动判断
- [ ] 创建后跳转到详情页

## 风险

无

## DoD

- [ ] 代码修改完成
- [ ] pnpm typecheck 通过
