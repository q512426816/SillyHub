---
author: flow-machine-draft
created_at: 2026-10-13T04:40:11.707Z
---
# 需求规格（Requirements）— 2026-10-13-editpatch-p3-cleanup

## 功能需求

### FR-01: daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）

- daemon claude-code 解析器的 edit_patch 附着上限必须按 UTF-8 字节数（Buffer.byteLength）判定：序列化字节数超上限时必须整体不附着（all-or-nothing 不变）；字符数低于 64 000 但字节数超限的 CJK patch 禁止附着。

#### 场景：CJK 字节超限

Given 载体行 structuredPatch 序列化含 30 000 个 CJK 字符（90 000 UTF-8 字节、30 000 字符）
When 解析
Then tool_result 段 edit_patch 缺省 undefined；字节不超限的 CJK patch（10 000 字符=30 000 字节）照常附着

### FR-02: agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）

- agent-log-card 装配必须存在一条直连断言用例：messages 端点 tool_result 段携带 edit_patch 时，经 segment.editPatch 到 ToolCallPreview 真实渲染路径，Write 卡必须渲染出变更对比 diff（红删行底 + 覆盖写入标题），防止装配接线被无声移除。

#### 场景：直连防回归

Given 对话化消息含 Write tool_use + 带 edit_patch 的 tool_result（配对成功）
When 展开对话视图渲染
Then Write 卡渲染红删绿增 diff 行与「变更对比（覆盖写入 +N −M）」标题

### FR-03: 相关 daemon/frontend 测试通过，既有行为零回归

- 本变更落地后 daemon agent-log 套件与 frontend 相关套件必须全绿、daemon typecheck 必须零错误；ASCII 超 64KB 不附着、字节内 CJK 附着等既有行为必须零回归。

#### 场景：回归

Given daemon agent-log 全套与 frontend agent-log-card/agent-log/tool-args-detail 套件
When 全部运行
Then 全绿 + daemon typecheck 零错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts「上限按 UTF-8 字节计（2026-10-13-editpatch-p3-cleanup）：CJK patch 字符数低于 64000 但字节超限 → 不附着；字节不超限 → 附着」
FR-02: frontend/src/components/daemon/__tests__/agent-log-card.test.tsx「edit_patch 直连：tool_result 段携带 structuredPatch 时 Write/Edit 卡渲染变更对比 diff」
FR-03: sillyhub-daemon/tests/agent-log（全套 208）+ frontend/src/components/daemon/__tests__/agent-log-card.test.tsx（21）+ frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx（既有超限/回退行为回归）
