---
author: qinyi
created_at: 2026-08-26 19:38:00
---

# 模块影响分析（Module Impact）— 工作区自定义 Skills 完整文件编辑

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend workspace | 修改 | SkillsViewService 写路径（5 方法+路径安全+审计）+ router 5 端点 + 新增 test_skills_edit.py |
| frontend | 修改 | skills 页双栏改造 + workspace-skills-view.ts 数据层扩展 + queryKeys 新增 + api-types/openapi 重生成 + 既有 page.test.tsx 更新 |

## 未匹配文件

无。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（skills 写路径 5 端点 + 安全约束） | done |
| `modules/frontend.md` | 更新 frontend 模块卡（skills 页双栏 + 数据层） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
