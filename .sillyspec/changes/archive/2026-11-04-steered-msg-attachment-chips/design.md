---
author: flow-machine-draft
created_at: 2026-11-04T06:22:01.389Z
---
# 设计记录（Design Record）— 2026-11-04-steered-msg-attachment-chips

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

缺陷点在渲染层：`UserMsgSegmentView`（`frontend/src/components/daemon/turn-segment-views.tsx`）只取
`parseAttachmentMarkers(segment.text).text`，把同一次解析得到的 `attachments` 丢弃，导致引导消息
（mid-turn steer）气泡上不出现附件卡片。上游数据链路已完整：后端 inject 在 user_input 留痕头部写
`[附件:<uuid>|<kind>|<name>]`（`backend/app/modules/daemon/session/service/inject.py` 附件标记段），
前端引导发送在展示文本里拼同样的标记行并上送 `attachment_ids`
（`session-panel-dialog.tsx` 的 submitFollowup / sendToServerQueue），历史回放装配保留 marker 版本
（`runtime-session-helpers.tsx` 的 `withMarker` 优先）。

做法：在 `UserMsgSegmentView` 内保留完整解析产物，按 phase 选择 chips 色调后渲染既有
`AttachmentChips`（图片缩略图 / 文件 chip / 点击预览全部复用，不新造组件）；正文容器只在
`text` 非空时渲染，纯附件引导消息呈现「chips + 状态行」。`AttachmentChips` 的 `tone` 只有
`onPrimary`（实色主气泡）与 `brand`（浅底）两档：delivered 用 onPrimary，steering / ended 用 brand。
三态共用同一份标记解析结果，不复制解析逻辑。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `UserMsgSegmentView` props 不变（仍只接 `segment: UserMsgSegment`）；纯内部渲染变化。
- 不改后端 schema、不改 RPC/HTTP 接口、不改消息文本协议（`[附件:id|kind|name]` 格式不变）。
- 无新增依赖；复用 `AttachmentChips`、`InlineAttRefTextWithPreview`。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

实时 append（steering）、SSE 留痕转 delivered、历史回放三路段的 text 均由同一
`joinAttachmentMarkers` 语义构造，均带 marker；即便旧数据段无 marker，解析返回空 attachments，
渲染退回纯文本，行为与当前一致（零回归）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

`UserMsgSegmentView` 是纯展示组件，无共享写；解析为纯函数；`AttachmentChips` 的 objectURL
生命周期沿用其内部 effect（按 att.id 依赖，卸载即 revoke）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

phase 三态切换只改变 chassis 样式与 chips tone，附件 id 不变、预览仍按 id 拉取；会话切换 /
段卸载时 chips 子组件自清理，无悬挂状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

附件 id 为全局 uuid，内容接口按 id + 归属校验（backend 既有），跨会话/跨工作区不串台；
前端不缓存跨会话附件数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：delivered 实色 primary 气泡上 chips 若用错 tone 会不可见（白底白字）——按 `AttachmentChips`
  既有 trade-off 用 `onPrimary`；ended 灰底用 `brand`，三主题下 meta 语义阶随主题换肤，对比度可接受。
- 风险：纯附件引导消息不渲染正文容器后，若未来出现「无附件、无正文」的空段，气泡会只剩状态行——
  该情形本来也无法由发送链路产生（inject 空 prompt 且无附件会被拒），不额外兜底。
- 放弃方案：后端把 attachments 结构化进 user_input 日志 metadata 或新 SSE 字段——需改 schema、双端
  openapi 类型重生成与历史数据兼容，而现有 marker 文本协议已承载全部信息，收益不抵成本。
