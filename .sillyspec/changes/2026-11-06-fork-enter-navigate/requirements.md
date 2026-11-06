---
author: flow-machine-draft
created_at: 2026-11-06T15:36:20.029Z
---
# 需求规格（Requirements）— 2026-11-06-fork-enter-navigate

## 功能需求

### FR-01: 门户页（page 模式）分叉成功后切选中进入 B（URL 同步）

- 门户宿主（SessionsPortal）**必须**向 SessionPanel 接线 `onNavigateToSession`：分叉确认成功后右侧面板切换为 B 会话渲染（key 重挂载）、地址栏 `?session=` 变为 B 的 id；**禁止**再弹 WorkerSessionOverlay 浮层。

#### 场景：门户内分叉成功切选中

Given 门户页选中源会话 A 且用户点轮头⑂完成分叉确认；When forkSession 返回 201；Then onNavigateToSession(B-id, A.workspace_id) 被调（门户切选中 + ?session= 同步，走列表选中同款清理：清预会话/群选中），无浮层出现。

#### 场景：未接线的 page 宿主回退浮层（零回归）

Given WorkerSessionOverlay 浮层内嵌的 SessionPanel（mode=page，未接回调）中再分叉；When 分叉成功；Then 回退既有浮层进入 B（data-overlay-title="分叉会话"）。

### FR-02: dialog 模式分叉成功后跳全局门户深链（实现语义统一，不做工作区路由分流）

- dialog 模式分叉确认成功后**必须**离开弹窗上下文进入 B 的会话页：宿主接 `onNavigateToSession` 优先；未接时组件内 fallback `window.location.assign` 整页跳全局门户（`?session=<B>`）。B 的 workspace 归属**必须**由门户深链 effect 自动解析（getAgentSession 验证 + setSelectedWorkspaceId），**不**要求各弹窗宿主感知 workspaceId 做路由分流。

#### 场景：dialog 未接回调 fallback 整页跳转

Given 任意 dialog 宿主（工作区弹窗/群聊等）中的会话分叉成功；When 未接 onNavigateToSession；Then window.location.assign("/sessions?session=<B>") 被调且无浮层出现。

### FR-03: 谱系溯源（LineageBlock 与面包屑点源会话）行为不变

- 谱系溯源入口**必须**维持既有 WorkerSessionOverlay 浮层形态（title=「原会话」+「↦ 已分叉」状态条），**禁止**被本次导航改造波及。

#### 场景：主路径

Given 分叉会话 B 面板顶部溯源块/面包屑；When 点击源会话节点；Then 仍以浮层打开源会话（现状行为）。

### FR-04: 分身会话浮层（TeamTaskBlock 分身行）行为不变

- 分身会话入口**必须**维持既有 WorkerSessionOverlay 浮层形态，**禁止**被本次导航改造波及。

#### 场景：主路径

Given 团队任务块分身行；When 点击查看分身子会话；Then 仍以浮层打开（现状行为）。

### FR-05: 相关测试全绿与类型零错

- 本变更**必须**只运行触及面测试（新增 fork-enter-navigate.test.tsx 3 用例 + 既有 session-fork-lineage/entry 33 用例防回归）并全绿；触及文件 tsc **必须**零错误（并行会话的 untracked prototype 文件错误不属本变更面）。

#### 场景：主路径

Given 实现与测试就位；When 运行上述测试与 tsc --noEmit；Then 36 用例全过、触及文件零 TS 错。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/fork-enter-navigate.test.tsx「A. page 模式接 onNavigateToSession（门户接线）→ 调回调切选中，不弹浮层」+「B. page 模式未接回调（浮层内嵌宿主）→ 回退既有浮层进入 B（零回归）」
FR-02: frontend/src/components/daemon/__tests__/fork-enter-navigate.test.tsx「C. dialog 模式未接回调 → fallback 整页跳全局门户（?session=B，无浮层）」
FR-03: 不适用：无行为变化（零改动面）——既有覆盖 session-fork-lineage.test.tsx「WorkerSessionOverlay 标题参数化」组守护浮层组件现状
FR-04: 不适用：无行为变化（零改动面）——分身浮层链路无 diff，既有测试面不受影响（36 用例回归含其上游）
FR-05: 不适用：FR-05 本身是测试/类型执行约束，成立性由 FR-01/02 测试绑定与执行结果承载
