---
author: qinyi
created_at: 2026-08-04 11:40:00
plan_level: full
revision: v2(plan 审查 P1 修正:menu-permissions.test.ts 测试归属 + 范围计数 + task-07 拆 Wave 6)
---

# 实现计划（Plan）— 智能体档案前端重设计

## 来源

brainstorm 变更 `2026-08-04-agent-profile-ui-redesign`(design.md v2 / decisions.md D-001~D-007 / requirements.md FR-01~10 / tasks.md)。方案 A(稳进版),Stage Review Gate 通过(docHash eb81be68)。本计划把 design 的 6 Phase + tasks.md 的 17 细任务归并为 7 个内聚交付单元,按依赖排 Wave。

## 范围（15 物理文件,跨 frontend + backend/profile）

**后端(3):**
- 修改 `backend/app/modules/agent/profile/router.py`(加聚合端点 + DTO)
- 修改 `backend/app/modules/agent/profile/service.py`(加 `list_visible_all`)
- 修改 `backend/openapi.json`(gen:types 同步)

**前端(12):**
- 修改 `frontend/src/lib/api-types.ts`(gen:types 同步)
- 修改 `frontend/src/lib/agent-profiles.ts`(聚合 fetch/hook)
- 新增 `frontend/src/components/agent-profile/agent-profile-card.tsx`
- 新增 `frontend/src/components/agent-profile/agent-profile-card-grid.tsx`
- 新增 `frontend/src/components/agent-profile/agent-profile-preview.tsx`
- 修改 `frontend/src/components/agent-profile-form.tsx`(重做双栏)
- 新增 `frontend/src/app/(dashboard)/agent-profiles/page.tsx`(全局页)
- 修改 `frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx`(复用卡片墙)
- 修改 `frontend/src/lib/menu-permissions.ts`(菜单条目)
- 修改 `frontend/src/components/app-shell.tsx`(图标映射)
- 修改 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`(入口保留)
- 修改 `frontend/src/components/agent-profile-select.tsx`(视觉对齐)

## Wave 分组

### Wave 1 — 后端地基(无依赖)
- [x] task-01: 后端聚合端点 + 越权测试(覆盖:FR-02, FR-03, D-004@v1)

### Wave 2 — 前端数据层(依赖 W1)
- [x] task-02: 聚合 fetch/hook + gen:types 同步(覆盖:FR-02, D-004@v1)

### Wave 3 — 组件(依赖 W2,内部可并行)
- [x] task-03: 卡片墙组件(card + grid + preview)(覆盖:FR-04, FR-05, FR-07, D-002@v1)
- [x] task-04: 重做表单(双栏预览 + 工作区上下文)(覆盖:FR-06, D-003@v1, D-006@v1)

### Wave 4 — 页面装配(依赖 W3)
- [x] task-05: 全局页 + 侧边栏菜单 + ws 内页重构 + 工作区入口(覆盖:FR-01, FR-10, D-001@v1, D-007@v1)

### Wave 5 — 收尾(独立)
- [x] task-06: 选档下拉视觉对齐(覆盖:FR-09, D-005@v1)

### Wave 6 — 验证(依赖 W1~5)
- [x] task-07: 前端测试 + verify 回归(覆盖:FR-08, 全局验收)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | allowed_paths |
|---|---|---|---|---|---|---|
| task-01 | 后端聚合端点 `GET /api/agent-profiles?scope=mine` + `AgentProfileAggregatedItem` DTO + `service.list_visible_all` + 越权测试 | W1 | P0 | — | FR-02, FR-03, D-004@v1 | `backend/app/modules/agent/profile/router.py`, `backend/app/modules/agent/profile/service.py`, `backend/app/modules/agent/tests/test_profile_service.py`(新越权用例), `backend/app/modules/agent/tests/test_profile_router.py`(既有路由测试,加端点后校验) |
| task-02 | 前端 `listMineAgentProfiles`/`useMineAgentProfiles` + 聚合类型;`pnpm gen:types` 同步 openapi.json + api-types.ts | W2 | P0 | task-01 | FR-02, D-004@v1 | `frontend/src/lib/agent-profiles.ts`, `frontend/src/lib/api-types.ts`, `backend/openapi.json` |
| task-03 | 角色卡 `agent-profile-card` + 卡片墙 `agent-profile-card-grid`(搜索+三筛选+网格,全局/ws 复用)+ 人设预览 `agent-profile-preview` | W3 | P0 | task-02 | FR-04, FR-05, FR-07, D-002@v1 | `frontend/src/components/agent-profile/agent-profile-card.tsx`, `agent-profile-card-grid.tsx`, `agent-profile-preview.tsx` |
| task-04 | 重做 `agent-profile-form`:宽弹窗双栏(左填右实时预览),字段三组,全局页「工作区上下文」选择器(`listWorkspaces` 数据源) | W3 | P0 | task-02 | FR-06, D-003@v1, D-006@v1 | `frontend/src/components/agent-profile-form.tsx` |
| task-05 | 新全局页 `/agent-profiles`;重构 ws 内页复用卡片墙;`menu-permissions.ts` 加 agent-profiles 条目(permissions:[]);`app-shell` 加图标;ws 详情页入口保留;**同步修既有 menu-permissions 测试硬编码计数** | W4 | P0 | task-03, task-04 | FR-01, FR-10, D-001@v1, D-007@v1 | `frontend/src/app/(dashboard)/agent-profiles/page.tsx`, `frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx`, `frontend/src/lib/menu-permissions.ts`, `frontend/src/lib/__tests__/menu-permissions.test.ts`(既有测试,加条目后计数断言失效需同步修), `frontend/src/components/app-shell.tsx`, `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` |
| task-06 | `agent-profile-select` 换 antd Select(showSearch),保持逻辑(数据合并/兜底项/失效标记/onChange null) | W5 | P2 | — | FR-09, D-005@v1 | `frontend/src/components/agent-profile-select.tsx` |
| task-07 | 前端组件/页面测试;`tsc --noEmit` + `eslint` 0 error;verify 对照 design 验收 7 条 + Docker rebuild 实测 | W6 | P0 | task-01~06 | FR-08, 全局 | `frontend/src/components/agent-profile/__tests__/`, `frontend/src/components/__tests__/`, `frontend/src/app/(dashboard)/agent-profiles/__tests__/` |

> allowed_paths 并集覆盖 design §6 全部 15 物理文件 + 2 个既有测试文件(test_profile_router.py / menu-permissions.test.ts),无遗漏。
> task-05 同步修 menu-permissions.test.ts 的硬编码计数(L159 toHaveLength 37→38、EXPECTED_MENU_KEYS 加 "agent-profiles"、L187 counter.agent 4→5)——因 task-05 是破坏源,测试归属随破坏方。

## 关键路径

task-01 → task-02 → task-03/04 → task-05 → task-07(后端端点 → 前端数据 → 组件 → 装配 → 验证,线性)。task-06(选档对齐)独立 Wave 5,可任意时机插入,task-07 收尾依赖全部。

## 全局验收标准

- [ ] 侧边栏「智能体」分组出现「智能体档案」一级菜单,点击直达 `/agent-profiles`(经 menu-permissions.ts + permission.ts:41)。
- [ ] 全局页展示 actor 可见全部档案(个人+各 ws+平台+预置),按工作区/可见范围/供应商筛选生效。
- [ ] 越权:actor A 看不到 B 的 private 档、看不到非成员 ws 的 workspace 级档(测试通过)。
- [ ] 新建/编辑宽弹窗左填右实时预览,8 字段齐全;全局页新建「工作区上下文」选定后能力区有数据。
- [ ] 系统预置档案卡显示「只读」,无编辑/删除。
- [ ] `GET /api/agent-profiles`(无 scope)行为不变,`?scope=mine` 返回聚合集。
- [ ] `tsc --noEmit` + `eslint` 0 error;`cd frontend && pnpm test` 通过(含 menu-permissions.test.ts 计数更新);`cd backend && uv run pytest app/modules/agent -q --no-cov` 通过。

## 覆盖矩阵

| 决策 ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1(独立菜单 + 全局聚合) | task-05, task-02 | AC-1, AC-2 |
| D-002@v1(卡片墙突破表格基准) | task-03 | AC-2 |
| D-003@v1(表单双栏突破单列基准) | task-04 | AC-4 |
| D-004@v1(后端只读聚合端点) | task-01, task-02 | AC-2, AC-3, AC-6 |
| D-005@v1(选档下拉视觉对齐) | task-06 | AC-4(select 部分) |
| D-006@v1(全局页工作区上下文 sourcing) | task-04 | AC-4 |
| D-007@v1(菜单经 menu-permissions.ts) | task-05 | AC-1 |

全部 D-001~D-007 被覆盖,无未覆盖决策。剩余风险(非阻断,P2):R-02 突破基准回写 FRONTEND_PAGE_STYLE(task-07 顺手)、R-07 owner-left-ws 边界单测(task-01 含)。
