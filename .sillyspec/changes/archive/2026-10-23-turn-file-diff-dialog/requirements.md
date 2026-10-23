---
author: flow-machine-draft
created_at: 2026-10-23T00:07:59.907Z
---
# 需求规格（Requirements）— 2026-10-23-turn-file-diff-dialog

用户原话（成功标准来源）：「会话轮次结束会显示 变更文件卡片，但是具体变更内容点击没显示，这个应该要能显示的，弹窗形式」。

## 功能需求

### FR-01: 点击文件变更卡中的文件行，弹出模态弹窗显示该文件本轮的具体变更内容（diff 形式，带行号红删绿增）

- 会话页轮级文件变更卡（FileChangesCard）在已接线 sessionId 的挂载面**必须**允许点击文件行打开模态弹窗，弹窗内**必须**以 diff 形式（双侧行号 + 红删绿增，复用 DiffView）渲染该文件本轮的 structuredPatch 内容，数据源为本轮 agent_run_logs 的 edit_patch 列（tool_call 行按 tool_use_id 配对）。

#### 场景：主路径

- Given 一轮有文件变更卡且本轮日志含该文件的 Edit 补丁（tool_call 行 args.file_path 匹配 + tool_result 行 edit_patch），When 用户点击该文件行，Then 弹出模态弹窗并渲染带行号的红删绿增 diff，不发起后端/daemon 侧任何改动。

### FR-02: 同一文件多次编辑（改N次）在弹窗中按次展示多段 diff

- 同一文件在一轮内被编辑工具命中多次时，弹窗**必须**按编辑次序逐段展示各次 structuredPatch（每段标注来源工具名），**禁止**只显示首次或合并伪造成一段。

#### 场景：主路径

- Given 本轮日志中同一路径有两次 Edit 补丁，When 打开该文件弹窗，Then 呈现两段 diff，各带其工具名标注与次序。

### FR-03: 命令行归因/二进制等无补丁内容的行，点击后弹窗如实说明无补丁原因，不显示伪造内容

- 点击无可渲染补丁的文件行（source=shell 命令行归因、二进制、或日志中配不到 patch）时，弹窗**必须**打开并如实说明该形态下无补丁内容的原因，**禁止**渲染伪造的 diff 或空壳成功态。

#### 场景：主路径

- Given 一轮文件卡中某行 attribution=command（shell 归因），When 点击该行，Then 弹窗打开并显示「命令行/脚本改动，无补丁内容」类如实说明；Given 日志拉取失败，Then 显示加载失败说明（可重试），不显示假 diff。

### FR-04: 未接 sessionId 的旧消费方（agent-replay-body 等）零回归：行不响应点击、不出弹窗

- 挂载面未传 sessionId（TurnTimeline 新 prop 缺省）时，文件行**必须**保持现行为（不响应点击、无弹窗渲染），既有消费方（agent-replay-body / group-chat-panel / proto 页）**禁止**出现行为或视觉变化。

#### 场景：主路径

- Given TurnTimeline 未接 sessionId，When 渲染带快照的轮，Then 文件行无点击交互（data-clickable 语义与现行为一致或更明确）、DOM 中不存在弹窗节点。

### FR-05: 相关组件测试绿（纯映射配对逻辑 + 弹窗形态 + 挂载面接线）

- 本变更触及的前端测试面（新增配对纯映射单测、弹窗组件测试、turn-timeline 接线测试）与既有 file-changes / turn-timeline 回归面**必须**全绿，`tsc --noEmit` 零错误。

#### 场景：主路径

- When 运行 `cd frontend && pnpm test`（触及面文件）与 `pnpm exec tsc --noEmit`，Then 全部通过、零类型错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx「sessionId 接线：点击文件行弹窗打开，展示该文件本轮 diff 内容（FR-01）」（点击接线半边）+ frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「命中补丁：渲染路径标题 + 第 1 次 Edit 分段 + 行级 diff（红删绿增）」（渲染半边）
FR-02: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「同文件多次编辑按次展示多段」
FR-03: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「shell 归因行如实说明无补丁」
FR-04: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx「未接 sessionId 文件行不响应点击」
FR-05: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「日志配对纯映射」（配 frontend 触及面 vitest + tsc --noEmit 构建证据）
