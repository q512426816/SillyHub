---
author: flow-machine-draft
created_at: 2026-10-27T00:43:43.805Z
---
# 设计记录（Design Record）— 2026-10-27-scheduled-send-attachments

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：缺口纯在前端。后端定时消息全链路已支持附件——`ScheduledMessageCreateRequest.attachment_ids`（backend schema.py:628）、`create_scheduled_message` 落库 str 列表快照（scheduled_messages.py:154）、到点 sweeper 派发转回 uuid 走 inject 附件管线（scheduled_send.py:133-135, :195）。前端 dialog/page 两模式 `confirmSchedCreate` 只组装 prompt+dispatch_at（session-panel-dialog.tsx:350、session-panel-page.tsx:1039），附件被静默丢弃；且创建成功只清文本不清附件 chips，残留误导。

修复三文件：①dialog/page 两处 `confirmSchedCreate` 组装 `pendingAttachments` 的 id 列表进请求体，成功后按 `onSendSettled` 同款口径清附件（按 id 精确过滤 + clearAttachmentsRef + meta 镜像删除）；②`ScheduledSendModal` 新增可选 `attachments` prop 展示预览并放宽空态判定。选此方案因改动面最小（3 文件）且与忙轮排队发送（sendToServerQueue 带 attachment_ids）口径逐字对齐，后端零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `ScheduledSendModal`（scheduled-send.tsx）：props 新增可选 `attachments?: Array<{ id: string; kind: string; name: string }>`——不传或空数组时行为与现状逐字节一致（预览区不渲染、空态判定不变），既有调用与测试零回归。
- `confirmSchedCreate`（session-panel-dialog.tsx / session-panel-page.tsx，组件内部函数非导出）：门控从「rawPrompt 非空」放宽为「rawPrompt 非空或有附件」；`createScheduledMessage` 请求体新增 `attachment_ids` 字段（OpenAPI 生成类型 `ScheduledMessageCreateRequest.attachment_ids?: string[] | null` 已存在，无 gen:types 义务）；成功分支清理面扩大（附件 chips + meta 镜像）。
- 后端 HTTP 端点、DTO、daemon、api-types.ts：零变化。
- 空态提示文案微调：带附件空文本时不再显示「输入内容为空，无法创建」的 amber 提示（该提示仅在「空文本且无附件」时出现）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。定时创建是单次 POST 无流式竞态；`schedSubmitting` 在途时确认按钮 loading + 防重复（`confirmSchedCreate` 入口 `schedSubmitting` 早退），弹窗取消按钮在途禁用，不存在双击重复创建或「响应乱序覆盖新输入」窗口。SSE 事件与本链路无交互。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：`pendingAttachments` 为组件内 React state——创建成功清理与用户手动删 chip 同走 setState 函数式更新（`prev.filter`），React 批处理串行无丢更新；`attachmentMetaRef`（useRef Map）清理按本次携带 id 逐个 `delete`，不触碰其它待发附件条目；`clearAttachmentsRef` 调的是输入栏既有一键清空句柄，与 onSendSettled 同一消费点。无跨组件并发写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：创建失败（422 时间过近 / 409 会话终态 / 网络断）→ 弹窗保持打开、文本与附件原地保留（既有 catch 分支不动，只新增请求字段不影响失败语义）；成功 → 弹窗关 + 草稿清 + 附件清，与普通发送 onSendSettled 收敛口径一致；会话被并发 end 时后端 409 `DaemonScheduledMessageSessionInactive` 前置拒绝，附件仍挂输入框可另行处理，无半态。定时窗口内附件失效（被删/会话删除）由后端到点派发校验兜底（failed(inject_failed) 留档可见），不新增风险面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会。前端只透传本会话输入框 `pendingAttachments` 的 id（附件上传时已绑定上传者 user_id），归属校验由后端到点 inject 管线执行（user_id 归属 + 引擎门控 + 图 5/文 5 上限）；不复制附件数据、不跨会话引用；page/dialog 两模式各自持独立 state 无串台；本仓单仓改动，无跨仓面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：**附件 chips 残留或误清的观感回归**——清理时机若用全清（clear）会误伤用户在创建窗口期新上传的附件。缓解：按本次携带 id 精确过滤（onSendSettled 同款 `prev.filter`），meta 镜像逐 id delete；新增测试断言「部分删除后只清剩余」。
- 次要风险：空文本+附件定时属行为放宽，用户可能误建无上下文的定时消息——后端既有附件豁免口径（D-7 看图说话）已覆盖该形态的合法性，与普通发送/忙轮排队一致，不额外设限。
- 试过放弃的方案：①定时弹窗内做独立附件上传入口——上传管线与 UI 重复建设，且与既有交互叙事冲突（弹窗说明「请先在输入框写好要发送的内容」，入口语义是「把输入框现有内容定时发出去」），放弃；②只修 page 模式——dialog 模式同缺口，双模式必须同修否则口径分裂（两处 confirmSchedCreate 历史上就是成对复制维护）。
