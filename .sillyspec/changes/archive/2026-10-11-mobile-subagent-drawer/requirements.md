---
author: flow-machine-draft
created_at: 2026-10-10T16:14:36.914Z
---
# 需求规格（Requirements）— 2026-10-11-mobile-subagent-drawer

## 功能需求

### FR-01: mobile 子代理段渲染紧凑基本信息卡（children 不内联刷屏）

- `variant="mobile"` 的会话页必须挂载 SubagentPanelContext（组件内槽位状态承载），使 SubagentBlockView 走紧凑卡片分支——子代理段只显示状态点/名称/类型/徽标/时长基本信息，内部会话（children）不得内联刷进对话流。

#### 场景：手机端回显

- Given 手机端会话页含一个已完成子代理容器段（children 有内部正文）
- When 历史回显完成
- Then 对话流只见紧凑卡（data-segment-id 容器），children 正文不可见

### FR-02: 点击紧凑卡打开移动端 Drawer 展示子代理内部会话

- 点击紧凑卡必须在右侧滑出的 Drawer（min(92vw, 420px)）内渲染既有 SubagentDetailPanel（初始化提示词 + 段时间线，与 PC 右栏同一组件）；✕ / 遮罩 / 再点已激活卡均为关闭（toggle 语义与 PC 一致）；嵌套子代理点击换面板内容（单槽位）；会话切换与段失效自动关闭。

#### 场景：点击-浏览-关闭

- Given FR-01 的紧凑卡
- When 点击卡片头
- Then Drawer 打开且内部会话正文与初始化提示词可见；点 ✕ 后 Drawer 卸载、正文消失；再次点击已激活卡片同样关闭

### FR-03: PC 与旧宿主零回归

- desktop portal 宿主（三 props 装配 + 右栏）行为必须零变化；desktop/dialog 未装配右栏 props 的旧宿主必须维持内联展开回退（默认折叠、点击展开）；右栏宽度/详情列等既有 desktop 逻辑不得被 mobile 分支影响。

#### 场景：desktop 悬浮宿主形态

- Given desktop SessionPanel（未传 onOpenSubagent）
- When 渲染子代理段
- Then 内联展开分支：默认折叠、点击头部 aria-expanded 展开后 children 可见（既有行为）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx「mobile：子代理段为紧凑卡（children 不内联刷屏），点击打开 Drawer 展示内部会话，✕ 关闭」
FR-02: frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx「mobile：再点已激活卡片为 toggle 关闭（与 PC 语义一致）」
FR-03: frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx「零回归锚：desktop 悬浮宿主形态（未装配右栏 props）仍内联展开（children 可见）」
