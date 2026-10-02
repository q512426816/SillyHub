---
author: qinyi
created_at: 2026-10-03 00:40:00
---

# UI 视觉证据（降级留痕）

> 变更 2026-10-02-change-center-token-usage · 探针 12 分级门

## 降级裁决

**组件级变化，无渲染对照截图**（未起前端 dev server 实机截图），以设计原型 + 组件测试断言替代：

1. **原型基准**：`prototype-change-center-token-usage.html`（brainstorm 阶段产出）场景一/二——「本地 CLI」绿阶 tag 行（`border-emerald-200 bg-emerald-50 text-emerald-700`）、请求列「—」、注脚口径文案。
2. **实现对照**：`frontend/src/components/changes/detail/change-usage-card.tsx`（commit 2c7783d3）三分支桶 tag + 请求列特判 + USAGE_NOTE_TEXT 双 kind——与原型逐项对齐（绿阶色值一致、桶名双端约定值「本地 CLI」一致）。
3. **测试锚定**：`change-usage-card.test.tsx` 断言 `localTag.className` 含 `text-emerald-700`（绿阶样式锚定）、「—」渲染、纯本地空态不触发——类名级视觉回归由组件测试锁定。

## 结论

样式微调级（桶行 + 注脚文案），页面骨架零变化；类名断言 + 原型对照可核验，未做实机截图属可接受降级（用户部署后可在变更详情页用量卡折叠明细中直接目视验证，见 verify-result 移交项 manual-acceptance）。
