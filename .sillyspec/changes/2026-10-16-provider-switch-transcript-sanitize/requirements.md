---
author: agent
created_at: 2026-10-16T08:32:38.925Z
---
# 需求规格（Requirements）— 2026-10-16-provider-switch-transcript-sanitize

## 功能需求

### FR-01: 平台内切换供应商时，resume 前必须清洗 transcript 里的供应商私有块

平台内核**必须**在「reload 检测到 provider 实际变化（`providerSwitchPayload`）且引擎为 claude」时，
于 resume 之前清洗该会话 transcript 里的供应商私有块：把 `server_tool_use` / `mcp_tool_use` 块
及引用其 id 的结果块（`tool_result` / `*_tool_result`）替换为等价 `text` 块（保留原正文）；
清洗前**必须**备份原文件；**禁止**改变记录条数与 `uuid` / `parentUuid` 链；清洗探测不到文件或内部
异常时**必须**降级为「仅告警、不阻断 reload」（R-01），**禁止**因清洗把会话弄坏。

#### 场景：主路径——切供应商后 resume 读到的历史已干净

Given 会话历史含上一家供应商的私有块对（实证形态：同一条 assistant 消息内 `server_tool_use`
+ 同 id `tool_result`），且 transcript 位于宿主机目录；
When 平台把该会话切到另一供应商并 reload（迁移 → 清洗 → resume）；
Then 隔离副本中该私有 id 消失、原正文以 `text` 保留、记录条数与链路字段不变、备份文件落盘，
宿主原件不被改写，且新供应商 env 与 resume key 不受影响。

#### 场景：边界——非切换轮不清洗 / 探测不到则不阻断

Given 同一份含私有块的历史；
When 只切人格（payload 不带 `providerConfig`）或探测不到 transcript；
Then 历史零改写、零备份（非切换轮），且 reload 照常成功（降级路径）。

### FR-02: 清洗后的历史必须能被真实新供应商接受（实测证据）

清洗后**必须**保证出站请求不再含 `server_tool_use`、不再出现无配对 `tool_result`；对真实
MiniMax Anthropic 兼容端点**必须**能取得 200（对照实验：同一对私有块未清洗时该端点回
`400 invalid params, tool result's tool id(...) not found (2013)`）。

#### 场景：对照实验——同一形态两种编码，端点一拒一收

Given 一段最小化 payload（含 `server_tool_use:analyze_image` + 同 id `tool_result`）；
When 分别以「原形态」与「等价 text 形态」请求真实端点；
Then 前者 400（错误文案与事故现场逐字一致）、后者 200（正常 completion）；且对实证会话的
清洗后 transcript 抓包，出站请求 `tool_use` 与 `tool_result` 计数完全配平、无私有块。

### FR-03: 模型错误分类器必须识别「供应商拒收历史」签名并给出可执行提示

`classifyModelError` **必须**在命中该 400 签名（`tool result's tool id … not found` /
`tool_use_id … not found` 形态）时覆写 `message` / `hint` 为可执行中文（不再落兜底「运行失败」+
`hint=null`）；**禁止**新增 `ModelErrorType`（daemon / backend / frontend 三端联合类型零变更）；
该签名**必须**保持 `retryable=false`（历史未清洗时重试必然复现，避免自动重试刷同一失败）。

#### 场景：签名命中与不误伤

Given 实证错误原文 / 变体文本 / 不含该签名的普通 400；
When 走归类器；
Then 前者得「拒收会话历史」提示且 `type=unknown` / `code=400` / `retryable=false` 不变，
后者保持兜底文案（不误命中）。

### FR-04: 守护测试必须覆盖清洗内核三类形态、链路完整性与备份

清洗内核**必须**有守护测试覆盖：同消息配对 / 跨记录配对 / 无脏块三类形态，记录链路（条数 +
`uuid`/`parentUuid`）完整性，备份存在且等于原文，幂等（二次清洗 `changed=false` 零备份），
以及 `mcp_tool_use` / `*_tool_result` 家族；接线层**必须**覆盖「切换清洗 / 非切换不清洗 /
探测不到降级」；分类器签名**必须**有用例；相关 daemon 测试与 `tsc` **必须**全绿。

#### 场景：测试面全绿

Given 本变更的三份测试文件与既有 interactive 套件；
When 跑 `vitest run tests/interactive tests/transcript-sanitize.test.ts tests/model-error/classifier.test.ts` + `tsc --noEmit`；
Then 全绿零失败。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts「SAN-1 切供应商 → 隔离副本被清洗（私有 id 消失 + 记录链不变 + 备份落盘），宿主原件不动」/「SAN-2 无供应商变更（config-only reload）→ 历史零改写、零备份」/「SAN-3 探测不到 transcript → 清洗降级跳过，reload 照常成功（R-01）」；内核词法面：sillyhub-daemon/tests/transcript-sanitize.test.ts「成对私有块（同消息）…」等 11 例
FR-02: 不适用：真实供应商端点不入单测（凭据/成本/网络外依赖）——实证留痕：出站请求抓包（清洗后 637 消息、tool_use 309 / tool_result 309 配平、无 server_tool_use）+ 真实端点对照（原形态 400 / 等价 text 形态 200），见本变更收口证据
FR-03: sillyhub-daemon/tests/model-error/classifier.test.ts「实证 MiniMax 400 文案 → message/hint 覆写为可执行中文提示（type/retryable 不变）」/「tool_use_id 变体（not found）同样命中覆写」/「不含该签名的普通 400 不误命中（保持兜底文案）」
FR-04: sillyhub-daemon/tests/transcript-sanitize.test.ts（11 例：三类形态 + 幂等 + 备份 + 链路 + 非法行透传 + 私有集合单一源）+ session-manager-config-switch SAN-1/2/3 + model-error/classifier.test.ts 3 例；实测：`vitest run tests/interactive tests/transcript-sanitize.test.ts tests/model-error/classifier.test.ts` 79 文件 1276 例绿 + `tsc --noEmit` 零错
