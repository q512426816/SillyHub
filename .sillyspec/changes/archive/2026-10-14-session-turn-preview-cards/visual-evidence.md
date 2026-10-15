---
author: WhaleFall
created_at: 2026-10-14 13:40:12
---

# UI 视觉证据（visual-evidence）— 2026-10-14-session-turn-preview-cards

## 渲染对照证据

| 项 | 证据 |
|---|---|
| 实测环境 | worktree dev server（`pnpm dev --port 3100`，分支 sillyspec/2026-10-14-session-turn-preview-cards，提交 0a3e7371b）+ 真实长会话 f231ca18（35 轮） |
| 截图 1（消息流顶部，第 1 轮展开态 + 左侧窄轨刻度） | `C:\Users\12532\.zcode\cli\artifacts\sess_84536fe0-1a91-4c99-ba63-ada7da29ffa2\call_c4f87db57740470a8adfc77d-tool-result-cffa1257-7fc2-46e6-b195-a4bae7cf02b8.png` |
| 截图 2（第 14 轮附近完整内容 + 刻度轨全量渲染） | `C:\Users\12532\.zcode\cli\artifacts\sess_84536fe0-1a91-4c99-ba63-ada7da29ffa2\call_019733a13c854e8b84308cd4-tool-result-88ee1f01-1030-4886-8e45-22566ef54988.png` |
| 原型对照基准 | `prototype-turn-preview-cards.html`（brainstorm 期用户已确认） |
| DOM 断言（jsdom + 真页面双面） | 真页面：35 轮 = 23 张 `data-testid="turn-preview-card"` + 12 行已加载内容；卡文本=轮号/「未加载 · 点击展开」/时间/提问摘要；点击后 22 卡 + 目标轮完整块 + 无双块 |

## 布局与主题核对

- 预览卡虚线边框 + brand-50 浅底与已加载实心气泡区分明确（截图与 DOM class 双证：`border-dashed border-brand-300/70 bg-brand-50`）；品牌色全走 `brand-*` 语义阶随 `html data-theme` 换肤，零硬编码色值。
- 左侧 TurnNavList 窄轨刻度 35 枚全量渲染（含失败轮 destructive 色点），消息流/导航/输入区布局无挤压错位（两张截图面板结构完整）。

## 降级声明裁决

design.md/requirements.md 中「大纲缺失降级为现状形态」（FR-04）是**功能容错路径**（接口失败时回到变更前形态），非视觉静默降级——不涉及视觉质量的削减。该路径由 jsdom 集成用例（`frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx` FR-04 用例）锁定；真浏览器不便模拟接口故障，以测试证据承接。

**用户裁决**：FR-04 降级形态「回到变更前现状」即探索期用户已知悉并确认的现状基线（brainstorm 期方案展示与原型确认环节明示「大纲缺失降级为现状形态，不报错不空白」，用户选定方案 A 时该边界随设计整体确认）；本变更不引入任何视觉质量的静默削减。
