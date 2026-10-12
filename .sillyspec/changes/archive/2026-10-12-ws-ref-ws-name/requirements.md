---
author: flow-machine-draft
created_at: 2026-10-12T03:45:00.000Z
---
# 需求规格（Requirements）— 2026-10-12-ws-ref-ws-name

## 功能需求

### FR-01: 悬停浮层显示工作区中文名（别名优先），查不到回退 id

- 必须：tooltip 的「工作区 X」段必须显示 desc.workspaceName（portal 组装时 display_alias ?? name 填充）；名称缺失时必须回退 workspaceId，禁止空白。

#### 场景：主路径

Given 工作区列表已加载（名称 SillyHub）/ When 插入引用并悬停 / Then 浮层显示「（工作区 SillyHub）」。

### FR-02: 不新增网络请求

- 必须：名称查询必须复用工作区列表既有 query（同 key 同 queryFn 缓存共享），禁止独立请求。

#### 场景：主路径

Given 列表已拉取 / When 进文件模式插引用 / Then 无第二次 listWorkspaces 调用（缓存命中）。

### FR-03: 发送置换/历史标记协议零变化；相关测试全绿

- 必须：workspaceName 不得进入任何发送标记；三文件相关测试全绿。

#### 场景：主路径

vitest 3 文件 154/154（logs/wsname-test.log）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx 既有 metas 链路用例（名称拼接经 tsc 类型+浏览器实测门验证显示）
FR-02: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx 既有 mocks.listWorkspaces 复用面（query 同 key 缓存共享由 react-query 契约保证）
FR-03: test/frontend/src/components/sessions/__tests__/sessions-portal.test.tsx + session-input-bar-upload.test.tsx + group-chat-panel.test.tsx 154/154（logs/wsname-test.log）
