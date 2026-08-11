---
author: qinyi
created_at: 2026-08-11 15:43:48
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 用 sillyspec 工具在本地改自己的 change，platform sync 上行进度 |
| 平台用户 | 在变更中心查看工作区变更的状态/阶段 |

## 功能需求

### FR-01: workspace-scoped token 签发
覆盖决策：D-001@v1
Given workspace 成员持 WORKSPACE_WRITE 权限
When 调 `POST /api/workspaces/{wid}/platform-sync-tokens`
Then 201 返回 `shpsync_` 明文 token 一次；`platform_sync_tokens` 存 sha256(token_hash) + workspace_id + created_by

### FR-02: 收件箱按 workspace 隔离
覆盖决策：D-001@v1
Given `platform_change_progress` 加 workspace_id + 复合唯一 `(workspace_id, change_name)`
When 持 `shpsync_` token 上行 `POST /api/changes/{name}/progress`
Then `require_platform_sync` 派生 (User=created_by, workspace_id)，upsert 按复合键隔离；workspace A 数据不进 workspace B

### FR-03: connect 自动下发 + 权限校验
覆盖决策：D-005@v1, D-006@v1
Given 用户跑 `sillyspec platform connect` 且持 user 级 shk_live_
When connect 调 `POST /api/workspaces/resolve-by-root-path`（body=root_path）
Then 反查 workspace（不到→404）→ 校验调用者 WORKSPACE_WRITE（无→403）→ 签发 shpsync_ 返回 `{workspace_id, token}`；connect 用 `replaceTopLevelSection` 写 local.yaml platform 段（保留注释）

### FR-04: 变更中心实时 join 投影 current_stage
覆盖决策：D-002@v1
Given 变更中心查列表/详情
When `enrich_summaries`（list 批量 IN join）/`enrich_with_workspace_ids`（single = 匹配）join `platform_change_progress`
Then 取 `latest_progress.changes[0].current_stage` 覆盖猜值；read-only 不写 changes 表；无 N+1

### FR-05: 未上行 fallback
覆盖决策：D-003@v1
Given 工具从未上行的 change（或 quick-<uuid8> 不建目录）
When join 不命中
Then fallback 到 changes 表现有 current_stage，不崩

### FR-06: 不投 status（已撤销 D-004@v2）
覆盖决策：D-004@v2
Given sillyspec status 仅 active/archived 两值
When 投影
Then 只覆盖 current_stage；status 维持变更中心派生（current_stage==archive → 已归档）

### FR-07: gen:types 同步
When 后端 schema 改动
Then 跑 `pnpm gen:types` 同步 `api-types.ts` + `openapi.json` 并提交

### FR-08: migration 棕地免回填
When `alembic upgrade`
Then 建 `platform_sync_tokens` 表 + `platform_change_progress` 加 workspace_id 复合唯一；老数据不回填（规则 7）；shk_live_ 过渡保留

## 非功能需求

- 兼容性：Windows/Linux/macOS（connect 用文本级段替换 writer，无平台特定路径处理）
- 可回退：工具未上行/隔离未配时 fallback 现有值，行为不变；shk_live_ 过渡期可回退
- 可测试：各模块 pytest + connect 联调；R-06 本机 500 排查为 execute 前置
- 安全：resolve-by-root-path 强制 WORKSPACE_WRITE 校验（P0，D-006），无权限 403

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | token 派生 + workspace 隔离 |
| D-002@v1 | FR-04 | 实时 read-only join |
| D-003@v1 | FR-05 | 未上行 fallback |
| D-004@v2 | FR-06 | 撤 status 投影（仅 current_stage） |
| D-005@v1 | FR-03 | connect 自动下发 |
| D-006@v1 | FR-03 | resolve-by-root-path WORKSPACE_WRITE 权限 |
