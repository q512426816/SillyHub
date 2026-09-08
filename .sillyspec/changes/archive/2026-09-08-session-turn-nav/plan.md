---
author: WhaleFall
created_at: 2026-09-08 13:52:41
plan_level: light
---

# 轻量计划（Light Plan）：/sessions 会话轮次刻度轨导航

## 来源

- brainstorm 定稿：design.md（十四节，D-001~D-007）、requirements.md（FR-01~08）、decisions.md；观感基准 prototype-session-turn-nav.html（v3 刻度轨，用户已确认）
- 用户原始需求：智能体会话页高轮次无法快速回顾历史；参考 ZCode 左缘刻度轨（每轮一条细横杠，hover 飞出信息卡，点击跳转定位）

## 范围

| 文件 | 任务 | 类型 |
|---|---|---|
| frontend/src/components/daemon/turn-timeline.tsx | task-01 | 修改 |
| NEW:frontend/src/components/sessions/turn-catalog.tsx | task-02 | 新增 |
| NEW:frontend/src/components/sessions/__tests__/turn-catalog.test.tsx | task-02 | 新增 |
| frontend/src/components/daemon/session-panel/session-panel-page.tsx | task-03~06 | 修改 |
| frontend/src/components/daemon/session-panel/page-helpers.tsx | task-04 | 修改（如需） |
| frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | task-05 | 修改（有意更新 desktop 父链断言） |

模块：frontend_components（主）+ frontend_app（页面接线约束）；零后端改动（D-004）。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03

## Wave 4（依赖前序 Wave）
- task-04

## Wave 5（依赖前序 Wave）
- task-05

## Wave 6（依赖前序 Wave）
- task-06

## 验收

- AC-01 桌面 /sessions 真会话聊天区左缘出现 ~30px 刻度轨，每轮一条 2px 刻度、垂直居中；失败红/运行中琥珀脉冲/未加载空心（FR-01）
- AC-02 hover 或键盘 focus 刻度飞出深色信息卡（轮号+提问+正文摘要+meta），位置随刻度钳制；触屏不挂飞出卡（FR-02）
- AC-03 目录覆盖全部历史轮次：未加载轮次由 runsMeta 补全为空心刻度；runsMeta 不可用降级为仅已加载（FR-03）
- AC-04 点击已加载刻度平滑滚动+目标轮高亮 ~2.2s；点击未加载刻度自动连续加载（≤8 页）后定位回填；跳转期抑制触顶自动加载（FR-04）
- AC-05 聊天滚动时当前轮刻度常亮（FR-05）
- AC-06 mobile ⋯ 菜单「轮次导航」抽屉可用（行式列表，点击即跳、跳后自动关）；悬浮窗零改动生效；dialog 不挂载（FR-06）
- AC-07 TurnRow 带 data-turn-key、aria 完整；三宿主既有行为不回归（desktop 父链断言有意更新为新层级）（FR-07、非功能约束）
- AC-08 turn-catalog 单测 + session-panel 集成用例通过；相关测试子集全绿、tsc 0 错误（§11）
- AC-09 实现观感对照 prototype v3 逐条核验（FR-08 原型一致性：间距/字号/圆角/主题 token，允许 design §9 声明的 D-005 差异）

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-06 | AC-01, AC-06 |
| D-002@v1 | task-03, task-04 | AC-03, AC-04 |
| D-003@v2 | task-02 | AC-02（信息承载移入飞出卡） |
| D-004@v1 | task-03 | AC-03（零后端，复用 runsMeta） |
| D-005@v1 | task-02, task-04 | AC-02, AC-04（未加载元数据+回填） |
| D-006@v1 | task-05 | AC-06（悬浮窗 desktop variant 零改动复用） |
| D-007@v1 | task-02, task-05 | AC-01, AC-02（刻度轨+飞出卡定稿形态） |
