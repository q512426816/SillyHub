# 视觉证据（visual-evidence）— 2026-10-14-change-center-lineage-tag-and-filter

本次 UI 改动为既有页面的小幅增量（列表行徽章 + 筛选维度），未新建页面、未动布局结构，故未走定稿原型管线（须知 1 的手绘/原型要求针对新页面级设计）；以下记录视觉决策与依据。

## 决策记录

1. **桌面列表行出身标签成对**（`changes/page.tsx` renderChangeRow）：
   - 「轻量」= primer StateLabel `attention`（琥珀底 + zap 闪电），沿用 2026-09-27-change-list-is-thin 既有视觉，零改动；
   - 「完整」= primer StateLabel `neutral`（中性灰 soft 底），新增——完整流程是常态出身，中性降噪；轻量是特殊出身，琥珀强调。两类配色经语义 token（`semantic-warning-soft` / `semantic-neutral-soft`），零硬编码 hex，AI-Native 双主题换肤自动跟随（FRONTEND_PAGE_STYLE §0.5 铁律）。
2. **桌面分类下拉**：antd Select，`w-32` 与阶段下拉（`w-36`）并排一行，样式与既有工具条一致；`aria-label="筛选分类"`（对齐 workspace 页 `aria-label="筛选状态"` 先例），阶段下拉顺手补 `aria-label="筛选阶段"`。
3. **移动卡片出身徽标**：StatusBadge `warning`（antd Badge 黄点+「轻量」）/ `neutral`（灰点+「完整」），与桌面琥珀/中性语义一一对应；放徽标行阶段徽标之后、待办之前，flex-wrap 自动换行不挤爆卡宽。
4. **移动抽屉分类 chips**：与阶段/排序 chips 同款形态（圆角胶囊 + `aria-pressed` + testid `m-changes-lineage-chip-*`），插在阶段与排序之间（与桌面「阶段 → 分类」顺序一致）。

## 降级

无降级。无用户裁决事项。
