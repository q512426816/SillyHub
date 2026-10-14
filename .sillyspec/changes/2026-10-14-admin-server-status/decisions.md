---
author: qinyi
created_at: 2026-10-14 23:50:17
generated_by: sillyspec-fourpiece-init
change: 2026-10-14-admin-server-status
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: /api/system-status 接口由公开收紧为登录+权限
- type: risk
- priority: P0
- status: accepted
- source: docs
- question: 后端 GET /api/system-status 现为完全公开（同 /health 不要求登录），CPU/内存/磁盘/用户数匿名可查（审计 docs/platform-audit-2026-08-20.md BS-6 在案）；恢复展示页时接口鉴权如何处理？
- answer: 收紧为登录 + 独立权限 system_status:read（require_permission_any）。审计"不修"的前提（首页匿名看板）已随 2026-07-24 看板删除消失，展示页迁入系统管理区（管理员区），接口权限与页面入口对齐。用户未实时应答（AskUserQuestion 无回复），按推荐项执行，可否决。
- normalized_requirement: GET /api/system-status 未登录返回 401；无 system_status:read 且非 platform:admin 返回 403；持权限或 platform:admin 返回 200（响应结构不变）。
- impacts: [FR-01, FR-03, task-01, task-03, verify-01]
- evidence: backend/app/modules/health/router.py:80-85（公开注释）；docs/platform-audit-2026-08-20.md:70,136（BS-6）；backend/app/core/auth_deps.py:135-152（require_permission_any）
- 故障面: 若有外部脚本匿名轮询该端点会开始收 401（仓库内前端零消费已核实，外部无已知消费方）。

## D-002@v1: 页面内容=原看板全部+数据库/Redis 连接状态
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 新页面展示范围？（原 ServerStatusCard=CPU/内存/磁盘+任务/项目/里程碑/用户数；设置页数据库卡片仅 DB 连接状态）
- answer: 原看板全部内容 + 合并 /api/health 的数据库/Redis 连接状态、版本、环境，一页看全服务器全貌；沿用原 5s 轮询自动刷新。用户未实时应答，按推荐项执行，可否决。
- normalized_requirement: 页面渲染 CPU/内存/磁盘三进度条（含已用/总量数值）、服务器时间、四项业务统计（任务/项目/里程碑/用户）、数据库与 Redis 连接状态徽标；5s 间隔自动刷新；接口失败显示降级态不白屏。
- impacts: [FR-02, task-02, verify-02]
- evidence: git show d7c7d5d06（原看板 ServerStatusCard 内容）；frontend/src/app/(dashboard)/settings/page.tsx:104-117（现存 DB 卡片）；backend/app/modules/health/schema.py（HealthResponse 字段）
- 
## D-003@v1: 页面落位系统管理组末尾，menuKey=server-status
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 页面放哪个菜单组、什么路径？
- answer: 用户原话"系统管理页面"→ system 组第 6 条（menus 之后、ppm 组之前），menuKey=server-status，label=服务器信息，href=/admin/server-status（absolute，对齐组内 /admin/* 惯例）。放组末尾使 system 组既有声明序索引（users=18/org=19/roles=20）不动，仅 ppm 组索引+1（无测试锚定 ppm 索引）。
- normalized_requirement: menu-permissions.ts system 组新增 server-status 条目（permissions=[system_status:read]）；admin/menus 测试"system 组 5 行"断言改 6 行；声明序锚注释同步 +1。
- impacts: [FR-04, task-04, verify-03]
- evidence: frontend/src/lib/menu-permissions.ts:397-463（system 组 5 条）；frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx:161-226（5 行断言+声明序锚）；menu-permissions.ts:97-100（共享断言面⑦登记）
- 故障面: 菜单覆盖表若已有同名 menu_key=server-status 的孤儿行会意外复活（核实过 menu_overrides 现存无此 key 才安全）。
- 退役判据: 服务器信息功能下线时同步删菜单条目并重算排序锚。

## D-004@v1: 新权限 system_status:read 免种子迁移
- type: premise
- priority: P1
- status: accepted
- source: code
- question: 新权限 SYSTEM_STATUS_READ 是否需要种子迁移给存量角色（2026-09-18 四权限先例）？
- answer: 不需要。先例迁移是"保可见性现状"（原登录常显）；本次原状是匿名公开、且新页定位系统管理区（管理员运维视图），语义为收紧——is_platform_admin 短路与 PLATFORM_ADMIN 直通使管理员天然可访问（rbac.py:132-139），其它角色默认不可见、可由管理员在角色管理页按需勾选（新权限自动进入 picker）。与 menu:admin（2026-09-18 新增、无种子）同模式。
- normalized_requirement: Permission 枚举新增 SYSTEM_STATUS_READ="system_status:read"（group 解析走默认分支归 PermissionGroup.PLATFORM，同 menu:admin 模式）；无 alembic 种子迁移；前端 PermissionKey 联合类型经 gen:types 自动收录。
- impacts: [task-01, task-03]
- evidence: backend/app/modules/auth/rbac.py:109-139（短路+直通）；backend/app/modules/auth/permissions.py:39-55（枚举+组惯例）；menu-permissions.ts:27-31（2026-09-18 种子先例，本次不适用）

## D-001@v2: 用户确认——接口收紧为登录+权限
- type: risk
- priority: P0
- status: accepted
- source: user
- question: 同 D-001@v1（AskUserQuestion 重新询问后用户亲选）。
- answer: 用户选择「收紧为登录+权限（推荐）」。决策内容同 v1，确认主体由 AI 推断改为用户亲选。
- normalized_requirement: 同 D-001@v1。
- impacts: [FR-01, FR-03, task-01, task-03, verify-01]
- evidence: AskUserQuestion 应答记录（2026-10-14 会话，问题1=收紧为登录+权限）
- supersedes: D-001@v1

## D-002@v2: 用户确认——页面内容=原看板全部+连接状态
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 同 D-002@v1（AskUserQuestion 重新询问后用户亲选）。
- answer: 用户选择「原看板全部+连接状态（推荐）」。决策内容同 v1，确认主体由 AI 推断改为用户亲选。
- normalized_requirement: 同 D-002@v1。
- impacts: [FR-02, task-02, verify-02]
- evidence: AskUserQuestion 应答记录（2026-10-14 会话，问题2=原看板全部+连接状态）
- supersedes: D-002@v1

## D-005@v1: 实现方案=独立页面（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 服务器信息展示的三种实现方案（A 独立页面 / B 并入设置页 Tab / C 首页挂卡片）选哪个？
- answer: 用户亲选方案 A：系统管理组新增第 6 项菜单「服务器信息」，独立页面 /admin/server-status 展示 CPU/内存/磁盘+四项业务统计+DB/Redis 连接状态，5s 自动刷新；接口同步收紧鉴权。
- normalized_requirement: 新建 frontend/src/app/(dashboard)/admin/server-status/page.tsx（客户端组件）；菜单注册 system 组末尾；不复用设置页；不在工作区首页挂卡片。
- impacts: [FR-02, FR-04, task-02, task-04]
- evidence: AskUserQuestion 应答记录（2026-10-14 会话，实现方案=A 独立页面）；menu-permissions.ts:397-463（system 组结构）
- 故障面: 菜单注册表新增条目平移 ppm 组声明序索引（共享断言面⑦），须同提交重算 admin/menus 测试锚。
- 退役判据: 页面下线时菜单条目+图标映射+测试锚同步回收。

## D-006@v1: 落选——并入设置页 Tab（方案 B）
- type: architecture
- priority: P2
- status: rejected
- source: user
- question: 同 D-005@v1。
- answer: 落选。劣势：设置页语义是平台配置，服务器运行状态混入入口不直观，不符用户"专门的页面"表述；设置页已有 4 个 Tab 再加拥挤。优势（改动面小、不碰菜单注册表）不足以抵消入口语义错位。
- 复潮条件: 若未来系统管理组菜单数量受限或用户改口接受设置页承载，可重议。
- evidence: AskUserQuestion 应答记录（2026-10-14 会话，方案 B 未选）

## D-007@v1: 落选——工作区首页挂卡片（方案 C）
- type: architecture
- priority: P2
- status: rejected
- source: user
- question: 同 D-005@v1。
- answer: 落选。劣势：与 D-001@v2 收紧权限直接冲突（首页全员可见 vs 管理员权限视图，无权限用户只能看降级卡片）；不落系统管理区，不符用户"系统管理页面"原话。
- 复潮条件: 若出现"全员可见的运行状态概览"需求（非管理员运维视图），可另立变更重议。
- evidence: AskUserQuestion 应答记录（2026-10-14 会话，方案 C 未选）



