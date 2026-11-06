---
author: flow-machine-draft
created_at: 2026-11-06T15:36:20.029Z
---
# 设计记录（Design Record）— 2026-11-06-fork-enter-navigate

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

新增一条「面板请求导航到另一会话」的受控回调链，替换 ForkConfirmModal onForked 里「setLineageOverlay 浮层进入 B」的默认动作：

1. **prop 通道**：`SessionPanelProps.onNavigateToSession?: (sessionId, workspaceId) => void`（index.tsx 声明，page 分支透传 / dialog 分支整包 props 携带）。onForked 分支：接了回调 → 调回调并 return（不弹浮层）；未接 → 回退既有浮层（WorkerSessionOverlay 内嵌等宿主零回归）。
2. **门户接线**（sessions-portal.tsx `handleNavigateToSession`）：走列表选中同款清理（清预会话态/群选中 + setSelectedWorkspaceId + syncSessionParam 写 `?session=`），key 重挂载契约自然切到 B 面板——复用门户既有双向同步，零新路由。
3. **dialog fallback**：弹窗宿主多数未接线，组件内 `window.location.assign("/sessions?session=<B>")` 整页跳全局门户（handleSwitchProvider 同款先例——useRouter 需为十余个渲染本组件的测试文件逐一 vi.mock next/navigation，整页跳零 mock 零回归）；B 的 workspace 归属由门户深链 effect 自动解析，不做「宿主感知 workspaceId 分流工作区路由」（4+ 宿主接线成本 > 收益，全局门户对工作区会话呈现同样正确）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

### 文件变更清单（提交面自声明）

- `frontend/src/components/daemon/session-panel/index.tsx` — SessionPanelProps 增 `onNavigateToSession` 可选 prop + page 分支透传
- `frontend/src/components/daemon/session-panel/page-helpers.tsx` — SessionPanelPageProps 增同款 prop
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` — 组件解构 + onForked 分支（有回调导航 / 无回调回退浮层）
- `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` — 解构 + onForked 分支（有回调导航 / 无回调 window.location.assign fallback）
- `frontend/src/components/sessions/sessions-portal.tsx` — handleNavigateToSession 回调 + 真会话装配点接线
- `frontend/src/components/daemon/__tests__/fork-enter-navigate.test.tsx` — 新增三分支用例

对外可见变化：无 HTTP API / 组件库公共 API 变化（prop 可选、缺省回退旧行为）；用户可见行为变化仅在「分叉成功进入 B」路径（门户切选中 / 弹窗整页跳转）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

1. **乱序/迟到到达**：onForked 在 forkSession 201 后同步触发一次（ForkConfirmModal 防双击：成功后不回退 submitting）；导航动作幂等（同 id 重复 setSelectedSessionId 无副作用，syncSessionParam 同值去重跳过）。
2. **并发写**：全部为前端单会话内 UI 状态写入（React 状态机串行），无共享写目标；window.location.assign 由浏览器导航互斥。
3. **切换/生命周期**：门户切选中 → SessionPanel key 重挂载 → A 面板 SSE/轮询随 unmount 关闭（R6 既有契约）；dialog fallback 整页跳转天然重置全部状态；forkTarget 残留态在导航分支前的 setForkTarget(null) 清除。
4. **作用域**：回调只携带 B 的 id 与继承 workspace_id，门户深链验证（getAgentSession）兜底越权/不存在 id；不跨用户（fork 201 已校验归属）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：dialog fallback 用整页跳转（非 SPA 路由）牺牲一次页面加载体验——分叉是低频操作且换回「十余个测试文件零 mock + 4+ 宿主零接线」，取舍成立；后续若宿主逐个接线 onNavigateToSession 可平滑升级为 SPA 导航（回调通道已在）。放弃的方案：a) dialog 组件内 useRouter.push——需为所有渲染本组件的测试文件加 vi.mock next/navigation（先例注释明确拒绝过），弃；b) 各弹窗宿主逐个接线做工作区路由分流——接线成本高且全局门户深链已正确解析 workspace，收益仅省一次深链验证请求，弃；c) 谱系溯源/分身浮层一并改跳转——用户未提诉求且浮层「关闭即返回主控」语义对只读查看更合适，本次不动（FR-03/04 零回归锚点）。
