---
author: qinyi
created_at: 2026-08-24 11:00:00
---

# 模块影响分析（Module Impact）— 平台会话实时反馈修复

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | daemon 子模块新增 SSE 事件 DTO、扩展 Redis 发布、新增 plan-response REST 端点 |
| backend | 依赖变更 | `protocol.py` 需新增 `DAEMON_MSG_PLAN_RESPONSE` 常量（与 daemon protocol.ts 对齐） |
| sillyhub-daemon | 修改 | hub-client 新增 notify 方法；session-manager 识别 plan/Bash/后台任务并上报 |
| sillyhub-daemon | 依赖变更 | `protocol.ts` 需新增 `MSG.PLAN_RESPONSE` 常量（与 backend protocol.py 对齐） |
| frontend | 修改 | lib/daemon.ts 新增事件解析；SessionPanel 接入新事件；新增 PlanApprovalCard / BashProgressCard |
| frontend | 修改 | askuser / permission 弹窗支持最小化浮动胶囊 |

## 未匹配文件

无。design.md 文件变更清单中所有源码与测试文件均已归属到 backend / sillyhub-daemon / frontend 三个模块。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| `modules/backend.md` | 更新后端模块卡（新增事件与端点） | pending |
| `modules/sillyhub-daemon.md` | 更新守护进程模块卡（新增上报方法与协议常量） | pending |
| `modules/frontend.md` | 更新前端模块卡（新增组件与事件消费） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
