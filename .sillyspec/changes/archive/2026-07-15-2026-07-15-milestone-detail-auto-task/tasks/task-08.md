---
id: task-08
title: （可选）milestone-details/page.tsx 提交成功 toast 加「已自动创建任务」文案
title_zh: 提交成功提示已自动创建任务
author: WhaleFall
created_at: 2026-07-15 19:29:30
priority: P2
depends_on: []
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
provides: {}
expects_from: {}
goal: |
  在 milestone 明细「提交（变 done）」成功后的 toast 上增加一句提示，
  让用户知道后端已自动创建任务计划，避免用户误以为还要手动建任务。
  纯文案优化，不改提交逻辑、不改接口、不改状态流转。
implementation: |
  1. handleSubmit 的 save 成功路径（约 336 行 `showToast(true, "已提交")`）：
     这是 edit 草稿提交（draft→done，DetailDrawer submit(autoSubmit=true) 经
     onSubmit→handleSubmit(detail.id,"save") 触发）的成功提示点。
     改为 `showToast(true, "已提交，已自动创建任务计划")`。
  2. DetailDrawer 的 create+autoSubmit 路径（约 2075-2080 行）：
     createPsPlanNodeDetail({status:"done"}) 成功后 onSaved() 返回，
     onSaved 回调（约 697/715 行）只触发刷新、不弹 toast。
     若需让「直接创建为 done」也能看到该提示，可在 onSaved 前补一句
     `showToast(true, "已提交，已自动创建任务计划")`；若仅要求覆盖编辑提交路径，
     则只改第 1 点即可。建议两处都加，保证两条 done 路径体验一致。
  3. 保存草稿路径（save 不带提交 / create 不带 autoSubmit）保持原有提示不变，
     不提示「已自动创建任务」。
acceptance:
  - edit 草稿提交（draft→done）成功后 toast 文案含「已自动创建任务」字样。
  - create 直接提交为 done 成功后同样能看到该提示（若实现第 2 点）。
  - 保存草稿、驳回、变更等其它路径提示文案不受影响。
verify: |
  cd frontend && pnpm exec tsc --noEmit
constraints: |
  - 纯文案优化，不改提交逻辑、不改接口调用、不改状态流转。
  - 仅在「提交（变 done）」成功路径提示；保存草稿路径不提示。
  - 保持中文文案，不引入新依赖。
