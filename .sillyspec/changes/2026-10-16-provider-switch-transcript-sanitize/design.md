---
author: agent
created_at: 2026-10-16T08:32:38.925Z
---
# 设计记录（Design Record）— 2026-10-16-provider-switch-transcript-sanitize

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

新增 daemon 侧纯离线清洗内核 `sillyhub-daemon/src/interactive/transcript-sanitize.ts`，并在
`session-manager.ts` 的 `_reloadSessionNow` 供应商切换分支接上一个前置步骤：切换供应商（payload 判据
`providerSwitchPayload === true` 且引擎为 claude）时，先把该会话 transcript 里「上一家供应商私有、
新供应商必然无法解析」的块就地改写为等价 `text` 块，再 resume。

判定规则（单一真相导出常量）：私有调用块 = `server_tool_use` / `mcp_tool_use`（Anthropic 服务端工具块，
不是客户端 `tool_use`；第三方 Anthropic 兼容端点只认 `tool_use` ↔ `tool_result` 配对，实测 MiniMax
对这类块回 `400 ... tool result's tool id(...) not found`）；私有结果块 = 引用上述私有 id 的结果块
（`tool_result` 或 `*_tool_result`），无论它落在同一条 assistant 消息里还是相邻记录里。

改写方式**不做删除**：把每个脏块替换成一个 `text` 块（前缀「【历史清理】…」+ 原文内容），因此
① 记录条数、`uuid`、`parentUuid` 链完全不变（CLI resume 定位与追加逻辑零影响）；
② 原文本信息不丢（如 analyze_image 的分析正文仍留在上下文里）。
写盘前把原文件备份为 `<文件名>.bak-sillyhub-<ISO时间戳>`，写盘走既有 `writeFileAtomic`（要么旧全文
要么新全文）。清洗是幂等的：干净文件再跑 `changed=false`、零写盘零备份。

不选「请求期改写」：要给所有 anthropic 流量做代理改写，越权面/性能面/安全面都不可控。不选「只加错误
提示不改历史」：用户依旧无法在新供应商下继续该会话。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

daemon 内部模块，**无对外契约变化**（无 HTTP/WS 契约、无 DB 字段、无前端类型变化 → 本变更不需要
`pnpm gen:types`，`backend/openapi.json` 与两端 `api-types.ts` 零改动）。

新增导出（`sillyhub-daemon/src/interactive/transcript-sanitize.ts`）：

```ts
/** 供应商私有工具块类型（跨供应商重放不可解析，需清洗）。 */
export const PROVIDER_PRIVATE_TOOL_BLOCK_TYPES: ReadonlySet<string>; // {'server_tool_use','mcp_tool_use'}

/** 纯函数：给定 jsonl 全文 → 清洗后全文 + 命中计数（不落盘，供单测/预览）。 */
export function planTranscriptSanitize(text: string): {
  text: string;
  replacedBlocks: number;
  droppedRecords: number; // 恒 0（不删记录，为自证/审计对账留字段）
};

/** 文件级清洗：备份 + 原子改写（幂等；IO/解析异常不抛，返回 changed=false）。 */
export async function sanitizeClaudeTranscriptForReplay(
  filePath: string,
  opts?: { beforeWrite?: () => void | Promise<void> }, // 测试注入缝（并发写守护用例）
): Promise<{
  filePath: string;
  changed: boolean;
  replacedBlocks: number;
  backupPath: string | null;
}>;
```

行为变化（daemon `session-manager.ts`，同一分支内顺序固定）：
`providerSwitchPayload` 命中 → 既有 transcript 迁移（home↔isolated）→ **新增** transcript 清洗
→ 既有 `applyTranscriptConfigDir` 探测定位 → resume。清洗失败（返回 changed=false）仅
`console.warn('transcript_sanitize_failed'|'..._skipped', {...})`，**绝不抛、绝不阻断 reload**
（与 R-01「会话可用优先」同款降级）。

评审加固（2026-10-16 独立评审 P2-2 / P3-2）：
- **写前重读比对**——读盘基线与写盘前重读不一致（期间被追加/改写）→ 放弃本次清洗返回
  `changed=false`，杜绝「整文件原子顶替吞掉并发追加」；
- 结果块含非文本内容（图片等）时**如实计数标注**「另含 N 个非文本内容块…未保留」，文本为空时
  明说「该结果无文本内容」，不再谎称全量文本化。

错误可读性（`sillyhub-daemon/src/model-error/classifier.ts`）：**不新增 `ModelErrorType`**
（三端联合类型零变化）；按既有 `silentTruncation` 同款「签名覆写 message/hint」模式，新增
「供应商拒收历史」签名识别：命中时 message = 「供应商拒收会话历史（含上一家供应商专有内容块）」，
hint = 「历史里有上一家供应商专有的工具块，新供应商无法解析；平台内切换供应商已自动清洗历史，
若仍失败请切回原供应商或在新会话继续」，`type` 仍由 `classifyBlob` 判定（实测落 `unknown`），
`retryable` 保持 false（历史未修时重试必然复现，避免自动重试死循环）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：配对判定不依赖块顺序——第一遍收集文件内全部私有 id 全集，第二遍扫结果块比对，
   因此「同一条 assistant 消息内成对」与「调用/结果分散在相邻记录」两种形态都能命中。清洗本身幂等：
   已清洗文件重跑命中 0、零写盘、零备份。
2. **并发写**：清洗只发生在 reload 前置路径，而 reload 已按会话串行化（`_reloadChains` 链），同会话不会
   两个清洗并发；`writeFileAtomic` 保证任一观察时刻文件是旧全文或新全文；备份名带毫秒时间戳避免互覆。
   **修正如实（2026-10-16 独立评审 P2-2）**：旧 CLI 句柄的 close 发生在 `driver.start` 之后
   （`session-manager.ts` :2180 一带），因此清洗时刻旧进程**理论上仍存活**，存在「CLI 追加一轮 ↔ 清洗
   整文件顶替」的窄窗口（原先声称的「CLI 已 close」不成立）。守护：清洗在读写之间加**写前重读比对**
   （内容变了就放弃并 warn，绝不吞并发追加）＋备份先行＋幂等；不引入新锁（多一层跨进程文件锁不值当，
   而放弃清洗的最坏后果只是退回清洗前行为）。
3. **切换/生命周期**：清洗失败/文件不存在/JSON 行损坏 → 返回 `changed=false` 并继续 resume（最坏情况
   是维持清洗前的报错，不会因清洗把会话弄坏）；反向切换（切回本机默认，isolated→home）在同一分支内
   先清洗再迁移，落到宿主 ~/.claude 的副本同样干净——宿主**原件**在正向迁移里仍不被删改（既有约束不变）。
4. **作用域**：只处理「本会话 agentSessionId 对应的那一个 transcript 文件」，路径来自既有探测函数
   `findClaudeTranscriptPath`（按文件名在 `<configDir>/projects/*` 子目录**线性探测定位**——这是既有
   模块的既有行为，非本变更新增扫描）；不读其它会话内容、不跨仓、不碰其它项目文件；daemon 单实例
   假设与既有 per-session 目录约定一致。（措辞修正：2026-10-16 独立评审 P3-1——原文「不扫目录」与
   既有探测实现不符。）

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：把「工具块」降级成 text 块会改变历史的结构语义（模型看到的是一次纯文本陈述而非工具调用）。
  影响面评估：本次实证的私有块 `input` 为空、价值全在结果文本里，文本形态保留了全部信息，且优于
  「换供应商后该会话永久 400」。
- **死路 1（放弃）**：请求期代理改写——需要 daemon 代理全部 anthropic 流量，性能/安全/越权面不可控。
- **死路 2（放弃）**：直接删除脏块所在记录——会打断 `uuid`/`parentUuid` 链，CLI resume 可能失配；
  改为「替换成 text、记录条数不变」。
- **死路 3（放弃）**：直接删私有块、结果文本丢弃——丢上下文且无必要，文本化成本更低。
- **遗留（明确不在本变更范围）**：本机默认会话 + 用户手改宿主机 `~/.claude/settings.json` 换档的路径，
  平台无任何变更信号可挂钩，自动化清洗不覆盖；本变更以「分类器可读提示 + 一次性修复实证（task-02）」
  兜底，后续如需自动覆盖需单独立项（涉及平台是否代管宿主配置的取舍）。
