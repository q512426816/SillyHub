# 设计记录（Design Record）— 2026-10-23-pre-session-draft-persist

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

把前序变更定为「恒空白」的预会话回读分支改回「读入口隔离键」，写侧零改动（持久化 effect 本就随每次输入变化落盘、含清空写空串；发送受理即清本就同步清键）。改动只有两处读分支：

- `session-panel-page.tsx` 预会话分支：`setInput("") + writeSessionDraft(null, "", preDraftScope)` → `setInput(readSessionDraft(null, preDraftScope))`；
- `session-panel-dialog.tsx` idle 分支：同构改为 `setInput(readSessionDraft(null, workspaceId ?? '-'))`。

为什么安全（前序报障「其他会话填 AAA 新建会话显示 AAA」不复潮）：回读源是入口隔离键 `__pre__:<scope>`，真会话的 AAA 存在 `<sessionId>` 键下，两键永不交叉；预会话写入也只落 `__pre__:<scope>`（persistence effect 以 sessionId=null + preDraftScope 组装）；`draftHydratedRef` rAF 门闩继续防「回读前旧会话 input 先写进新键」。page 门户 `preMountNonce` 强制每次新建重挂载 → 回读 effect 必跑；dialog 宿主 key `attachSession?.id ?? "live"` 使 idle↔真会话切换必重挂载。即本次只是把「读自己键」的既有能力重新打开，隔离机制原样。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- **无**新接口 / 无签名变化：`readSessionDraft` / `writeSessionDraft` / `clearInputAccepted` / `restoreRejectedSend` / `handlePreSessionSend` / `openPreSession(preMountNonce)` 全部原样。
- 行为变化（对外可见）：预会话/idle 挂载时输入框回显 `__pre__:<scope>` 键的未发送草稿（原为恒空白并清键）。
- 键空间零变化：仍为 `sillyhub.sessions.draft.__pre__:<workspaceId|'-'>[:<runtimeId>]`（page 带 runtime 维度，dialog 无）与 `sillyhub.sessions.draft.<sessionId>`。
- 后端 API：零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

回读 effect 依赖 `[sessionId]`（null=预会话），挂载即同步 `setInput(read)`，rAF 后才放行写 effect——读先于写，顺序确定。预会话发送中切走：`clearInputAccepted` 在受理点同步写 `""`（不走 effect，不受卸载影响），失败恢复 `restoreRejectedSend` 同步写回 raw——两条路径均不经组件生命周期，无乱序窗口。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

同一预会话键只有一个挂载实例（page 门户 nonce 重挂载互斥 / dialog 单实例），同标签页内无并发写；跨标签页 last-write-wins（与既有会话草稿同语义）。真会话与预会话写不同键，互不覆盖。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

切走：写 effect 已随最后一次输入落盘（不依赖卸载钩子）。刷新：同左。清空后立刻切走：`onChange` → `setInput("")` → effect 写 `""`（FR-02 的关键路径，commit 内完成，切换发生在之后的用户操作，必然晚于 effect）。预会话发送成功后 `createSession` 完成、面板切真会话——键已清，后续新建为空。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

入口隔离键含 workspaceId（缺省 '-'）与 runtimeId（page）；不同入口互不可见（既有 task-01 / D-001 机制原样，既有用例锁定）。真会话键按 sessionId 组装，与 `__pre__` 系无交集。group-chat 草稿（`sillyhub.groupchats.draft.*`）独立键族不受影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **本变更显式反转前序裁决**（须记 decisions 新版本取代）：`2026-10-23-session-input-clear-fix` FR-04「预会话恒空白、新建即弃稿」与 `2026-10-23-session-dialog-input-align` FR-04「idle 恒空白」。复潮条件已满足——用户实测后显式要求保留（本次 --input 原话）。两处被反转用例（「同一入口重进：输入框恒空白」「同 workspaceId 重开 dialog：恒空白」）就地改写为恢复语义，防口径漂移。
- 最大风险：清空后「组件卸载早于写 effect」丢清空事件 → 回来回显旧 AAA。评估：写 effect 在 input 变化的 commit 后同步 flush，用户「清空→切走」是人手两个操作，时间上必然晚于 effect 执行；唯一理论窗口是程序化清空（无）与清空后同 tick 卸载（无此路径）。风险可接受，FR-02 用例锁定。
- 放弃方案 A「预会话卸载钩子里补写草稿」：为不存在的窗口加防御，卸载钩子读 state 闭包易踩过期值（前序变更已知陷阱），不引入。
- 放弃方案 B「把预会话草稿并到每入口一个 sessionStorage」：用户明确要求刷新（新标签/重开浏览器）也保留，sessionStorage 不满足。
- 放弃方案 C「回读时同时回显 @ 联想/附件」：草稿键只存文本（R-7 语义），附件与 @ 绑定需重选是既有裁决，不扩scope。
- 明确边界（可接受）：同一入口的预会话草稿不区分「哪个用户意图」——只要没发送，重进就恢复；用户想丢弃就清空（FR-02 即为此设计）。
- 明确边界（可接受）：预会话草稿无 TTL（会话草稿同款），残留量级 = 入口数 × 一条文本。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 预会话回读分支：读 `__pre__:<scope>` 取代清空+清键（约 2 行） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | idle 回读分支：同构改读 `__pre__:<workspaceId\|'-'>`（约 2 行） |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx | 反转 2 个「恒空白」用例为恢复语义；新增清空语义 2 例 + 发送即清后新建为空 1 例 |
