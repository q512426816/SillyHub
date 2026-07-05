---
author: qinyi
created_at: 2026-07-05 01:06:00
change: 2026-07-05-agent-log-type-tags
---

# Requirements

## 角色

| 角色 | 描述 |
|---|---|
| 平台用户 | 在前端 agent 日志查看器查看 agent 执行日志的人，需要按工具类型筛选/定位 |
| daemon | tool_use 事件采集方（batch 路径），打 tool_kind 标签 |
| backend | 日志落库 + API 提供方（interactive 路径兜底打标 + publish payload） |
| frontend | 日志渲染 + 筛选 UI（两层筛选 + 工具徽标） |

## 功能需求

### FR-01: AgentRunLog 加 tool_kind 结构化列
覆盖决策：D-003@v1

**Given** agent_run_logs 表存在且只有 channel 分类列
**When** 执行 alembic 迁移 upgrade
**Then** 表新增 `tool_kind VARCHAR(32) NULL` 列 + 单列索引 `ix_agent_run_logs_tool_kind`；downgrade 删列+索引可逆

**Given** down_revision
**When** 多分支并行开发存在
**Then** down_revision 接 `alembic heads` 确认的当前真实 head，避免迁移链断裂（R-01）

### FR-02: classify_tool_kind 识别函数（Python + TS 同逻辑）
覆盖决策：D-001@v1, D-002@v1

**Given** tool_name="Bash" 且 args.command 含 "sillyspec" 子串
**When** 调用 classify_tool_kind("Bash", {command: "sillyspec run execute && git add"})
**Then** 返回 "sillyspec"

**Given** tool_name="Bash" 且 command 不含 sillyspec
**When** 调用 classify_tool_kind("Bash", {command: "ls -la"})
**Then** 返回 "bash"

**Given** tool_name="Skill"
**When** 调用 classify_tool_kind("Skill", {skill: "sillyspec-execute"})
**Then** 返回 "skill"（不分子技能名）

**Given** tool_name="mcp__playwright__browser_navigate"
**When** 调用 classify_tool_kind
**Then** 返回 "mcp"（所有 mcp__ 前缀统一一类，D-002@v1）

**Given** tool_name=None 或空 / 未知工具名
**When** 调用 classify_tool_kind
**Then** 返回 None（非工具）/ "other"（未知）

**Given** Python 版与 TS 版同一 (tool_name, args) 输入
**When** 两端分别调用
**Then** 返回值相同（共享单测用例表，R-05）

### FR-03: daemon task-runner tool_use 分支打标（batch 路径）
覆盖决策：D-001@v1

**Given** daemon 收到 tool_use 事件，md.tool_name + md.tool_input 可用
**When** task-runner.ts:1708-1798 处理 tool_use 分支
**Then** 调 classifyToolKind 得 tool_kind，写入 tool_call JSON 那条 message 的顶层 tool_kind 字段；配对的 stdout `[TOOL_USE]` 文本行不带

### FR-04: backend _extract_sdk_messages interactive 打标
覆盖决策：D-003@v1

**Given** interactive 路径收到结构化 SDK tool_use block（btype==="tool_use"，有 tool_name + input）
**When** run_sync/service.py:1081-1137 展开 SDK 消息
**Then** 调 Python classify_tool_kind 识别，落库时填 tool_kind 列

### FR-05: backend submit_messages batch 兜底
覆盖决策：D-003@v1

**Given** batch 路径 daemon 上报的 message
**When** submit_messages（282-398）落库
**Then** msg.get("tool_kind") 优先；缺则对 channel='tool_call' 行 JSON.parse(content) 取 tool/args 调 classify_tool_kind 兜底；stdout 文本行不兜底（tool_kind=NULL）

### FR-06: publish payload 两处带 tool_kind（SSE 实时流）
覆盖决策：R-08

**Given** submit_messages 落库一条 tool_call 日志
**When** 构造 published_logs.append（400+）+ session_payload（147-154）
**Then** 两处 dict 都含 "tool_kind" 字段；前端 SSE 实时流能拿到标签

### FR-07: GET /logs 加 ?tool_kind= 筛选
覆盖决策：D-003@v1

**Given** GET /workspaces/{ws}/agent/runs/{run_id}/logs?tool_kind=sillyspec,skill
**When** 后端处理 query
**Then** 返回 channel=tool_call 且 tool_kind IN (sillyspec, skill) 的日志行

**Given** GET /logs 不传 tool_kind
**When** 后端处理
**Then** 返回全部日志（向后兼容）

### FR-08: 前端 AgentRunLogEntry 加 tool_kind 字段
覆盖决策：D-003@v1

**Given** OpenAPI 生成的 AgentRunLogEntry 类型
**When** 后端 schema 加 tool_kind + OpenAPI 重生成
**Then** frontend/src/lib/agent.ts 的 AgentRunLogEntry + StreamLogEvent 都有 tool_kind?: string | null

### FR-09: toolKindMeta 徽标映射
覆盖决策：D-001@v1, D-002@v1

**Given** tool_kind = "sillyspec" / "skill" / "bash" / ... / null
**When** 调 toolKindMeta(tool_kind)
**Then** 返回 {label, Icon, badgeClass}：sillyspec→紫红/技能→玫红/...；null→灰色通用「工具」徽标；视觉沿用 semanticCategoryMeta 模式

### FR-10: agent-log-viewer 第二层筛选按钮组（多选）
覆盖决策：D-003@v1

**Given** 用户在 agent 日志查看器
**When** 第一层选中「工具」或「全部」
**Then** 显示第二层「工具类型」按钮组（SillySpec/技能/命令行/读文件/写文件/搜索/子任务/网搜/清单/MCP/其他）

**Given** 第二层点亮 SillySpec + 技能
**When** 渲染日志列表
**Then** 只显示 tool_kind ∈ {sillyspec, skill} 的工具调用行；非工具行（assistant/thinking/...）不受第二层影响；清除筛选恢复全部

### FR-11: 工具徽标渲染（含旧日志兼容）
覆盖决策：D-003@v1

**Given** 一条 channel=tool_call 的日志行
**When** 渲染
**Then** 在 type 徽标旁渲染 toolKindMeta(tool_kind) 工具徽标

**Given** 一条 tool_kind=NULL 的旧 tool_call 日志行
**When** 渲染
**Then** 显示灰色通用「工具」徽标（tk-none 风格），不报错，第二层筛选不命中

## 非功能需求

- **兼容性**：旧日志（tool_kind=NULL）向后兼容显示；旧 daemon 上报无 tool_kind 时 backend 兜底；API 不传 tool_kind 返回全部；前端 AgentRunLogEntry.tool_kind 可选。
- **可回退**：迁移 downgrade 删列+索引；代码回退后旧逻辑恢复，无数据损失。
- **跨平台**：Python + TS 双实现同逻辑，共享单测用例表（R-05）。
- **性能**：tool_kind 加索引，按标签筛选查询走索引；前端筛选纯客户端 O(n)。
- **可维护**：参照项目既有 AgentArtifact.kind 模式 + semanticCategoryMeta 配色；样式遵守 CLAUDE.md 规则 16（archive/2026-06-21-frontend-style-system）。
- **测试**：三端单测覆盖（FR-02 全枚举、FR-03/04/05 双路径、FR-06 publish、FR-10/11 前端筛选+兼容）。

## 决策覆盖关系

| 决策 | 覆盖 FR | 覆盖 design 章节 |
|---|---|---|
| D-001@v1 SillySpec 识别策略（子串匹配，不分子命令） | FR-02, FR-03, FR-09 | §5 Phase 2、§7、R-06 |
| D-002@v1 MCP 统一一类 | FR-02, FR-09 | §5 Phase 2、§7、R-04 |
| D-003@v1 加 tool_kind 结构化列（方案 B） | FR-01, FR-04, FR-05, FR-07, FR-08, FR-10, FR-11 | §5、§6、§8 |

无未解决决策。
