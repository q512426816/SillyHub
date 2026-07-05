---
author: qinyi
created_at: 2026-07-05 01:07:00
change: 2026-07-05-agent-log-type-tags
---

# Tasks

任务清单（粗粒度，Wave 分组与依赖在 plan 阶段展开）。每项列出：覆盖 FR / 涉及文件 / 覆盖决策。

## backend

### task-01: AgentRunLog 加 tool_kind 列 + alembic 迁移 + schema
- 覆盖：FR-01, FR-08（后端侧）
- 文件：
  - 修改 `backend/app/modules/agent/model.py`（AgentRunLog 加 tool_kind 列，line 285-358 区域）
  - 新增 `backend/migrations/versions/20260705xxxx_add_agent_run_log_tool_kind.py`（down_revision 接真实 head）
  - 修改 `backend/app/modules/agent/schema.py`（AgentRunLogEntry 加 tool_kind，line 128-140 区域）
- 决策：D-003@v1；风险：R-01

### task-02: backend classify_tool_kind 识别函数（Python）
- 覆盖：FR-02（Python 侧）, FR-04, FR-05
- 文件：
  - 新增 `backend/app/modules/agent/tool_kind.py`（classify_tool_kind + TOOL_KIND_VALUES）
  - 新增 `backend/tests/.../test_tool_kind.py`（全枚举 + 边界，与 TS 共享用例表）
- 决策：D-001@v1, D-002@v1

### task-03: backend run_sync 落库 + publish 填 tool_kind（双路径）
- 覆盖：FR-04, FR-05, FR-06
- 文件：
  - 修改 `backend/app/modules/daemon/run_sync/service.py`：
    - `_extract_sdk_messages`（1081-1137）interactive 打标（FR-04）
    - `submit_messages`（282-398）batch 兜底 + 落库填列（FR-05）
    - `published_logs.append`（400+）+ session_payload（147-154）两处 publish dict 加 tool_kind（FR-06）
- 决策：D-003@v1；风险：R-02, R-08

### task-04: backend GET /logs 加 ?tool_kind= query
- 覆盖：FR-07
- 文件：
  - 修改 `backend/app/modules/agent/router.py`（GET /logs 加 tool_kind: str | None = Query(None)，逗号分隔多选；385-403 区域）
  - 修改对应 service 查询方法（按 tool_kind IN 过滤）
- 决策：D-003@v1

### task-05: backend 单测（迁移 + 落库 + API + publish）
- 覆盖：FR-01, FR-04, FR-05, FR-06, FR-07
- 文件：
  - 新增 `backend/tests/.../test_agent_run_log_tool_kind.py`（迁移正反、落库填列、API 筛选、publish payload 含 tool_kind）
- 风险：R-01（PG 验证不只 SQLite）

## sillyhub-daemon

### task-06: daemon classifyToolKind 识别函数（TS）
- 覆盖：FR-02（TS 侧）
- 文件：
  - 新增 `sillyhub-daemon/src/tool-kind.ts`（classifyToolKind + TOOL_KIND_VALUES，注释互引 Python 版）
  - 新增 `sillyhub-daemon/src/tool-kind.test.ts`（同 Python 用例表）
- 决策：D-001@v1, D-002@v1；风险：R-05

### task-07: daemon task-runner tool_use 分支打标
- 覆盖：FR-03
- 文件：
  - 修改 `sillyhub-daemon/src/task-runner.ts`（tool_use 分支 1708-1798：调 classifyToolKind → tool_call JSON message 顶层加 tool_kind 字段；配对 stdout 文本行不加）
- 决策：D-001@v1, D-003@v1

## frontend

### task-08: frontend AgentRunLogEntry + toolKindMeta 映射
- 覆盖：FR-08, FR-09
- 文件：
  - 修改 `frontend/src/lib/agent.ts`（AgentRunLogEntry + StreamLogEvent 加 tool_kind: string | null；OpenAPI 重生成后对齐）
  - 新增 `frontend/src/components/agent-log/tool-kind-meta.ts`（toolKindMeta：14 枚举 + null 兜底，lucide 图标 + tailwind badge 着色，沿用 semanticCategoryMeta 风格）
- 决策：D-001@v1, D-002@v1, D-003@v1

### task-09: agent-log-viewer 第二层筛选 + 工具徽标渲染
- 覆盖：FR-10, FR-11
- 文件：
  - 修改 `frontend/src/components/agent-log-viewer.tsx`：
    - 现有 10 个 SemanticCategory 按钮（711）保留为第一层
    - 新增第二层「工具类型」按钮组（11 个：SillySpec/技能/命令行/读文件/写文件/搜索/子任务/网搜/清单/MCP/其他），多选 active Set
    - 第二层筛选逻辑：active 非空→只显示 tool_kind ∈ active 的 tool_call 行；非工具行不受影响
    - 每条 tool_call 行渲染工具徽标（type 徽标 + tool_kind 徽标并列）；tool_kind=null 显示灰色 tk-none 兜底
  - 样式参考 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/`
  - 新增/补充 `frontend/.../agent-log-viewer.test.tsx`（两层筛选正交、多选、兼容 null）
- 决策：D-003@v1；风险：R-03, R-07

## 待 plan 阶段细化

- Wave 分组（backend task-01~05 / daemon task-06~07 / frontend task-08~09 顺序依赖 + 部分可并行）
- 依赖：task-02/06（识别函数）是 task-03/07（打标）前置；task-01（迁移）是 task-03 落库前置；task-08 是 task-09 前置
- 测试矩阵：三端单测 + 端到端手动验收（成功标准 1-9）
