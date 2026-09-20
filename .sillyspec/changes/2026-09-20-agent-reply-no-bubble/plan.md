---
author: qinyi
created_at: 2026-09-20 17:52:30
plan_level: light
---

# 轻量计划（Light Plan）：agent 回复去气泡（用户气泡保留）

## 来源

brainstorm 已收敛（design.md §总体方案，方案 B 容器语义重构 D-005@v1）：会话时间线 agent 回复文本（v2 段模型 + 旧数据回退双路径）去掉卡片气泡，换无框正文容器 `.seg-text-body`（max-width: min(100%,48rem)）；用户气泡（含引导消息三态气泡）完全不动；mobile 字号/行高规则随类名迁移（不带 max-width 覆盖）；删子代理透明化冗余补丁。

## 范围

- frontend/src/components/daemon/turn-segment-views.tsx（task-01）
- frontend/src/components/daemon/turn-timeline.tsx（task-02）
- frontend/src/app/globals.css（task-03）
- frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx（task-03）
- frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx（task-03）

## 验收

- AC-01: agent 文本段（v2 TextSegmentView + 旧路径答复）容器为 `.seg-text-body`，无 border/底色/阴影/气泡内边距类，max-width min(100%,48rem)（旧路径内容自适应宽度、行尾时间戳仍尾随内容边缘）
- AC-02: 用户气泡 `.turn-bubble` 类名与样式不变；全仓 grep 无残留气泡语义引用 `.seg-text-bubble`
- AC-03: mobile 变体 `.seg-text-body` 应用 font-size 14px / line-height 24px，规则不含 max-width 覆盖
- AC-04: 相邻面测试全绿（turn-segment-views.test / session-panel-dialog.test / sessions page.test，仅跑相关测试，遵守仓库规则 0 禁全量）
- AC-05: 不改后端/API/schema/类名契约之外的前端行为（CopyButton、流式光标 `.seg-caret`、AskUser 卡、文件卡等挂载与行为不变）

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 覆盖 FR | 验收证据 |
|---|---|---|---|
| D-001@v1 | task-01, task-02 | FR-01, FR-03 | AC-01, AC-02 |
| D-002@v1 | task-02 | FR-01 | AC-01 |
| D-003@v1 | task-03 | FR-02 | AC-03 |
| D-004@v1 | task-01 | FR-01 | AC-01 |
| D-005@v1 | task-01, task-02, task-03 | FR-01, FR-02 | AC-01, AC-02, AC-03 |
