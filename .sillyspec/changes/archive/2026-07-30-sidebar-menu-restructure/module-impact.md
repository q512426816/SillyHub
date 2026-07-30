---
author: qinyi
created_at: 2026-07-30 10:35:00
change: 2026-07-29-sidebar-menu-restructure
---

# 模块影响分析（Module Impact）— SillyHub 侧边栏菜单信息架构重组

## 三重交叉验证

| 来源 | 代码文件数 | 一致性 |
|---|---|---|
| 声明范围（design §6 文件清单） | 10 | ✅ |
| 任务范围（plan.md / tasks/task-NN.md allowed_paths） | 10 | ✅ |
| 真实变更（git diff 1a5ea80e，排除 13 个 spec docs） | 10 | ✅ |

> 以 git diff 为准。代码文件三方一致；另有 13 个 `.sillyspec/changes/...` 规范文档（变更包自身，不计入代码模块）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend | 逻辑变更（纯增量枚举） | `backend/app/modules/auth/permissions.py` | `Permission` 枚举追加 `LLM_PROVIDER_READ = "llm_provider:read"`，group 默认归 PLATFORM；seed_platform_admin_role 启动幂等同步，无 migration、不改任何 router 鉴权 | false |
| backend | 测试 | `backend/tests/modules/auth/test_permissions.py` | 枚举计数 64→65 + 新枚举值/group 断言 + 专项用例 | false |
| frontend | 逻辑变更（配置驱动） | `frontend/src/lib/menu-permissions.ts` | MenuSection 6 值 + 菜单按功能域重组 5 组（workspace8/agent4/config4/governance3/system4，ppm14 不变）+ 新增 skills/mcp/llm-providers 3 菜单 + runtimes 归 config | false |
| frontend | 逻辑变更（渲染） | `frontend/src/components/app-shell.tsx` | MENU_ICON_MAP 补 /settings/skills→Puzzle、/settings/mcp→PlugZap、/settings/providers→Cloud；间距/高亮单一渲染源不变 | false |
| frontend | 逻辑变更（瘦身） | `frontend/src/app/(dashboard)/settings/page.tsx` | 移除 4 EntryCard + providers Tab + LlmProviderSection 引用，仅留 4 平台配置 Tab，默认工作区信息 | false |
| frontend | 新增 | `frontend/src/app/(dashboard)/settings/providers/page.tsx` | 我的供应商独立页（复用 LlmProviderSection） | false |
| frontend | 测试 | `frontend/src/lib/__tests__/menu-permissions.test.ts`<br>`frontend/src/lib/__tests__/permission.test.ts`<br>`frontend/src/components/__tests__/admin-role-permission-picker.test.tsx`<br>`frontend/src/app/(dashboard)/settings/providers/__tests__/page.test.tsx` | 适配新分组（6 组/37 计数/新菜单显隐）+ 新页渲染测试 | false |

## 未匹配文件（spec docs，非代码模块）

| 文件 | 说明 |
|---|---|
| `.sillyspec/changes/2026-07-29-sidebar-menu-restructure/*`（13 个） | 变更包规范文档（proposal/requirements/design/tasks/plan/decisions/tasks/task-0X.md/verify-result/module-impact），归档随包移动，不影响代码模块 |

## 接口/数据模型影响

- **无 API 变更**：不新增/修改任何 REST/WebSocket 端点
- **无数据模型变更**：无 DB schema 变更，仅新增权限字符串枚举值
- **无生命周期契约变更**：design §7.5 已判定不涉及（daemon 仅菜单项静态展示）

## 模块文档同步

`frontend.md` 变更索引需在 archive 阶段追加本变更条目（按项目惯例）。
