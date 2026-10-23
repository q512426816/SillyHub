---
author: flow-machine-draft
created_at: 2026-10-23T02:51:38.964Z
---
# 设计记录（Design Record）— 2026-10-23-session-input-clear-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三类症状一个共同根因 + 一个产品语义修正：

1. **发送后不立即消失**：`onSendSettled`（session-panel-page.tsx）/ `performSend`（group-chat-panel.tsx）/ `handlePreSessionSend` 均为「HTTP 响应成功后才清输入」。改为**受理即清**：handleSend 守卫全部通过后同步 `setInput("")`，附件 chips 与 mentions 维持原时序（响应成功后清）——失败路径附件天然保留可重试，文本恢复走 catch 分支。
2. **发送在途/成功瞬间切换会话后草稿残留**：清空链路原为 `setInput("") → 写草稿 effect → writeSessionDraft`，组件因 key 切换卸载时 effect 不执行，localStorage 草稿键保留已发送文本（预会话 `__pre__:scope` 键残留 → 下次新建回读显示；真会话键残留 → 切回显示）。修复：发送受理点**直接同步调 `writeSessionDraft(sessionId, "", preDraftScope)`** 清键，不依赖组件存活；失败恢复时写回原文。
3. **「新建会话显示旧内容」**：①预会话草稿残留由上述 2 解决；②未发送草稿跨「重新新建」回读是刻意的草稿特性，但与「新建=全新开始」的用户预期冲突——改为**预会话挂载不回读草稿**（恒空白 + 顺带清残留键）；③重新进入同 scope 预会话（同 workspace+runtime）时 portal 的 key 值相同导致组件不重挂载、输入态残留——门户对预会话 key 追加**自增 nonce**（每次 enterPreSession/直带链置位 preContext 时 +1），强制重挂载。真会话草稿持久化（按 sessionId）不动，零回归。

选择「受理即清 + 失败恢复」而非「响应后清（现状）」：用户感知第一优先级是发送即时出框（ChatGPT/Claude 等同款交互惯例）；失败是小概率路径，恢复成本一行 `setInput((prev) => (prev === "" ? prompt : prev))`（不覆盖失败窗口期的新输入，与既有 inflight 打断回退 `handleInterrupt` 分支同款先例）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sendFromQueue(prompt, attachmentIds, rawPrompt?)` / `sendToServerQueue(prompt, attachmentIds, rawPrompt?)`（session-panel-page.tsx）：新增第三参 rawPrompt（用户所见原文，token 置换前），catch 失败恢复输入框与草稿键用；缺省回落 prompt（无 token 场景两者相等，旧调用兼容）。
- `handlePreSessionSend(prompt, attachmentIds, rawPrompt?)`：同上第三参，失败恢复用。
- SessionPanel 预会话挂载语义变更（内部行为，props 签名不变）：sessionId=null 时不再回读 localStorage 草稿，输入恒空白。
- sessions-portal.tsx 预会话挂载 key：`pre:<ws|'-'>:<runtimeId>` → `pre:<ws|'-'>:<runtimeId>:<nonce>`（仅 key 值，无对外契约）。
- 后端 API、组件 props、localStorage 键格式：零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

失败恢复 `setInput((prev) => (prev === "" ? raw : prev))` 仅在输入框为空时回填——迟到失败到达时用户已输入新内容则不覆盖（与既有 inflight 打断回退、定时发送清空同款防御）。成功响应迟到（用户已切走）时 onSendSettled 的 setState 落在已卸载组件上为 no-op，草稿键已在受理点同步清过，无残留。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

同会话连发两条——第一条受理即清后第二条守卫 `!rawPrompt && 无附件` 拦截空发；占位轮 currentRunId 同步置位（既有串行机制）保证第二条走排队/steering 路径，不变。localStorage 单标签页串行写，无并发冲突；多标签页写同一草稿键为 last-write-wins（原语义不变）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

发送在途切换会话/群——组件卸载，setState no-op（React 18 安全），草稿键已同步清（本修复核心）；失败恢复的 setState 落在已卸载组件同样 no-op，但 catch 仍执行 `writeSessionDraft(sessionId, raw, ...)` 写回草稿键（不依赖组件存活），用户切回原会话回读即恢复可重试，文本不丢。预会话发送成功瞬间 `onPreSessionCreated` 同批次切换真会话（组件卸载）——草稿键已在受理点清，不残留（本次根因路径）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

草稿键按 sessionId / `__pre__:<workspaceId|'-'>:<runtimeId>` 隔离，本变更只改写入时序与回读条件，不改键组装，跨工作区/跨机器不串台；预会话 key nonce 仅存在于当前门户组件树，刷新后 nonce 归零重挂载（预会话本就恒空白，无影响）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：立即清空后「失败窗口期」用户误以为发送成功。缓解：失败路径既有 errorMsg/notify 提示（不变），且文本自动恢复到输入框。可接受。
- 放弃方案 A「发送时输入框转禁用+spinner 等响应」：不解决切换会话后的草稿残留，且阻塞连续输入，体验更差。
- 放弃方案 B「卸载 cleanup 里清草稿」：卸载时无法区分「发送在途」与「用户主动切走（草稿应保留）」，语义不可判定，死路。
- 放弃方案 C「dialog 模式（session-panel-dialog.tsx）同步修」：用户报障场景为会话页面（page 模式）；dialog 无测试覆盖基础，本变更不扩面，遗留同构问题已知并记录。
- 预会话「不回读草稿」牺牲了「预会话写一半切走再回来继续」场景：与「新建=全新开始」预期冲突时取后者（用户报障明确）；真会话草稿不受影响。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | clearInputAccepted/restoreRejectedSend；handleSend 全路径受理即清；sendFromQueue/sendToServerQueue/handlePreSessionSend 加 rawPrompt 失败恢复；预会话挂载不回读草稿+清残留键 |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | preMountNonce + openPreSession 统一写入点（两处）；预会话挂载 key 追加 nonce |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | performSend 受理即清 draft + writeGroupDraft；catch 按空回填并写回草稿 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx | FR-01/02/03 新增 describe；FR-04 预会话「重进恢复」用例改写为「恒空白」 |
| 修改 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | 群聊 FR-01/02/03 用例两条 |
| 修改 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | 同 scope 重新新建强制重挂载用例（nonce） |
