# 设计记录（Design Record）— 2026-10-23-askuser-dialog-draft

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两件独立小改动，都落在 `AskUserDialogCard`（三宿主 page dock / dialog dock / 群聊聚合同款复用，改一处全生效）：

1. **单选互斥改为「禁用对侧 + 提示」**（不做「后者清前者」）：
   - 选项按钮：`disabled={submitting || (isSingle && st.customText.trim() !== "")}`；
   - 手动输入框：`disabled={submitting || (isSingle && st.selected.length > 0)}`；
   - 两侧各给一行 `text-[10px]` 提示文案（选中态时提示"再点一次取消即可改为手动输入"；输入非空时提示"清空后可选择选项"）；
   - `selectOption` / `setCustomText` 内部再加一道防御（互斥条件命中直接 return），防止禁用态被程序化事件绕过；
   - `computeAnswer` 保持原样（输入优先 / 多选合并），互斥由 UI 层保证——这样单选即使历史草稿里同时有选项与输入，仍按"输入优先"确定性作答，不会崩。
   - **互斥优先级「输入 > 选项」**（实现期发现的必需补充）：旧草稿或异常路径可能让单选同时存在勾选与输入，若两侧都禁用会互锁死（选项不可点取消、输入框不可清空）。故规则定为：有非空输入时只锁选项、不锁输入（清空输入即解锁选项）；仅在「有勾选且无输入」时锁输入框。
   选禁用而非"后者清前者"：清空会静默丢用户已填内容（输入一半手滑点选项即丢），禁用可逆且用户明确说"目前勾选之后也能输入…不对"（要的是不能，不是被清）。

2. **作答草稿 localStorage 持久化**（对齐会话输入草稿方案）：新增 `frontend/src/components/ask-user-dialog-draft.ts`（纯函数模块，无 React 依赖）：
   - 键：`sillyhub.askuser.draft.<requestId>`（`request_id` 全局唯一 —— 新提问天然不复用旧草稿，满足 FR-04 场景 4）；
   - 值：`{ v: 1, at: <epoch ms>, states: Record<string, {selected: string[], customText: string}> }`（`states` 键为问题下标字符串，与组件 `Record<number, QuestionState>` 同构）；
   - `readAskUserDraft(requestId)`：解析失败 / 结构不符 / 已过期 → 返回 `null`（组件降级空作答）；同时顺手清掉该条损坏/过期记录；
   - `writeAskUserDraft(requestId, states)`：写入时顺带 prune（扫描前缀键，删 `at` 超过 TTL=7 天的条目——孤儿兜底，满足 FR-04 场景 3）；
   - `clearAskUserDraft(requestId)`：删键。
   组件侧：`useState` 用 **lazy initializer** 读草稿（首帧即恢复，无"先空后填"闪动）；`useEffect([states])` 写草稿（首次 mount 写回同值无害，顺带承担 prune）；`handleSubmit` 成功后与 409 分支各 `clearAskUserDraft`；另有 `useEffect([answered, alreadyAnswered])`——卡片进入已答关闭态（群聊被他人回答 / 父组件 answered prop）时清草稿。
   为什么不放到父组件（dock）：卡片是三宿主共用组件，父组件有三处（page dock、dialog dock、群聊聚合），放父组件要改三处并各自传 props；放组件内零接口变化、宿主无需感知。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增模块 `frontend/src/components/ask-user-dialog-draft.ts` 导出：
  - `interface AskUserDraftState { selected: string[]; customText: string }`
  - `readAskUserDraft(requestId: string): Record<string, AskUserDraftState> | null`
  - `writeAskUserDraft(requestId: string, states: Record<string, AskUserDraftState>): void`
  - `clearAskUserDraft(requestId: string): void`
  - `ASKUSER_DRAFT_TTL_MS`（导出常量供测试断言）
- `AskUserDialogCard` props：**零变化**（三宿主无需改动）。
- 提交载荷 `dialog_result.answers`：**零变化**（单选仍单值、多选仍数组）。
- 新增 localStorage 键 `sillyhub.askuser.draft.<requestId>`（前缀 `sillyhub.askuser.draft.` 为清理/prune 的扫描面）。后端 API：零变化。
- 对外可见行为变化：①单选问题勾选后输入框禁用、输入非空后选项禁用（含提示文案）；②未提交作答刷新/切换会话后恢复；③提交成功或 409 后草稿清除。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

草稿写入是「整份 states 覆盖写」，无字段级合并，故不存在字段级乱序；同一标签页内 React 事件串行，最后一次写得真相。跨标签页同 `request_id` 并发填答为 last-write-wins（与既有会话输入草稿同语义）；一标签提交成功后 `clear`，另标签下一次输入会重写草稿——但其卡片此时已被 SSE 移除（不再挂载），无可见影响。迟到 `permission_resolved`（用户已提交）由父组件过滤 pending → 卡片卸载，残留草稿至多到 TTL，不会被任何卡片读到（request_id 唯一）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

同一提问多端填答：localStorage 按 origin 隔离，各端本地互不可见（不会串话），提交仍是"先到先得"（后端 409 既有语义不变）。同一端多次 `write` 为覆盖写，最终态一致。`prune` 只删自己前缀下过期条目，不触碰其它键（含会话草稿 `sillyhub.sessions.draft.*`）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

切会话：会话面板 key 重挂载 → 卡片卸载，但草稿已落盘，切回（提问仍 pending）后 lazy initializer 恢复（FR-03 场景 2）。最小化：卡片保持挂载（既有 task-08 语义），不受影响。卸载时机与写入时机：`useEffect` 在提交前每次输入都已落盘，故"输入后立刻关页面"也不丢（不依赖卸载钩子）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

键以 `request_id` 为唯一维度（全局唯一，跨会话/跨工作区天然隔离），不含 sessionId/workspaceId（避免"切会话后键变化导致读不到"）。同一浏览器多标签共享同一 origin 的 localStorage，但读到的是同一提问的同一份作答——符合"刷新/切换保留"的预期，不构成串台。跨用户（同机不同浏览器 profile / cookie）不共享 localStorage，不会泄漏他人作答。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：`request_id` 若被后端复用（同一 id 发起新一轮提问），旧草稿会带入新提问。核查：`request_id` 由 daemon 每次提问新生成（`SessionPermissionRequest.request_id` 唯一标识一次 permission 请求，SSE/REST 双侧同一值），复用不在既有契约内；TTL 7 天进一步兜底。记为可接受风险。
- 放弃方案 A「互斥用『后者清前者』」：静默丢弃用户已填内容（输入一半点选项即丢文本），与本仓一贯的"不覆盖用户新输入"口径冲突（2026-10-23-session-dialog-input-align 同款取舍）。
- 放弃方案 B「把作答草稿提升到 dock 组件统一管理」：三宿主（page dock / dialog dock / 群聊聚合）各要改一遍并新增 props 通道，而卡片本身已是三宿主共用组件——放卡片内零接口变化。
- 放弃方案 C「只做 sessionStorage（刷新保留、切会话不保留）」：用户明确要求切换会话也保留，sessionStorage 在新标签打开时不共享，语义不足。
- 实现期发现的坑（已解决，记此备查）：既有 `ask-user-dialog-card.test.tsx` 各用例共用 `request_id="req-1"` 且不清 localStorage，草稿持久化会让上一例的勾选/输入被下一例读回（3 个存量用例连带挂）。修法是在测试文件顶层加 `beforeEach(() => window.localStorage.clear())`——属测试隔离问题，非实现问题（真实使用 request_id 唯一）。
- 明确边界（可接受）：多选不互斥（用户裁决「仅单选互斥」）——多选仍可"勾多项 + 自定义合并"。
- 明确边界（可接受）：草稿只在浏览器本地，不跨设备/跨浏览器同步（用户诉求是刷新与切换会话，未提跨端）。
- 明确边界（可接受）：卡片因 SSE `permission_resolved`（他人已回答 / 会话结束）卸载时不做即时删除，依赖 TTL 兜底——因为组件卸载事件无法区分"已经答完"与"只是切走了"，即时删会让 FR-03 场景 2 失效。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/components/ask-user-dialog-draft.ts | 草稿读写/清理/TTL prune 纯函数模块（键 `sillyhub.askuser.draft.<requestId>`） |
| 修改 | frontend/src/components/ask-user-dialog-card.tsx | 单选互斥禁用 + 提示文案 + 防御守卫；states lazy initializer 读草稿 + effect 写草稿 + 提交成功/409 清草稿 |
| 新增 | frontend/src/components/ask-user-dialog-draft.test.ts | 草稿模块用例（读写往返 / TTL 过期 / 损坏降级 / 跨 requestId 隔离 / prune 不碰其它前缀） |
| 修改 | frontend/src/components/ask-user-dialog-card.test.tsx | 新增 FR-01 互斥三场景、FR-02 多选回归、FR-03 卸载重挂载恢复、FR-04 提交成功清草稿 |
