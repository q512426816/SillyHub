---
author: WhaleFall
created_at: 2026-07-16T09:35:00
---

# 提案书（Proposal）— 计划节点模板子表样式优化

> 变更 `2026-07-16-plan-node-subtable-style` · scale: small · 方案 A · 原型 `prototype-plan-node-subtable.html`

## 动机

`/ppm/plan-nodes`（计划节点模板）页展开行内的明细/模块子表宽度太宽，把母表横向滚动条撑得很长，子表本身不滚动，明细列空旷不美观。用户反馈要求：子表有自己的 X 轴滚动条 + 列变窄。

## 根因

母表与子表都用 AntD `scroll.x: "max-content"`。子表内容宽度（明细 7 列约 920px）通过展开行传导给母表的内容宽度测量（双重传导），母表被撑到 1000px+，子表反而不滚动。

## 目标

- 子表有独立 X 轴滚动条，滚动行为与母表隔离；
- 明细列宽整体压缩，紧凑美观；
- 仅改 plan-nodes 本地，对其他页面零回归。

## 不在范围内（Non-Goals）

- 不改 `PpmSubTable` 通用组件（避免影响 `milestone-details`、`ppm-project-plan-detail`）；
- 不改母表列结构 / 母表 scroll 配置；
- 不改后端接口、数据模型、DB；
- 不引入子表竖向滚动 / 最大高度（本次仅解决横向溢出）；
- 不顺手优化其他 ppm 页面。

## 方案（方案 A）

1. 明细/模块子表各套一层限宽 `calc(100vw - 340px)` + `overflowX: auto` 滚动容器，切断 max-content 传导；
2. `DETAIL_COLUMNS` 7 列列宽压缩（920 → 790px）；
3. 不动 `PpmSubTable` 通用组件 / 母表列结构 / 后端。

## 影响范围

仅 `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx` 单文件。零回归（`milestone-details`、`ppm-project-plan-detail` 不受影响）。

## 风险

见 `design.md` §10：R-01 容器偏移值需实测；R-02 两类子表 max-content 隔离需实测，有退化方案（固定 `scroll.x`）。
