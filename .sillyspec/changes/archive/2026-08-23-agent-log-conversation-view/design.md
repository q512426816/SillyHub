---
author: qinyi
created_at: 2026-08-23 20:46:41
updated_at: 2026-08-23 21:10:00
scale: large
modules: [platform_sync, daemon, frontend_components, frontend_lib]
---

# 设计文档（Design）— 本地 Agent 会话日志对话化回显（zcode MVP）

## 1. 背景

`2026-08-23-agent-activity-sessions` 落地「本地 Agent 会话」（tool_report）：CLI 上报
本地 harness 日志元信息 → 平台自动建会话 → 会话详情可「查看内容」。当前内容查看链路
（platform_sync/router.py:448 `read_agent_log_content`）经 ws rpc `host_fs.read_file`
读**文件尾部 256KB 原文**，前端 `agent-log-card.tsx:311` 用 `<pre>` 直出。

zcode 的 model-io 日志每行是一次完整 API 请求记录（含全量系统提示词 + 对话窗口 +
工具定义），实测单文件 3.6MB / 24 行、单行可达 150KB+——原文回显对人类完全不可读，
用户看不懂会话里到底发生了什么。

explore 调研 + Grill 实证（两份真实日志文件逐行解析验证）：zcode 格式可解析重建对话；
前端 `agent-log-viewer` / `agent-log/tool-renderers` 已有对话渲染组件（MarkdownText /
ToolCallPreview / ToolResultCard / CollapsibleSection），只缺归一化消息供给。

## 2. 设计目标（FR）

- **FR-01** zcode model-io 日志「查看内容」以对话流渲染：用户输入气泡、助手 Markdown
  正文、工具调用卡片（可展开输入/结果）、思考折叠；交互与平台会话「对话」视图同款。
- **FR-02** 解析在 daemon 本地完成（全量读文件），跨网络只传归一化消息（KB 级），
  替代 256KB 原文尾部口径。
- **FR-03** 解析失败 / 格式不支持 / daemon 未升级 / 文件已被轮换清理 → 自动回落现有
  原文 `<pre>` 查看或既有 404 文案，现状能力零损失。
- **FR-04** 二进制格式（dsh zstd / cursor sqlite）维持现有 409 拦截不变。
- **FR-05** 长会话按段窗口下发（最近 200 段 + 截断标记 + 按需加载更早），防大
  会话一次性 MB 级 payload。

## 3. 非目标（Non-Goals）

- 不做 claude-code / codex / pi 格式解析（二期按解析器注册表逐格式扩展）。
- 不改 tool_report 会话生命周期 / 懒激活 / 继续对话链路（纯只读查看增强）。
- 不落库消息内容（读即弃，与现有 content 端点同口径）。
- 不做解析结果缓存（每次查看实时解析；zcode 会轮换清理 rollout 文件，缓存反而
  造假数据）。
- 不复用 `session-log-assembler` 装配器（它是 daemon 实时协议流的分类/去重/撤回
  机器，靠 channel+文本前缀分类；转录解析已有显式 kind，走它需反向合成协议文本，
  且会踩其 AskUserQuestion 丢弃与 seenText 同文去重陷阱——Grill B2 裁决，
  见 D-006@v1）。

## 4. 拆分判断

单一功能（内容查看升级）、三侧薄改动（daemon 解析器 / backend 透传端点 / 前端渲染
替换）、强耦合不可独立交付 → 不拆分、不批量，一个 change（Wave 划分见 plan）。

## 5. 总体方案

```
前端 agent-log-card「查看内容 ▾」
   ↓ ① GET /api/agent-logs/{id}/messages?before_seq=（新）
backend platform_sync/router（scope 鉴权 + daemon 定位 + throw 错误映射，
        全部复用 read_agent_log_content 既有口径，抽共享 helper 防漂移；零解析）
   ↓ ② ws rpc: host_fs.read_agent_log_messages {path, format, beforeSeq?}（新方法）
daemon host-fs-handler（白名单校验同 read_file；not_found/forbidden 照旧 throw RpcError）
   ↓ ③ 解析器注册表（MVP 仅 zcode-model-io-jsonl；无解析器 → status:'unsupported'）
   ├─ 全量读文件（预算上限 20MB；超限 status:'too_large'）
   ├─ 逐行 parse → 窗口按绝对 offset 对齐合并（§5.1）
   ├─ 遍历合并序列产出段：user_input / reply / thinking / tool_use / tool_result
   │  （剥 role=system、request.body.system/tools、user 内容 <system-reminder> 块）
   └─ 段窗口截断（最近 200 段 + truncated + total_segments）
   ↓ ④ 归一化消息（KB 级 JSON）
前端：直构段列表（不走 session-log-assembler，见 §7.3），复用 tool-renderers
导出组件渲染；status 非 parsed / HTTP 非 200 → ⑤ 回落原文 <pre>（现状端点）
```

### 5.1 zcode 格式事实与窗口合并算法（Grill B1 修正版，两份真实文件实证）

**行结构**（type=model_io）：
`{request: {messages[], messageOffset, messageCount, messagesKind}, response: {text, toolCalls[], finishReason, usage}, attempt, completedAt, …}`

**messagesKind 实测三值**（样例 5e2ebe2b：full 21 / delta 5 / tail 13，该文件现已
被轮换不可复验，存活文件 delta 均 len≥2，统一规则下无害；fixture 保留 len=0 形状）：
- `full`：offset=0 的完整前缀窗口；
- `delta`：增量窗口（实测 offset=6/len=3、offset=36/len=0——len=0 表示本次调用
  无新消息、仅记录 response）；
- `tail`：滑动尾部窗口（offset>0，前缀被裁剪）。

**消息形状实测**（与 Anthropic content-block 形状不同，勿按块猜）：
- `role=user`：`content` 为**纯字符串**（可内嵌 `<system-reminder>…</system-reminder>`）；
- `role=assistant`：`content` 块仅有 `{type:'text'}` / `{type:'reasoning'}` 两种；
  工具调用在**消息级** `toolCalls: [{id, name, input}]`（不是 content 块）；
- `role=tool`：消息级 `{toolCallId, toolName, isError, content: 纯字符串}`；
- `role=system`：跳过不展示。

**合并规则（统一，无 kind 分支）**：维护全局数组 G，逐行执行
`G[messageOffset + i] = messages[i]`——full/delta/tail 三种窗口都按**绝对 offset
对齐覆盖**（full 恒 offset=0；delta/tail 是同一对齐规则的局部窗口）。行序天然保证
后写覆盖新版本；attempt>1 重试在实测样本中未出现（全 attempt=1），"后写覆盖取最新"
作为未验证假设登记 R-06。

**段产出**：按 index 遍历 G（跳过空洞 index——窗口未覆盖区）：
- user → 剥 `<system-reminder>` 块后非空才产出 `user_input` 段（R-04 修正：
  reminder 块绝不渲染成用户气泡）；
- assistant → text 块产出 `reply` 段、reasoning 块产出 `thinking` 段、消息级
  `toolCalls[]` 逐个产出 `tool_use` 段（id/name/input）；
- tool → `tool_result` 段（toolCallId 配对键、isError、content 摘要）。

**response 与 G 的双源裁决**（Grill B1.4 修正）：G 为历史权威——每行 response 的
输出会出现在**后续行**的窗口里（首行 response 被 CLI 从窗口丢弃除外）；仅**末行**
response 永远不会进任何窗口，需补产段（末行 response.text→reply、toolCalls→
tool_use）。补产前做同文去重（与 G 尾部 assistant 段文本比对，重复则跳过）。

**坏行容错**：单行 JSON.parse 失败 / 结构不符（缺 request 或 messages 非
数组）→ 跳过该行记 skipped_lines；坏行占比 > 50% → 整体 `parse_error`（回落）。

### 5.2 段窗口与加载更早

- 单次下发最近 **200 段** + `{truncated, total_segments}`；
- 「加载更早」带 `?before_seq=<最小seq>` 重解析后按 seq 切片（daemon 无状态，
  热文件轮换导致两次请求间内容变化时以最新解析为准，seq 不连续则截断标记兜底）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts | zcode 解析器：统一 offset 对齐合并 / 剥 system 与 reminder / 段产出 / 末行 response 补尾去重 / 200 段窗口。产出 `NormalizedLogMessage[]`（**producer**，字段 snake_case 与 §7.1 一致）→ host-fs-handler 返回 → ws rpc JSON → backend pydantic 校验透传 → openapi → 前端 api-types → agent-log-card 直构渲染（**consumer**） |
| 新增 | sillyhub-daemon/src/agent-log/registry.ts | 解析器注册表 `{format → parser}`；MVP 仅 `zcode-model-io-jsonl`（与 CLI 上报落库 format 串逐字一致），未注册 → status:'unsupported'（二期扩展点） |
| 修改 | sillyhub-daemon/src/host-fs-handler.ts | 新增 `readAgentLogMessages(path, format, beforeSeq?)`：白名单校验复用 `assertWithinAllowedRoots`；not_found/forbidden **照旧 throw RpcError**（与 readFile 同通道，Grill B3 裁决）；解析结果以 `{status, messages, truncated, total_segments, skipped_lines}` 正常返回 |
| 修改 | backend/app/modules/platform_sync/router.py | 新增 `GET /agent-logs/{entry_id}/messages`：scope 鉴权 / daemon 定位 / RpcError→HTTP 映射从 `read_agent_log_content`（:490-573）抽共享 helper 复用；status 一律 200 分层返回（前端判断回落，§7.2）；method-not-found（老 daemon）→ 422 `HTTP_422_AGENT_LOG_UNSUPPORTED`（唯一 422 场景） |
| 修改 | backend/app/modules/platform_sync/schema.py | 新增 `AgentLogMessagesResponse {status, messages, truncated, total_segments, skipped_lines}` + `AgentLogMessageItem {seq, kind, text, tool_name, tool_use_id, tool_input, tool_result, is_error, ts}`（字段与 daemon 产出逐字对齐，snake_case 沿用本模块既有惯例——AgentLogEntry 同款） |
| 修改 | frontend/src/lib/agent-logs.ts | 新增 `readAgentLogMessages(entryId, beforeSeq?)`；类型来自 `pnpm gen:types`（openapi 同步提交，规则 21） |
| 修改 | frontend/src/components/daemon/agent-log-card.tsx | 「查看内容」先调 messages 端点；status=parsed → 直构段列表渲染（§7.3）；否则回落现有 `readAgentLogContent` `<pre>`；面板加「对话/原文」切换与「加载更早」 |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成 |
| 新增 | sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts | 真实形状 fixture：full/delta(len=0)/tail 交错、消息级 toolCalls、字符串 content、system-reminder 剥离、末行 response 补尾、同文去重、坏行>50%、20MB 上限、before_seq 切片 |
| 新增 | backend/app/modules/platform_sync/tests/test_agent_log_messages.py | 新端点 scope / status 分层透传断言（parsed/unsupported/parse_error/too_large 均 200）/ method-not-found→422 / throw 通道复用（forbidden/not_found/离线/超时）测试 |
| 修改 | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx | parsed 渲染 + unsupported/parse_error/HTTP 失败回落 + 加载更早用例 |

## 7. 接口定义

### 7.1 daemon RPC（host_fs 命名空间，ws）

```ts
// host-fs-handler.ts
// 错误通道裁决（Grill B3）：not_found / forbidden 与 readFile 同通道 throw RpcError
//（backend 既有映射零改动）；以下 return 是「成功 RPC 的解析结果」，非错误。
readAgentLogMessages(path: string, format: string, beforeSeq?: number): Promise<{
  status: 'parsed' | 'unsupported' | 'parse_error' | 'too_large';
  messages: NormalizedLogMessage[];   // 仅 status=parsed 非空
  truncated: boolean;
  totalSegments: number;              // 仅 parsed 有意义
  skippedLines: number;
}>

// agent-log/parse-zcode-model-io.ts —— 字段 snake_case，与 backend schema 逐字对齐
interface NormalizedLogMessage {
  seq: number;                 // 全局段序（加载更早切片键；窗口空洞跳过后重编号）
  kind: 'user_input' | 'reply' | 'thinking' | 'tool_use' | 'tool_result';
  text: string | null;         // user_input / reply / thinking 正文
  tool_name: string | null;    // tool_use
  tool_use_id: string | null;  // tool_use 与 tool_result 配对键（消息级 toolCalls[].id / toolCallId）
  tool_input: string | null;   // JSON.stringify(input) 摘要（首 2KB 截断）
  tool_result: string | null;  // 结果文本摘要（首 4KB 截断）
  is_error: boolean | null;    // tool_result 专用
  ts: string | null;           // 所属行 completedAt
}
```

### 7.2 backend HTTP

```
GET /api/agent-logs/{entry_id}/messages?before_seq=<int>
→ 200 AgentLogMessagesResponse（status=parsed：渲染对话；unsupported/parse_error/
   too_large 同样 200，由前端判断回落——「RPC 成功≠解析成功」语义分层）
→ 404 中文（entry 越权/不存在；无绑定 daemon）——复用既有 code
→ 404 HTTP_404_AGENT_LOG_FILE_NOT_FOUND（daemon not_found=文件被轮换清理，复用）
→ 409 HTTP_409_AGENT_LOG_BINARY_FORMAT（format 二进制黑名单，共享 helper 含之，FR-04）
→ 409 HTTP_409_AGENT_LOG_READ_FORBIDDEN（白名单，复用）
→ 422 HTTP_422_AGENT_LOG_UNSUPPORTED（老 daemon method-not-found，唯一 422 场景）
→ 502/504 沿用既有网关/超时语义
```

前端约定：非 200、或 200 但 status≠parsed → 一律静默回落原文端点（黄条提示，
不弹错误框）。

### 7.3 前端渲染（Grill B2 修正：直构段列表，不走 session-log-assembler）

`session-log-assembler` 的 `AssemblerLogInput` **没有 kind 字段**——kind 由
`classifySessionLog` 按 channel+文本前缀协议推导（`[THINKING]` 前缀、channel=
'tool_call' 的 daemon JSON、`[TOOL_RESULT]` 前缀；session-log-assembler.ts:157-200）。
转录解析已有显式 kind，反向合成协议文本属于迂回，且会触发其丢弃规则（含
"AskUserQuestion" 的内容整行丢弃 :164）与 seenText 同文去重（同文本 tool_result
被吞）。故：

- agent-log-card 把 `NormalizedLogMessage[]` **直接**映射为渲染项：user_input →
  用户气泡；reply → `MarkdownText`；thinking → 折叠块；tool_use/tool_result 按
  `tool_use_id` 配对 → 复用 `agent-log/tool-renderers` 导出的 `ToolCallPreview` /
  `ToolResultCard` / `CollapsibleSection`（agent-log-viewer.tsx:25/56 同款导出）。
- 配对语义：**按 tool_use_id**（消息级 id，非装配器的位置配对）；tool_use 无对应
  result（窗口截断/中断）→ 渲染「结果未记录」中性徽章，**不得**复用「执行中 ⏳」
  （避免已结束会话假运行的既有陷阱语义）。入参 `ToolCallEntry`（agent-log/types.ts）
  是纯展示 DTO，由 NormalizedLogMessage 直接构造，无协议合成。
- 零依赖：agent-log-card 不 import session-log-assembler，两套数据通路互不影响。

## 7.5 生命周期契约表

本变更涉及 session/daemon 关键词但**不新增、不修改任何生命周期状态**（纯只读查看）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 查看内容（messages） | 前端 | backend | entry_id, before_seq? | 无（读即弃） |
| 解析请求（read_agent_log_messages） | backend | daemon | path, format, beforeSeq? | 无（无状态重解析；not_found/forbidden 走既有 throw 通道） |
| 回落查看（content） | 前端 | backend | entry_id | 无（现状链路） |

tool_report 会话自身状态机（pending→active↔ended）与懒激活链路零改动。

## 8. 数据模型

无表结构变更、无迁移。`platform_agent_logs` / `agent_sessions` 均只读。

## 9. 兼容策略（brownfield）

- 旧 `GET /agent-logs/{id}/content` 端点**保留不删**（回落路径 + 二进制格式唯一通道）。
- 老 daemon（无新 RPC 方法）→ method-not-found → backend 映射
  `HTTP_422_AGENT_LOG_UNSUPPORTED` → 前端回落，部署顺序无强依赖。
- 未使用新端点时所有现有行为不变（新端点增量；旧 UI 仅按钮行为升级）。
- `api-types.ts` 经 `pnpm gen:types` 再生成，无手写。
- zcode rollout 文件轮换：CLI 会清理旧文件（Grill 期间亲见样例被删）→ daemon
  not_found → 前端回落后同样 404 → 沿用既有「文件已被清理或移动」文案。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | zcode 日志格式无官方 schema，CLI 升级改字段（messagesKind/消息形状漂移） | P1 | 解析器防御式（未知 kind/缺字段行跳过计 skipped_lines）；坏行>50% → parse_error 回落；delta 已按实测三值处理，不再按两值假设 |
| R-02 | 20MB 预算内大文件逐行 JSON.parse 阻塞 daemon 事件循环 | P1 | 行级批处理每 500 行 yield；5s 超时保护 → parse_error 回落 |
| R-03 | 窗口空洞（index 不连续）导致段序错乱 / tool_use 与 result 跨窗口失配 | P1 | 空洞 index 跳过 + seq 重编号；配对按 tool_use_id 显式匹配（非位置）；失配渲染「结果未记录」不猜测 |
| R-04 | 原文含系统提示词/system-reminder 等敏感内容泄漏到对话视图 | P2 | 设计铁律：role=system、request.body.system/tools、user 内容 `<system-reminder>` 块永不进 NormalizedLogMessage；剥离后为空则整消息丢弃 |
| R-05 | 与前序变更 2026-08-23-agent-activity-sessions（未归档）并行改 agent-log-card.tsx 冲突 | P2 | 本变更基于其合并后 main；只动查看面板渲染分支 |
| R-06 | attempt>1 重试行的窗口语义未实证（样本全 attempt=1） | P2 | 按「后写覆盖取最新」处理；同文去重兜底；登记待真实样本验证 |
| R-07 | 热文件两次请求间被轮换/增长，before_seq 翻页窗口不连续 | P2 | seq 不连续时以最新解析为准，truncated 标记兜底；文件被删走 not_found 回落 |

## 11. 决策追踪

见 `decisions.md`。当前版本：D-001@v1（daemon 侧解析）、D-002@v1（MVP 仅 zcode）、
D-003@v1（失败回落原文）、D-004@v1（方案 A 用户确认）、D-005@v1（四段设计用户确认）、
D-006@v1（Grill 修正三裁决：真实格式事实重写 §5.1 / 前端直构不走装配器 / 错误双
通道分层）。全部被 FR-01~05 与 §5~§10 覆盖，无未解决决策。

## 12. 自审（Self-Review）

- 章节齐全：背景/目标/非目标/拆分/方案/清单（含数据流标注）/接口/生命周期契约表/
  数据模型/兼容/风险/决策/自审 ✓
- Grill fail→修正闭环：B1（§5.1 按实测三 kind + 真实消息形状重写，response 双源
  裁决定值）、B2（§7.3 直构段列表，规避 classify 协议合成与两陷阱）、B3（§7.1/§7.2
  错误通道裁决 + §6 字段逐字对齐含 tool_input/tool_result/is_error）——全部落实 ✓
- 生命周期契约表：涉及 session/daemon 关键词 → 已含（只读链路三事件，无状态变化）✓
- UI 原型：组件级变化（建议生成级）→ `prototype-agent-log-conversation-view.html`
  已在变更目录 ✓
- 数据流标注：NormalizedLogMessage producer→consumer 全链已标（§6 第一行）✓
- 事实锚定：本轮修正所引格式事实均经两份存活日志文件 python 逐行验证（kinds
  full/delta/tail 计数、消息级 toolCalls、tool 消息键集、user 字符串 content）；
  AssemblerLogInput 无 kind / classify 前缀协议 / AskUserQuestion 丢弃行均核对
  源码（session-log-assembler.ts:157-271）✓
- YAGNI：registry 抽象是二期扩展既有 format 契约的自然延伸；before_seq 是 FR-05
  刚需 ✓
