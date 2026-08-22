---
author: qinyi
created_at: 2026-08-22T16:41:22
change: 2026-08-22-workspace-sessions-portal
scale: large
revision: v3（用户验收返工：scope 列表数据源反转为全局端点+后端补 workspace_id/change_id 过滤参——撤 v2 的降级矩阵与客户端仅本人过滤，D-003@v2 取代 D-003@v1）
---

# 会话门户三入口统一（以 /sessions 为准）

## 1. 背景

2026-08-22-session-panel-unify（verify PASS 待归档）完成了基元层统一（antd），但
用户指出核心未满足：「/workspaces/[id]/sessions 的会话与 /sessions 不一样」——
两页虽都渲染 SessionPanel，但**模式不同**：/sessions 用 `mode="page"`（外壳 =
SessionListPanel 真分页列表 + NewSessionForm 两态 + page 面板：标题/状态/配置条/
子代理目录/附件/重开），工作区页用 `mode="dialog"`（WorkspaceSessionSection：
SessionListLayout 列表 + dialog 面板：引擎选择器/新建结束按钮/attach 轮询）。
模式不同 = 布局与功能集不同 = 用户看到的「还是不一样」。

用户拍板（AskUserQuestion 三轮）：**以 /sessions 为准、统一一个组件**；范围 =
工作区会话页 + 变更详情会话区**两处一起**；变更详情承载形态 = **方案A 专属路由
门户**（侧边窄卡塞不下全页门户，卡片变入口跳专属路由）。决策编号索引（详见
decisions.md）：D-001@v1 三入口一组件、D-002@v1 专属路由、D-003@v1 仅本人过滤、
D-004@v1 ?session= 统一能力、D-005@v1 ended 恢复手动化。

## 2. 设计目标

1. 三个入口渲染**同一个组件**，观感与交互零差异（v3 起 scope 列表与全局同端点同字段同筛选，仅条目集合按 scope 过滤——降级矩阵已随 D-003@v2 撤销）：
   - `/sessions`（全局）
   - `/workspaces/[id]/sessions`（工作区级）
   - `/workspaces/[id]/changes/[cid]/sessions`（**新路由**，变更级）
2. 变更详情侧边卡改为会话入口（最近会话预览 + 打开按钮）；
3. WorkspaceSessionSection 与 change-session-section 的 dialog 面板装配退役
  （ended 会话恢复由 page 模式自带 reopen 承接，P10）；/runtimes 弹窗成为
   dialog 模式唯一消费面（弹窗场景合理保留）；
4. 后端仅加两个可选过滤参数（零回归）；全量回归 + 3001 部署实证 + 用户复验。

## 3. 非目标

- 不动 /runtimes 弹窗（dialog 模式在弹窗场景是正确形态）；
- 不动 SessionPanel 组件本体（page/dialog 两分支实现不变，只是消费面重组）；
- 不动团队功能（2026-08-22-team-session-unify 刚合入的派团队按钮/任务块等）；
- 不做列表筛选器语义扩展（v3 起 scope 复用全局筛选，无需扩展；v2 的「隐藏筛选条」随 D-003@v2 撤销）；
- 不迁移 URL 参数行为差异之外的历史包袱（?session= 恢复点**升级为门户统一
  能力**，见 §4.A——非维持旧文件实现而是迁移语义）；

## 4. 总体方案

### 4.A 共享门户组件（新建 `components/sessions/sessions-portal.tsx`）

自 `app/(dashboard)/sessions/page.tsx` 整块提取（机器/供应商 react-query、
selectedSessionId 状态、SessionListPanel + NewSessionForm/SessionPanel 两态、
key 重挂载契约、删除后清选中等），props：

```typescript
interface SessionsPortalProps {
  /** 会话范围与创建绑定；缺省 = 全局门户（/sessions 现状） */
  scope?: WorkspaceScope | ChangeScope; // 判别联合（Grill P2）
}
type WorkspaceScope = { kind: "workspace"; workspaceId: string };
type ChangeScope = { kind: "change"; workspaceId: string; changeId: string };
```

- `/sessions` 页 → `<SessionsPortal />`（薄壳化，PageContainer/PageHeader 留页级
  或进组件，以提取后两页一致为准——进组件，三入口标题统一为「智能体会话」，
  workspace/change 级标题带范围后缀）；
- 门户内部按 scope 派生：列表 queryKey/queryFn、新建绑定、标题后缀；
- **深链恢复（Grill P0-2 修订）**：门户统一支持 `?session=<id>` 初始选中——
  挂载时解析一次设为 selectedSessionId（自旧 workspace-session-section.tsx:95-113
  迁移的能力，全局入口同样受益；无参或无效 id 时静默忽略、行为不变，沿用旧
  :106-108 语义）。变更入口卡「直达选中态」经此链路实现（Link 带 ?session=）。

### 4.B SessionListPanel 加 scope（修改；v3 数据源反转）

props 增加可选 `scope`（判别联合，同 §4.A）。**v3：scope 模式复用全局端点
`listAgentSessions` 加过滤参**（后端 GET /api/daemon/sessions 增可选
`workspace_id`/`change_id` Query，SQL 层精确匹配，照 runtime_id 模式零回归）：

- scope=workspace → `listAgentSessions({ workspace_id })`；scope=change →
  `listAgentSessions({ workspace_id, change_id })`；
- 全局端点本就 owner-scoped（「List the current user's AgentSessions」）+
  返回全字段（runtime_id/config_snapshot/created_at/llm_provider_id 等 24 键）
  → **列表条目 chips/时间/服务端筛选条（状态/机器/引擎）/真分页/加载更多与
  /sessions 完全一致**，仅条目集合按 scope 过滤；
- v2 的 scopeItemToRow 瘦字段降级、filterOwnSessions 客户端过滤、筛选条隐藏
  三段逻辑**全部删除**（D-003@v2 取代 D-003@v1：owner 隔离由端点保证）；
- queryKey 带 scope 区分缓存；删除软删后 invalidate 前缀键（同全局）。

### 4.C NewSessionForm 加锁定绑定（修改）

props 增加可选 `bindWorkspaceId?: string`（锁定：隐藏 WorkspaceSessionPicker、
createSession 直传 workspace_id）与 `bindChangeId?: string`（createSession 加
change_id，change 级隐含同时绑 workspace）。已有 workspaceId state 与
createSession workspace_id 链路是现成的（:162/:237），只加锁定分支。

### 4.D 变更详情入口卡（修改 `changes/detail/change-sessions-card.tsx`）

窄卡改为入口形态：数据源 = `listChangeSessions(workspaceId, changeId)` 取前 3 条
（Grill P2：显式数据源；客户端按 author 过滤仅本人后取前 3），每条显示 id 短码/
状态/相对时间，点击经 `?session=` 深链进入专属路由并选中；卡尾「打开会话工作台」
按钮 Link 至 `/workspaces/[id]/changes/[cid]/sessions`。原卡内嵌
ChangeSessionSection 移除。

### 4.E 退役与清理

- `components/workspace-session-section.tsx` 删除（唯一消费方
  `app/(dashboard)/workspaces/[id]/sessions/page.tsx` 改渲染 SessionsPortal）；
- `components/changes/change-session-section.tsx` 删除（唯一消费方
  change-sessions-card 改入口形态；grep 实测各仅 1 消费方）；
- 对应测试：workspace-session-section.test.tsx（4 用例——「仅本人会话」过滤
  语义迁至门户新测试的 scope 过滤断言）与 change-session-section.test.tsx
  随组件退役删除——语义迁移清单：①仅本人过滤 → sessions-portal.test 的 scope
  用例；②创建绑定 workspace_id/change_id → 门户 + NewSessionForm 锁定用例；
  ③ended 会话恢复 → page 模式 18 用例既有 reopen 断言；④?session= 深链 →
  门户 ?session= 用例（新增）。**有意交互变更（明示）**：ended 会话由旧
  「选中即自动 reopen」改为 page 模式「手动点重新打开」（240s 超时 + 409 文案，
  以 /sessions 行为为准）；SessionPanel 的 changeId prop 随 change-section 退役
  暂无消费方（保留定义，非目标）。

### 4.F 测试策略

- 新增 `sessions-portal.test.tsx`：三 scope 渲染（列表 queryFn 路由到对应 API、
  NewSessionForm 绑定透传、标题后缀）+ §4.E 语义迁移枚举用例——scope 仅本人
  过滤（含 change 级从跨成员变仅本人的有意统一断言）、?session= 深链（有效/
  无效 id 两分支）、创建绑定（workspace_id / change_id+workspace_id 双传）；
- SessionListPanel 现有测试补 scope 用例（mock 两个列表 API）；
- NewSessionForm 现有测试补锁定绑定用例（picker 隐藏 + createSession 参数）；
- change-sessions-card.test.tsx 适配入口形态；
- sessions/page.test.tsx（18 用例）适配薄壳化（断言语义保留）；
- 全量回归三件套 + 3001 重建部署后浏览器实证（三入口截图对照）。

## 5. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新建 | `frontend/src/components/sessions/sessions-portal.tsx` | 共享门户（自 sessions/page.tsx 提取） |
| 新建 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/sessions/page.tsx` | 变更级门户路由（薄壳） |
| 修改 | `frontend/src/app/(dashboard)/sessions/page.tsx` | 薄壳化（渲染 SessionsPortal） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx` | 改渲染 SessionsPortal（workspace scope） |
| 修改 | `frontend/src/components/sessions/session-list-panel.tsx` | 可选 scope（切换列表数据源） |
| 修改 | `frontend/src/components/sessions/new-session-form.tsx` | 锁定绑定入参（workspace/change） |
| 修改 | `frontend/src/components/changes/detail/change-sessions-card.tsx` | 入口卡形态（最近会话+跳转） |
| 删除 | `frontend/src/components/workspace-session-section.tsx` | 退役（消费面重组） |
| 删除 | `frontend/src/components/changes/change-session-section.tsx` | 退役（消费面重组） |
| 删除 | `frontend/src/components/__tests__/workspace-session-section.test.tsx` | 随组件退役（语义迁门户测试） |
| 删除 | `frontend/src/components/changes/__tests__/change-session-section.test.tsx` | 随组件退役（语义迁入口卡/门户测试） |
| 新建 | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | 三 scope 门户测试 |
| 修改 | `frontend/src/components/sessions/__tests__/session-list-panel.test.tsx` | 补 scope 用例 |
| 修改 | `frontend/src/components/sessions/__tests__/new-session-form.test.tsx` | 补锁定绑定用例 |
| 修改 | `frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx` | 入口形态适配 |
| 修改 | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` | 薄壳化适配（18 用例语义保留） |
| 修改 | `backend/app/modules/daemon/router.py` | v3：GET /sessions 增 workspace_id/change_id 过滤参（task-10） |
| 修改 | `backend/app/modules/daemon/service.py` + `backend/app/modules/daemon/session/service.py` | v3：两层透传+SQL 过滤（task-10） |
| 修改 | `backend/app/modules/daemon/tests/test_sessions_list_filters.py` | v3：5 新用例（task-10） |
| 修改 | `backend/openapi.json` + `frontend/src/lib/api-types.ts` | v3：gen:types 同步（规则 21，task-12） |

## 6. 接口定义

SessionsPortal 对外仅 `scope` 一个可选 props（见 §4.A）；SessionListPanel /
NewSessionForm 新增可选 props 均向后兼容（缺省 = 现行为零变化）；
SessionPanelProps 不动。类型 re-export（SessionListEntry 等）维持现路径。

生命周期契约：无 —— 纯前端页面装配与组件提取重组，不新增/修改任何 session、
lease、agent_run、daemon 状态流转与事件契约（后端零改动；SSE/排队/重开均为
SessionPanel page 模式既有能力，仅换装配位置）。

## 7. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 门户提取漏搬页级逻辑（删除后清选中/列表刷新链） | /sessions 回归 | 整块提取 + 18 用例语义保留对账 + 全量回归 |
| 整列数组适配 InfiniteQuery 模式引入假分页 bug | scope 列表异常 | 一次性 setPage + 加载更多隐藏；虚拟滚动兜底；补 scope 用例 |
| change 级创建绑定缺 workspace（API 要求？） | 创建 422 | createSession 既有 change_id/workspace_id 双参链路（dialog 模式曾同时传）——scope=change 时两者都传 |
| 变更入口卡丢失原「会话调试」快捷性 | 变更页体验 | 入口卡保留最近 3 条预览直达选中态（?session= 恢复点链路沿用） |
| 与 team-unify 刚合入代码的合并面 | 冲突 | 实测其前端改动集中于 session-panel 弹层/team 组件，门户提取不动这些文件；执行期再核 git 状态 |
| 退役组件测试直接删致对账缺口 | 覆盖率假降 | 语义迁移清单（§4.E）+ 门户新测试覆盖同批断言点 |

## 8. 自审

- [x] 目标可验证：三入口同组件（grep 渲染点）、观感一致（浏览器对照）、回归全绿
- [x] 用户三轮拍板留痕（范围/承载/设计确认）
- [x] 关键事实已核：NewSessionForm 已有 workspace 绑定链路、三列表端点齐、变更侧卡为 aside 窄卡（承载形态依据）
- [x] 文件清单 16 项覆盖实现+测试+退役两侧
- [x] 生命周期豁免声明（纯装配重组）
- [x] 原型跳过：目标观感 = 现网 /sessions 活基准，无增量信息（用户已知悉可否决）
- [x] Grill v1 审查 14 项发现全部处置：P0-1 作者过滤（§4.B 迁移仅本人语义）、P0-2 深链矛盾（§4.A 门户统一 ?session=，§3 同步改口径）、P1-1 字段降级矩阵（§4.B 显式接受）、P1-2 筛选条语义（§4.B 定案：隐藏服务端筛选保留本地搜索）、P2×4（判别联合/入口卡数据源/reopen 交互变更明示/changeId 死 props 保留）
