# spike-01：codex app-server `turn/steer` 实机探测记录（spike-codex-turn-steer）

> task-02 / FR-06 / D-003@v1。探测日期 2026-09-18（本地 17:04–17:07）。
> 所有回执均为实机原文（Windows Git Bash + Node spawn），零臆造。
> 探测脚本与完整 transcript 存于系统临时目录 `%TEMP%\codex-steer-spike\`（probe.js / probe2.js / probe-transcript.jsonl / probe2-transcript.jsonl / schema-out\），随系统清理，不复入仓。

## 1. 环境

| 项 | 值 |
|---|---|
| codex-cli | 0.147.0（`codex --version` 实测） |
| 启动命令 | `C:\nvm4w\nodejs\codex.cmd app-server --listen stdio://`（cmd.exe /c 包装，对齐 daemon 生产路径） |
| rust 主程序 | `C:\nvm4w\nodejs\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` |
| 探测客户端 | Node 脚本 spawn + stdin/stdout 按行 JSON-RPC；握手相邻请求间隔 300ms（对齐 codex-app-server-driver.ts DEFAULT_HANDSHAKE_INTERVAL_MS） |
| 会话 cwd | `%TEMP%\codex-steer-spike\work`（临时目录，无仓库污染） |
| 进程清理 | 脚本 finally `taskkill /PID <pid> /T /F`；探测后 `tasklist` 确认无 codex 残留 |

## 2. 静态证据（先于实机，用于定试探方向）

### 2.1 二进制字符串（codex.exe，offset 为 grep -aob 实测）

- `expectedTurnId` + `struct TurnSteerParams with 6 elements`（offset 233448344 附近）——字段名直接命中。
- 方法表（offset 233375460 附近）：`...turn/startturn/steerturn/interruptthread/realtime/start...`——三方法同表（R-02 枚举痕迹证实）。
- 字段名池（offset 234020018 附近）：`threadId clientUserMessageId input responses apiClientMetadata additionalContext ... expectedTurnId turnId ...`。
- `turn/steer.responses` / `turn/steer.additionalContext`（server→client 子方法名，本次两次实机会话均未触发，仅记录存在）。

### 2.2 官方 schema 导出（0.147.0 自带，实机生成）

`codex app-server generate-json-schema --out <dir>` 成功（v2 目录）：

- **v2/TurnSteerParams.json**：
  - `threadId`: string，**必填**
  - `expectedTurnId`: string，**必填**，schema 描述原文："Required active turn id precondition. The request fails when it does not match the currently active turn."
  - `input`: UserInput[]，**必填**（UserInput oneOf：`{type:'text',text}` / image / localImage / audio / localAudio / skill / mention；text 变体必填 `type`+`text`，`text_elements` 可选默认 `[]`）
  - `clientUserMessageId`: string|null，可选
- **v2/TurnSteerResponse.json**：`{ turnId: string }`（必填，单字段）。
- 对照：v2/TurnInterruptParams.json = `{threadId, turnId}` 均必填；v2/TurnStartedNotification.json 顶层 `properties: ["threadId","turn"]`——**turnId 嵌套在 `params.turn.id`**（见 §6 副发现）。

## 3. 实机会话 A（probe.js）：握手 + 忙轮 4 组试探 + interrupt + 空闲态 + 存活验证

### 3.1 握手与忙轮建立（原文回执）

```
>> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"spike","title":"spike","version":"0.0.1"}}}
<< {"id":1,"result":{"userAgent":"spike/0.147.0 (Windows 10.0.19045; x86_64) xterm-256color (spike; 0.0.1)","codexHome":"C:\\Users\\qinyi\\.codex","platformFamily":"windows","platformOs":"windows"}}
>> {"jsonrpc":"2.0","method":"notifications/initialized"}
>> {"jsonrpc":"2.0","id":2,"method":"thread/start","params":{"cwd":"C:\\Users\\qinyi\\AppData\\Local\\Temp\\codex-steer-spike\\work"}}
<< {"id":2,"result":{"thread":{"id":"01a0b57a-736a-7c73-a203-719e48dcac61", ...}}}
>> {"jsonrpc":"2.0","id":3,"method":"turn/start","params":{"threadId":"01a0b57a-736a-7c73-a203-719e48dcac61","input":[{"type":"text","text":"请从 1 数到 2000，每行输出一个数字，按顺序完整输出，不要省略任何数字，也不要提前停止。"}]}}
<< {"id":3,"result":{"turn":{"id":"01a0b57a-757f-75b3-95de-3c475122898f","items":[],"itemsView":"notLoaded","status":"inProgress",...}}}
<< {"method":"turn/started","params":{"threadId":"01a0b57a-736a-7c73-a203-719e48dcac61","turn":{"id":"01a0b57a-757f-75b3-95de-3c475122898f","items":[],"itemsView":"notLoaded","status":"inProgress",...}},"emittedAtMs":1789751096792}
```

注意：`turn/started` 的 **turnId 在 `params.turn.id`，顶层无 `params.turnId`**（§6 副发现）。忙轮确认：turn/started 后 3s 内已收到持续 `item/agentMessage/delta` 流（模型在逐字数数）。

### 3.2 忙轮中的 turn/steer 试探（请求与回执原样）

| # | 请求 params | 回执（原样） | 判定 |
|---|---|---|---|
| S1 | `{}`（空参数，钓 serde 错误文案） | `{"error":{"code":-32600,"message":"Invalid request: missing field \`threadId\`"},"id":4}` | 被拒：字段缺失逐个报 |
| S2 | `{threadId, expectedTurnId:"01a0b57a-757f-…898f", input:[{type:"text",text:"[steer 插入测试] …改为从 3001 开始倒数到 2950…"}]}` | `{"id":5,"result":{"turnId":"01a0b57a-757f-75b3-95de-3c475122898f"}}` | **成功**：响应 turnId = 当前忙轮同一 turn id |
| S3 | `{threadId, expectedTurnId:"nonexistent-turn-id-000", input:[…]}` | `{"error":{"code":-32600,"message":"expected active turn id \`nonexistent-turn-id-000\` but found \`01a0b57a-757f-75b3-95de-3c475122898f\`"},"id":6}` | 被拒：CAS 前置条件失配（错误文案回显当前活跃 turn id） |
| S4 | `{threadId, expectedTurnId:<正确>, prompt:"alternative prompt field shape"}`（prompt 字符串形状） | `{"error":{"code":-32600,"message":"Invalid request: missing field \`input\`"},"id":7}` | 被拒：不认 prompt 字段，必须 input:UserInput[] |

S2 请求原文：

```
>> {"jsonrpc":"2.0","id":5,"method":"turn/steer","params":{"threadId":"01a0b57a-736a-7c73-a203-719e48dcac61","expectedTurnId":"01a0b57a-757f-75b3-95de-3c475122898f","input":[{"type":"text","text":"[steer 插入测试] 收到本指令后：停止继续按原顺序数数，改为从 3001 开始倒数到 2950，每行一个数，然后结束。"}]}}
<< {"id":5,"result":{"turnId":"01a0b57a-757f-75b3-95de-3c475122898f"}}
```

S2 成功后 8s 通知流观察：`item/started reasoning`（新推理条目）→ `item/reasoning/summaryTextDelta`×N → `item/completed reasoning` → `item/started agentMessage` → delta 流继续（本会话随后被 interrupt，未及输出转折内容；行为学确认见 §4）。

### 3.3 interrupt 对照 + 空闲态 steer + 会话存活

```
>> {"jsonrpc":"2.0","id":8,"method":"turn/interrupt","params":{"threadId":"01a0b57a-736a-7c73-a203-719e48dcac61","turnId":"01a0b57a-757f-75b3-95de-3c475122898f"}}
<< {"id":8,"result":{}}
<< {"method":"turn/completed","params":{"threadId":"…","turn":{"id":"01a0b57a-757f-…898f","items":[],"itemsView":"notLoaded","status":"interrupted","error":null,"startedAt":1789751096,"completedAt":1789751110,"durationMs":14163}},"emittedAtMs":1789751110892}

>> {"jsonrpc":"2.0","id":9,"method":"turn/steer","params":{"threadId":"…","expectedTurnId":"01a0b57a-757f-…898f","input":[{"type":"text","text":"steer on idle thread"}]}}
<< {"error":{"code":-32600,"message":"no active turn to steer"},"id":9}      ← 空闲态被拒（未排队、未挂死）

>> {"jsonrpc":"2.0","id":10,"method":"turn/start","params":{"threadId":"…","input":[{"type":"text","text":"只回复两个字母：OK"}]}}
<< {"id":10,"result":{"turn":{"id":"01a0b57a-acfa-7590-9679-59c3913add12",...}}}
<< {"method":"turn/completed","params":{... "turn":{"id":"01a0b57a-acfa-…dd12","items":[{"type":"agentMessage","id":"resp_…_msg","text":"OK",...}],"status":"completed",...}}}
```

**存活结论**：经历 S1/S3/S4/S5 共 4 次 -32600 拒绝 + 1 次 interrupt 后，同一会话再起 turn 正常 completed（agentMessage 文本 "OK"）——**被拒不炸会话、不挂死**，FR-06「被拒回落轮边界消费」有实机支撑。

## 4. 实机会话 B（probe2.js）：行为学确认（steer 是否真的改变模型输出）

时间线（probe2-transcript.jsonl 原文时间戳，thread `01a0b57b-d1e1-…`，turn `01a0b57b-d38a-…`）：

| 时刻 | 事件 |
|---|---|
| 17:06:26.363 | turn/started（数数任务） |
| 17:06:41.438 | 首个 `item/agentMessage/delta`（"1"）——模型开始流式输出 |
| 17:06:41.439 | 发 turn/steer（expectedTurnId=当前 turn；指令：「立即停止数数…只回复一个大写单词：STEERED-OK」） |
| 17:06:41.440 | **1ms 内回执** `{"id":4,"result":{"turnId":"01a0b57b-d38a-7c20-9eb9-e244a33b4c52"}}`（同一 turn id） |
| 17:07:25.489 | 当前 agentMessage **完整数完 1→2000** 才收尾（textLen=8892，tail `…1999\n2000`）——**steer 不打断在途流式输出** |
| 17:07:25.517 | steer 文本以 `item/started userMessage` 注入同 turn：`{"item":{"type":"userMessage","id":"01a0b57c-bacc-…","clientId":null,"content":[{"type":"text","text":"[steer] 立即停止数数…STEERED-OK","text_elements":[]}]},"threadId":"…","turnId":"01a0b57b-d38a-…"}` |
| 17:07:37.587 | 新一轮 `item/started reasoning`（下一个模型调用边界被唤起） |
| 17:07:38.228 | `item/completed agentMessage` **text="STEERED-OK"**（textLen=10）——模型按 steer 指令回复 |
| 17:07:38.244 | `turn/completed` status=**completed**，durationMs=71914，turn id 仍是 `01a0b57b-d38a-…`——**全程单一 turn，steer 不产生新 turn** |

**行为语义定论**：turn/steer 受理即时（~1ms 回执），steer 文本在下一次模型调用边界以 userMessage 注入当前 turn；在途的 agentMessage/工具轮不会被截断（截断是 turn/interrupt 的职责）。这正好匹配 FR-06「转向=轮内注入、不打断当前流」的语义，与 turn/interrupt 形成正交分工。

## 5. 错误回执样例汇总（全部 -32600，均有真实文案）

| 场景 | message 原文 |
|---|---|
| 空 params | ``Invalid request: missing field `threadId` `` |
| 缺 input（用 prompt 串） | ``Invalid request: missing field `input` `` |
| expectedTurnId 失配 | ``expected active turn id `nonexistent-turn-id-000` but found `01a0b57a-757f-75b3-95de-3c475122898f` `` |
| 空闲态（无活跃 turn） | ``no active turn to steer`` |

被拒后无任何 notification 副作用、会话存活（§3.3 已证）。错误均走标准 JSON-RPC error 对象（code+message+id），无 stderr 崩溃、无 server 断连。

## 6. 关键副发现：`turn/started` 的 turnId 位置（task-03 必读）

0.147.0 实测 `turn/started` params 形状为 `{threadId, turn:{id,…}}`（§3.1 原文），**顶层没有 `turnId`**；而 `turn/interrupt` 的 params 才是顶层 `{threadId, turnId}`（v2 schema 与实机一致）。

当前 `sillyhub-daemon/src/interactive/codex-app-server-driver.ts:1483 _extractTurnId` 只读 `msg.params?.turnId`——在 0.147.0 上恒为 undefined → `currentTurnId` 永远为 null → `interrupt()`（:2305 的 `h.currentTurnId == null` 卫语句）恒返回 false。**task-03 接线 turn/steer（同样需要 turnId）时必须换提取点**，任选其一（均为实机验证过的来源）：

1. `turn/start` 响应 `result.turn.id`（§3.1 id=3 回执原文；最早可用，driver 现已收到该响应）；
2. `turn/started` 通知 `params.turn.id`（修 `_extractTurnId` 一行）；
3. 兜底：`item/agentMessage/delta` 通知 params 顶层有 `turnId`（§3.2 后续通知流可证）。

## 7. daemon 接线建议（供 task-03）

1. **参数组装**：`turn/steer {threadId, expectedTurnId: <当前活跃 turnId>, input: [{type:'text', text}]}`；`clientUserMessageId` 可选传平台消息 id 做关联。禁止用 prompt/message 串字段。
2. **turnId 来源**：按 §6 修正提取（推荐 turn/start 响应 `result.turn.id`，或 turn/started `params.turn.id`）。
3. **成功判定**：收到 id 匹配的 `{"result":{"turnId":…}}` 即受理；`turnId` 等于当前 turn id，不产生新 turn，**不得**当成新轮处理。
4. **被拒回落**：-32600 + 上述四类文案 → 按现有轮边界消费语义静默降级（会话存活已证），对用户可提示「当前不可转向」；`no active turn to steer` / `expected active turn id … but found …` 文案可直接透传诊断。
5. **UI 呈现**：steer 生效以 `item/started userMessage`（content[].text，同 turn）为可视化锚点，随后 reasoning/agentMessage 条目继续走既有 flat 映射；adapter 现有 parseItemStarted/parseItemCompleted 不处理 userMessage 类型——注入事件会被静默丢弃，task-03 若要在前端显示「已注入的转向消息」需补该分支（非本卡范围，仅记录）。
6. **并发语义**：expectedTurnId 是 CAS 卫语句——driver 现行「收到 turn/completed 才取下一条输入」的轮级串行天然不会撞失配；steer 与 interrupt 可并存（steer 后 interrupt，注入已排队的行为会被 interrupt 终止，本探测 S2→interrupt 序列即此情形，turn/completed status=interrupted 正常收敛）。

## 8. 结论

**总判定：可用（codex-cli 0.147.0 app-server 存在可用的 turn/steer 通道，参数形状已实机命中并验证行为闭环）。**

- **可用参数形状**：`params = { threadId: string(必填), expectedTurnId: string(必填, 须等于当前活跃 turn id), input: UserInput[](必填, 元素形如 {type:'text', text:string}), clientUserMessageId?: string|null }`。
- **成功响应形状**：`{"jsonrpc":"2.0","id":<请求id>,"result":{"turnId":"<当前活跃 turn id>"}}`（受理 ~1ms）。
- **被拒条件（实机四类）**：缺必填字段（serde 文案点名）、expectedTurnId 失配（CAS）、无活跃 turn（空闲态）、非 input 形状（prompt 串被拒）。被拒不炸会话。
- **行为语义**：受理后 steer 文本于下一模型调用边界以 userMessage 注入同 turn；不打断在途流式输出；turn id 不变；turn/completed 只发一次。
- **对 task-03**：按 §7 接线即可，**无「参数形状未命中」豁免**；另需按 §6 修 turnId 提取点（否则 interrupt/steer 全被 null 卫语句挡死）。
- **对 task-01**：codex caps 保持可转向取值（无需置 false 降级）。
