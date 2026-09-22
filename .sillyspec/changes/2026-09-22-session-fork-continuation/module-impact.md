# 模块影响分析（plan 阶段首版——最终以 execute 后 git diff 为准）

> 文件×模块归属按 _module-map.yaml paths 前缀 + design.md 文件变更清单；影响类型为语义判断。
> 归档时按真实 diff 复核并同步各模块文档增量节。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| models（backend 数据模型） | backend/app/modules/agent/model.py、backend/migrations/versions/20260922194500_add_session_fork_columns.py、backend/app/modules/agent/tests/test_session_fork_model.py | 数据结构变更（AgentSession fork 三列+origin 值域+索引、AgentRun engine_anchor） | 是 |
| daemon（backend 会话域） | backend/app/modules/daemon/session/service/fork.py（NEW）、session/service/create.py、session/service/__init__.py、router/session_crud.py、schema.py、lease/context.py、run_sync/service/submit_commit.py、tests/test_session_fork.py（NEW）、tests/test_engine_anchor.py（NEW） | 接口变更（POST /sessions/{id}/fork+SessionRead 三字段）+新增（fork 服务）+逻辑变更（claim 白名单两键、engine_anchor 回填） | 是 |
| agent（backend 供给与能力位） | backend/app/modules/agent/placement.py（lease.metadata 两键）、backend/app/modules/agent/provider_caps.py（sessionFork 镜像）、backend/app/modules/agent/tests/test_provider_caps_alignment.py（16 键） | 调用关系变更+配置变更（caps 第 16 键） | 是 |
| sillyhub-daemon（Node 执行体） | sillyhub-daemon/src/interactive/providers.ts、scripts/gen-provider-caps.mjs、src/daemon.ts、src/interactive/session-manager/{types,index,driver-factory}.ts、src/interactive/{claude-sdk-driver,pi-rpc-driver}.ts、tests/session-fork.test.ts（NEW）、tests/interactive/provider-registry.test.ts | 接口变更（caps 16 键、CreateSessionInput 增键）+逻辑变更（execPayload 解析/driverOpts/claude SDK options 透传，R-07 解耦点） | 是 |
| frontend_lib | frontend/src/lib/daemon/sessions.ts（forkSession 封装+镜像）、frontend/src/lib/provider-caps.ts（生成镜像） | 接口变更（新增 API 封装+caps 键） | 否（生成物+薄封装） |
| frontend_components | frontend/src/components/daemon/turn-segment-views.tsx（轮头入口）、session-fork/fork-confirm-modal.tsx（NEW）、session-fork/lineage-block.tsx（NEW）、session-panel/worker-session-overlay.tsx（标题参数化）、session-panel/session-panel-page.tsx、session-panel/session-panel-dialog.tsx、sessions/session-list-panel.tsx（分组徽标）、__tests__/session-fork-{entry,lineage}.test.tsx（NEW） | 新增（分叉入口/弹层/溯源块）+调用关系变更（双面板挂载、列表分组） | 是 |

## 生成物（不落模块卡，随变更提交）

- backend/openapi.json（gen:types 派生）
- frontend/src/lib/api-types.ts（gen:types 派生，禁手写）

## 变更目录内产物（不入模块）

- .sillyspec/changes/2026-09-22-session-fork-continuation/spike-pi-fork.md（task-02）、e2e-claude-fork.md（task-08）、decisions.md（D-008 追加）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| daemon.md | 增量节：fork 端点/白名单透传/锚点回填/生命周期契约新行 | 待归档同步 |
| models 模块卡 | fork 三列+engine_anchor+origin 值域 | 待归档同步 |
| agent 模块卡 | placement 两键+caps 16 键 | 待归档同步 |
| sillyhub-daemon 模块卡 | caps 16 键/透传链/R-07 解耦/pi 定档结论 | 待归档同步 |
| frontend_components/frontend_lib 模块卡 | 分叉入口/弹层/溯源块/浮层参数化/列表分组/API 封装 | 待归档同步 |
| _module-map.yaml | main_symbols 追加本变更条目 | 待归档同步 |
