# Spike 双定档：pi RPC fork 截断语义 × claude resumeSessionAt×forkSession（task-02）

> 探测日期：2026-09-22。探测员：task-02 spike 子代理（只读探测，零源码改动，WT 内零 commit）。
> 环境：Windows 10 / pi 0.81.1（全局 `C:\nvm4w\nodejs\node_modules\@earendil-works\pi-coding-agent`）/ `@anthropic-ai/claude-agent-sdk` **0.3.247**（WT 实装，pnpm overrides 未钉 0.3.181，known-issue 不成立）/ claude.exe **2.1.216**（`~/.local/bin/claude.exe`，daemon 生产 `resolveClaudeExecutable` 解析路径）。
> 探测脚本与完整对话记录：`%TEMP%\pi-fork-spike\`（probe-pi-fork.mjs / proxy-provider-ext.ts / probe-pi-fork2.mjs / sessions*\/）与 `%TEMP%\claude-fork-spike\`（probe-claude-fork.mjs / probe-claude-at.mjs / probe-claude-guard.mjs），均不入仓。
> 模型花销：pi 侧成功 4 轮 + 失败诊断 2 次（kimi 订阅失效，报错不产生 token 花费）+ print 模式 2 次；claude 侧成功 4 轮（3 轮铺垫 + 1 轮 fork 探针）+ 守卫探测 2 次（CLI 拒绝旗标，未达模型）+ curl 通道验证 1 次。模型通道均为本机 claude 代理（glm-5.3）。

---

## pi fork 定档

**结论：pi = native（原生截断分叉成立，实测通过）。**

FR-04「pi spike 定档」场景的判定门是「spike 断言能否截断到指定消息」——实测断言**通过**：RPC `fork` 命令能把会话截断到指定用户消息之前（= 轮边界），fork 出的新会话模型**不知道截断点之后的任何内容**。

### 判据（三级证据）

**1. 协议面（参数面）**——pi 0.81.1 `docs/rpc.md:613-639` 与 `dist/modes/rpc/rpc-types.d.ts:105-106`：

```
#### fork
Create a new fork from a previous user message on the active branch. Can be
cancelled by a `session_before_fork` extension event handler. Returns the text
of the message being forked from.

{"type": "fork", "entryId": "abc123"}
→ {"type": "response", "command": "fork", "success": true,
   "data": {"text": "The original prompt text...", "cancelled": false}}
```

- RPC wire 类型只有 `entryId` 一个参数（`{ id?: string; type: "fork"; entryId: string }`），且 `rpc-mode.js:465-466` 分发为 `runtimeHost.fork(command.entryId)`——不传 `position`，运行时默认 `position: "before"`：**entryId 必须是用户消息，新分支截止到该消息的 parent（即截断到上一轮轮末），被截去的用户消息原文经响应 `data.text` 返回**（作为重发提示词）。
- 运行时 API（`agent-session-runtime.d.ts:87-93`）另有 `position: "at"`（截止到任意 entry 本身），但 RPC 面不暴露。
- `clone`（rpc.md:641-667）= `fork(当前叶子, {position:"at"})` 全量复制（rpc-mode.js:472-481）——**分叉点在最后一轮之后时用它**（无内容需截去）。
- `switch_session`（rpc.md:595-611）只收 `sessionPath` 整文件切换，**无截断参数**，与定档无关。
- CLI 旗标 `--fork <path|id>`（`cli/args.js:70-71` → `main.js:195-206` → `SessionManager.forkFrom`）是**全量复制**，spawn 时无法指定截断点——**截断能力唯一入口是 RPC `fork` 命令**。

**2. 实现面**——`agent-session-runtime.js:171-247` fork() → `session-manager.js:1077+` `createBranchedSession(leafId)`：取 `getBranch(leafId)` 从根到叶的路径，**新建独立会话文件只写入该路径条目**（重链 parentId、重建路径内 label）。截断后的内容物理上不进新会话文件。

**3. 实机断言（本轮实测，经本地 claude 代理 provider 完成，见「环境限制」）**：

对话摘录（3 轮铺垫 + fork + 探针，完整记录在 `%TEMP%\pi-fork-spike\probe2-result.json`）：

```
turn1 user : Remember this fact: my name is Alice. Reply with exactly the word OK...
turn1 assistant: OK
turn2 user : Remember this fact: my secret code is BANANA-77. Reply ...
turn2 assistant: OK
turn3 user : Remember this fact: my favorite color is purple. Reply ...
turn3 assistant: OK
get_fork_messages → [{entryId:"308df55d", text:"...BANANA-77..."}, ...]（3 个用户消息可锚）
fork {"entryId":"308df55d"} → success, data.text="Remember this fact: my secret code is BANANA-77...",
                              data.cancelled=false
fork 后 get_state.sessionFile：…12-57-08-707Z_01a0c931-0763….jsonl（新文件/新会话 id）
fork 后 get_messages：["user","assistant"]（仅第 1 轮；fork 前 6 条）
原会话文件零改动：messageEntries=6（3 轮全量原样保留 → D-005 语义在 pi 侧成立）
探针 user : Answer on exactly one line, format: name=<…>; code=<…>; color=<…>
探针 assistant: name=Alice; code=none; color=none   ← 知第 1 轮（保留），不知第 2/3 轮（截去）
VERDICT: PASS
```

### 与平台粒度的映射（D-003 轮边界对齐）

「第 N 轮后分叉」→ pi 锚点 = **第 N+1 轮的用户消息 entryId**（`position:"before"` → 保留第 1..N 轮全部）；分叉在末轮之后 → `clone`（全量）。**锚点粒度天然是轮边界，与 D-003 不发明新粒度完全一致。**

注意（实现范围提示，非定档门）：daemon 现有 `pi-rpc-driver.ts` 未跟踪 entryId（grep 无命中），`src/interactive/pi-rpc-driver.ts:778-782` 注释明言 fork/switch_session 本变更未接；RPC fork 需在活 RPC 会话上发命令（或短命进程预 fork 后走既有 `--session` spawn resume 链），锚点 entryId 需驱动层落库（关联 FR-07 的 pi 侧修订，见产物B）。

### 环境限制清单（pi 侧）

1. **本机 pi 默认 kimi 通道不可用**：`cc-switch-kimi-for-coding`（`~/.pi/agent/models.json`，内嵌 apiKey）请求 `https://api.kimi.com/coding` 返回 `permission_error: "Your current subscription does not have access to Kimi Code right now"`。模型级断言改为经本地 claude 代理（`http://127.0.0.1:15721`，anthropic-messages 兼容，token `PROXY_MANAGED`）注册临时 pi 扩展 provider 完成——**断言本身是在真 pi 0.81.1 RPC 会话上做出的，仅模型后端不同，fork 语义结论不受影响**。
2. **pi 会把上游 API 错误静默吞成空 assistant 轮**：kimi 400/订阅错误与「模型不存在 400」均不产生任何错误事件，`agent_settled` 照常、assistant content 落 `[]`。对 daemon 的含义：pi 会话的模型侧故障不浮出，需在平台层另行监控（记入此处供主变更参考，不属本 spike 修复范围）。
3. **pi 扩展注册模型缺 `cost` 字段会崩溃**：`provider-composer.js:37` 读 `model.cost.tiers` 抛 `Cannot read properties of undefined (reading 'tiers')`——临时扩展补 `cost:{input:0,output:0,cacheRead:0,cacheWrite:0}` 后恢复。属 pi 扩展面小坑，与 vendored 扩展（ask-user/subagent）无关。
4. 本机代理按 claude 模型名路由（`claude-sonnet-4-5` → glm-5.3），自定义模型名（如 `glm-5.3-spike`）报 1211 模型不存在。

---

## claude resumeSessionAt×forkSession 组合行为

### 实装版本与符号面（静态）

- **SDK 实装 0.3.247**（`sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/package.json`；pnpm overrides 钉 0.3.181 的 known-issue 在本 WT **不成立**，无需升 SDK）。
- 三符号**全部存在**于 `sdk.d.ts`（行号为 0.3.247 实装）：
  - `:723` `forkSession(_sessionId, _options?: ForkSessionOptions): Promise<ForkSessionResult>`（独立会话文件手术函数）；`:728-733` `ForkSessionOptions = { dir?, upToMessageId?, title? }`，`upToMessageId` 注释原文 "**Slice transcript up to this message UUID (inclusive).** If omitted, full copy."
  - `:1551` `Options.forkSession?: boolean`："When true, resumed sessions will fork to a new session ID rather than continuing the previous session. Use with `resume`."（daemon 生产已用：`claude-sdk-driver.ts:476-479`）
  - `:1892` `Options.resumeSessionAt?: string`："When resuming, only resume messages **up to and including** the message with this UUID. … Accepts **any chain-entry UUID** — typically `SDKAssistantMessage.uuid`…"
  - `:1943` `Options.resumeDropsTurn?: string`：声明本次截断式 resume 要丢弃的那一轮的 **prompt UUID**；CLI 在 fork 时校验 `resumeSessionAt` 之后的条目是否全部可归因于该轮，否则**确定性拒绝**（`error_during_execution` 结果、消息前缀 `Resume rejected by --resume-drops-turn:`），"Consumers MUST map a refusal … to their rewind-recovery path … **not retry**: the refusal is deterministic"；省略该参数 = 未校验截断行为（"Omit to keep the unvalidated truncation behavior"）。
- **lane 限制**（`:1927-1932` 原文摘录）："**PRINT/HEADLESS LANE ONLY**: the pair is consumed exclusively by the headless boot path (print-mode CLI, Agent SDK, ProcessTransport). An interactive `claude --resume` boot and background-job worker boots **ignore both options** — the resume loads the full chain with no truncation, no guard, and no error". daemon 主会话走 SDK `query()`（headless/print lane）→ **适用**；但平台若有 background-job worker 形态的 claude 引导路径，此对参数在该 lane 静默失效（截断不生效且无报错），实现时须避开。

### 实机断言结果（本机已做，PASS）

会话 `9b88e377…`（transcript：`~/.claude/projects/C--Users-qinyi-AppData-Local-Temp-claude-fork-spike/`）：

1. **3 轮铺垫**（SDK `query()` + `resume` 续轮，session id 稳定不变）：轮1 "name is Alice"→"OK"、轮2 "secret code is BANANA-77"→"OK"、轮3 "favorite color is purple"→"OK"。
2. **组合断言**：`resume(9b88e377) + resumeSessionAt(轮2末 assistant uuid 9019fe24…) + forkSession(true)` + 探针提问 →
   - 新 session id `8d2d674f…`（≠ 原 id，fork 语义成立）；
   - 探针回答：**"name=Alice; code=BANANA-77; color=none"** —— 知轮1+轮2、**不知轮3**；
   - **transcript 物理核验**：新会话文件仅含轮1、轮2、探针轮（紫色轮条目物理不存在）；**原会话文件 19 条目零改动**（fork 后原 id 仍可 resume 全量 → D-005 语义在 claude 侧成立）。
   - 附带证明：锚在「轮末 assistant uuid」在**轮1 用户消息后带 attachment 条目**（55f0888b/7d405c2b）与**轮内多 assistant 条目**（轮3 有 cdd68e97 空 + 09854e63 两条）的会话上工作正常。
3. **resumeDropsTurn 守卫行为（本机实测）**：
   - `claude.exe 2.1.216` **不支持 `--resume-drops-turn`**：传真实 UUID 亦报 `error: unknown option '--resume-drops-turn=<uuid>'`，CLI 进程 exit 1，SDK `query()` 直接 **reject 抛错**（非 `error_during_execution` result）——错误浮出形态 = 进程级硬崩，先于任何校验/模型调用。
   - 对照：`--resume-session-at` 在 2.1.216 上**可用**（`--help` 未列出但被接受且语义生效，如上实测）。
   - 结论：**守卫在「SDK 0.3.247 + CLI 2.1.216」组合上不可启用**。SDK 类型已声明、CLI 落后——启用守卫需升级 claude CLI（属环境升级，非 SDK 升级；只记录不擅动）。sdk.d.ts 描述的拒绝形态（`error_during_execution` + `Resume rejected by --resume-drops-turn:` 前缀）在本机 CLI 上**不可达**（未达校验步）。**v1 实现约束：driver 不得传 resumeDropsTurn**（传 undefined 也会被序列化成 `--resume-drops-turn=null` 硬崩）；省略即官方文档明示的「未校验截断」，截断语义仍成立（如组合断言所证）。
4. **用户 prompt UUID 流内不可得**：3 轮流式 `SDKUserMessage.uuid` 均为 undefined（`sdk.d.ts:5066` 该字段可选；`SDKAssistantMessage.uuid` 必有且已流式拿到）。resumeDropsTurn 所需 prompt UUID 只能从磁盘 transcript 读（transcript 内 user 条目带 uuid，如轮2 用户 `82fa4d3b…`）或客户端自行赋值——守卫不可用的当下 v1 无需解决。

### 锚点消息类型结论

**claude 引擎锚点 = 轮末最后一个 chain-entry 消息 UUID；普通对话轮 = 轮末 `SDKAssistantMessage.uuid`（本机已实测确认）。**

细则（sdk.d.ts `resumeDropsTurn` 文档原文归纳，标注**待实机确认**，daemon 现网无这些场景）：end-turn tool 轮（`outputFormat:{type:'json_schema'}` 或 `_meta['claude/endTurn']` MCP 工具）轮末是 tool_result carrier + `structured_output` attachment，须锚在**最后一个条目**（attachment，无则 carrier）而非末 assistant；被中断轮（Esc 前已完成若干工具）同样**锚最后一Entry**；`shouldQuery:false` 的裸 user 追加条目之后才能作为截断点。总则原文："fork at the **KEPT turn's last chain entry**, whatever it is — `resumeSessionAt` accepts any chain UUID."

### 环境限制清单（claude 侧）

- 凭证：无 `ANTHROPIC_API_KEY` 环境变量；走 `~/.claude/settings.json` 的本地代理（`ANTHROPIC_BASE_URL=http://127.0.0.1:15721`，`ANTHROPIC_AUTH_TOKEN=PROXY_MANAGED`，模型映射 glm-5.3）。断言在真 SDK→CLI→代理链上完成。
- `--resume-drops-turn` 的**校验拒绝路径**（守卫真拒绝时的 result 形态）未实测——CLI 2.1.216 不支持该旗标，无法到达校验代码；形态仅取自 sdk.d.ts 文档（见上）。
- end-turn tool 轮 / 中断轮 / `shouldQuery:false` 追加轮的锚点细则未实测（daemon 无此场景），按文档归纳并标「待实机确认」。
