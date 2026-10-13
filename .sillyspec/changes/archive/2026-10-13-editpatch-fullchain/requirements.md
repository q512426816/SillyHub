---
author: flow-machine-draft
created_at: 2026-10-13T03:59:07.722Z
---
# 需求规格（Requirements）— 2026-10-13-editpatch-fullchain

## 功能需求

### FR-01: agent-log EditToolPreview 有 editPatch 渲染红删绿增 DiffView，无 patch 回退 LCS 行级 diff，超大输入回退既有红绿两块

- agent-log 视图 Edit 工具卡必须按三级渲染：entry 携带可解析 editPatch 时必须以 DiffView 渲染红删绿增行级 diff（structuredPatch 真实文件行号）；editPatch 缺失或解析失败时必须回退 computeLineDiff LCS 自算（片段相对行号）；旧/新文本乘积超 LCS 护栏（返回 null）时必须回退既有红/绿两块形态，禁止报错或空白。

#### 场景：patch 真实行号

Given 带 structuredPatch JSON 的 Edit 工具卡
When 渲染
Then 删除行红底、新增行绿底（行号取 hunk oldStart/newStart），标题含「变更对比」

#### 场景：LCS 回退与超大护栏

Given 无 editPatch 的 Edit 卡（old/new 可解析）
When 渲染
Then 走 computeLineDiff 行级 diff；输入超 100 万 LCS 单元格时回退既有红/绿两块（不渲染 DiffView）

### FR-02: daemon 消息解析在 claude 日志 toolUseResult.structuredPatch 存在时把 edit_patch 带到 tool_result 消息项，前端对话视图 Write/Edit 卡消费

- daemon claude-code 解析器必须在载体行顶层 toolUseResult.structuredPatch 为非空数组时将其序列化为 edit_patch 附着到该行 tool_result 段（超 64KB 整体不附着，禁止产出残缺 JSON）；backend AgentLogMessageItem 必须显式声明 edit_patch 透传（extra=ignore 下不声明即被剥离）；前端对话视图（agent-log-card）必须把配对 tool_result 段的 edit_patch 传入 Write/Edit 工具卡渲染。

#### 场景：daemon 附着

Given claude-code JSONL 载体行带 toolUseResult.structuredPatch（非空数组）
When parseClaudeCodeJsonlLog 解析
Then 该行 tool_result 段 edit_patch 等于序列化 JSON 串；create/缺字段/空数组/非数组/超 64KB → 缺省 undefined

#### 场景：全链透传与消费

Given daemon RPC 返回的 tool_result 消息项带 edit_patch
When 经 backend schema 校透传 + agent-log-card 配对成工具卡
Then Write/Edit 卡拿到 editPatch 渲染行级 diff；缺省项照常渲染无 patch 回退形态

### FR-03: 相关 daemon/backend/前端测试通过，gen:types 同步（若 backend schema 变更），既有行为零回归

- 本变更落地后必须跑相关三端测试并全绿（daemon agent-log 套件、backend messages + provider-caps 对齐、前端 agent-log + daemon 相关套件），backend schema 变更必须同步 `pnpm gen:types` 产物（backend/openapi.json + frontend api-types.ts）并提交，daemon/frontend typecheck 必须零错误；既有行为（会话面板、Write 无 patch 全文预览、其余工具卡）必须零回归。

#### 场景：三端回归

Given 三端相关测试套件与生成物守门
When 全部运行
Then 全绿 + typecheck 零错误 + gen:types 产物随本变更提交

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx「EditToolPreview diff 渲染（2026-10-13-editpatch-fullchain）」三用例
FR-02: sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts「行级 toolUseResult.structuredPatch（非空数组）→ edit_patch JSON 串附着该行 tool_result 段」等三用例 + backend/app/modules/platform_sync/tests/test_agent_log_messages.py「test_parsed_200_camelcase_to_snake_case」（edit_patch 透传断言）+ frontend/src/components/daemon/__tests__/agent-log-card.test.tsx（对话视图装配回归）
FR-03: sillyhub-daemon/tests/agent-log（全套 207）+ backend test_provider_caps_alignment.py + frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx 与 tool-args-detail.test.tsx（会话面板零改动回归）
