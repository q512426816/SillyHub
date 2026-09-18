# spike-claude-steering —— claude SDK 命令队列 mid-turn 吸收实测（spike-02）

> task-04（2026-09-18-single-chat-steering / FR-01 / R-01 / D-003@v1）
> 结论先行：**真机验证通过——忙轮向 `query({prompt: AsyncIterable})` 推流后，
> SDK 命令队列吸收注入消息且全程不需要 interrupt；吸收时机呈双形态：工具循环
> 忙轮 = mid-turn 吸收（折进当前轮后续 LLM 调用，当前轮输出体现注入指令），
> 纯生成忙轮（无工具间隙）= 轮结束吸收（同 session 自动续跑下一轮，降级可接受）。
> caps 建议：claude `steering = true`；驱动源码零改动（预期成立）。**

## 1. 环境

| 项 | 值 |
|---|---|
| SDK | `@anthropic-ai/claude-agent-sdk` **0.3.247**（sillyhub-daemon/node_modules，package.json version 实读） |
| CLI | `C:\Users\qinyi\.local\bin\claude.exe`（PE32+ 真 exe，**2.1.216**，`claude --version` 实测） |
| 网络 | bigmodel anthropic 兼容代理（`deploy/.env` 的 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`，与 daemon 部署同源；`/v1/messages` 预检 HTTP 200） |
| 模型 | 会话报告 `claude-fable-5[1M]`（代理侧映射名） |
| 系统 | Windows 10 19045 x64 / Node v24.15.0 |
| init 能力 | `caps=["interrupt_receipt_v1","msg_lifecycle_v1"]`（无 `interrupt_cancel_queued_v1`） |
| 探测脚本 | 一次性脚本 `%TEMP%\spike02-claude-steering\probe.mjs`（用完即弃；证据 JSON 同目录 `probe-result.json`，关键数值已内嵌本文防丢失） |

探测形态对齐生产 driver（`claude-sdk-driver.ts` `start()`）：`query({ prompt:
AsyncIterable<SDKUserMessage>, options })`，options 携带 `pathToClaudeCodeExecutable /
cwd（临时目录）/ env（ANTHROPIC_*）/ allowedTools（收紧避免真实副作用）/
includePartialMessages:true / forwardSubagentText:true`；输入消息形态与
`mapUserTurnInputToSdk` 输出同形（`{type:'user', message:{role:'user', content:text},
parent_tool_use_id:null}`）。**脚本无任何 `q.interrupt()` 调用点**（interruptUsed 恒
false 由代码路径保证）。

## 2. 类型契约证据（sdk.d.ts 0.3.247 实读行号）

- `queued_turn_count?: number`：**sdk.d.ts:4672**（SDKResultError）与 **:4726**
  （SDKResultSuccess）。语义原文："User-initiated sends still waiting in the command
  queue when this result was produced. Greater than 0 means at least one more user turn
  (and result) follows without further input, barring cancellation…"
- `still_queued: string[]`：**sdk.d.ts:3821**（SDKControlInterruptResponse）——interrupt
  后仍存活的队列消息 uuid 清单（本 spike 不走 interrupt，仅作为队列机制存在的旁证）。
- mid-turn fold 语义：**sdk.d.ts:1899-1901**（resumeSessionAt 校验注释）"…e.g. a
  queued user message or task notification the session **absorbed mid-turn**…"；
  :3809/:3823（interrupt cancel_queued 注释）"a **fold-in-flight** uuid's
  queued_command attachment may already appear in the aborted turn's transcript if the
  abort landed after the fold's attachment yield — it never runs as its own turn"——
  即命令队列存在「把排队消息折进当前轮下一次 LLM 调用」的 mid-turn 吸收机制。
- `Query.interrupt()`：**sdk.d.ts:2425**（turn 级打断，本 spike 全程不触碰）；
  `streamInput`（AsyncIterable 输入即 `query({prompt})` 内部路径）：**sdk.d.ts:2698**。

## 3. 真机实测证据

### 3.1 场景 A：纯生成忙轮（无工具、单次 LLM 调用）——轮结束吸收

首条 prompt：写 ≥1200 字长文（`allowedTools: []`）；在**首个 stream_event**（首轮
LLM 流式输出进行中，+4579ms）把第二条消息推入输入流：`新指令：……只输出这一行：
STEERED-A-OK-42`。

时间线（相对 query 启动）：

| 时刻 | 事件 |
|---|---|
| +3142ms | SYSTEM_INIT（sid=0169f07e-…f7a1） |
| **+4579ms** | **PUSH_SECOND_MSG（mid-turn：首轮 LLM 仍在流式输出中）** |
| +47618ms | RESULT#1 success（result_len=2459，长文完整产出，**无注入痕迹**） |
| +47636ms | SYSTEM_INIT（**同 sid** 0169f07e-…f7a1；streaming 模式每轮重发 init，见 §5 附注） |
| +50238ms | ASSISTANT 输出恰好 `STEERED-A-OK-42` |
| +50279ms | RESULT#2 success（result 全文= `STEERED-A-OK-42`） |

要点：
- `pushedBeforeFirstResult = true`（推送先于轮结束 **43.0 秒**，绝非轮边界后补推）。
- **全程未调 interrupt**；注入消息在 RESULT#1 后**同 session 自动作为下一轮执行**
  （两条 result 的 `session_id` 相同：`0169f07e-46d2-4556-a705-2b405e66f7a1`）。
- RESULT#1 / RESULT#2 的 `queued_turn_count` **均为 undefined**（见 §3.3 负面发现）。
- 语义：纯生成轮没有 mid-turn fold 点（轮内只有一次 LLM 调用，无工具间隙），
  消息进命令队列等轮结束——**轮边界吸收（降级形态）**：等待时长=当前轮剩余
  时长（本例由 43s 长文主导），轮结束后次轮立即启动（本例 RESULT#1→RESULT#2
  仅 2.66s 含次轮全程）。不丢消息、不打断、不失败。

### 3.2 场景 B：工具循环忙轮（只读工具、多次 LLM 调用）——mid-turn 吸收（严格意义）

cwd 放 6 个 `spike-NN.txt`（quokka 计数 3/6/9/12/15/18）；首条 prompt：Glob 列出
+ 逐个 Read 统计（`allowedTools: ['Read','Glob','Grep']`，无真实副作用）；在**首个
tool_result 回传后**（+7122ms，本轮还有后续 LLM 调用未发生）推第二条：
`补充指令：请在你的最终输出中单独附加一行，内容恰好是 MARKER-BANANA-42`。

时间线（相对 query 启动，sid=aec7c743-…f048）：

| 时刻 | 事件 |
|---|---|
| +3736ms | SYSTEM_INIT |
| +6996ms | ASSISTANT [tool_use]（Glob） |
| +7122ms | tool_result 回传 → **PUSH_SECOND_MSG（mid-turn：下一次 LLM 调用前）** |
| +9705ms | ASSISTANT [tool_use]（后续 LLM 调用 #2——注入消息在此后被折进当前轮） |
| +12732~12827ms | ASSISTANT [tool_use]×5 + tool_result×5（并行 Read 收尾） |
| +18564ms | ASSISTANT 最终输出：完整统计表 + 末行 **`MARKER-BANANA-42`** |
| +18575ms | RESULT#1 success（result_len=229） |

RESULT#1 全文（关键证据，注入指令体现在**当前轮**的最终输出）：

```
逐个统计结果如下：
| 文件 | 「quokka」出现次数 | … spike-01.txt | 3 | … spike-06.txt | 18 |
**总数：3 + 6 + 9 + 12 + 15 + 18 = 63 次**
MARKER-BANANA-42
```

要点：
- `pushedBeforeFirstResult = true`（推送先于轮结束 11.5 秒）。
- **没有 RESULT#2**：注入消息被**折进当前轮**（mid-turn fold），未作为独立轮运行
  ——探测脚本等第二条 result 直到 300s 超时兜底收尾（消息早已被吸收，非丢失）。
- **全程未调 interrupt**；marker 串只存在于被注入的第二条消息中（首条 prompt 不含），
  排除模型自发输出的混淆。
- 语义：**工具循环型忙轮（agent 典型负载）＝ mid-turn 吸收**——消息在下一次 LLM
  调用前进入上下文，当前轮剩余工作直接体现引导指令。

### 3.3 queued_turn_count 真机负面发现（如实记录）

SDK 0.3.247 的 `sdk.d.ts:4672/:4726` 定义了 `queued_turn_count`，但真机 CLI 2.1.216
在两场景全部 result 帧上**均未填充该字段（undefined）**——即便场景 A 注入消息
确实在命令队列中等待（次轮自动执行可证）。结论：**在当前 CLI 版本上，
`queued_turn_count ≥ 1` 这一任务卡首选断言通道不可用**；本 spike 以行为学证据
替代（次轮自动执行 / 当前轮输出体现 + session_id 连续 + 无 interrupt + marker
唯一起源于注入消息）。若未来 CLI 升级填充该字段，可按 sdk.d.ts 语义直接采用。

## 4. 守护测试（已落盘，与真机证据互补）

`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts` 按文件既有 mock 惯例
（vi.hoisted mockQuery + setMockQueryImpl + makeFakeQuery）追加 2 用例，既有 34 用例
零改动：

1. **忙轮 inject：第二条消息被 SDK prompt 迭代器在轮边界 result 前消费，全程不
   interrupt**——mock query 的 generator 以 promise 门槛锁住 turn1 result，仅当
   mock SDK 侧迭代器消费到第二条 prompt 才放行（结构化顺序证明，不靠 sleep）；
   断言 `orderLog = [assistant_yielded, second_prompt_consumed, result_yielded]`、
   `interruptSpy` 零调用、消息经 `mapUserTurnInputToSdk` 转换形态正确。
2. **连续两条忙轮 inject：均按 FIFO 进流被消费，输入迭代器持续单订阅不断流**——
   同一忙轮内连推两条引导，断言三条消息按 push 顺序被 SDK 迭代器消费、不
   interrupt、turn1 result 正常收口。

自验：`pnpm exec vitest run tests/interactive/claude-sdk-driver.test.ts` →
**36/36 通过（1 file, 0 fail）**，真实机吸收证据以本 md 为准，CI 不依赖网络/鉴权。

## 5. 结论

### 5.1 吸收时机判定（定论）

| 忙轮形态 | 吸收时机 | 真机证据 | 效果 |
|---|---|---|---|
| 工具循环轮（agent 典型负载，轮内多次 LLM 调用） | **mid-turn 吸收**（折进当前轮下一次 LLM 调用前） | 场景 B：注入指令出现在 RESULT#1 输出末行，无 RESULT#2 | 引导即时生效，当前轮剩余工作即体现 |
| 纯生成轮（轮内单次 LLM 调用，无 fold 点） | **轮结束吸收**（命令队列 → 次轮自动执行，同 session） | 场景 A：RESULT#2 全文=`STEERED-A-OK-42`，两条 result session_id 相同 | 排队时延=当前轮剩余时长，不丢消息、不失败（降级可接受） |

两形态共同点：**全程不 interrupt、不丢消息、驱动零改动**——`ClaudeSdkDriver`
现有 `start/consume/interrupt` 一行未动即具备 steering 能力（push 进
`InputQueue` → `mapUserTurnInputToSdk` → SDK 输入流 → 命令队列）。

### 5.2 queued_turn_count 证据

类型层存在（sdk.d.ts:4672/:4726，语义明确）；真机 CLI 2.1.216 **不填充**
（两场景全部 result 帧 undefined）。断言口径以行为学证据为准（§3.1/§3.2），
`still_queued`（:3821）仅 interrupt 场景可用，本 steering 路径不涉及。

### 5.3 caps 取值建议（给 task-01 收尾）

**`PROVIDER_CAPS.steering.claude = true`**。依据：真机证明 claude 忙轮注入不打断
即可生效（mid-turn 或轮边界双形态），驱动零改动；降级路径（纯生成轮轮边界吸收）
= 排队时延，不失败——满足 design「引导式（不打断，mid-turn 注入活跃轮）」语义，
与 pi steer 同档；codex/cursor 的取值归各自任务（A1/R-02），不在本 spike 范围。

### 5.4 前端「引导中」态收敛依据

不依赖 `queued_turn_count`（真机无值）。收敛信号取既有流式事件即可：
- mid-turn 吸收：注入后**当前轮的后续 assistant 流式输出**（体现引导指令）即
  收敛——turn 不结束、无新 result；
- 轮边界吸收：RESULT（当前轮完成）+ **紧随的次轮 assistant 流式输出开始**即收敛。
即「引导中」态的最长存活期 = 当前轮剩余时长；两种形态下都有可观察的流式活动
作为收敛锚点，无需新增 SDK 字段依赖。

### 5.5 附注观察（不影响本结论，供后续参考）

- streaming 模式下 CLI **每轮重发 SYSTEM_INIT**（场景 A +47636ms，session_id 不变）
  ——daemon 归一化器对重复 init 的表现归既有多轮会话行为，非 steering 引入。
- 真机主线程 **tool_result 帧 `parent_tool_use_id = null`**（场景 B 实测 7 帧均如此）
  ——识别须看 `message.content` 数组的 `tool_result` 块；daemon `claude-events`
  归一化按 content 判定，不受影响（本 spike 探测脚本首版即因按 parent_tool_use_id
  误判而错过注入窗口，已修正复测）。
- 探测中观察到大量非 init 的 system 帧与 stream_event（partial 开启），均为既有
  daemon 消费面已知形态。

## 6. 铁律对账

- 只改：本 md（新建）+ `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts`
  （追加 2 用例）；`claude-sdk-driver.ts` 零改动（git 对账见 worktree diff）。
- 未 git commit、未写 review.json；探测脚本与证据 JSON 留在系统临时目录（一次性，
  不入库）。
- 测试仅跑本卡相关文件（vitest 单文件 36/36），未跑全量。
