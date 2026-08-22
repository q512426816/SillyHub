---
author: qinyi
created_at: 2026-08-23 05:00:00
---

# 模块影响分析（Module Impact）— 会话门户工作区中心化与预会话态

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend/components-sessions | 修改（重） | session-list-panel.tsx 重构为两层筛选 tab+工作区分组手风琴+机器小节+owner chip（退役引擎胶囊/全局虚拟滚动/机器多选）；sessions-portal.tsx 双态接线+preContext 解析（迁入 resolveDefaultMachineId+LS_KEY）；新增 pre-session-picker.tsx；new-session-form.tsx 与 workspace-session-picker.tsx 退役删除；测试大改写+迁移 |
| frontend/components-daemon | 修改（中） | session-panel.tsx 预会话态（page 分支 null 同构空态+守卫清单+首句 createSession 链路，dialog 模式零改动）；runtime-session-helpers.tsx 零改动 |
| frontend/lib（daemon.ts/api-types.ts） | 修改（轻） | 列表 limit 参数收口；api-types.ts 随 gen:types 生成更新（owner_name） |
| frontend/app-sessions-pages | 修改（轻） | 三页面薄壳微调（change 页传 preContext；sessions 页面测试迁移预会话语义） |
| backend/modules-daemon | 修改（轻） | 列表端点 owner_name join users + limit le=500（router/schema/session-service 三文件+pytest） |
| sillyhub-daemon | 依赖变更 | 无（协议零变更，design §7.5） |

## 未匹配文件

无（design §6 全部路径落入上述模块）。

## 更新结果（verify/收尾阶段回填）

| 目标 | 操作 | 状态 |
|------|------|------|
| docs/frontend/modules/components-sessions.md | 待更新（task-08）：树/浮层/退役/门户 preContext | pending |
| docs/frontend/modules/components-daemon.md | 待更新（task-08）：预会话守卫清单+首句链路 | pending |
| backend daemon 模块文档 | 待更新（task-08）：owner_name/limit | pending |
| docs/frontend/modules/_module-map.yaml | 预计无变化（未增删模块，pre-session-picker 归 components-sessions） | pending |
