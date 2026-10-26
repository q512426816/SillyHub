---
author: flow-machine-draft
created_at: 2026-10-26T07:07:30.293Z
---
# 需求规格（Requirements）— 2026-10-26-subagent-card-width-unify

## 功能需求

### FR-01: SubagentBlockView 两分支根容器（panel 紧凑卡片与纯展示）限宽统一为 max-w-[calc(100%-120px)]，不再铺满整行

- 会话消息流中的子代理嵌套卡（SubagentBlockView，panel 紧凑卡片与无 Provider 纯展示两分支）与团队分身卡（TeamWorkerBlockView）根容器**必须**限宽 `max-w-[calc(100%-120px)]`（整行宽度 − 120px，随父容器自适应），**禁止**继续铺满整行（原 `w-full self-stretch` 全宽形态）。

#### 场景：子代理卡不铺满

- Given 会话消息流渲染一个运行中子代理段（有 children）或 subagent_stub 段
- When SegmentView 渲染 SubagentBlockView（page 模式有面板 context 或无 context 纯展示）
- Then 根容器 className 含 `max-w-[calc(100%-120px)]` 且 `self-start`，与文本段（TextSegmentView）左缘对齐、右缘不达行尾

#### 场景：团队分身卡同步

- Given 会话消息流渲染团队 MCP 派发工具段（isTeamDispatchTool 命中 → TeamWorkerBlockView）
- When 组件挂载
- Then 根容器限宽口径与 FR-01 主场景一致

### FR-02: 进度视图工具调用卡（工具段容器）等 agent 侧信息块同步限宽，与文本段左对齐

- 进度视图与对话视图共用的过程信息行——工具调用行（ToolRowView）、思考行（ThinkingRowView）、警告行（StderrRowView）——根容器**必须**限宽 `max-w-[calc(100%-120px)]`，与文本段左缘对齐；行内子元素（工具名/摘要/耗时）随容器收缩，超宽仍按既有截断规则处理。

#### 场景：工具行限宽

- Given 消息流渲染一个 tool 段（无 children，普通工具调用）
- When ToolRowView 挂载
- Then 根容器 className 含 `max-w-[calc(100%-120px)]`；既有展开态（open）内容区随容器宽度收缩，不越界

### FR-03: 既有相关测试全绿，宽度断言同步更新

- 上述限宽行为**必须**有组件测试断言锁定（每类组件根容器至少一处 className 断言）；既有 turn-segment-views 相关测试套件**必须**全绿，因限宽调整导致的既有断言变化随本变更同步更新，**禁止**为躲断言而跳过测试。

#### 场景：断言锁定

- Given 修改后的组件代码
- When 跑 frontend vitest 的 turn-segment-views 套件
- Then 全部通过，且新断言覆盖 FR-01/FR-02 各组件根容器限宽类

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「子代理卡与团队分身卡根容器限宽断言（max-w-[calc(100%-120px)] + self-start）」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「工具/思考/警告行根容器限宽断言（max-w-[calc(100%-120px)]）」
FR-03: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「套件全绿（vitest run 该文件 + 既有断言零冲突）」
