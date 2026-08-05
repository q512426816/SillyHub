---
author: qinyi
created_at: 2026-08-04 16:12:00
scale: large
risk_level: contract-required
revision: v2(Design Grill P1 修正:B-1 菜单数据源/B-2 schema.py 不存在/B-3 表单工作区上下文)
---

# 设计文档(Design)— 智能体档案前端重设计(全局卡片墙 + 带预览表单)

> 变更 `2026-08-04-agent-profile-ui-redesign` · 方案 A(稳进版)
> 原型:`prototype-agent-profile-redesign.html`(画面①全局卡片墙 / 画面②带预览弹窗)
> 前置已落地:`2026-08-02-agent-profile-layer`(AgentProfile 配置层 + 三级 visibility + 后端 CRUD)已 archive,本变更在其之上做前端体验重做。
> v2:经 Design Grill 独立审查修正 3 个 P1(B-1 菜单数据源漏列 / B-2 profile 无 schema.py / B-3 表单 ws 上下文未覆盖),见 decisions D-006/D-007 + 本文件 §6/§7.2/§9/§12。

## 1. 背景

智能体档案(AgentProfile)是 2026-08-02 落地的「可复用智能体人设模板」配置层,管供应商/模型、系统提示词、MCP/技能引用、工具策略引用,带三级可见性(私有/工作区/平台)+ 系统预置只读档。后端契约与数据层已完整。

但当前前端体验被用户判定为「拉跨」,四项痛点全中:
- **视觉不精致**:列表是 antd DataTable 默认皮肤,信息平铺无层次。
- **信息太挤**:列表 9 列(序号/名称/供应商模型/工具策略/MCP/技能/可见范围/版本/操作),MCP 与技能列堆 tag,一眼抓不到重点。
- **表单填着不顺**:新建/编辑是 640px Modal、8 字段平铺,新手不知道每项填了有啥用,无即时反馈。
- **缺功能**:无搜索、无按可见范围/供应商/工作区筛选、无「预览人设下发效果」。

根因分析(代码级,见 `agent-profiles/page.tsx` / `agent-profile-form.tsx`):当前页**已遵循** FRONTEND_PAGE_STYLE.md 基准(PageContainer/PageHeader/SectionCard/DataTable + Modal),问题不在规范执行,而在**信息架构错配**——「人设模板」这种实体用「表格行」展示不直观,8 字段平铺表单缺引导。入口还藏在工作区详情页快捷入口里(`workspaces/[id]/page.tsx:361`),层级深。

## 2. 设计目标

- **入口独立**:智能体档案提升为侧边栏一级菜单,一键直达,不再埋在工作区里。
- **全局聚合视图**:点进去看当前用户可见的全部档案(个人私有全集 + 所在各工作区的 workspace 级 + 全部 platform 级 + 系统预置),可按工作区/可见范围/供应商筛选。
- **卡片墙列表**:用「角色卡」取代表格行,每张卡一眼看清这个档案是谁、用什么模型、有什么人设、能干什么。
- **带实时预览的表单**:新建/编辑宽弹窗,左填字段、右实时预览角色卡,所见即所得。
- **补齐功能**:搜索(名字+提示词)、筛选(工作区/可见范围/供应商)、点卡片预览人设下发效果。
- **遵循项目设计系统**:配色/间距/组件走 FRONTEND_PAGE_STYLE.md token 与 antd,仅在 agent-profile 页对「表格→卡片」「单列 Modal→双栏 Modal」做显式声明的特例。

## 3. 非目标(Non-Goals)

- ❌ 不改后端 AgentProfile CRUD 契约(只**新增**一个只读聚合查询端点,加法)。
- ❌ 不改三级 visibility 鉴权逻辑、系统预置只读、profile=None 兜底链(前置变更 §8 不变)。
- ❌ 不改 daemon-entity-binding / spec 注入管线 / claim lease 生命周期。
- ❌ 不重做任务详情页选档下拉(`AgentProfileSelect`)的逻辑——仅做视觉对齐(D-005,界定见 §7.3)。
- ❌ 不做暗色模式、不做响应式移动端、不做档案市场/跨工作区活共享/配额计费/执行统计。
- ❌ 不动 `build_spec_bundle` 渲染管线(预览人设是前端只读展示,不真注入)。

## 4. 拆分判断

单一变更,不拆分、不批量。理由:这是一次内聚的前端体验重做(列表+表单+入口)+ 一个紧耦合的后端只读聚合端点(为全局视图服务),逻辑边界清晰;卡片墙/预览表单/聚合端点相互依赖、需同步交付才有意义,拆开反而产生中间态。规模 large(多文件 + 交互范式变更 + 1 个后端端点),走完整 plan→execute→verify→archive。

## 5. 总体方案(6 Phase,plan 细化为 Wave)

| Phase | 内容 | 类型 |
|---|---|---|
| P1 | 后端只读聚合端点 `GET /api/agent-profiles?scope=mine`:跨工作区并集返回 actor 可见档案,每条带 workspace 归属 | 后端地基 |
| P2 | 前端数据层:`lib/agent-profiles.ts` 加聚合 fetch + hook + 聚合响应类型;`gen:types` 同步 | 前端地基 |
| P3 | 共享卡片墙组件:角色卡 + 搜索筛选条 + 网格(全局页与工作区内页复用) | 核心 |
| P4 | 带预览的重做表单:宽弹窗(左填右预览),保留 8 字段分 身份/大脑/能力 三组;全局页新建带「工作区上下文」选择器(B-3/D-006) | 核心 |
| P5 | 全局页路由 + 侧边栏一级菜单(经 `menu-permissions.ts` 数据源,B-1/D-007)+ 工作区详情页入口调整;人设预览弹窗 | 核心 |
| P6 | 任务页选档下拉视觉对齐(D-005);回归校验 | 收尾 |

## 6. 文件变更清单

> v2 修正:Grill B-1(菜单数据源在 `menu-permissions.ts` 非 app-shell 直接加)、B-2(profile 模块**无 schema.py**,DTO 统一在 `router.py`,已 Glob 核实:`profile/` 仅 model/router/__init__/seed/service)。

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/profile/router.py` | 加 `GET /api/agent-profiles?scope=mine` 端点 + `AgentProfileAggregatedItem` DTO(与现有 DTO 同处;profile 模块 DTO 约定全在 router.py,见 router.py:18-19 docstring) |
| 修改 | `backend/app/modules/agent/profile/service.py` | 加 `list_visible_all(actor)` 跨工作区可见性并集方法(复用 `_can_read_async`/`_is_workspace_member`,见 §7.1) |
| 修改 | `backend/openapi.json` | `pnpm gen:types` 同步新端点/类型(规则 20) |
| 修改 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` 同步新端点/类型(规则 20) |
| 修改 | `backend/app/modules/agent/tests/test_profile_service.py` | 新增越权用例(R-01 他人 private 不可见 / 非成员 ws 的 workspace 级不可见 + R-07 owner 边界) |
| 修改 | `backend/app/modules/agent/tests/test_profile_router.py` | 新增 scope=mine 聚合用例 + no-scope 冻结用例(C8) |
| 修改 | `frontend/src/lib/agent-profiles.ts` | 加 `listMineAgentProfiles` fetch + `useMineAgentProfiles` hook + 聚合类型导出 |
| 新增 | `frontend/src/components/agent-profile/agent-profile-card.tsx` | 角色卡(头像/名/可见/模型/人设摘要/能力/版本/操作) |
| 新增 | `frontend/src/components/agent-profile/agent-profile-card-grid.tsx` | 卡片墙:搜索+筛选条+网格,全局页与 ws 内页复用 |
| 新增 | `frontend/src/components/agent-profile/agent-profile-preview.tsx` | 人设预览弹窗(点卡片看 system_prompt 下发片段) |
| 修改 | `frontend/src/components/agent-profile-form.tsx` | 重做:宽弹窗(~900px)双栏,左填字段右实时预览,字段分三组带说明;加「工作区上下文」选择器(全局页用,数据源 `listWorkspaces()`,D-006) |
| 新增 | `frontend/src/app/(dashboard)/agent-profiles/page.tsx` | 全局卡片墙页(一级菜单落地,`/agent-profiles`) |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx` | 重构:复用卡片墙组件 + workspace 预筛(废弃原 9 列表格) |
| 修改 | `frontend/src/lib/menu-permissions.ts` | **菜单数据源**(B-1/D-007):agent section 加「智能体档案」条目 `{section:"agent", menuKey:"agent-profiles", menuLabel:"智能体档案", href:"/agent-profiles", absolute:true, matchPattern:"/agent-profiles", permissions:[]}`;permissions:[] 经 `permission.ts:41` 对所有登录用户可见 |
| 修改 | `frontend/src/components/app-shell.tsx` | `MENU_ICON_MAP` 加 `/agent-profiles` 的 lucide 图标映射(图标渲染消费处;菜单条目本身在 menu-permissions.ts) |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 快捷入口「智能体档案」保留(l:361),指向 ws 内卡片墙页 |
| 修改 | `frontend/src/components/agent-profile-select.tsx` | 视觉对齐新风格(D-005,见 §7.3 界定) |
| 修改 | `frontend/src/lib/__tests__/menu-permissions.test.ts` | 同步菜单计数(37→38/EXPECTED_MENU_KEYS 加 agent-profiles/agent 4→5/空 permissions 例外) |
| 修改 | `frontend/src/components/__tests__/agent-profile-form.test.tsx` | 补双栏实时预览 + 工作区上下文选择器用例(D-003/D-006) |
| 新增 | `frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx` | 角色卡渲染 + 系统预置只读用例 |
| 新增 | `frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx` | 搜索/筛选/数据源切换用例 |
| 新增 | `frontend/src/app/(dashboard)/agent-profiles/__tests__/page.test.tsx` | 全局页渲染用例 |
| 删除 | — | 无(原表格页重构不删文件) |

## 7. 接口定义

### 7.1 后端聚合端点(唯一新增)

```
GET /api/agent-profiles?scope=mine
Auth: 当前 actor(JWT)
Response 200: AgentProfileAggregatedListResponse { items: AgentProfileAggregatedItem[] }
（独立聚合响应类型，非复用 AgentProfileListResponse）
```

`AgentProfileAggregatedItem` = `AgentProfileRead` 全字段 +:
- `workspace_id: UUID | null`(档案归属工作区;private/platform 级为 null)
- `workspace_name: str | null`(归属工作区名,前端筛选/卡片展示用;join workspace 表)

可见性集合(新增 `service.list_visible_all(actor)`,**逐档**用 `_can_read_async` 判定后并入,严防越权 R-01):
- actor 自己的所有 private 档案(跨工作区,owner_user_id=actor)
- actor 所属各工作区(`user_workspace_roles` 存在性)的 workspace 级档案
- 全部 platform 级档案 + 系统预置档案(platform 级对所有人可见)

实现:查 `agent_profiles` 全表 → 逐档 `_can_read_async(profile, actor)` 过滤(与现有 `list()` 单 ws 内的可见性逻辑同源,扩展到跨 ws)。platform/系统预置按 id 去重。**不沿用** `list()` 的按 ws clause 拼接(那是单 ws 的),而是逐档判定(正确处理 owner-who-left-ws 等边界,见 R-07)。

### 7.2 前端表单「工作区上下文」sourcing 策略(B-3/D-006)

现 form 的 ③能力 数据源是 ws-scoped:`useWorkspaceToolPolicies(workspaceId)` / `useWorkspaceMcpConfig(workspaceId)`(form:159-160);skill_refs 是 user-scoped。全局页新建若无 ws 上下文,③能力 下拉会空。策略:

- **全局页(`/agent-profiles`)新建**:表单首字段「工作区上下文」**必选**,数据源 `listWorkspaces()`(`@/lib/workspaces`,已存在,workspace-switcher 在用,返回 actor 可见工作区列表)。选定后 ③能力(mcp/policy)按该 ws sourcing。
  - visibility=workspace:此字段即「归属工作区」(workspace_id=它)。
  - visibility=private/platform:此字段仅作 **sourcing**(提供 mcp/policy 选项),workspace_id 落 null。
- **工作区内页(`/workspaces/[id]/agent-profiles`)新建/编辑**:workspaceId 已知(路由参数),无该选择器,直接用路由 ws。
- **编辑态 private/platform 档案**:无 workspace_id,③能力 sourcing 用「参考工作区」(默认 actor 第一个可见 ws,可手动切)。

```ts
// lib/agent-profiles.ts(新增)
export type AgentProfileAggregatedItem = components["schemas"]["AgentProfileAggregatedItem"];
export async function listMineAgentProfiles(): Promise<AgentProfileAggregatedItem[]>;
export function useMineAgentProfiles(): { profiles, isLoading, isError, error, refetch };

// 组件(表单 workspaceId 仍为必填语义,但全局页通过「工作区上下文」选择器提供)
<AgentProfileCard profile={...} onPreview onEdit onCopy onDelete />
<AgentProfileCardGrid workspaceId?={wid} scopedToWorkspace?={bool} />
<AgentProfilePreview profile={...} open onClose />
<AgentProfileForm mode workspaceId? profile? onClose />  // 全局页内部用「工作区上下文」selector 填充 workspaceId
```

### 7.3 选档下拉视觉对齐范围(D-005,C6)

现 `agent-profile-select.tsx` 用原生 `<select>`(select:99-117),偏离 FRONTEND_PAGE_STYLE §0「UI 组件全用 antd」。本次「视觉对齐」=换 antd `Select`(showSearch + optionFilterProp),保持现有逻辑(数据合并/兜底项/失效标记/onChange null 语义)不变。属样式对齐,非逻辑重做。

### 7.4 人设预览定义(R-05,C5)

预览内容(纯前端只读,不真注入):
1. system_prompt 原文(档案 system_prompt 字段)
2. 模拟「prepend 到下发 daemon 的 CLAUDE.md 顶部」的片段(展示拼接形式,参考前置变更 `2026-08-02-agent-profile-layer` design §7 的注入语义;**真正注入点在 `router.py:240` 读取 `agent_profile_snapshot` 后由 daemon 写 CLAUDE.md**,本预览只模拟文本,不调用该链路)

> v2 修正(C5):原 §10 R-05 误写「注入点 router.py:240」——router.py:240 是读取 snapshot 的位置,真正写入 CLAUDE.md 在 daemon 侧(build_spec_bundle 下游)。预览仅模拟文本。

## 8. 数据模型

**不新增表、不改字段**。AgentProfile 表已有 `workspace_id`(前置变更 task-02),聚合端点只做跨工作区只读查询 + join workspace 取 name。

## 8.5 生命周期契约

**不涉及生命周期契约**:本变更是前端 UI 重做 + 一个只读聚合查询端点,不改变 session/lease/agent_run/daemon 的状态流转或 claim/heartbeat 机制。档案的 `provider` 字段在 dispatch 时由前置变更的 placement 解析路由到 daemon,该链路本变更不动;新聚合端点纯读不写。

## 9. 兼容策略(brownfield)

- 项目未正式上线(PPM 模块除外),无历史兼容负担(CLAUDE.md 规则 11)。
- `GET /api/workspaces/{wid}/agent-profiles`(workspace 级 CRUD)完全不动,新端点是加法。
- **`GET /api/agent-profiles`(无 scope)行为冻结**(C8):现存 `list_platform_profiles` 返回 platform 级档案,被 `AgentProfileSelect` 依赖。本次新增 `?scope=mine` 参数,**未带 scope 时保持原 platform 级行为不变**,避免破坏选档下拉。
- 工作区详情页「智能体档案」快捷入口保留,用户习惯不破坏;新增侧边栏一级菜单是额外入口。
- `AgentProfileRead` 类型不动,新增 `AgentProfileAggregatedItem` 扩展,向后兼容。
- profile=None 兜底链(前置变更 §8)不变,选档下拉行为不变。

## 10. 风险登记(Risk)

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 聚合端点可见性越权:返回了 actor 无权看的档案 | P0 | 新 `list_visible_all` **逐档** `_can_read_async` 判定(不拼 ws clause);service 单测覆盖:actor 不在 ws X 不见 ws X 的 workspace 级档;集成测 actor A 看不到 actor B 的 private 档 |
| R-02 | 突破 FRONTEND_PAGE_STYLE 基准(表格→卡片、单列 Modal→双栏)被当规范污染扩散 | P1 | 本 design 显式声明 agent-profile 为特例,仅限本页;卡片墙封装在 `agent-profile/` 目录不外泄;plan 阶段把「agent-profile 卡片特例」登记回写 FRONTEND_PAGE_STYLE.md(C7) |
| R-03 | 全局视图跨工作区重名档案混淆 | P2 | 卡片显示 workspace_name;筛选可按工作区隔离 |
| R-04 | 档案数量大时卡片墙性能 | P2 | 档案低频小量;前端分页兜底;>100 再考虑后端分页 |
| R-05 | 「预览人设下发效果」内容定义 | P2 | §7.4 已定义:system_prompt 原文 + 模拟 CLAUDE.md 顶部片段,纯前端只读 |
| R-06 | gen:types 暴露无关旧测试债 | P2 | 按规则 20 惯例顺手补字段修好 |
| R-07 | owner-who-left-ws 边界:owner 离开 ws 后,其在该 ws 建的 workspace 级档案在聚合视图的归属 | P2 | `_can_read_async` 对 WORKSPACE 级非 owner 需成员判定;owner 离开后该档对其仍可见(与 `get()` 一致,owner 短路);plan 补单测 |

## 11. 决策追踪

见 `decisions.md`。当前版本决策均被本 design 覆盖:
- D-001@v1(独立一级菜单 + 全局聚合视图)→ §2 / §5 P5 / §6
- D-002@v1(列表卡片墙,突破表格基准)→ §5 P3 / §10 R-02
- D-003@v1(表单带预览双栏,突破单列 Modal 基准)→ §5 P4 / §10 R-02
- D-004@v1(后端新增只读聚合端点)→ §5 P1 / §7.1 / §10 R-01
- D-005@v1(选档下拉视觉对齐不重做)→ §3 / §5 P6 / §7.3
- D-006@v1(全局页新建表单工作区上下文 sourcing,B-3)→ §5 P4 / §7.2
- D-007@v1(侧边栏菜单经 menu-permissions.ts 数据源,B-1)→ §5 P5 / §6

无仍未解决的决策;P1 已在 v2 修正,剩余 P2 风险见 §10。

## 12. 自审(Self-Review)

| 检查项 | 结果 |
|---|---|
| 需求覆盖(四项痛点 + 独立菜单 + 全局聚合 + 卡片 + 预览 + 搜索筛选) | ✅ §2 逐条对应 |
| decisions 引用(D-001~D-007) | ✅ §11 全部引用且被章节覆盖 |
| 约束一致(FRONTEND_PAGE_STYLE token/antd;CONVENTIONS tailwind+use client;规则 20 gen:types) | ✅ §2/§6/§7.3/§10 R-02 |
| 真实性(文件路径) | ✅ v2 已逐项核实:`profile/` 目录 Glob 确认无 schema.py(DTO 在 router.py:18-19);菜单数据源 `menu-permissions.ts` + `permission.ts:41` 空 perms=登录可见;工作区列表 `listWorkspaces()`(@/lib/workspaces);`workspaces/[id]/page.tsx:361` 快捷入口 |
| YAGNI(非目标明确) | ✅ §3 |
| 生命周期契约 | ✅ §8.5 显式豁免(本变更纯读 + UI 重做,不改 lifecycle) |
| 验收标准具体可测 | ✅ §10 R-01 越权测试 + verify 对照 |
| 兼容/回退 | ✅ §9 加法零回归;no-scope 行为冻结(C8);原端点/入口/类型不动 |

**验收标准**(verify 阶段对照):
1. 侧边栏「智能体」分组出现「智能体档案」一级菜单(经 menu-permissions.ts + app-shell 图标),点击直达 `/agent-profiles`。
2. 全局页展示 actor 可见全部档案(个人+各 ws+平台+预置),按工作区/可见范围/供应商筛选生效。
3. 越权用例:actor A 看不到 actor B 的 private 档、看不到非成员 ws 的 workspace 级档(R-01 测试通过)。
4. 全局页新建弹窗:首字段「工作区上下文」(listWorkspaces 数据源)选定后 ③能力(mcp/policy)有数据;左填右实时预览;8 字段齐全;visibility=workspace 时该字段=归属工作区,private/platform 时仅 sourcing。
5. 系统预置档案卡显示「只读」,无编辑/删除按钮。
6. 任务详情页选档下拉换 antd Select,视觉与新风格一致,逻辑/兜底项/失效标记不变。
7. `GET /api/agent-profiles`(无 scope)行为不变,`?scope=mine` 返回聚合集。
8. `pnpm gen:types` 同步,`tsc --noEmit` + `eslint` 0 error;前端测试通过。
