---
author: sillyspec-fr-index
created_at: 2026-09-20T10:15:03.599Z
---

# FR 索引 — styles

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/styles.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-styles-001 agent 回复文本无框化（双路径一致）
变更：2026-09-20-agent-reply-no-bubble
状态：active
摘要：v2 段模型文本段（主路径）；旧数据回退路径；连续多文本段
依据决策：D-001@v1、D-002@v1、D-004@v1、D-005@v1
场景正文：
- 场景：v2 段模型文本段（主路径） — Given 会话时间线渲染含 text 段的 turn（segments 非 undefined）；When TextSegmentView 渲染文本段；Then 容器为 `.seg-text-body`：无 border/底色/阴影/气泡内边距，铺在时间线背景上，max-width 为 min(100%, 48rem)；
- 场景：旧数据回退路径 — Given 孤儿 turn / 旧会话数据（segments undefined）且有 output 答复；When 旧路径渲染答复；Then 容器同为 `.seg-text-body` 无框样式，内容自适应宽度（不取 w-full），行尾时间戳仍尾随内容边缘；与 v2 路径视觉形态一致
- 场景：连续多文本段 — Given 一轮内多个 text 段（可能直接相邻）；When 渲染为多个 `.seg-text-body`；Then 段间由既有 space-y 间距分隔，可辨识边界；不新增分隔线/背景块装饰
全文：.sillyspec/changes/archive/2026-09-20-agent-reply-no-bubble/requirements.md#FR-01
最近确认：fbbf02f4b

## FR-styles-002 mobile 可读性规则随类名迁移
变更：2026-09-20-agent-reply-no-bubble
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 会话时间线以 mobile 变体渲染（data-variant="mobile"）；When agent 文本段显示；Then `.seg-text-body` 应用 font-size 14px / line-height 24px；规则不携带 max-width 覆盖（阅读限宽由 m
全文：.sillyspec/changes/archive/2026-09-20-agent-reply-no-bubble/requirements.md#FR-02
最近确认：fbbf02f4b

## FR-styles-003 用户侧气泡完全不变
变更：2026-09-20-agent-reply-no-bubble
状态：active
摘要：用户消息气泡；轮内引导消息三态气泡
依据决策：D-001@v1
场景正文：
- 场景：用户消息气泡 — Given 会话时间线渲染用户消息（turn.prompt）；When 用户气泡渲染；Then 类名 `.turn-bubble` 与品牌色右对齐气泡样式与改前一致
- 场景：轮内引导消息三态气泡 — Given 轮内 steering 引导注入的 user_msg 段（steering/delivered/ended 三态）；When 引导消息渲染；Then 三态气泡样式与类名与改前一致（不因本变更变化）
全文：.sillyspec/changes/archive/2026-09-20-agent-reply-no-bubble/requirements.md#FR-03
最近确认：fbbf02f4b
