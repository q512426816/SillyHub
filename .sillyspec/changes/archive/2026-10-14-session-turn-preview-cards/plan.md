---
plan_level: light
execution_mode: main
---

# 轻量计划（Light Plan）：会话未加载轮消息流预览卡 + 跳转附近预取

## 来源

brainstorm 已确认结论（用户三步实选：方向=预览卡+附近预取、架构=方案 A 合并式、设计原型已确认）：

- design.md（2026-10-14-session-turn-preview-cards）——四 Phase 总体方案、文件变更清单、R-01~R-05 风险登记
- requirements.md——FR-01 预览卡 / FR-02 原地展开 / FR-03 附近预取 / FR-04 大纲缺失降级
- decisions.md——D-001~D-004 全 accepted
- 原型 prototype-turn-preview-cards.html（视觉与交互基准）

## 范围

全部位于 frontend 子项目 frontend_components 会话族（单模块、单隐式 Wave 串行执行）：

- NEW:frontend/src/components/daemon/session-panel/preview-merge.ts（归并纯函数）
- frontend/src/components/daemon/turn-timeline.tsx（预览分支 + TurnPreviewCard + 可选 props）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（displayTurns 接线 + handleExpandPreview + 附近预取）
- NEW:frontend/src/components/daemon/__tests__/preview-merge.test.ts、NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx（测试）
- 后端 / daemon / api-types 零改动（D-002，不触发 pnpm gen:types）

执行注意（承 design 风险登记）：R-03 同 run_id 键空间去重防双块；展开/预取完整复用 handleJumpToTurn 既有直达实现（含游标压低先例）防翻页重复；TurnTimeline 新 props 可选、旧消费方零回归门。

## 验收

- FR-01：打开 35 轮实测会话（f231ca18），消息流呈现全部轮次（已加载完整内容 + 未加载预览卡），预览卡零额外请求；
- FR-02：点预览卡原地替换为完整轮块（无双块同屏），2.2s ring 高亮自清，不触发滚动定位，再次点击不重复请求；
- FR-03：导航跳转第 N 轮后，前后各 1 个未加载轮自动补入（在飞/已加载/零正文三重判重），不阻塞目标轮、不打扰视口；
- FR-04：大纲缺失降级为现状形态，不报错不空白；
- 兼容：dialog 模式与 /runtimes 弹窗（不传新 props）渲染行为与现状等价；
- 新增单测/渲染测试绿 + 既有 session-panel jump / turn-nav-list / turn-catalog / turn-timeline 相关测试面复跑绿 + tsc 通过（规则 0 不跑全量）。

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03 | AC：FR-01/FR-03 验收条目（方向=预览卡+预取） |
| D-002@v1 | task-01~task-04 | AC：后端/daemon 零改动、不触发 gen:types |
| D-003@v1 | task-03 | AC：FR-02 展开后保持完整不缩回 |
| D-004@v1 | task-01 | AC：FR-01 单一列表源、加载后原位替换无双块 |
