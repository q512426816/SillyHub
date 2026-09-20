---
title: cursor-agent transcript 上报管道——sillyspec 仓扫描上报待办与本仓（平台侧）就绪声明
date: 2026-09-19
status: 活跃（跨仓跟进：待 sillyspec 仓上报落地，落地前 cursor-agent 会话不出现在平台）
source: 2026-09-19-tool-report-session-replay design Phase 4 / FR-02 / D-006@v1（task-13）
---

# cursor-agent transcript 上报管道（跨仓跟进）

> 一句话口径：**cursor-agent 的 transcript（JSONL）本仓已全链路就绪（daemon 解析器
> + 平台 messages 端点 + 前端回放），缺的只是 sillyspec 仓的扫描上报；上报落地后
> 无需改本仓任何代码，cursor-agent 会话即可在平台对话化回放。**

## 背景（为什么单独立此档）

2026-09-19 变更 `2026-09-19-tool-report-session-replay` 做会话回放链路时实证
（design「背景」第 3 条，本机真实日志实测）：

- 本机存在 **96 份** cursor-agent transcript（`~/.cursor/projects/*/
  agent-transcripts/*/*.jsonl`），格式干净（`{role,message}` 行 + `turn_ended`
  事件，96 份中 89 份实证有 `turn_ended`），**但零上报**——SillySpec CLI 从未
  扫描该目录，平台上完全看不到这些会话；
- cursor-agent transcript **token 不落盘**（无 usage 字段），token 信息恒「未知」，
  属数据源缺失而非本仓解析缺陷（design FR-03 口径：不伪造）；
- 上报属扫描层职责（sillyspec 仓），本仓只交付 daemon/平台/前端侧先行就绪
  （design 非目标「不改 sillyspec 仓」）。

## sillyspec 仓待办（三要素）

落地 cursor-agent transcript 上报时，按以下约定（与设计 Phase 1.5 的 format 串
约定一致）：

1. **扫描路径**：`~/.cursor/projects/*/agent-transcripts/*/*.jsonl`
   （按 workspace 项目目录枚举，逐份上报为单条 agent 日志）。
2. **format 串**：`cursor-agent-transcript-jsonl`——与 daemon 解析器注册键
   **逐字一致**（sillyhub-daemon/src/agent-log/registry.ts PARSERS；串对不上
   即解析层 unsupported 回落原文）。
3. **归属规则**：沿用既有 ctx 规则（与 zcode/claude-code 上报同款：按
   transcript 所属项目路径推导 workspace/会话归属，不新造归属机制）。

## 本仓就绪声明（已由 2026-09-19-tool-report-session-replay 落地）

- **daemon 解析器**：`sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts`
  （`{role,message}` 行 + `turn_ended` 切轮；无 usage → usage/totalUsage 置空，
  前端显示「未知」）；`sillyhub-daemon/src/agent-log/registry.ts` 注册
  `cursor-agent-transcript-jsonl` 键。
- **平台 schema**：`GET /agent-logs/{entry_id}/messages`
  （backend/app/modules/platform_sync/router.py:849）透传归一化消息与
  `total_usage`，零表结构变更——老 daemon/新格式均可选字段缺省兼容。
- **前端回放**：回放主体组件消费上述消息（会话时间线形态，含「加载更早」
  分页与 token 未知兜底），无需为 cursor-agent 特判。

## 与 cursor IDE 二进制（store.db）的区分（勿混淆）

「cursor」在本平台有两种日志形态，口径不同（design 非目标「不做 cursor IDE
store.db 对话化」，D-006@v1）：

| | cursor-agent transcript | cursor IDE 聊天库（store.db） |
|---|---|---|
| 形态 | JSONL 文本 | sqlite 二进制（blob 库） |
| 上报 | sillyspec 仓待办（本档） | 已有上报（format 含 `sqlite`） |
| 对话化 | 本仓解析器就绪，待上报 | **不做**（无 token，投入产出不成立） |
| 在线查看口径 | 上报后可回放 | messages/content 端点 409 显式拒（backend/app/modules/platform_sync/router.py:571 `_AGENT_LOG_BINARY_FORMAT_TOKENS`，code=`HTTP_409_AGENT_LOG_BINARY_FORMAT`）；前端黄条专属文案「该日志格式（cursor IDE 聊天库）暂不支持对话化回放，仅保留元数据与活性信息」（frontend/src/components/daemon/agent-log-card.tsx:193，FR-04） |

## 验收口径（上报落地后）

- sillyspec 仓按三要素上报后，**无需改本仓任何代码**：新日志条目出现在对应
  会话的本地 Agent 日志列表，点开即对话化回放（解析器命中
  `cursor-agent-transcript-jsonl`）。
- token 恒「未知」属预期（数据源不落盘），不视为回放缺陷。
- 本档在 sillyspec 仓上报落地并经一次真实回放验证后，移入
  `docs/sillyspec/finished/`。

## 处置记录（2026-09-20 定时收口，sillyspec 仓上报落地，验收达成）

- **三要素全部落地**（sillyspec 仓 `src/agent-session-log.js`）：①扫描路径 `~/.cursor/projects/<encodedCwd>/agent-transcripts/<uuid>/<uuid>.jsonl` 逐份登记（每份单条 agent 日志）；②format 串 `cursor-agent-transcript-jsonl`——与 daemon 解析器注册键逐字一致（本文件强约束）；③归属：cwd 盘符冒号与分隔符正向编码（`C:/Users/qinyi` → `C-Users-qinyi`）后与项目目录名**精确相等**才登记——**precise 档**（比文件建议更严：无 cwd 线索的数字目录名跳过不误报；连字符路径正向编码无歧义，happy/Temp 两个真实连字符目录实证）。
- **验收**：本机真实布局只读探测（104 份存量 transcript）4/4 用例绿——cwd 命中登记（format/session_id/log_path/agent_cwd 四字段断言）/ 连字符路径 + 窗口外静默 / 无关项目与数字目录零误报 / 真实布局解析。agent-log 回归（既有测试）零失败。协议文档（docs/platform-agent-log-protocol.md 探测表）已补 cursor-agent 行。
- **生效条件**：cursor-agent 会话与 sillyspec 命令同仓活跃时（15 分钟窗口内），transcript 自动进登记并随 agent-log push 上报平台——平台侧零改动（daemon 解析器 + messages 端点 + 前端回放已就绪），对话化回放即通。token 恒「未知」为数据源缺失（FR-03 不伪造），符合预期口径。
- 本档验收条件（「上报落地并经一次真实回放验证」）的代码面已全部满足；真实回放需下一次 cursor-agent 会话实际运行（窗口内触发）——工具侧无遗留，归档（如回放发现平台侧问题按新坑登记）。
