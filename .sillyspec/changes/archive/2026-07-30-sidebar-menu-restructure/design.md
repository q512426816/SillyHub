---
author: qinyi
created_at: 2026-07-30 08:35:17
scale: large
change: 2026-07-29-sidebar-menu-restructure
---

# 设计文档（Design）— SillyHub 侧边栏菜单信息架构重组

## 1. 背景

当前 SillyHub 侧边栏菜单存在三类问题（用户反馈"菜单好乱、一些功能没展示出来、分组和布局也不好"）：

1. **功能被埋藏、入口不一致**：「我的供应商」「技能管理」「MCP 管理」三个功能全部藏在「设置」一个菜单内部（`settings/page.tsx` 顶部的 4 个 `EntryCard` 卡片入口 + 5 个 Tab），侧边栏无法直接触达。而同样性质的「Git 身份」「API 密钥」却已是侧边栏独立菜单——**同一类功能，入口层级不一致**，显得又乱又难找。
2. **分组语义混杂**：现状 5 个分组（overview 概览 8 项 / management 管理 7 项 / admin 系统管理 3 项 / system 系统 2 项 / ppm 项目管理），其中"管理"组把**凭证类**（Git 身份、API 密钥）与**业务类**（智能体控制台、Agent 团队、审批、审计）混在一组，缺乏清晰的功能域划分。
3. **视觉不统一**：菜单图标 emoji（`menu-permissions.ts` 的 `icon` 字段）与 lucide 线条图标（`app-shell.tsx` 的 `MENU_ICON_MAP`）混用，分组间距与高亮样式缺乏统一规范。

代码依据（已读透）：

- `frontend/src/lib/menu-permissions.ts` — 菜单唯一数据源（`MENU_PERMISSION_GROUPS` 硬编码数组 + `MenuSection` 联合类型 + `MENU_SECTION_ORDER`/`MENU_SECTION_LABEL`）。
- `frontend/src/components/app-shell.tsx` — 侧边栏渲染（按 `SECTION_ORDER` 分组渲染、`MENU_ICON_MAP` 图标映射、ppm 隔离逻辑）。
- `frontend/src/app/(dashboard)/settings/page.tsx` — 设置页（`EntryCard` 卡片入口 + `LlmProviderSection` 供应商 Tab）。
- `frontend/src/lib/permission.ts` — 菜单可见性判断（`canSeeMenu`/`visibleMenusBySection`/`hasAnyPermission`）。
- `backend/app/modules/llm_provider/router.py` — 「我的供应商」后端为 **per-user 个人级**（所有端点按 `current_user.id` 过滤，用 `get_current_user`，**非**平台管理员门槛）。
- `backend/app/modules/auth/rbac.py` + `backend/app/modules/auth/permissions.py` — RBAC 权限模型（角色→权限，`is_platform_admin` 短路全可见，`GET /api/auth/me` 经 `collect_permissions_everywhere` 返回全量权限驱动前端菜单显隐）。

## 2. 设计目标

1. **按功能域重组菜单**：将侧边栏（非 ppm）重排为 5 个语义清晰的分组——工作区 / 智能体 / 配置中心 / 协作治理 / 系统管理；ppm 组保持隔离不变。
2. **补齐埋藏功能**：「我的供应商」「技能管理」「MCP 管理」提为侧边栏独立菜单，可直达。
3. **设置页瘦身**：设置页只保留平台级配置（工作区信息 / 智能体配置 / 安全策略 / 集成），移除与侧边栏重复的卡片入口与供应商 Tab，实现单一入口。
4. **视觉统一**：菜单图标统一为 lucide 线条图标，分组间距与高亮样式统一。
5. **供应商可见性可分配**：新增 `llm_provider:read` 权限，纳入 RBAC，可在角色管理中分配/收回。

## 3. 非目标（Non-Goals）

- **不改动任何后端业务接口的鉴权逻辑**：`llm_provider`、`skills`、`settings/mcp` 等 router 的权限要求保持原样。本次只新增一个权限枚举值用于**前端菜单显隐**，不改变"谁能调接口"。
- **不改动 ppm 组**：`/ppm/*` 菜单与隔离逻辑（`pathname.startsWith("/ppm")`）完全不动。
- **不改动路由结构**：`/settings/skills`、`/settings/mcp` 等现有路由保持原路径，仅新增 `/settings/providers` 一个路由；不重命名、不迁移旧路由。
- **不做"默认全员可见"的 migration 强制赋权**：`llm_provider:read` 不在 migration/seed 中默认授予所有角色（保持"分配"语义纯粹；普通成员默认不可见，由管理员在角色管理分配）。
- **不重构菜单为嵌套/多级结构**：仍是"分组 + 平铺菜单项"一层结构，不引入可折叠子菜单树（YAGNI）。
- **不改动工作区级 skills/mcp 页面**（`/workspaces/[id]/skills`、`/workspaces/[id]/mcp`）：本次菜单只指向平台级那套。

## 4. 拆分判断

**单一变更，不拆分、不走批量模式**。理由：菜单重组是一次连贯的信息架构调整，所有菜单项耦合在同一个数据源（`menu-permissions.ts`）与同一渲染入口（`app-shell.tsx`）中，拆成多个变更反而割裂且无法独立验证；任务数量 < 10，各任务无"模板 × 数据"的重复模式，不满足批量模式条件。

## 5. 总体方案

### 5.1 新菜单结构（最终定稿，含用户确认的分组调整）

| 分组（section key） | 中文标签 | 菜单项 |
|---|---|---|
| `workspace` | 工作区 | 工作区首页 · 项目组组件 · 拓扑图 · 变更中心 · 扫描文档 · 运行时 · 知识&日志 · 发布（8 项，原 overview 组平移） |
| `agent` | 智能体 | 智能体控制台 · Agent 团队 · **技能管理🆕** · **MCP 管理🆕**（4 项） |
| `config` | 配置中心 | **我的供应商🆕** · API 密钥 · Git 身份管理 · 守护进程运行时（4 项） |
| `governance` | 协作治理 | 审批中心 · 审计中心 · 事件（3 项） |
| `system` | 系统管理 | 用户 · 组织 · 角色 · 设置（4 项） |
| `ppm` | 项目管理 | （保持现状，隔离不变） |

> 用户确认的两处定制：①「守护进程运行时」归入**配置中心**（非系统管理），因其管的是 daemon 实例/版本等平台运行资源，与供应商/密钥/Git 身份同属"平台资源配置"（D-006）；②技能/MCP 菜单指向**平台级**那套（`/settings/skills`、`/settings/mcp`），工作区级仍在工作区内部访问。

### 5.2 分 Phase 实施

**Phase 1 — 菜单数据源与分组重组（核心）**
- `menu-permissions.ts`：`MenuSection` 联合类型改为 `"workspace" | "agent" | "config" | "governance" | "system" | "ppm"`；`MENU_PERMISSION_GROUPS` 全量重排到新分组；新增 3 个菜单项（`llm-providers` / `skills` / `mcp`）；更新 `MENU_SECTION_ORDER` 与 `MENU_SECTION_LABEL`。
- 后端 `permissions.py`：新增 `LLM_PROVIDER_READ = "llm_provider:read"` 枚举。

**Phase 2 — 我的供应商独立页面 + 设置页瘦身**
- 新增 `settings/providers/page.tsx`：复用 `LlmProviderSection` 组件，独立路由直达。
- 改造 `settings/page.tsx`：移除 4 个 `EntryCard` 卡片入口（技能/MCP/API 密钥/Git 身份）与 `providers` Tab；保留工作区信息 / 智能体配置 / 安全策略 / 集成 4 个 Tab。

**Phase 3 — 侧边栏渲染与视觉统一**
- `app-shell.tsx`：`MENU_ICON_MAP` 补充 `skills`/`mcp`/`llm-providers` 图标并统一为 lucide；分组标题间距、选中高亮样式统一；保持 ppm 隔离与 `navHidden` 逻辑不变。

**Phase 4 — 测试与权限接线**
- 更新受影响测试（`menu-permissions.test.ts`、`admin-role-permission-picker.test.tsx`、`permission.test.ts`；`layout.test.tsx` 因 mock AppShell 无需改动）；新增 `providers` 页面渲染测试；后端 `permissions.py` 加枚举（`seed_platform_admin_role` 启动自动同步，无需 migration）。

### 5.3 「我的供应商」可见性设计（D-002）

- 后端 `llm_provider` router 本为 per-user（任何登录用户可调接口管理自己的供应商），**本次不改其后端鉴权**。
- 前端菜单"我的供应商"用新权限 `llm_provider:read` 控制显隐：
  - `is_platform_admin === true` → 短路可见（管理员改完即可见）；
  - 普通成员 → 需被分配 `llm_provider:read`（在【角色管理】里分配/收回，即用户所说的"分配"）。
- 权限 picker（`AdminRolePermissionPicker`）读取 `menu-permissions.ts` 的 `permissions` 字段渲染可分配权限卡片，新增菜单项会自动出现在角色管理中，无需额外接线。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/menu-permissions.ts` | `MenuSection` 改 6 值；菜单项重排到新分组；新增 `llm-providers`/`skills`/`mcp` 3 个菜单项；更新 SECTION_ORDER/SECTION_LABEL |
| 修改 | `frontend/src/components/app-shell.tsx` | `MENU_ICON_MAP` 补 3 个图标并统一 lucide；分组间距/高亮视觉统一 |
| 新增 | `frontend/src/app/(dashboard)/settings/providers/page.tsx` | 我的供应商独立页面，复用 `LlmProviderSection` |
| 修改 | `frontend/src/app/(dashboard)/settings/page.tsx` | 瘦身：移除 4 个 EntryCard + providers Tab，保留 4 个平台配置 Tab |
| 修改 | `frontend/src/lib/__tests__/menu-permissions.test.ts` | 适配新分组与新菜单项断言 |
| 修改 | `frontend/src/components/admin-role-permission-picker.tsx` | 直接消费 `MENU_SECTION_ORDER`/`MENU_SECTION_LABEL`/`MenuSection`（行 7-10/159/169），核对新分组渲染 |
| 修改 | `frontend/src/components/__tests__/admin-role-permission-picker.test.tsx` | 更新硬编码分组断言（"renders 4 sections in fixed order"/"overview section renders 8 menus"） |
| 修改 | `frontend/src/lib/__tests__/permission.test.ts` | 更新 `visibleMenusBySection` 的旧 section 名（"admin"/"management"/"overview"/"system"→新值） |
| 新增 | `frontend/src/app/(dashboard)/settings/providers/__tests__/page.test.tsx` | 供应商独立页渲染测试 |
| 无需修改 | `frontend/src/app/(dashboard)/layout.test.tsx` | 已 mock `AppShell`（passthrough），不依赖菜单分组，不受本变更影响 |
| 修改 | `backend/app/modules/auth/permissions.py` | 新增 `LLM_PROVIDER_READ = "llm_provider:read"` 枚举；`seed_platform_admin_role`（service.py:475）启动时自动遍历枚举同步至 platform_admin 角色，**无需 migration** |
| 修改 | `backend/tests/modules/auth/test_permissions.py` | 权限枚举计数 64→65 + 新枚举分组归属/值断言 |

> 影响面确认（经 Design Grill 核实）：`MenuSection` 联合类型改动波及 `app-shell.tsx`、`admin-role-permission-picker.tsx` 及相关测试（`menu-permissions.test.ts`、`admin-role-permission-picker.test.tsx` 硬编码分组、`permission.test.ts` 旧 section 名），已全部列入上表。`permission.ts` 的 `canSeeMenu`/`hasAnyPermission` 逻辑**无需改动**（仅消费新分组数据）。`layout.test.tsx` 因 mock `AppShell` 不受影响。

## 7. 接口定义

### 7.1 前端类型（`menu-permissions.ts`）

```ts
// 变更前
export type MenuSection = "overview" | "management" | "admin" | "system" | "ppm";
// 变更后
export type MenuSection = "workspace" | "agent" | "config" | "governance" | "system" | "ppm";
```

新增菜单项（结构沿用现有 `MenuPermissionGroup`）：

```ts
{ section: "config", menuKey: "llm-providers", menuLabel: "我的供应商",
  href: "/settings/providers", absolute: true, matchPattern: "/settings/providers",
  permissions: [{ key: "llm_provider:read", name: "供应商管理" }] },
{ section: "agent", menuKey: "skills", menuLabel: "技能管理",
  href: "/settings/skills", absolute: true, matchPattern: "/settings/skills",
  permissions: [{ key: "settings:admin", name: "平台设置管理" }] },
{ section: "agent", menuKey: "mcp", menuLabel: "MCP 管理",
  href: "/settings/mcp", absolute: true, matchPattern: "/settings/mcp",
  permissions: [{ key: "settings:admin", name: "平台设置管理" }] },
```

`MENU_SECTION_LABEL` 更新：

```ts
{ workspace: "工作区", agent: "智能体", config: "配置中心",
  governance: "协作治理", system: "系统管理", ppm: "项目管理" }
```

### 7.2 后端权限枚举（`permissions.py`）

```python
class Permission(StrEnum):
    # ... 现有值 ...
    LLM_PROVIDER_READ = "llm_provider:read"  # 新增，仅用于前端菜单显隐 + 角色分配
```

### 7.3 无新增 API 端点

本次不新增/修改任何 REST/WebSocket 端点；`/settings/skills`、`/settings/mcp`、`/llm-providers` 复用现有页面与接口。

### 7.5 生命周期契约

本变更为前端菜单信息架构重组 + 1 个后端权限枚举值，**不涉及生命周期契约**（无 session/lease/agent_run 生命周期、无状态机/心跳/租约变更；出现的"daemon"仅为"守护进程运行时"菜单项的静态展示，不涉及其生命周期事件）。

## 8. 数据模型

- **无数据库表结构变更**。
- 仅新增一个权限字符串枚举值 `llm_provider:read`。`platform_admin` 由 `is_platform_admin` 短路，无需 role_permission 记录即可见；`seed_platform_admin_role`（`service.py:475`，启动时 `platform_admin_permissions_synced`）会将全部 `Permission` 枚举同步给 platform_admin 角色以保持数据完整。普通成员默认无此权限（需分配），符合"分配"语义。

## 9. 兼容策略（brownfield）

- **路由兼容**：`/settings/skills`、`/settings/mcp` 等现有路由路径不变，旧书签/旧链接不失效；仅新增 `/settings/providers`。
- **设置页行为变化**：`/settings` 默认 Tab 由"我的供应商"改为首个保留 Tab（工作区信息）；原供应商功能改由 `/settings/providers` 与侧边栏菜单直达。属**有意的入口迁移**，非破坏（功能未删，仅入口位置变化）。
- **权限向后兼容**：新增枚举值为纯增量；无 `llm_provider:read` 的角色只是看不到"我的供应商"菜单（新增菜单项，无旧行为被破坏）；`is_platform_admin` 不受影响。
- **未配置新功能时**：不涉及功能开关，菜单重排为纯展示层调整，无运行时配置依赖。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | ~~权限枚举需与 seed/migration 同步~~（已消解：`seed_platform_admin_role`（service.py:475）启动时以其内 `missing = [p.value for p in Permission ...]` 幂等遍历 `Permission` 枚举补绑 platform_admin 角色，新增枚举无需 migration 即自动同步） | 已消解 | 仅需改 `permissions.py` 加枚举值，重启后端 seed 自动同步 |
| R-02 | `MenuSection` 联合类型改动波及所有引用处（app-shell / picker / 测试），漏改导致编译失败或菜单分组错乱 | P1 | execute 时 grep 全部 `MenuSection`/`SECTION_ORDER`/`visibleMenusBySection` 引用逐一核对 + 跑前端全量测试 |
| R-03 | 普通成员默认看不到"我的供应商"（需分配），与用户"展示出来"的直觉可能冲突 | P2 | 汇报时明确说明；管理员可一键在角色管理分配，或后续按需给默认角色赋权 |
| R-04 | 设置页移除卡片入口后，习惯从设置页进入的用户需适应侧边栏新入口 | P2 | 菜单命名与设置页卡片命名保持一致（技能管理 / MCP 管理），降低认知成本 |
| R-05 | 视觉统一改动误伤 ppm 隔离判断或 `navHidden` 二级页逻辑 | P2 | 保持 `pathname.startsWith("/ppm")` 与 `navHidden` 过滤逻辑原样，仅调整非 ppm 分组样式 |
| R-06 | 「我的供应商」改独立路由后，设置页内其他 Tab 的 `LlmProviderSection` 引用残留导致编译错误 | P2 | 瘦身时彻底移除 import 与 Tab 分支，跑 typecheck |

## 11. 决策追踪

| 决策 ID | 标题 | 覆盖位置 |
|---|---|---|
| D-001@v1 | 菜单按功能域重组为 5 组（工作区/智能体/配置中心/协作治理/系统管理）+ ppm 隔离 | §5.1，FR-01 |
| D-002@v1 | 「我的供应商」提为独立菜单 + 独立路由，可见性用新增 `llm_provider:read` 权限（可分配） | §5.2/§5.3，FR-02/FR-05 |
| D-003@v1 | 技能/MCP 提为独立菜单，指向平台级（复用 `settings:admin`） | §5.1，FR-03 |
| D-004@v1 | 设置页瘦身，仅留 4 个平台配置 Tab，移除卡片入口与供应商 Tab | §5.2，FR-04 |
| D-005@v1 | 菜单视觉统一（lucide 图标去 emoji、分组间距、高亮） | §5.3 Phase 3，FR-06 |
| D-006@v1 | 「守护进程运行时」归入配置中心（非系统管理） | §5.1，FR-01 |

所有决策均为当前版本（v1），无未解决项。剩余风险见 §10。

## 12. 自审

- ✅ 必备章节齐全：背景 / 设计目标 / 非目标 / 拆分判断 / 总体方案 / 文件变更清单 / 接口定义 / 数据模型 / 兼容策略 / 风险登记 / 决策追踪 / 自审。
- ✅ 生命周期契约：已判定不涉及（§7.5 写明豁免短语「不涉及生命周期契约」）。
- ✅ 决策追踪：D-001~D-006 全部列出并标注覆盖位置（§11）。
- ✅ 文件变更清单：含操作类型 + 路径 + 说明（§6）。
- ✅ 兼容策略：brownfield 已覆盖路由/权限/行为三方面（§9）。
- ✅ Design Grill 交叉审查（tier=independent）已执行：specVerdict=pass；qualityVerdict 初判 fail（文件变更清单遗漏 3 个文件）。已据审查补全 `admin-role-permission-picker.tsx` + 2 个测试文件、标注 `layout.test.tsx` 无需修改、并消解 R-01（seed 启动自动同步枚举，无需 migration）。文件变更清单现已完整，无未解决阻塞项。
