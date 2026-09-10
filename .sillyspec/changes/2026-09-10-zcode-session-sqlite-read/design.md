---
author: qinyi
created_at: 2026-09-10 11:25:56
scale: large
---

# 设计文档（Design）— zcode 会话读取恒走本地 SQLite（zcode-session-sqlite-read）

## 背景

「本地活动」zcode 会话的对话化/原文查看当前读 `~/.zcode/cli/rollout/model-io-sess_<id>.jsonl`
文件（CLI 扫描上报元数据，`format=zcode-model-io-jsonl`；daemon `host_fs.read_agent_log_messages`
RPC 读文件 + `parse-zcode-model-io.ts` 解析）。该文件生命周期极短——zcode 客户端在会话
结束后很快清理（实证：本机 rollout 目录仅存 3 个活跃会话文件，半小时前结束的会话文件已
消失），导致隔天点开「本地活动」会话即报「日志文件在目标机器上不存在（可能已被清理或
移动）」，历史会话完全不可回看。

实证发现 zcode 客户端自带本地长期库 `~/.zcode/cli/db/db.sqlite`（2.5GB）：

- `session` 表 1473 行，**与 `message` 表 distinct session_id 完全对齐**（全量覆盖，含
  主会话与子代理 `sess_subagent_agent_*`），带 `title` / `directory`（工作目录）/ `parent_id`；
- `message`（11.5 万行，data 含 role/time/model/tokens 等）+ `part`（43.7 万行，data 为
  `{type, text, …}` JSON，type 分布：tool / step-start / step-finish / reasoning / text /
  timeline / file）构成完整对话内容；
- 被清掉的死会话在库中完整存在（抽样 de7e1282：676 条消息 + 标题 + cwd）。

用户决策（三轮确认）：本仓改（sillyspec 仓零改动）；zcode 会话**恒读 SQLite**（文件存在
也不读文件）；原文视图同样从库合成；库读失败保留文件兜底；前端不标注数据来源；DB 路径
**不做 256KB 截断**（按会话查询天然有界，用户明确修正），仅文件回落路径保留原截断。

## 设计目标

1. zcode 会话对话化查看（messages 端点）数据源从 rollout 文件切换为本地 SQLite，
   历史会话（文件已被清理）可完整回看（FR-01）
2. 原文查看（content 端点）对 zcode 会话从库合成伪 jsonl 文本，同样不依赖文件；DB
   路径不截断，`truncated` 沿用对话窗口语义（FR-02）
3. 库读取失败（zcode 升级改 schema / 库损坏 / 会话不在库 / node:sqlite 不可用）自动
   回落现有文件路径——文件在即无感救回，双失败才按现状报错（FR-03）
4. 上报协议、API 响应形状、frontend、sillyspec CLI、liveness、claude/codex 链路零
   改动（FR-04）

## 非目标

- **不动扫描/上报**：sillyspec CLI 继续扫 rollout 短命文件上报元数据（发现只需会话
  活跃期文件存在，够用）；上报协议、`platform_agent_logs` 表、format 键全部不变
- **不动 liveness 五态**：`agent-log/liveness` 继续差量 tail rollout 文件（活跃会话
  文件在，语义不变）
- **不迁移/双写**：不把 SQLite 内容搬到平台库（用户明确不上传服务器），不建归档目录
- **不标注数据来源**：前端零改动，用户对数据源无感知
- **不做 schema 版本探测**：不做"检测 zcode 版本选解析器"——读取器查询异常即回落，
  容错优先于预判
- **claude / codex 不动**：其 format 分派与文件解析保持现状

## 拆分判断

单一连贯链路变更（daemon 读取器 → backend content 分支共享同一 messages RPC 通路），
分拆会产生中间态（库读取器有了但 raw 还读文件），不拆。Wave 按"daemon 读取器（纯新
模块+测试）→ daemon 分派接线 → backend content 分支"纵向推进，每 Wave 独立可测。

## 总体方案

### Phase 1 — daemon：SQLite 读取器（纯新模块）

新增 `src/agent-log/read-zcode-sqlite.ts`：

- **sess id 提取**（纯函数）：从上报 `log_path` 文件名解析
  `model-io-sess_<id>.jsonl` / `model-io-sess_subagent_agent_<id>.jsonl` → `<id>`
  即 `session.id`（子代理同规则，已实证在库）。
- **开库**：惰性 `import('node:sqlite')` → `DatabaseSync`，URI
  `file:<homedir>/.zcode/cli/db/db.sqlite?mode=ro` 只读打开（WAL 并发读安全）。
  `node:sqlite` 导入失败（Node <22.5）或库文件缺失 → 抛读取器不可用 → 调用方走
  文件回落。**engines 不 bump**：旧 Node 环境自动降级文件路径，非瘫痪。
- **归一化**（双层遍历 `message`（按 sequence）×`part`（按 message_id + sequence）→
  `NormalizedLogMessage[]`）。映射表字段已经独立审查代理对本机真实库只读实证（X-Grill
  DB-01/X13/X14/X16，抽样 5000 tool part + 400 user 消息）：

  | SQLite 侧 | NormalizedLogMessage |
  |---|---|
  | message.role=user 且**非隐藏**下 part.type=text | kind=user_input，text |
  | message.role=assistant 下 part.type=text | kind=reply，text |
  | part.type=reasoning | kind=thinking，text |
  | part.type=tool（单条即含调用+结果：data={tool, callID, state:{status, input, output\|error, …}}） | **一条 part 产两段**：tool_use（tool_name=tool / tool_use_id=callID / tool_input=state.input 2KB 摘要）+ tool_result（tool_result=state.output 4KB 摘要，is_error=(status=='error')，附 tool_name）；state.status ∈ running/pending（无 output）时只产 tool_use 段不产 result 段 |
  | message 隐藏标记：data.semantics.uiVisibility=='hidden' \|\| transcriptVisibility=='hidden' \|\| visibility=='model-only' | 整条 message 跳过（实测 user 侧 11,785 条中 9,124 条为系统注入，不过滤会产生大量假用户气泡；对齐文件 parser 剥 `<system-reminder>` 的 R-04 同语义） |
  | part.type=step-start / step-finish / timeline / file / compaction | 忽略（边界/元数据段） |
  | part.type 为任何**未知类型** | 防御式忽略（skippedLines 计数；实测现存 7 类，未来新增类型不炸） |
  | message.data.time.created | ts（数值毫秒 → ISO；注意 time 是 {created, completed} 对象，取 created） |

  seq 全局重编号（1 起）；`beforeSeq` 切片语义与 `parse-zcode-model-io` 对齐（「加载
  更早」翻页不受影响）；段窗口/预算口径对齐现有 parser（truncated + totalSegments）；
  坏行（data 非法 JSON / 字段缺失）跳过计数 skippedLines，不中断。

- **node:sqlite 生效版本**：≥22.13.0 或 ≥23.4.0（官方去 flag 版本带；22.5–22.12 /
  23.0–23.3 虽有模块但带实验 flag，导入即抛错 → 走文件回落）。engines 不 bump 决策
  不变：旧环境自动降级。TS 侧 `@types/node`（现 20.14，无 node:sqlite 声明）需 bump
  至 22.13+ 或加本地 .d.ts 声明（devDep 变更，不影响运行时分发）。

### Phase 2 — daemon：分派接线（host-fs-handler）

`readAgentLogMessages`（host-fs-handler.ts）现流程：**allowed_roots 守卫
（assertWithinAllowedRoots）→ registry 按 format 查 parser（未注册→unsupported 不读
文件）→ lstat → 20MB 预判 → 读文件 → 解析**。改造为：守卫通过后、registry 分派前，
**format=`zcode-model-io-jsonl` 先走 Phase 1 读取器**（守卫先行是安全铁律——SQLite
分派不得绕过越界检查）；读取器抛"不可用/查不到/查询异常"→ 落回现流程（lstat + 文件
解析），文件也缺才按现状 `not_found` RPC 错。registry.ts 纯映射职责不变（读取器不经
registry 分派，避免把"文件内容解析"注册表语义扩成"数据源路由"）。claude/codex format
路径零触碰。

### Phase 3 — backend：content 端点 zcode 分支

`read_agent_log_content`（platform_sync/router.py）：`entry.format=zcode-model-io-jsonl`
时，先发既有 `host_fs.read_agent_log_messages` RPC（同 `_send_agent_log_rpc` 通路，
rpc_args 已含 format/beforeSeq，通路现成）：
- `status=parsed` → 将 messages 序列化为伪 jsonl 文本：**固定九字段逐行全量 JSON**
  （seq/kind/text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts，封闭列举，
  不加省略号），返回 `{content, truncated=resp.truncated, size_bytes=len(content)}`——
  **不截断**（按会话查询天然有界，窗口即上界）；
- `status=unsupported/parse_error/too_large`（即库+文件双失败后的文件解析降级）或
  RPC 抛错（含 not_found 404、**method_not_found 422 老 daemon**、离线/超时类）→
  回落现有 `read_file` 路径（离线/超时类双跳延迟可接受），该路径保留原 256KB 尾部
  截断语义一字不改。

### 数据流（对外字段语义微调标注）

`AgentLogContentResponse.truncated`：producer=daemon messages RPC 窗口语义（zcode DB
路径，Phase 3 透传 `resp.truncated`）或既有文件尾部截断（回落路径）→ consumer=
frontend agent-log-card「已截断」提示。响应 shape 不变，仅 zcode 路径下 truncated 的
含义从"文件尾 256KB 截断"变为"对话窗口截断"。`size_bytes` 语义同步为合成文本长度。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts | SQLite 读取器：sess id 提取（纯函数）/ node:sqlite 惰性只读开库 / message+part 归一化（映射表见总体方案，字段已实证）/ beforeSeq 窗口 / 坏行容错 |
| 修改 | sillyhub-daemon/package.json | devDep @types/node bump 至 22.13+（node:sqlite 类型声明；仅类型层，不影响运行时 engines 与分发） |
| 修改 | sillyhub-daemon/src/host-fs-handler.ts | readAgentLogMessages：allowed_roots 守卫后、registry 前，zcode format 先分派 SQLite 读取器，失败回落现有文件读取+解析流程（内部实现变化，RPC 响应形状不变） |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts | fixture SQLite 库（按真实 schema 造数）：主会话/子代理/空会话/工具单 part 产两段（含 running/pending 无 result）/隐藏消息过滤（hidden 三判据）/未知 part 类型防御忽略/坏行/beforeSeq 窗口/开库失败 |
| 新增 | NEW:sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts | 分派优先级：库成功不碰文件 / 库失败文件在=成功 / 双失败=not_found；claude format 不走新分支 |
| 修改 | backend/app/modules/platform_sync/router.py | read_agent_log_content：zcode format 先 messages RPC 合成伪 jsonl（不截断），失败回落 read_file 原路径（含 256KB）；truncated 数据流见上节 |
| 修改 | backend/app/modules/platform_sync/tests/test_agent_log_content.py | zcode 合成分支 / messages 失败回落 read_file / claude format 不走新分支 |

无 schema 迁移、无上报协议变更、无 frontend 变更、无 sillyspec CLI 变更。

## 验收要点

1. 文件已清理的历史 zcode 会话：对话化视图完整渲染（含 user/reply/thinking/工具配对），
   原文视图返回合成伪 jsonl，均不再报"文件不存在"
2. 活跃 zcode 会话（文件在）：同样走库（数据源一致性），「加载更早」翻页正常
3. 库读失败回落：模拟库缺失 + 文件在 → 走文件解析成功；库+文件双缺 → 现状错误语义
4. claude/codex 会话查看行为逐字节不变（回归）
5. Node <22.5 环境（node:sqlite 不可用）：自动全走文件路径，不崩

## 风险与对策

- **zcode 升级改 schema**（库内部实现，已有 18 个 migration）：读取器查询异常 → 自动
  文件回落（活跃会话无感；历史会话短暂回到"文件不存在"提示，可接受降级）；execute
  阶段用真实库全量冒烟（本机 1473 会话抽样核对 kind 分布无异常放大）
- **大会话合成文本体积**：窗口即上界；伪 jsonl 单行含 text/tool_result 摘要（2KB/4KB
  截断沿用现有摘要口径），初窗体积量级与现有文件解析窗口一致
- **并发读安全**：只读连接 + WAL；不设 busy_timeout 长等待（读失败即回落，不阻塞 RPC 预算）
