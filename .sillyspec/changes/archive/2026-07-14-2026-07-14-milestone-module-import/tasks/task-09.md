---
id: task-09
title: 导入弹窗组件 + 导入按钮
title_zh: ImportModuleModal 三态弹窗与列表导入入口
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P0
depends_on: [task-02, task-08]
blocks: [task-12]
requirement_ids: [FR-005, FR-008]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
expects_from:
  task-08:
    - contract: importModulesPreview
      needs: [ImportPreviewResp]
    - contract: importModulesCommit
      needs: [ImportResultResp]

goal: >
  在 ModuleLevelTable 顶部「+ 新建模块」旁加「📥 导入模块」按钮，点击弹出 ImportModuleModal，
  含上传态/预览态（Sheet 勾选 + 表格标错）/结果态三态，对接 task-08 的 API 完成预览后确认流程。
implementation: |
  - ModuleLevelTable 工具栏（page.tsx L943-951「+ 新建模块」旁）加「📥 导入模块」按钮，
    disabled={readOnly}；onClick 打开 ImportModuleModal，传 planNodeId、projectId
  - ImportModuleModal 三态（用 AntD Modal/Table/Upload/Dragger）：
    ① 上传态：Upload/Dragger 选 .xlsx → 调 importModulesPreview(planNodeId, projectId, file)
    ② 预览态：Sheet checkbox 勾选（默认全选）+ AntD Table 列出解析行；
       未匹配责任人(duty_matched=false)/valid=false 行 rowClassName 标红 + Tag「未匹配/错误」；
       正常/临时 plan_type 用蓝/橙 Tag（参考 prototype blue-600 主色）
    ③ 结果态：统计 created_modules/merged_modules/created_details/skipped_rows + failed_rows 列表
  - 预览态「确认导入」→ 调 importModulesCommit(planNodeId, {sheets: 勾选 Sheet 的 valid rows})
    → 结果态 → 成功后 message.success + reload() 刷新模块列表 + 关闭弹窗
  - 错误处理：preview/commit 失败 message.error，停留在当前态
acceptance: |
  - 导入按钮在 ModuleLevelTable 顶部，针对当前里程碑（实施阶段）
  - 三态切换正常：上传 → 预览 → 确认 → 结果 闭环
  - 未匹配责任人/错误行（valid=false）标红可见
  - Sheet 可勾选，未勾选 Sheet 的行不提交
  - 成功后刷新列表显示新模块（含 task-02 新增的「计划类型」列）
  - readOnly 模式下导入按钮禁用（与「+ 新建模块」一致）
verify: |
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints: |
  - 仅在实施阶段里程碑的 ModuleLevelTable 加按钮（非模板簇 plan-nodes）
  - 样式与项目既有页面一致（参考 prototype blue-600 主色，Tag 蓝/橙）
  - 弹窗用 AntD Modal/Table/Upload，不引入新 UI 库
---
