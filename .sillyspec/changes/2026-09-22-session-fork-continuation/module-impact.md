# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| models（backend 数据模型） | `backend/app/modules/agent/model.py` | 数据结构变更 | 是 |
| daemon（backend 会话域） | `backend/app/modules/agent/placement.py` | 调用关系变更（lease.metadata fork 四键） | 是 |
| agent（backend 供给与能力位） | `backend/app/modules/agent/provider_caps.py` | 配置变更（caps 第 16 键生成镜像） | 是 |
| models | `backend/app/modules/agent/tests/test_agent_session_model.py` | 逻辑变更（字段全集守卫 30→33） | 否 |
| models | `backend/app/modules/agent/tests/test_mission_session_id.py` | 逻辑变更（字段全集守卫追加） | 否 |
| agent | `backend/app/modules/agent/tests/test_provider_caps_alignment.py` | 逻辑变更（alignment 升 16 键+定值断言） | 否 |
| models | `backend/app/modules/agent/tests/test_session_fork_model.py` | 新增（fork 列模型单测 9 断言） | 否 |
| daemon | `backend/app/modules/daemon/lease/context.py` | 接口变更（claim payload 白名单四键，Grill B-1 断链点） | 是 |
| daemon | `backend/app/modules/daemon/router/__init__.py` | 逻辑变更（_ENDPOINT_ORDER 登记，D-013①） | 否 |
| daemon | `backend/app/modules/daemon/router/session_crud.py` | 接口变更（POST /sessions/{id}/fork） | 是 |
| daemon | `backend/app/modules/daemon/router/session_insights.py` | 接口变更（SessionRunRead 增 engine_anchor，D-014③） | 是 |
| daemon | `backend/app/modules/daemon/run_sync/service/submit_commit.py` | 逻辑变更（engine_anchor 分档回填，D-011 消费端） | 是 |
| daemon | `backend/app/modules/daemon/schema.py` | 接口变更（SessionForkRequest/Response+SessionRead 三字段） | 是 |
| daemon | `backend/app/modules/daemon/session/service/__init__.py` | 逻辑变更（fork 子域 8 符号 re-export） | 否 |
| daemon | `backend/app/modules/daemon/session/service/create.py` | 接口变更（fork 参数组 5 参+空 prompt 豁免） | 是 |
| daemon | `backend/app/modules/daemon/session/service/fork.py` | 新增（fork 服务全链 425 行：校验/mode 分派/种子帽/快照继承） | 是 |
| daemon | `backend/app/modules/daemon/tests/test_engine_anchor.py` | 新增（锚点回填六场景） | 否 |
| daemon | `backend/app/modules/daemon/tests/test_session_fork.py` | 新增（fork 专项 22 用例含 A 零改动断言） | 否 |
| models | `backend/migrations/versions/20260922194500_add_session_fork_columns.py` | 新增（四列+索引对称迁移） | 否 |
| backend 生成物 | `backend/openapi.json` | 配置变更（gen:types 派生） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/session-fork-entry.test.tsx` | 新增（门控矩阵/弹层 17 用例） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/session-fork-lineage.test.tsx` | 新增（溯源/面包屑/浮层/分组 16 用例） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx` | 逻辑变更（挂载期谱系 fetch mock 补齐，D-015③） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx` | 逻辑变更（同上连带） | 否 |
| frontend_components | `frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx` | 逻辑变更（同上连带） | 否 |
| frontend_components | `frontend/src/components/daemon/session-fork/fork-confirm-modal.tsx` | 新增（确认弹层两档语义标注） | 是 |
| frontend_components | `frontend/src/components/daemon/session-fork/lineage-block.tsx` | 新增（溯源块+多跳面包屑） | 是 |
| frontend_components | `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` | 调用关系变更（dialog 模式挂载+按需拉锚） | 是 |
| frontend_components | `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | 调用关系变更（page 模式挂载） | 是 |
| frontend_components | `frontend/src/components/daemon/session-panel/worker-session-overlay.tsx` | 接口变更（title/statusHint 参数化零回归） | 否 |
| frontend_components | `frontend/src/components/daemon/turn-segment-views.tsx` | 新增导出（TurnForkEntry 三重门控） | 是 |
| frontend_components | `frontend/src/components/daemon/turn-timeline.tsx` | 调用关系变更（forkEntry prop 接线+group 类，D-015①） | 是 |
| frontend_components | `frontend/src/components/sessions/session-list-panel.tsx` | 逻辑变更（origin+fork_of 分组与分身树不混+徽标） | 是 |
| frontend 生成物 | `frontend/src/lib/api-types.ts` | 配置变更（gen:types 派生禁手写） | 否 |
| frontend_lib | `frontend/src/lib/daemon/sessions.ts` | 接口变更（forkSession 封装+SessionRunRead 镜像补 engine_anchor） | 是 |
| frontend 生成物 | `frontend/src/lib/provider-caps.ts` | 配置变更（caps 镜像） | 否 |
| sillyhub-daemon | `sillyhub-daemon/scripts/gen-provider-caps.mjs` | 逻辑变更（枚举值域扩展+三端模板 16 键） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/daemon.ts` | 调用关系变更（execPayload 四键解析透传） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts` | 接口变更（resumeAtUuid→resumeSessionAt+forkSession；禁 resumeDropsTurn；engineAnchor 补挂） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/pi-rpc-driver.ts` | 新增逻辑（短命 RPC 预 fork 两态+entryId 回查补挂） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/providers.ts` | 接口变更（caps 第 16 键 sessionFork 定值） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager.ts` | 调用关系变更（spec 四键并入+fork 不降级门） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager/driver-factory.ts` | 逻辑变更（R-07 独立转发分支解耦 systemPrompt 守卫） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager/types.ts` | 接口变更（DriverOptionsSpec 增三键） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/types.ts` | 接口变更（CreateSessionInput 增四键） | 是 |
| sillyhub-daemon | `sillyhub-daemon/tests/interactive/provider-registry.test.ts` | 逻辑变更（契约 16 键+定值锚） | 否 |
| sillyhub-daemon | `sillyhub-daemon/tests/session-fork.test.ts` | 新增（透传全链 14 用例） | 否 |

## 未匹配文件

归类器 0 命中（multi-agent-platform 根 map 的 `backend/**`/`frontend/**`/`sillyhub-daemon/**` paths 前缀与归类器口径不齐）——47 个文件已全部人工归属进上方矩阵（语义判定，以 git diff 为准）；无真游离文件。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 归类器对根 map `backend/**`/`frontend/**`/`sillyhub-daemon/**` 前缀 0 命中——工具归类口径待修（记录 friction，不本仓自行 rebuild）；语义归属已人工补全（47 文件入矩阵） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
