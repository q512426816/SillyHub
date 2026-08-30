---
author: qinyi
created_at: 2026-08-26 14:12:00
plan_level: full
---

# 实现计划（Plan）

## Spike 前置验证

无独立 Spike——技术方案经 Design Grill 全量源码核查（挂点/合并语义/下发条件均有代码证据），唯一不确定点「工作区会话 workspaceId 下发覆盖率」已收敛为 task-06 前置验证任务（不通过则该任务内补齐 backend 下发，不推翻设计）。

## Wave 1（并行，后端基础 + 前置验证）
- task-01
- task-03
- task-06

## Wave 2（依赖 Wave 1：测试与类型与拉取层）
- task-02
- task-04
- task-05

## Wave 3（依赖 Wave 2：daemon 接线与前端数据层）
- task-07
- task-09

## Wave 4（依赖 Wave 3：链路与页面测试收口）
- task-08
- task-10

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 PUT mcp-config 写接口 | W1 | P0 | — | FR-01, FR-02, FR-03 / D-003@v2, D-005@v2 | service `update_mcp_config`（校验/`<set>` 还原/原子写/审计）+ router 端点 + pydantic 模型（就近 skills_view_service.py） |
| task-02 | 写接口 pytest | W2 | P0 | task-01 | FR-01, FR-02, FR-03 | 权限 403/校验 422/还原成功与失败/原子写/审计落库/中文文案 |
| task-03 | daemon API 扩展 workspace 维度 | W1 | P0 | — | FR-05 / D-004@v1 | `workspace_id` 可选 query + **新增** `_read_mcp_config_raw` 不脱敏读法 + 不带参回归 |
| task-04 | 前端类型重生成 | W2 | P0 | task-01, task-03 | FR-01 | `pnpm gen:types`（先探 node_modules 健康），提交 api-types.ts + openapi.json（PUT 与 daemon API 两处 schema 都需先落地） |
| task-05 | daemon fetchMcpBundle | W2 | P0 | task-03 | FR-02, FR-04 | 三件套拉取 + 非 stdio 预净化跳过 warn + 回落链 + 单测 |
| task-06 | workspaceId 下发覆盖率验证 | W1 | P0 | — | FR-04 / D-008@v1 | 核查工作区普通/主控会话 execPayload.workspaceId（lease/context.py 下发条件）；缺口则本任务内补 backend 下发 |
| task-07 | daemon 预取挂点与合并注入 | W3 | P0 | task-05, task-06 | FR-04 / D-006@v2, D-007@v2, D-008@v1 | daemon.ts `_startInteractiveSession` 预取 + `Map<sessionId,bundle>` 缓存（restore/reload 重取回落）+ provider 合并注入（白名单参数并入两个内置 server 名，优先级 builtin > workspace > platform）+ rejected warn + 头注释修正 |
| task-08 | daemon 注入链路测试 | W4 | P0 | task-07 | FR-04 | 落点 `sillyhub-daemon/tests/cli-session-manager-injection.test.ts`（既有 provider 用例所在地）或就近新文件：优先级覆盖/白名单剔除 warn/拉取失败回落/无 workspaceId 现状不变/restore 缓存缺失重取 |
| task-09 | 前端 mutation 与缓存失效 | W3 | P1 | task-04 | FR-01 | `updateWorkspaceMcpConfig` + `useUpdateWorkspaceMcpConfig`，成功 invalidate `workspaceMcpConfig.detail` |
| task-10 | 页面双态改造与测试 | W4 | P0 | task-09 | FR-01 / D-001@v1, D-002@v1 | 查看/编辑双态 + zod 校验（中文定位 server 名）+ `<set>`/白名单/mcpRefs 提示文案，对照原型；**更新既有 page.test.tsx（现断言「只读/无编辑」文案，双态后失效）** + 新增编辑态用例 |

## 关键路径
task-03 → task-05 → task-07 → task-08（daemon 链路最长）；并行支线 task-03 → task-04 → task-09 → task-10（前端支线）

## 全局验收标准
1. 子模块测试全绿：backend `workspace` + `daemon`、sillyhub-daemon、frontend（按 local.yaml modules 块命令）
2. 不带 `workspace_id` 的 daemon API 响应与现状字节级同构（向后兼容回归）
3. 无 `.mcp.json` 工作区会话注入结果与现状一致（内置 server 照常，brownfield 行为不变）
4. 端到端冒烟：页面保存含密钥配置 → 文件落盘（密钥 `<set>` 不写盘）→ daemon 日志可见三件套合并与白名单剔除 warn
5. 错误文案含中文（守护测试约束）；密钥在 GET/PUT 响应中恒为 `<set>`

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-10 | 页面编辑保存生效 |
| D-002@v1 | task-10 | textarea JSON + zod 校验 |
| D-003@v2 | task-01, task-02 | `<set>` 还原/失败报错测试 |
| D-004@v1 | task-03, task-05 | daemon API 扩展 + 三件套拉取 |
| D-005@v2 | task-01, task-02, task-05 | 后端拒绝 + daemon 预净化 |
| D-006@v2 | task-07, task-08 | 白名单参数含内置名 + 优先级测试 |
| D-007@v2 | task-07, task-08 | 预取挂点 + 缓存回落测试 |
| D-008@v1 | task-06, task-07 | workspaceId 覆盖率验证 + 注入分支 |
