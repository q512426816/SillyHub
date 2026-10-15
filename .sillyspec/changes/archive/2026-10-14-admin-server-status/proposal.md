---
author: qinyi
created_at: 2026-10-14 23:50:17
generated_by: sillyspec-fourpiece-init
change: 2026-10-14-admin-server-status
---
# 提案书（Proposal）

## 动机

用户需要在系统管理页面查看服务器信息状态。该能力此前以首页看板（ServerStatusCard + HealthCard）形态存在，2026-07-10 首页改造为纯跳转页后卡片不再渲染，2026-07-24 死代码清理（commit cbde5217d / c2262cca3 / 51e63ef45）将前端展示层物理删除，功能从此消失。后端 `GET /api/system-status` 接口（backend/app/modules/health/router.py:80）始终在线但已无任何前端消费方。

## 关键问题

1. **服务器运行状况无处可看**：CPU/内存/磁盘与业务统计的展示入口已删，运维只能裸调 API；现存唯一近似物是设置页的数据库卡片（frontend/src/app/(dashboard)/settings/page.tsx:104-117），仅覆盖 DB 连接状态。
2. **审计遗留 BS-6**：/api/system-status 完全公开（匿名可查 CPU/内存/磁盘/用户数），docs/platform-audit-2026-08-20.md:70,136 在案；当时"不修"的理由（首页匿名看板）已随看板删除消失，接口成为无消费方的暴露面。
3. **权限面缺口**：系统管理组各页均有独立权限门控，"服务器信息"若恢复需补齐同构的权限语义，而非回到人人可见。

## 变更范围

- 后端：`/api/system-status` 收紧为登录 + 新权限 `system_status:read`（require_permission_any），响应结构零变化；Permission 枚举新增 SYSTEM_STATUS_READ（免种子迁移，platform:admin 直通）。
- 前端：系统管理组末尾新增「服务器信息」菜单与 `/admin/server-status` 页面（CPU/内存/磁盘进度条 + 任务/项目/里程碑/用户统计 + DB/Redis 连接状态，5 秒自动刷新，失败降级不白屏）；lib/health.ts 恢复 getSystemStatus()；api-types 经 gen:types 再生成。
- 测试：后端三态鉴权用例、前端页面组件测试、admin/menus 排序锚重算。

## 不在范围内（显式清单）

- 不做历史性能曲线/监控告警（仅当前值快照，与原看板口径一致）
- 不改 SystemStatusResponse 响应字段（不改 schema.py）
- 不在工作区首页或任何非系统管理入口挂状态卡片（D-007@v1 rejected）
- 不做 WebSocket 推送（沿用 5s 轮询）
- 不动 /api/health 端点（保持公开，负载均衡健康检查语义）

## 成功标准（可验证）

- 管理员登录后系统管理组可见「服务器信息」菜单，页面三组卡片数据正确并 5 秒自动刷新
- 未登录调 GET /api/system-status 得 401；无权限登录用户得 403 且菜单不可见；持 system_status:read 或 platform:admin 得 200
- 角色管理页权限勾选器出现「服务器状态查看」可分配
- 后端聚焦测试（test_health.py）与前端聚焦测试（新页面 + admin/menus）全绿，tsc/eslint 零错
- 审计 BS-6 关闭：匿名访问 /api/system-status 不再返回服务器数据
