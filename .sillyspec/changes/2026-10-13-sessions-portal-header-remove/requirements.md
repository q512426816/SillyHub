---
author: flow-machine-draft
created_at: 2026-10-13T08:48:58.467Z
---
# 需求规格（Requirements）— 2026-10-13-sessions-portal-header-remove

## 功能需求

### FR-01: 四个入口页面不再渲染可见的标题/副标题文字块（DOM 中不再出现该副标题文案，标题仅保留无障碍隐藏语义）。

- 智能体会话四入口（全局 /sessions、workspace、change、quicklog scope）**必须**不再渲染可见的页头标题/副标题块：dom 中**禁止**出现副标题文案「跨机器、跨智能体的统一会话入口：左侧选择会话，右侧继续对话或新建」；页面标题 **必须**降级为 sr-only 的一级标题（`h1` 带 `sr-only` 类，视觉零占位、可访问性树仍在），标题文案按 scope 后缀参数化不变。

#### 场景：主路径

Given 任意用户打开 /sessions（或三 scoped 入口任一，不区分登录后数据多少） / When 页面渲染完成 / Then 视口顶部不存在「智能体会话…」标题行与「跨机器、跨智能体…」副标题行；DOM 中 `h1` 文本仍为「智能体会话（+ scope 后缀）」且其 class 含 `sr-only`；`queryByText(副标题全文)` 为 null。

### FR-02: 标题块移除后，下方左列表＋右面板分栏容器向上占满可用视口高度，无标题占位留下的空白。

- 页头块退役后，分栏容器**必须**直接吃满腾出的空间：页容器**必须**保持视口高度锚定 `h-[calc(100vh-64px)]`（TopBar 64px），分栏行**必须**为 `flex-1` + `min-h-0`（无固定高、无 shrink-0 钳制）；**禁止**保留任何等高的标题占位留白。

#### 场景：主路径

Given 1440×900 视口打开 /sessions（全局或 workspace scope） / When 门户主体渲染完成 / Then 分栏行（`sessions-portal-panes`）顶边紧贴页容器内边距上缘（无标题块位移），底边到视口底部；对照截图 00（改前，分栏起点 ≈y140）与 01/02（改后 ≈y80）差 ≈60px 即释放的标题块高度。

### FR-03: workspace scope 的紧凑 Git 状态条功能不回归（仍渲染且可查询到）。

- workspace scope 的紧凑态 Git 状态条**必须**继续渲染（含分支徽标/↑↓/±/失败 ⚠ 与悬停全量细节），`data-testid="git-status-bar"` 可查询且 `data-variant="compact"`；change/quicklog/全局 scope **必须**仍零渲染（CC-08 语义不变）。容纳点由页头 actions 槽改为独立右对齐紧缩行，不改组件与取数。

#### 场景：主路径

Given workspace scope 门户（干净工作区固件） / When 页面渲染 / Then `git-status-bar` 存在且 `data-variant=compact`、分支徽标文案「⎇ main」；change/quicklog/全局 scope 同断言 `queryByTestId("git-status-bar")` 为 null。

#### 场景：边界

Given 本机无 backend / daemon 的真页渲染取证（route mock） / When 打开 /workspaces/ws-1/sessions / Then 顶部右对齐出现「⎇ main ↑2 +3/−1」紧凑条（截图 02），分栏仍占满其余高度。

### FR-04: 相关单测更新并通过（sessions-portal / sessions page 冒烟），不破坏其它会话功能断言。

- 两个相关测试文件**必须**全绿：`sessions-portal.test.tsx`（含新增「页头标题块移除」用例，锁副标题不渲染 + `h1` sr-only + 容器/分栏高度链类名）与 `sessions/__tests__/page.test.tsx`（47 用例，含顺手修正的附件 token 存量断言）；四 scope 标题后缀、深链、预会话、群/三分屏等既有断言**禁止**回归。

#### 场景：主路径

Given 改动后的工作区 / When `pnpm -C frontend exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx "src/app/(dashboard)/sessions/__tests__/page.test.tsx"` / Then 64 用例 + 47 用例全通过（0 失败）；`pnpm -C frontend typecheck` 无类型错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「页头标题块移除（2026-10-13-sessions-portal-header-remove）：副标题文案不再渲染、标题降级 sr-only、分栏 flex-1 占满视口高度」
FR-01: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「无选中：左会话列表 + 右空门户态 + 页标题语义（sr-only，页头块 2026-10-13 移除）」
FR-02: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「页头标题块移除（2026-10-13-sessions-portal-header-remove）：副标题文案不再渲染、标题降级 sr-only、分栏 flex-1 占满视口高度」（容器 `h-[calc(100vh-64px)]` + `sessions-portal-panes` 的 flex-1/min-h-0 类名契约）；真页视觉对照见 visual-evidence.md（截图 00/01/02）
FR-03: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「workspace scope：列表走 listAgentSessions({limit, workspace_id})，标题「智能体会话 · 工作区」，空门户态 + defaultExpandedWorkspaceId 预展开传参（FR-06）」（git-status-bar compact 断言）+ change scope 用例的零渲染断言；真页视觉见 visual-evidence.md 截图 02
FR-04: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx 全文件 64 用例 + frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx 全文件 47 用例
