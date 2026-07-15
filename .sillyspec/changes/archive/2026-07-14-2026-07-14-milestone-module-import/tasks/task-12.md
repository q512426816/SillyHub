---
id: task-12
title: 前端导入流程测试
title_zh: ImportModuleModal 三态流程 vitest 测试
author: WhaleFall
created_at: 2026-07-14 19:24:33
priority: P2
depends_on: [task-09]
blocks: []
requirement_ids: [FR-008]
decision_ids: [D-003, D-006]
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/milestone-details/__tests__/

goal: >
  为 ImportModuleModal（task-09 产物）编写 vitest 测试，mock 后端 API，
  覆盖「上传 → 预览 → 勾选 Sheet → 确认 → 结果报告」完整三态流程（FR-008）。

context: |
  - 测试栈同 milestone-details.test.tsx：vitest + @testing-library/react + fireEvent。
  - 组件三态：上传态 / 预览态（Sheet 勾选 + 表格标错）/ 结果态（统计报告）。
  - API（task-08）：importModulesPreview(planNodeId, projectId, file) → ImportPreviewResp；
    importModulesCommit(planNodeId, payload) → ImportResultResp。
  - DTO 结构见 design.md §7.2（sheets[].rows[].duty_matched/valid、result 的 created/merged/skipped/failed）。

implementation: |
  - vi.mock "@/lib/ppm/plan"，提供 importModulesPreview/importModulesCommit 的 mock 实现，
    分别 resolve 构造的 ImportPreviewResp（含 2 个 Sheet：正常计划全匹配 + 临时计划含未匹配行）
    与 ImportResultResp（created_modules/merged_modules/created_details/skipped_rows/failed_rows）。
  - 用例 ① 上传 .xlsx 后进入预览态：调用 importModulesPreview，表格展示解析行（断言行数/模块名）。
  - 用例 ② 未匹配责任人行视觉标记：duty_matched=false / valid=false 行可断言（通过 data-testid 或 row 类名，
    不依赖具体颜色样式 —— 见 constraints「不测样式细节」）。
  - 用例 ③ Sheet 勾选/取消控制提交内容：取消勾选某 Sheet 后，该 Sheet 的 rows 不进入 commit payload。
  - 用例 ④ 点「确认导入」调用 importModulesCommit，且 payload.sheets 仅含被勾选 Sheet 的 valid 行
    （断言 mock 收到的 payload 结构）。
  - 用例 ⑤ 结果态显示统计（created_modules / skipped_rows / failed_rows 文本可见）。
  - 用例 ⑥ 成功后触发列表刷新回调（onSuccess / onRefresh 断言被调用一次），并关闭弹窗。
  - jsdom 无 File 上传真实解析能力：构造 new File([bytes], "x.xlsx") 后 fireEvent.change 触发上传 input，
    preview 完全由 mock 返回，不依赖真实 xlsx 解析（与 constraints「mock 后端，不真实请求」一致）。

acceptance: |
  - 三态切换断言正确：上传→预览→确认→结果，各态渲染关键文本/元素。
  - importModulesPreview 在上传后调用一次；importModulesCommit 仅在确认后调用一次。
  - commit payload 仅包含被勾选 Sheet 的 rows（取消勾选的 Sheet 不在 payload.sheets）。
  - 未匹配行（valid=false）可通过非样式手段断言（data-testid / className / 文案）。
  - 成功后 onSuccess 刷新回调被调用。

verify: |
  - cd frontend && pnpm exec vitest run
    （或限定：pnpm exec vitest run src/app/\(dashboard\)/ppm/milestone-details/__tests__/<本测试文件>）

constraints: |
  - mock 后端，不真实请求（vi.mock "@/lib/ppm/plan"）。
  - 用 vitest + @testing-library/react（项目既有栈，风格同 milestone-details.test.tsx）。
  - 不测样式细节（颜色/边框等易碎），用 data-testid / 文案 / DOM 结构断言。
  - 不引入新依赖。

out_of_scope: |
  - 真实 xlsx 解析（属后端 task-10 importer 单测）。
  - 端点集成（属后端 task-11）。
  - 样式/视觉像素级校验。
---
