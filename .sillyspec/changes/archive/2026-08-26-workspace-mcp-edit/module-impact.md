---
author: qinyi
created_at: 2026-08-26 14:25:00
---

# 模块影响分析（Module Impact）— 工作区 MCP 配置编辑与端到端注入

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend workspace | 修改 | 新增 PUT /workspaces/{id}/mcp-config 写接口（router + skills_view_service 新增 update_mcp_config/`<set>` 还原/原子写/审计 + pydantic 模型）+ 新增测试 test_mcp_config_write.py |
| backend daemon | 修改 | get_daemon_mcp_config 扩展 workspace_id 参数 + 新增 _read_mcp_config_raw 不脱敏读法；test_mcp_config_endpoint.py 补分支用例 |
| frontend | 修改 | workspaces/[id]/mcp/page.tsx 双态改造 + workspace-skills-view.ts 新增 mutation + api-types.ts/openapi.json 重生成 + __tests__ 用例（含更新既有 page.test.tsx） |
| sillyhub-daemon | 修改 | mcp-config.ts 新增 fetchMcpBundle/预净化 + 头注释修正；daemon.ts _startInteractiveSession 预取挂点 + 会话级缓存；cli.ts provider 合并注入 + rejected warn；cli-session-manager-injection.test.ts 等测试 |

## 未匹配文件

无。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（workspace 写接口 + daemon API 扩展 + 主控 ws 兜底） | done |
| `modules/frontend.md` | 更新 frontend 模块卡（MCP 页双态 + mutation + api-types） | done |
| `modules/sillyhub-daemon.md` | 更新 sillyhub-daemon 模块卡（fetchMcpBundle + 预取缓存 + 合并注入） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
