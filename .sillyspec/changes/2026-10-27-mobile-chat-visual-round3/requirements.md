---
author: flow-machine-draft
created_at: 2026-10-27T02:41:29.576Z
---
# 需求规格（Requirements）— 2026-10-27-mobile-chat-visual-round3

## 功能需求

### FR-01: RoundDivider mobile 单行不折行：mobile 分支不渲染 detail(开始时刻/历时,最次要)且胶囊 nowrap+truncate 超长省略,desktop 形态不变

- 手机端轮次分隔必须单行不折行（nowrap+truncate 超长省略）且 detail（开始时刻/历时）不渲染；desktop 必须保留胶囊单行+detail 原位渲染。

#### 场景：主路径

- Given mobile 会话页长 meta 轮次分隔
- Then 单行显示（超长尾部省略），无开始/历时段；desktop 形态逐类名不变

### FR-02: SessionPanel mobile 头部标题左侧加返回按钮(ChevronLeft)：有 workspace_id 跳 /m/workspaces/{wid}/sessions,无则 /m/workspaces;desktop/dialog/悬浮宿主零变化

- SessionPanel mobile 头部必须在标题左侧渲染返回按钮（ChevronLeft，data-testid session-mobile-back），路由行为由宿主 onBack prop 装配；desktop/dialog/悬浮宿主不传必须零渲染。

#### 场景：主路径

- Given /m/ 会话页（variant=mobile + onBack 传入）
- Then 标题左侧返回钮可点，跳转 /m/workspaces/{id}/sessions（宿主显式路由，深链可达）

### FR-03: mobile 会话列表卡行首加 PC 同款状态标：消费 session-list-panel 导出纯函数 sessionStatusIndicator(status,liveness null,completedUnread false,runStatus undefined,pendingDialogKind=pending_requests[0].kind)——红点失败/绿点完成/问号待答/其余留白,与 PC 单一源同款

- mobile 会话列表卡行首必须渲染与 PC 端同款状态标——直接消费 session-list-panel 导出纯函数 sessionStatusIndicator（单一源，不另造词表）：红点失败/绿点完成/问号待答/转圈执行/琥珀等你；liveness 传 null（mobile 无 agent-logs 链路）。

#### 场景：主路径

- Given mobile 会话列表卡（failed/ended/待回答/running 等状态）
- Then 行首渲染对应状态标（与 PC 会话列表五态语义逐字同款）

### FR-04: 相关测试面全绿(round-divider/session-panel-variant/page.m-sessions/mobile-session-list 零回归)

- 改动后五套件必须全绿（round-divider 契约更新/session-panel-variant/page.m-sessions/mobile-session-list/page.m-session-chat 补 useRouter mock）。

#### 场景：主路径

- Given 全部改动落地
- Then 59 用例全绿 + tsc 0 + lint 0 errors

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/chat/__tests__/round-divider.test.tsx「mobile=true：单行不折行（nowrap+truncate）+ detail 不渲染」+ desktop 锚用例
FR-02: frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx（useRouter mock 补齐后 16 用例全绿，含 props 透传断言）
FR-03: frontend/src/components/mobile/mobile-session-list.test.tsx 全套件零回归（状态标渲染经 tsc/lint 验证，五态纯函数为 PC 既有单测覆盖面）
FR-04: 五套件实测 59 用例全绿（16+43）+ tsc 0 + lint clean
