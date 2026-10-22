---
author: flow-machine-draft
created_at: 2026-10-22T15:08:49.335Z
---
# 设计记录（Design Record）— 2026-10-22-session-composer-slim

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三处展示层降噪，发送协议与后端零改动：

1. **引用纯文本化**：在 `lib/attachment-refs.ts` 新增纯函数 `formatRefsForPlainText()`——先剥离 `[附件:uuid|kind|name]` 标记行（复用 `parseAttachmentMarkers`），再把 `[附件引用:uuid|name]`、`[文件引用:…]`、`[目录引用:…]`、`[代码引用:…|Lx-Ly]` 替换为「📎 文件名」「📄/📁 名称」「🧾 名称:起-止」。消费点：`MessageQueueBar` 的折叠摘要与展开正文、`ScheduledMessagesBar` 摘要、用户气泡的复制文本（`CopyButton.getText`）。气泡内的可点击标签（`InlineAttRefText`）不动。
2. **续跑入口迁移**：`SessionConfigBar` 删除 `autoResume` 渲染块与 running 提示行，并移除该 prop；`SessionInputBar` 新增可选 `autoResume` prop，在 + 菜单追加带状态勾选的「中断自动续跑」项，点击调用既有 `handleAutoResumeToggle`。父层 `session-panel-page.tsx` 把原传给配置条的对象改传输入区；dialog/预会话不传即不渲染。
3. **额度图标化**：`QuotaPill` 桌面与移动端统一改为紧凑图标按钮（`Gauge` 图标 + 当前会话供应商首窗口百分比，D-001；当前会话供应商不可查/无百分比时回退排序第一家），百分比按既有 `quotaLeftToneClass` 阈值着色；完整明细继续走既有 `Popover`（供应商/模型/各窗口/重置时间）。数据查询、keep-last-good、5 分钟轮询、悬浮 2 秒刷新全部保留。

UI 证据：本仓前端为真码 React 管线，改动直接用项目现有 Vitest + 真实页面渲染核验；对照结论记录在 `visual-evidence.md`。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `formatRefsForPlainText(text: string): string`（`frontend/src/lib/attachment-refs.ts`，纯函数，无副作用）。
- `SessionConfigBarProps.autoResume` **移除**（唯一调用方 `session-panel-page.tsx` 同步删除传参）。
- `SessionInputBarProps` 新增：
  ```ts
  autoResume?: {
    enabled: boolean;
    disabled?: boolean;
    onToggle: (next: boolean) => void | Promise<void>;
  };
  ```
- `QuotaPillProps` 签名不变；渲染形态变化仅影响 `data-testid="quota-pill"` 的文本内容（保留 testid）。
- 后端 API、daemon 协议、`api-types.ts`、`openapi.json`：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。引用格式化是渲染期纯函数，输入文本乱序/残缺只会回退为原文（解析不等长片段归 text 段），不丢字、不抛错。续跑开关状态以父层会话配置为准，点击→PATCH→invalidate 的既有链路已处理响应乱序（失败 notify、成功刷新）；额度取最低值只依赖当前已收敛的 entries 快照。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无新增共享写面。本次只改前端渲染与组件 prop；续跑切换沿用既有 PATCH，后端为单字段写入。额度查询维持 in-flight 防重入 + keep-last-good，多标签页各自独立轮询，无数据回写。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。切换会话时组件随父层重挂载，本地 `entries` 重置；异步回调有 cancelled 标记。+ 菜单内切换续跑若组件卸载，请求仍由父层处理，不产生本地悬挂状态。`formatRefsForPlainText` 无状态。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。额度数据按供应商 id 聚合、仅本机供应商列表；续跑状态按 sessionId 走既有接口；引用格式化只作用于传入的那条消息文本。无跨工作区/跨仓数据流。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：额度图标信息量骤减后用户难以判断是哪家供应商。缓解：图标保留 `title` 简述（供应商 · 首窗口 · 重置时间），点击浮层为权威明细；百分比颜色保留低量告警。
- 测试面风险：`ctx-usage-bar.test.tsx` 大量断言旧胶囊文本，需成组更新为新形态断言，避免只改实现不改测试造成假绿。
- 放弃方案：① 直接在发送协议里去掉 uuid（会破坏历史引用预览与同名附件区分，且影响 daemon 消费，风险高于收益，用户已确认只改展示层）；② 保留配置条开关仅在 mobile 收起（用户明确要求去掉常驻按钮，入口统一到 + 菜单）；③ 图标显示全部供应商最低剩余百分比（用户 D-001 选择当前会话供应商首窗口，更贴近正在使用的额度）。
- 运行中提示行一并移除：各控件 title 已带「运行中切换将于本轮结束后生效」说明，减少行宽占用；该信息不丢失。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/lib/attachment-refs.ts | 新增 `formatRefsForPlainText` 纯函数；迁入 `parseAttachmentMarkers` |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | `parseAttachmentMarkers` 改为从 lib re-export，导出面不变 |
| 修改 | frontend/src/components/daemon/message-queue-bar.tsx | 摘要/展开正文剥离标记行并简化引用 |
| 修改 | frontend/src/components/daemon/scheduled-messages-bar.tsx | 定时消息摘要简化引用 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 复制文本使用简化后的正文 |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 移除续跑开关、运行提示与 autoResume prop |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | + 菜单新增中断自动续跑项 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 续跑状态改传输入区 |
| 修改 | frontend/src/components/sessions/ctx-usage-bar.tsx | 额度胶囊改紧凑动态图标 |
| 修改 | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx | 更新/新增引用简化断言 |
| 修改 | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | 新增格式化纯函数用例 |
| 修改 | frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx | 新增续跑菜单项用例 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 更新移除开关断言 |
| 修改 | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | 更新额度图标断言 |
| 修改 | frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | 并发下等待窗口稳定化（固定 50ms → waitFor 轮询，语义不变） |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | 50 页跳转用例等待窗口放宽（全量并发下的时序抖动，语义不变） |
| 新增 | .sillyspec/changes/2026-10-22-session-composer-slim/visual-evidence.md | UI 对照证据记录 |
