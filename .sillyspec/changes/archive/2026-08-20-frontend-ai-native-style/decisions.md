---
author: qinyi
created_at: 2026-08-20T09:45:00
---

# decisions.md — 2026-08-20-frontend-ai-native-style 决策台账

> 只记录有实现/验收影响的决策。长期术语在 archive/scan 时提升到 glossary.md。

## D-101@v1: 主题切换机制
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 蓝↔AI紫主题切换用什么机制实现?
- answer: 方案A——themes.ts 主题注册表两套 palette + zustand store（localStorage 持久化），切换时同步改 `<html data-theme>`（驱动 globals.css 双套 CSS 变量→Tailwind 语义类）与 React state（驱动 antd ConfigProvider token）
- normalized_requirement: 不用 antd cssVar 纯 CSS 方案（覆盖度坑多 + TS 常量直引处覆盖不到）；antd token 必须从 themes[当前主题] 取，禁止散落 hex；CSS 变量双套块必须从同一注册表派生
- impacts: [P0 地基, §7 接口定义, R-02/R-03]
- evidence: step4 三方案对比后用户选"方案A（推荐）"

## D-102@v1: 默认主题与持久化键
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 默认主题用哪套?偏好怎么记?
- answer: 默认 ai-native（新 AI 紫）；旧 blue 保留可切换；localStorage key=`sillyhub-theme`；layout inline script 首帧前读取防 SSR 闪烁；非法值兜底 ai-native
- normalized_requirement: 新用户/未设偏好一律 ai-native；blue 取值为现版原样平移（观感与 2026-06 系统一致；例外见 D-003@v2：info 徽标色统一青）
- impacts: [P0, §9 兼容策略, R-03]
- evidence: step3 澄清用户选"蓝↔AI紫配色切换"+"本变更就做可切换主题"（选项文案含"新 AI 紫为默认"）

## D-003@v2: 蓝色清扫原则（brand 语义色阶）
- type: convention
- status: accepted
- supersedes: D-003@v1
- source: design-grill
- priority: P1
- question: v1 的"品牌蓝→primary 语义类或 violet 阶"在浅档（bg-blue-50×43 等 100+ 处）无法兑现 blue 主题"原样平移"——tailwind 现有 blue 阶是静态 hex，primary 语义类无色阶，静态 violet 阶则 blue 主题残留紫色。如何让品牌用途浅档主题感知?
- answer: 新增 brand 语义色阶：globals.css 定义 `--color-brand-50..950` 双套取值（:root=ai-native violet 阶 / [data-theme="blue"]=现有 blue 阶原值），tailwind 映射 `brand.*` 走 CSS 变量；清扫时品牌用途（含全部浅档）blue-* 类 → brand-* 类。真信息蓝（信息提示语义）保留 blue 阶。info 徽标色两主题统一 accent 青（§9 例外声明，blue 主题"进行中"状态点为青非蓝）。
- normalized_requirement: 品牌用途类名清一色 brand-*（主题感知）；grep 验收 `bg-blue|text-blue|border-blue` 仅剩信息语义场景且逐一判断；antd 组件 token 的 blue 阶引用改 themes[theme].color.brand 阶字段；blue 阶基础调色板保留不删
- impacts: [P0 brand 阶定义, P2 清扫, §9 例外声明, R-01, FRONTEND_PAGE_STYLE §7 文档同步]
- evidence: Grill X1/X3（子代理实测浅档分布 100+ 处 + info 冲突）；用户设计②段已确认"info 档从蓝改青"

## D-003@v1: 蓝色清扫原则（已被 @v2 取代）
- type: convention
- status: superseded
- supersedes_by: D-003@v2
- source: architect
- priority: P1
- question: ~180 处 blue-* 类与 hex 如何处置?
- answer: 品牌蓝→primary 语义类或 violet 阶；信息蓝保留；info 档统一 accent 青；blue 阶保留
- normalized_requirement: （见 @v2，v1 缺浅档主题感知机制）
- impacts: [P2 清扫]
- evidence: step2 grep 实证分布 + 设计确认

## D-004@v1: 会话页 AI 细节边界
- type: boundary
- status: accepted
- source: architect
- priority: P2
- question: 流式光标/typing 指示/上下文卡片能否实现?
- answer: 仅表现层：turn-timeline 等渲染组件加样式（caret blink CSS、typing 三点动画、ctx chip），不动 SSE 数据流/协议/状态机；全部动效 respect prefers-reduced-motion
- normalized_requirement: 不改 session/agent_run 的任何事件与字段；样式在 globals.css utility + 组件 className 实现
- impacts: [P3, §7.5 生命周期豁免, R-04]
- evidence: 评审模板第 05 节 + 用户确认设计
