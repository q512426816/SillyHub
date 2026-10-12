# 视觉证据 — 2026-10-12-session-defects

## 说明：本变更无 UI 渲染面

本变更交付面为平台后端（backend FastAPI）+ daemon（Node）+ 前端逻辑层，无新页面/组件布局改动：

- 前端仅两类改动：`api-types.ts`（OpenAPI 生成物）、`normalize.ts` 类型联合扩展、`run-error-item.tsx` MODEL_ERROR_META 增 `context_overflow` 条目（错误卡文案/配色键，复用既有 RunErrorItem 渲染路径，无布局变化）。
- 错误卡渲染断言由 `frontend/src/components/agent-log/__tests__/run-error-item.test.tsx` 表驱动用例覆盖（`context_overflow → 上下文超限 · indigo`，48 用例绿），视觉面以组件测试代证。
- 生产实证形态（Prompt is too long 失败卡）的端到端视觉验证需真实上下文超窗会话，属上线后观察项，不在本变更验收面。
