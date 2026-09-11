---
author: qinyi
created_at: 2026-09-11 21:13:12
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-11-workspace-asset-bridges

<!-- 由 sillyspec design-init 生成的骨架（2026-09-11-workspace-asset-bridges）——逐节填散文后删除本注释；存量手写路径不受影响 -->

## 背景

技能库/MCP 资产库（user 维度）与 workspace 层（specDir/skills、.mcp.json）管理面互不知晓：workspace skills 页看不到平台 git 技能库；MCP 资产库无法一键下发到 workspace .mcp.json；specDir 里手工放的技能无法收编为个人库资产。注入层已完整（bundle 三源+三层 MCP 合并），本变更补管理面的四座桥（用户裁决 D-001）。关联变更：skills-central-library（第三源/本表）、mcp-central-registry（资产库）。

## 设计目标

1. workspace 技能页：从平台 git 技能库按 workspace 维度启用（桥①②）
2. workspace mcp 页：从 MCP 资产库一键选入 .mcp.json（桥③）
3. specDir/skills 反向收编为 CustomSkill（桥④）
4. 注入并集语义 user ∪ workspace（D-002）；user 维度零回归

## 非目标

- 不改 workspace .mcp.json 既有 PUT/审计路径（import 复用）
- 不做 workspace 维度 MCP 绑定进 platform_default（.mcp.json 本身就是 workspace 注入面，桥③已闭环）
- 不收编多文件技能的辅助文件（CustomSkill 单文件模型，提示用户手动合并）
- 不做 daemon 分发架构深化（D-007 仅最小改造：per-workspace 槽位+按会话选槽；manifest 向后兼容——不带 workspace_id=user-only）

## 拆分判断

单一连贯变更：四桥共享 user_skill_enables 表扩展与两前端页面改造，拆开中间态（列加了没查询=workspace 绑定无效）。Wave 按表→端点→前端切。

## 总体方案

三模块分布（D-006 方案A）：skill_source 扩双 scope 查询+toggle+adopt；workspace 扩 mcp import-from-registry 端点；mcp_registry 扩 get_server_for_import helper（解密 env）。前端 workspace skills 页加平台库启用区块+收编入口；workspace mcp 页加从资产库选入。

**Wave**：W1 迁移+双 scope 查询+toggle（D-010 四处谓词）；W2 MCP import（D-009 三态契约）；W3 收编（D-008 归一化）；W4 daemon per-workspace 分发（D-007 最小改造）；W5 前端两页+gen:types。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/skill_source/model.py | UserSkillEnable 增 workspace_id 列（D-003） |
| 新增 | NEW:backend/migrations/versions/xxxx_add_workspace_scope_enables.py | 一列+双 partial unique |
| 修改 | backend/app/modules/skill_source/service.py | toggle 双维度（删除谓词带 scope D-010）+adopt 两方法（名归一化 D-008）+library workspace 参数（enabled_keys NULL 过滤 D-010） |
| 修改 | backend/app/modules/skill_source/router.py | enable 端点 workspace 参数 |
| 修改 | backend/app/modules/workspace/router.py | mcp import + adoptable/adopt 三端点（WORKSPACE_WRITE 域） |
| 修改 | backend/app/modules/workspace/skills_view_service.py | import 写入复用点+adoptable 扫描+adopt 落库 |
| 修改 | backend/app/modules/mcp_registry/service.py | get_server_for_import helper |
| 修改 | backend/app/modules/agent/skills_bundle_service.py | 第三源双维度并集+workspace_id 透传（None case 显式 IS NULL 谓词 D-010——user bundle version hash 零变化） |
| 修改 | backend/app/modules/daemon/router/daemon_rpc.py | manifest 端点 ?workspace_id 可选参数（带=并集渲染 D-007；不带=user-only 兼容） |
| 修改 | sillyhub-daemon/src/skill-manager.ts | per-workspace manifest 拉取（缓存槽 <manifest>:<workspace_id> 与全局槽并存；fetchRemoteManifest 增可选 workspaceId） |
| 修改 | sillyhub-daemon/src/daemon.ts | 会话 workspace 绑定时按 workspace 槽拉取+解包其 git 技能到 workdir（Grill B-01/D-007） |
| 修改 | sillyhub-daemon/src/task-runner.ts | 任务 workspace 绑定时同款按槽分发（batch 路径） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx | 平台库启用区块+收编入口 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx | 从资产库选入按钮+弹窗 |
| 修改 | frontend/src/components/skills-library/skill-source-api.ts | hook 扩 workspace 参数 |
| 修改 | frontend/src/lib/api-types.ts | gen:types |
| 修改 | backend/openapi.json + sillyhub-daemon/src/api-types.ts | 联动 |

## 接口定义

```python
async def toggle_enable(skill_key, user, *, enabled, workspace_id: UUID | None = None)
async def list_adoptable(session, workspace_id) -> list[AdoptableSkill]
async def adopt(session, workspace_id, names, user) -> AdoptResult
async def _collect_enabled_git_skills(session, user_id, workspace_id: UUID | None)
  # WHERE (user_id=:u AND workspace_id IS NULL) OR (workspace_id=:w)
async def get_server_for_import(server_id) -> McpServerImportView  # mcp_registry
# REST 新端点（WORKSPACE_WRITE）
POST /api/workspaces/{id}/mcp/import-from-registry {server_id}
GET  /api/workspaces/{id}/skills/adoptable
POST /api/workspaces/{id}/skills/adopt {names[]}
```

## 生命周期契约表

不涉及 lifecycle 实体（enable/adopt 均无状态 CRUD）。豁免。

## 数据模型

user_skill_enables + workspace_id UUID NULL FK workspaces CASCADE；原 UNIQUE 转 partial（workspace_id IS NULL）；新 partial (workspace_id, skill_key) WHERE workspace_id IS NOT NULL。workspace 行 user_id=操作者（审计）。

## 兼容策略（brownfield 必填）

- user 维度零回归：workspace_id IS NULL 行为逐字一致；无绑定 bundle version hash 不变
- manifest 向后兼容：不带 workspace 上下文=user-only；带上=并集
- import 复用 .mcp.json 原子写+审计；解密仅 import 内容构造
- adopt 不删源；CustomSkill 重名 409 既有

## 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | daemon 分发改造面 | P1 | D-007 定为最小改造纳入 W4（per-workspace 槽+按会话选槽）；启动全局拉保留 |
| R-02 | workspace 成员校验 | P1 | 端点 WORKSPACE_WRITE+service 二次校验 |
| R-03 | adopt 路径解析 | P2 | SkillsViewService 既有防穿越 |
| R-04 | import 明文 env | P2 | .mcp.json 本就明文；审计记 server_id |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001 四桥 | 目标 1-3 | 已覆盖 |
| D-002 并集 | 接口定义 | 已覆盖 |
| D-003 单表双 scope | 数据模型 | 已覆盖 |
| D-004 MCP import | 接口定义 | 已覆盖 |
| D-005 收编 | 接口定义 | 已覆盖 |
| D-006 三模块分布 | 总体方案 | 已覆盖 |

## 自审

- [x] 章节齐全/frontmatter（scale=large）/lifecycle 豁免/原型跳过（区块无新页面）/无存疑
