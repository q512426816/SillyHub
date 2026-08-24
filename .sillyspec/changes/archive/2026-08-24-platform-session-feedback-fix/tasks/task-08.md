---
id: task-08
title: '前端 askuser / permission 弹窗支持最小化'
title_zh: '前端 askuser / permission 弹窗支持最小化'
author: 'qinyi'
created_at: 2026-08-24 11:07:30
priority: P0
depends_on: []
blocks: ['task-09']
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/ask-user-dialog-card.tsx
  - frontend/src/components/permission-approval-card.tsx
  - frontend/src/components/permissions/session-permission-panel.tsx
  - frontend/src/components/permissions/__tests__/session-permission-minimize.test.tsx
goal: >
  为 AskUser 结构化问答弹窗与普通工具审批弹窗增加最小化能力：用户可将弹窗收缩为右下角浮动胶囊，点击胶囊可还原，避免大弹窗完全遮挡会话内容。
implementation:
  - 在 AskUserDialogCard 与 PermissionApprovalCard 新增 minimized 受控状态与最小化/还原按钮，保持原有提交/审批回调不变。
  - SessionPermissionPanel 管理全局 minimized 卡片集合；未最小化卡片按原列表渲染，最小化卡片聚合为右下角固定浮动胶囊。
  - 浮动胶囊显示未决数量角标与最近一条标题，点击后还原对应卡片到列表并继续作答/审批。
  - 适配 AI-Native 双主题系统（brand-* 语义阶、shadow-* 主题 token），保证胶囊在对话/进度视图下都不遮挡输入区与关键操作。
acceptance:
  - 用户点击最小化按钮后，弹窗从卡片列表移除并收缩为右下角胶囊；原列表区域不再占用空间。
  - 点击胶囊可还原到原位置，已填写的选项/文本保留，能正常提交回答或审批。
  - 多个卡片同时最小化时，胶囊显示未决数量与最后一条 request 的标题摘要。
  - permission_resolved 到达后，无论卡片处于展开还是最小化状态，都能正确移除。
verify:
  - cd frontend && pnpm exec vitest run src/components/permissions/session-permission-panel.test.tsx src/components/permissions/__tests__/session-permission-minimize.test.tsx src/components/ask-user-dialog-card.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅改前端展示层，不改动 permission_request / session_dialog_request 数据模型。
  - 不改动 respondSessionPermission 调用契约与后端交互逻辑。
  - 默认展开态与现有行为完全一致，最小化是新增能力。
  - 30 分钟超时回退、标题闪烁提示等增强不在本次范围（见 design.md 风险 R-04）。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
