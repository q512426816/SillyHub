---
author: qinyi
created_at: 2026-10-14 23:50:18
generated_by: sillyspec-design-init
change: 2026-10-14-admin-server-status
scale: "large"  # 依据=用户显式要求完整流程（CLAUDE.md 规则 3：新功能必须走 brainstorm→plan→execute→verify→archive；本变更=恢复已删页面+新增权限枚举+鉴权收紧+菜单断言面，非小修复档）。技术轴如实声明：总量单会话可吞吐（非上下文分片型 large）；Wave 仅为执行编排形态——后端簇（task-01）与前端页面簇（task-02）可真并行，gen:types（task-03）是契约枢纽、菜单锚重算（task-04）顺序依赖之。
---

# 设计文档（Design）— 2026-10-14-admin-server-status

## 背景

服务器运行状态展示曾以首页看板形态存在（commit d7c7d5d06，2026-06-22：ServerStatusCard + HealthCard，展示 CPU/内存/磁盘 + 任务/项目/里程碑/用户数，5 秒轮询）。2026-07-10 首页改造为纯跳转页（frontend/src/app/page.tsx:15-26，commit 0ea4bec00）后卡片不再渲染；2026-07-24 两轮死代码清理（commit cbde5217d / c2262cca3 / 51e63ef45）将前端组件与 getSystemStatus() 物理删除。后端 `GET /api/system-status`（backend/app/modules/health/router.py:80-126）完好保留至今，前端零消费（api-types.ts:41-54 路径与 SystemStatusResponse 类型仍在生成物中）。

同时该端点为完全公开（匿名可查服务器性能与用户计数），审计 docs/platform-audit-2026-08-20.md BS-6 在案，"不修"前提（首页匿名看板）已消失。

用户需求：在系统管理页面恢复服务器信息状态展示（AskUserQuestion 亲选：接口收紧为登录+权限、内容=原看板全部+连接状态、方案 A 独立页面）。

## 设计目标

1. 系统管理组新增「服务器信息」独立页面，一页看全服务器性能、业务统计、依赖状态，5 秒自动刷新。
2. /api/system-status 收紧为登录 + system_status:read 权限，关闭审计 BS-6；权限可在角色管理页分配，与系统管理区既有独立权限模式同构。
3. 菜单注册、图标、admin/menus 声明序锚一次性同步到位（共享断言面⑦合规）。

## 非目标

- 不做性能历史曲线、告警、WebSocket 推送
- 不改 SystemStatusResponse schema 与 /api/health 公开语义
- 不在系统管理区以外的入口挂状态卡片
- 不新增后端表/迁移（role_permissions 按权限 key 行存，运行时写入）

## 拆分判断

单变更不拆批：后端鉴权收紧与前端页面恢复共享同一权限 key（system_status:read），拆开会出现中间态（接口收紧了页面没入口，或页面上了接口还公开），必须同变更落。

## 总体方案

**Wave 1（可并行两簇）**

簇 A · 后端权限与鉴权：
- backend/app/modules/auth/permissions.py：Permission 新增 `SYSTEM_STATUS_READ = "system_status:read"`（group 解析走默认分支归 PermissionGroup.PLATFORM，同 menu:admin，permissions.py:185-227）；免种子迁移——rbac.py:132 `is_platform_admin` 短路与 :139 PLATFORM_ADMIN 直通保证管理员天然可访问，新权限默认无人持有即"收紧"语义本身（D-004@v1）。
- backend/app/modules/health/router.py:80-85：端点签名加 `user: Annotated[User, Depends(require_permission_any(Permission.SYSTEM_STATUS_READ))]`（对齐 settings/router.py:54 惯例）；docstring 删"公开端点"表述改为权限说明。响应体零变化。
- backend/tests/test_health.py：补三态用例（未登录 401 / 登录无权限 403 / 持权限或 platform:admin 200）。

簇 B · 前端页面（可与簇 A 并行开发，联调需簇 A 就位）：
- frontend/src/lib/health.ts：恢复 `getSystemStatus(): Promise<SystemStatusResponse>`（类型取 api-types 生成物，D-002@v2）。
- 新建 /admin/server-status 页面（"use client"）：PageContainer + PageHeader 骨架；三组卡片——①服务器性能：antd Progress × 3（strokeColor 阈值：<80 主题紫 token / 80–90 琥珀 / >90 红）+ 已用/总量数值；②业务统计：任务/项目/里程碑/用户四格（样式对齐原型 stat-grid）；③依赖与版本：getHealth() 数据渲染 PostgreSQL/Redis Badge + 版本/commit/环境/UTC 时间。5s setInterval 轮询 + 卸载清理 + 立即刷新按钮 + 上次更新时间；失败显示错误条（--semantic-error-soft 浅红底）不清空既有数据。

**Wave 2（顺序依赖 Wave 1 簇 A）**

契约同步：导出 backend/openapi.json + `pnpm gen:types`（Permission 联合类型收录 system_status:read，menu-permissions.ts 的 PermissionKey 编译期校验闭环）。

**Wave 3（顺序依赖 Wave 2）**

- frontend/src/lib/menu-permissions.ts:397-463：system 组末尾新增 server-status 条目（permissions=[system_status:read]，icon emoji 占位，menuKey 遵守 R-01 稳定标识规约）。
- frontend/src/components/app-shell.tsx:74-114：MENU_ICON_MAP 加 `"/admin/server-status": Server`（lucide Server 未被占用，语义直白）。
- frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx：断言"system 组 5 行"→ 6 行（:161-168）；上移/下移用例的声明序锚注释 +1（:224-226，system 组自身锚定索引 18/19/20 不动，注释补 ppm 平移说明）。
- 前端页面组件测试（__tests__/page.test.tsx）：三卡渲染、轮询触发、失败降级。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/permissions.py | Permission 枚举新增 SYSTEM_STATUS_READ（producer：后端鉴权与 OpenAPI；consumer：health/router + 前端 PermissionKey） |
| 修改 | backend/app/modules/health/router.py | /system-status 挂 require_permission_any(SYSTEM_STATUS_READ)，docstring 更新 |
| 修改 | backend/tests/test_health.py | 补 system-status 三态鉴权用例 |
| 修改 | backend/tests/modules/auth/test_permissions.py | Permission 枚举 len 硬计数锚 59→60（:51，先例 2026-10-14-deploy-release-notes 58→59 同模式） |
| 修改 | backend/openapi.json | gen:types 契约源再导出（Permission 联合类型扩员） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成（规则 21：禁手写） |
| 修改 | frontend/src/lib/health.ts | 恢复 getSystemStatus() |
| 新增 | NEW:frontend/src/app/(dashboard)/admin/server-status/page.tsx | 服务器信息页（客户端组件，三卡 + 5s 轮询 + 降级） |
| 新增 | NEW:frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx | 页面组件测试 |
| 修改 | frontend/src/lib/menu-permissions.ts | system 组新增 server-status 第 6 条 |
| 修改 | frontend/src/components/app-shell.tsx | MENU_ICON_MAP 增 /admin/server-status → Server |
| 修改 | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | 5 行→6 行断言 + 声明序锚注释重算 |

## 接口定义

本变更接口面：1 端点鉴权变更 + 1 枚举扩员，0 新端点。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/system-status | 路由与响应模型不变（SystemStatusResponse：server_time/cpu_percent/memory_percent/memory_used_mb/memory_total_mb/disk_percent/disk_used_gb/disk_total_gb/tasks/projects/milestones/users）；鉴权从匿名收紧为 require_permission_any(Permission.SYSTEM_STATUS_READ)（401 未登录 / 403 无权限，PermissionDenied 既有错误通道） |

- Permission 枚举新增值 `"system_status:read"`（StrEnum；OpenAPI Permission schema 联合类型自动扩员，前端 PermissionKey 随 gen:types 收录）。前端菜单卡 PermissionItem.name 钉为「服务器状态查看」。

前端恢复函数：`getSystemStatus(): Promise<SystemStatusResponse>`（frontend/src/lib/health.ts，apiFetch 携 Bearer）。

## 生命周期契约表

本变更无生命周期契约变更（不涉及 session/lease/agent_run/daemon/lifecycle/state transition/claim/heartbeat——纯端点鉴权与展示页）。

## 数据模型

无 schema 变更：Permission 为 Python StrEnum（不入库表结构）；role_permissions 按 permission key 行存储，由角色管理页运行时写入，新权限默认零行（收紧语义），无 alembic 迁移。

## 兼容策略（brownfield 必填）

- 未持新权限的存量角色：菜单不可见、接口 403——行为收紧是本变更目标（用户确认 D-001@v2），非回归；管理员（is_platform_admin / platform:admin）行为不变（直通放行）。
- 前端零消费方已核实（system-status 展示层 2026-07 已删），接口收紧无既有页面破坏面；仓库外无已知匿名消费方（BS-6 审计记录即唯一登记面）。
- SystemStatusResponse 响应结构零变化：任何未来消费方按既有 schema 对接不受影响。
- 回退路径：极端情况下管理员仍可经 role_permissions 手工授五回收可见性；代码回退=revert 单提交。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | menu_overrides 表若存在 menu_key=server-status 历史孤儿行会意外复活覆盖 | P3 | grep 后端种子与代码无此 key；本项目未上线可重置数据（规则 11）；上线前菜单管理页可手工核 |
| R-02 | 共享断言面⑦漏跟提交（admin/menus 锚未重算被 pre-commit 拦） | P2 | task 表把锚重算列为独立任务项；提交前本地跑 scripts/check-assertion-surfaces.py |
| R-03 | 5s 轮询对后端产生固定 QPS（多管理员同时开页叠加） | P3 | 单页单 interval + 卸载清理；psutil 采样丢线程池开销低（interval=None 非阻塞）；量级远低于既有任务页轮询 |
| R-04 | gen:types 暴露无关旧测试债（规则 21 场景） | P3 | 按惯例顺手补字段修好，不为躲报错回退手写 |
| R-05 | cpu_percent(interval=None) 首次调用返回 0.0（psutil 冷启动语义） | P3 | 既有端点行为不变，前端如实展示；非本次范围 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v2 | FR-01 · 总体方案簇 A | accepted（用户亲选） |
| D-002@v2 | FR-02 · 总体方案簇 B | accepted（用户亲选） |
| D-003@v1 | FR-04 · Wave 3 落位 | accepted |
| D-004@v1 | FR-03 · 簇 A 免种子 | accepted |
| D-005@v1 | 总体方案（方案 A 独立页面） | accepted（用户亲选） |
| D-006@v1 | 非目标（设置页 Tab 拒绝） | rejected 防复潮 |
| D-007@v1 | 非目标（首页卡片拒绝） | rejected 防复潮 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN（v2 覆盖 v1，v1 保留审计链）
- [x] 生命周期契约豁免短语已写（紧邻标题，无生命周期关键词变更）
- [x] UI 原型分级核对：新增页面=必须生成档，prototype-admin-server-status.html 已按项目惯例（自包含 HTML + themes.ts 同源 token + 双态演示）落在变更目录
- [x] 无未标注的自审存疑项（R-05 属已知既有行为，非本次设计不确定项）
