---
author: qinyi
created_at: 2026-08-04 16:25:00
---

# 模块影响分析（Module Impact）— 智能体档案前端重设计 + 后端聚合端点

## 变更范围

change `2026-08-04-agent-profile-ui-redesign`:agent-profile 前端重做(全局卡片墙 + 带预览表单 + 独立菜单 + 选档对齐)+ 1 个后端只读聚合端点(`GET /api/agent-profiles?scope=mine`)。真实修改 22 个代码文件(git diff HEAD,三重交叉验证以真实为准)。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend(agent/profile) | 接口变更 + 逻辑变更 + 新增 | `router.py` / `service.py` / `tests/test_profile_router.py` / `tests/test_profile_service.py` / `openapi.json` | 新增 `GET /api/agent-profiles?scope=mine` 只读聚合端点(scope 省略=原 platform 行为 C8 冻结)+ `AgentProfileAggregatedItem` DTO(定义在 router.py,profile 模块无 schema.py)+ `service.list_visible_all` 跨工作区并集(逐档 `_can_read_async` 越权防护)+ 越权/owner 边界测试 | false |
| frontend | 新增 + 逻辑变更 + 接口变更 + 配置变更 + 调用关系变更 | `app/(dashboard)/agent-profiles/page.tsx`(新) / `components/agent-profile/{agent-profile-card,agent-profile-card-grid,agent-profile-preview}.tsx`(新) / `components/agent-profile-form.tsx` / `components/agent-profile-select.tsx` / `workspaces/[id]/agent-profiles/page.tsx` / `components/app-shell.tsx` / `lib/{agent-profiles,menu-permissions,api-types}.ts` / `app/(dashboard)/layout.tsx` / 4 个测试文件 | 全局卡片墙页(独立一级菜单)+ 3 个卡片墙组件(角色卡/卡片墙/人设预览)+ 重做表单(900px 双栏左填右实时预览 + 工作区上下文选择器 D-006)+ 选档下拉 select→antd Select + ws 内页重构复用卡片墙 + 侧边栏「智能体档案」菜单(menu-permissions 条目 + app-shell Bot 图标)+ `useMineAgentProfiles` 聚合数据层 + gen:types 同步 + **`layout.tsx` 工作区守卫白名单加 `/agent-profiles`(execute 集成遗漏,部署发现修复)** | false |

## 未匹配文件

无(22 个文件均在 backend / frontend 模块路径内)。

## 部署/运行时补充

- 新端点 `scope=mine` 本地 Docker 实测通过(全局卡片墙聚合展示 3 个档案,浏览器验证)。
- `layout.tsx` 白名单修复为 execute 阶段集成遗漏(组件测试覆盖不到「路由 × layout 守卫」),部署浏览器实测发现并已修复。
