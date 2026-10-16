---
author: flow-machine-draft
created_at: 2026-10-16T05:37:22.887Z
---
# 需求规格（Requirements）— 2026-10-16-decision-pill-no-workspace

## 功能需求

### FR-01: session.workspace_id 为空的会话中，待决策 pill 正常渲染（只要有提问历史/pending）

- 真会话（sessionId 非空）且 session.workspace_id 为空/未解析时，待决策 pill **必须**照常渲染与工作（显隐只由组件自身的三类信息空判控制，禁止依赖 workspace_id）。

#### 场景：主路径

Given 会话 445e12d9（workspace_id 为空，存在 2 条已答 AskUser 提问）
When 用户打开 /sessions?session=445e12d9
Then 待决策 pill 渲染，展开已答历史列出 2 条（浏览器实测通过）

### FR-02: 变更文件 pill 在无 workspace 会话维持不渲染（原有显隐契约不变）

- session.workspace_id 为空时变更文件 pill **必须**维持不渲染（其 API 依赖 workspaceId，缺省零占位契约不变）。

#### 场景：主路径

Given 同 FR-01 会话
When 页面渲染完成
Then data-testid=session-change-files-hover 不在 DOM（浏览器实测通过）

### FR-03: 既有回归测试全绿

- 本变更**禁止**引入任何既有测试回归（决策 pill 组件测试 + 变更文件 pill 测试 + panel 渲染测试）。

#### 场景：主路径

Given 修复提交 9b5485fb0
When 跑相关 vitest 与 tsc --noEmit
Then 12/12 + 26/26 + 38 合并用例全绿、tsc 零错（实测通过）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：挂载条件在 session-panel-page 渲染分支内（页面级渲染测试未覆盖无 workspace 分支），由部署后浏览器实测覆盖（会话 445e12d9 实测通过，视觉证据随归档）
FR-02: 不适用：同上（同一次实测一并验证 changeFilesPill=0）
FR-03: frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx 全组 12 用例；frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx 全组（embedded 缺省回归）；frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx 全组
