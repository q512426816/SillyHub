---
author: flow-machine-draft
created_at: 2026-10-13T03:16:53.101Z
---
# 需求规格（Requirements）— 2026-10-13-agentlog-write-diff

## 功能需求

### FR-01: normalize 数据链把 tool_result 行/事件的 edit_patch 配对写入对应 tool_call entry

- normalize 两轨（旧文本协议行 / AgentEvent v2 事件）在 tool_result 配对进工具卡时，必须把结果源携带的 structuredPatch JSON（旧轨行 edit_patch 列 / v2 轨事件 edit_patch 字段）以首条语义写入配对卡片的 `editPatch` 字段；非工具卡或无 patch 时必须保持 `editPatch` 为 undefined（零回归）。

#### 场景：旧轨行列拾取

Given tool_call JSON 行（带 tool_use_id）+ 后续 stdout [TOOL_RESULT] 行携带 edit_patch 列
When normalizeLogs 归一化
Then 结果行按 parent_tool_use_id（或邻近退化）合并进卡片，卡片 editPatch 等于该 JSON 串

#### 场景：v2 轨事件字段拾取

Given AgentEvent v2 的 tool_result 事件带 edit_patch 字段（行 edit_patch 列缺省）
When fromAgentEvent 按 call_id 配对工具卡
Then 卡片 editPatch 取事件字段值，mergedToolResult 照常回填

### FR-02: agent-log 视图 Write 工具卡有 editPatch 时渲染红删绿增 DiffView，无 patch 保持现有全文预览

- agent-log 视图 Write 工具卡在 entry 携带可解析 editPatch 时，必须以 DiffView 渲染红删绿增行级 diff（标题含「变更对比（覆盖写入 +N −M）」）并保留复制完整原文按钮；editPatch 缺失或解析失败时必须回退既有「内容预览」全文形态，禁止报错或空白。

#### 场景：覆盖写红删绿增

Given Write 工具卡配对了 structuredPatch JSON
When 渲染该卡片
Then 删除行红底、新增行绿底（真实文件行号），diff 区提供复制完整新文件内容按钮

#### 场景：无 patch 零回归

Given 无 editPatch（或非法 JSON）的 Write 工具卡
When 渲染该卡片
Then 保持既有「内容预览 (N 行)」全文 pre + 复制按钮，不出现变更对比区

### FR-03: 相关前端测试通过，不改动 Edit 预览与会话面板现有行为

- 本变更落地后，agent-log EditToolPreview 渲染与会话面板（daemon tool-args-detail / turn-segment-views）既有行为必须保持不变（既有用例零改动通过），且 normalize / 渲染新用例与相关回归测试必须全绿。

#### 场景：既有行为回归

Given normalize / normalize-dual-path / tool-args-detail / turn-segment-views 既有套件
When 跑全部用例
Then 全绿——Edit 预览与会话面板用例零改动通过，`pnpm typecheck` 零错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/agent-log/__tests__/normalize.test.ts「2026-10-13-agentlog-write-diff: edit_patch 配对到工具卡」四用例
FR-02: frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx「WriteToolPreview diff 渲染（2026-10-13-agentlog-write-diff）」三用例
FR-03: frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts（双轨等价回归）+ frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx + frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx（Edit 预览与会话面板零改动回归）
