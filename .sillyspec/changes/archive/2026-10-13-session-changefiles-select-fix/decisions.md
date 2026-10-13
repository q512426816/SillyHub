---
author: flow-machine-draft
created_at: 2026-10-13T07:37:48.595Z
---
# 决策记录（Decisions）— 2026-10-13-session-changefiles-select-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：`closest('[role="dialog"]')` 依赖 radix DialogContent 的 `role="dialog"` 语义稳定——若未来 shadcn Dialog 实现变更（role 改名/自定义 DialogContent 包裹层），兜底回落 body 会静默退回旧 bug。缓解：既有 vitest 用例已加「下拉 DOM 必须在 `[role="dialog"]` 内」守护断言（`selectAntdOption` 内），实现变更会测试转红而非静默。试过但放弃的方案：①改用 shadcn `ui/dropdown-menu`（radix Dropdown）替代 antd Select——违背 FRONTEND_PAGE_STYLE「控件类继续 antd」且交互重写面大；②radix Dialog 改 `modal={false}`——牺牲遮罩/焦点管理语义，影响面远超本 bug；③把下拉挂到 Select 的 `parentElement`（DialogHeader）——头部容器层级/裁剪风险高于 `closest(role=dialog)`（DialogContent 是 radix 明确标记的可交互子树）。
