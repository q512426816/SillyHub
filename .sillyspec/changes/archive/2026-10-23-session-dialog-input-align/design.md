---
author: flow-machine-draft
created_at: 2026-10-23T03:33:04.639Z
---
# 设计记录（Design Record）— 2026-10-23-session-dialog-input-align

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

dialog 模式是 page 模式的独立子组件（session-panel-dialog.tsx，2334 行），上一变更（2026-10-23-session-input-clear-fix）只修了 page，两模式因此行为分叉。本变更把 page 已验证同款的三件套搬过来：

1. **受理即清**：新增 `clearInputAccepted()`（`setInput("")` + 同步 `writeSessionDraft(view.sessionId ?? null, "", workspaceId ?? '-')`），在 `handleSend` 守卫全部通过后、各路径派发前调用一次。`onSendSettled` 里原有的 `setInput` 清空守卫保留（幂等，防定时发送等其它入口），附件 chips / @ 联想清理时序不变。
2. **失败恢复**：新增 `restoreRejectedSend(raw)`——`setInput((prev) => (prev === "" ? raw : prev))`，仅在输入框为空时回填（不覆盖失败窗口期新输入，与 `handleInterrupt` 打断回退、page 版同款），且草稿键为空时才写回原文（不覆盖用户新输入落盘的草稿）。三条失败路径接线：`submitFollowup` 抛错（handleSend 的 try/catch）、`sendToServerQueue` 的 catch、idle `createSession` 的 catch（现状是清空后不恢复，属丢文本缺陷）。
3. **idle 恒空白**：草稿回读 effect 改为 `view.sessionId ? readSessionDraft(...) : (setInput("") + writeSessionDraft(null, "", workspaceId ?? '-'))`——idle 态不回读、并清残留 `__pre__:<workspaceId>` 键；真会话回读语义零变化。

选择「受理即清 + 失败恢复」而非「响应后清（现状）」：与 page 模式保持一致的交互口径（发送即时出框是用户第一感知），失败为小概率路径且恢复是一行防御式回填。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sendToServerQueue(prompt, attachmentIds, rawPrompt?)`（session-panel-dialog.tsx）：新增第三参 rawPrompt（用户所见原文，token 置换前）；catch 内 `restoreRejectedSend(rawPrompt ?? prompt)` 回填（缺省回落置换版，旧调用兼容）。
- `submitFollowup` **未加参**（设计草案原列第三参，实现收敛为不加）：该函数失败向向上抛，失败恢复统一由调用方 `handleSend` 的 catch 承担；`handleResend`（时间线失败卡重发，prompt 非来自输入框）复用同一函数不传输入语义，故不在函数内自带恢复（避免两处双恢复）。
- 新增局部回调 `clearInputAccepted()` / `restoreRejectedSend(raw)`（均 useCallback，deps `[view.sessionId, workspaceId]`；不对外暴露）。
- SessionPanel dialog 组件 props 签名：零变化（`input`/`view` 全内部状态）。
- localStorage 键格式：零变化（真会话 `sillyhub.sessions.draft.<sessionId>`；idle `sillyhub.sessions.draft.__pre__:<workspaceId|'-'>`）。
- 后端 API：零变化。
- 对外可见行为变化仅两处：①idle 浮窗不再回读 `__pre__` 草稿（恒空白）；②发送失败时文本回到输入框（原先 idle 首句失败即丢文本）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

`restoreRejectedSend` 仅在输入框为空时回填，迟到失败到达时用户已输入新内容则不覆盖；草稿键同样仅在为空时写回。成功响应迟到（浮窗已卸载/已切走）时 `onSendSettled` 的 setState 落在已卸载组件上为 no-op，草稿键已在受理点同步清过，无残留。`submitFollowup` 内部 `inflightSendRef` 校验（被打断则补 interrupt）逻辑不变，受理即清不影响其判定。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

同会话连发两条：第一条受理即清后，第二条因输入为空、无附件被 handleSend 的首个守卫拦下（`!rawPrompt && pendingAttachments.length === 0` 即 return）；忙轮第二条走 `sendToServerQueue` 排队，占位/currentRunId 串行机制既有不变。localStorage 单标签页串行写；多标签页同键 last-write-wins（原语义不变）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

浮窗卸载（关闭 modal、切到历史会话、父级 key 变化）——setState no-op 安全，草稿键已在受理点同步清（本修复核心）；失败恢复的 catch 仍直接写盘（`writeSessionDraft`），组件已销毁时切回原会话回读即恢复可重试，文本不丢。idle→真会话切换（createSession 成功后 view.sessionId 变化）触发回读 effect 重跑，`view.sessionId` 非空故走正常回读（此时真实会话草稿为空，输入框保持空白）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

草稿键组装未改（真会话按 sessionId、idle 按 `__pre__:<workspaceId|'-'>`），本变更只改回读条件与写入时序，跨工作区/跨机器不串台。dialog 无 runtime 维度（D-001 既有约定：同一 workspaceId 入口共享 idle 键），本变更不引入新 scope。dialog 侧无门户式 nonce 需求：宿主 `runtime-session-helpers.tsx` 的 key 为 `attachSession?.id ?? "live"`——新建（idle）与本会话（真会话）之间切换必然变 key → 重挂载；关闭 modal 即卸载子树（条件渲染），不存在「同 key 复用残留输入」路径；而 page 模式的预会话面板由门户常驻渲染，故那边需要 nonce。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：立即清空后「失败窗口期」用户误以为发送成功。缓解：失败路径既有 errorMsg/notify（不变）且文本自动回填；与 page 模式同一口径。
- 放弃方案 A「只在 dialog 内部给 idle 态加 nonce/重挂载」：宿主已用 key 表达会话切换（`attachSession?.id ?? "live"`），再叠一层 nonce 会与宿主 key 语义重复；改由「idle 不回读草稿」直接消除残留来源，更小改动面。
- 放弃方案 B「dialog 与 page 合并为同一实现」：两模式 2334 行 vs 6163 行、渲染容器/队列 hook/SSE 生命周期不同（dialog 零 react-query、page 挂 react-query），合并属重构级改动，本次不扩面（记为长期项）。
- 放弃方案 C「失败恢复用 setInput(prompt) 无条件覆盖」：会吞掉用户在失败窗口期新输入的内容；与本仓 `handleInterrupt` 回退、page 版「仅空时回填」口径冲突。
- 明确边界（可接受）：`handleResend`（时间线失败卡「重新发送」）不走输入框语义，失败不把该轮 prompt 回填输入框——用户未在输入框输入该文本，回填属越权写；保持现状。
- 明确边界（可接受）：`cancelSched`/定时发送相关路径清空语义不变（`confirmSchedCreate` 保留原 trim 比对清空），定时创建成功不属「发送受理」，不回填。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 新增 clearInputAccepted/restoreRejectedSend；handleSend 三条路径受理即清 + 透传 rawPrompt；submitFollowup/sendToServerQueue 加第三参并在失败处恢复；idle 回读 effect 改恒空白并清残留键 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx | dialog harness 追加 FR-01/02/03/04 四个 describe；既有 dialog idle「重进恢复」用例改写为「恒空白」 |
