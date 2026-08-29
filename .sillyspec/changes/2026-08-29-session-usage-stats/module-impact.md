---
author: qinyi
created_at: 2026-08-29 13:52:33
---
# 模块影响分析（Module Impact）— 会话内 Token 用量统计展示

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:daemon | 修改+新增 | schema.py 新增 SessionUsageRead/SessionUsageModelItemRead DTO；session/service.py 新增 get_session_usage 两段聚合（明细表 GROUP BY model + AgentRun 四维列兜底）；router.py 新增 GET /sessions/{id}/usage 端点（owner-only 404） |
| backend:daemon-tests | 新增 | test_session_usage.py（聚合三态/空会话/归属用例），task-02 创建 |
| frontend:components-daemon | 新增+修改 | 新增 session-usage-bar.tsx 用量条组件（+组件测试）；session-panel.tsx page/dialog 双模式渲染点接线 + 轮次终态 refreshSignal（+新挂载测试 session-usage-panel-mount.test.tsx） |
| frontend:lib-daemon | 修改 | daemon.ts 新增 getSessionUsage 封装与手写过渡类型（与后端 DTO 同构） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts | 生成物（pnpm gen:types），task-05 收口再生成，不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/backend/modules/daemon.md`（daemon 子映射卡）+ `docs/multi-agent-platform/modules/backend.changelog.md` | 会话契约摘要补 `GET /{id}/usage` 聚合语义条目 + 根卡变更索引 | done |
| `docs/SillyHub/modules/frontend_components.md`（会话域组件清单）+ `docs/multi-agent-platform/modules/frontend.changelog.md` | 补 session-usage-bar 组件条目 + 根卡变更索引 | done |
| `_module-map.yaml` | session-usage-bar.tsx 归 components-daemon 既有目录，无需新映射条目；待 scan 刷新 | skipped |
