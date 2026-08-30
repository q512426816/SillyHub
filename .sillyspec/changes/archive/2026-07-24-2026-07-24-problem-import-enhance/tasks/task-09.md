---
id: task-09
title: Remove static import template xlsx
title_zh: 删除静态模板 xlsx（统一动态端点）
author: qinyi
created_at: 2026-07-24 14:22:00
priority: P1
depends_on: [task-07]
blocks: []
requirement_ids: []
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/public/templates/problem-import-template.xlsx
provides: []
expects_from:
  task-07:
    - contract: downloadImportTemplate
      needs: []
goal: >
  前端下载模板改走动态端点（task-07）后，删除静态 xlsx，避免双源混乱。
implementation:
  - 删除 frontend/public/templates/problem-import-template.xlsx
  - 确认 import-problem-modal 已改调 downloadImportTemplate（task-08），无残留 a.href=/templates/...
acceptance:
  - 静态 xlsx 已删
  - 无代码引用静态路径
verify:
  - git status 确认删除
  - grep -rn "problem-import-template.xlsx" frontend/src 确认无静态引用
constraints:
  - 必须在 task-07/08（前端改动态端点）之后删，否则旧前端下载 404
---

# TaskCard — task-09 删除静态模板 xlsx

## 上下文依据
- design.md §5 Wave2.3：前端下载模板统一改走动态端点（`GET /problem-list/import-template`），静态 xlsx 删除，避免双源混乱。
- design.md §9 兼容策略：静态模板删除，前端统一动态端点（不改 API 路径/表/权限）。
- design.md §11 D-007@v1：模板下载改动态端点 → §5 Wave2（覆盖任务 task-05/07/09）。
- plan.md task-09：删 `public/templates/problem-import-template.xlsx`，依赖 task-07，覆盖 D-007。
- 已确认静态文件存在：`frontend/public/templates/problem-import-template.xlsx`。

## 依赖契约
- 前置 task-07：`lib/ppm/problem.ts` 的 `downloadImportTemplate()` 已改为调用 `GET /problem-list/import-template`（blob 下载），不再指向静态 `/templates/...`。
- 旁证 task-08：`import-problem-modal.tsx` 下载模板入口已切换到新 client，无残留 `a.href="/templates/..."` 静态引用。

## 执行步骤
1. 删除文件 `frontend/public/templates/problem-import-template.xlsx`（本任务唯一 allowed_path，仅删除不新增）。
2. 执行后核查：`grep -rn "problem-import-template.xlsx" frontend/src` 应无命中；`grep -rn "/templates/problem-import-template" frontend` 应无命中。
3. 如发现残留引用，不得本任务内修改其它路径文件（越界）——回退给 task-07/08 处理。

## 验收清单
- [ ] `git status` 显示该 xlsx 为 deleted。
- [ ] `frontend/src` 全量 grep 无静态路径引用。
- [ ] task-07/08 已 merge/落地（否则禁止执行，避免旧前端下载 404）。

## 风险与约束
- 顺序硬约束：必须在 task-07（client 改动态）+ task-08（modal 切换）之后执行；否则前端点击「下载模板」会 404。
- 本任务不碰代码，仅删静态资源；不产生测试用例。
