# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/agent/model.py` → agent（数据模型）：数据结构变更（两列 soft-add：QueuedMessage.origin / Run.metadata_）
- `backend/migrations/versions/20260910120000_add_auto_resume_origin_and_run_metadata.py` → 数据库迁移（agent/daemon 域）：数据结构变更（两列 add/drop 对称）
- `backend/app/modules/daemon/session/service/auto_resume.py` → daemon（会话服务）：新增（守卫序列+SAVEPOINT+提示词模板单一源）
- `backend/app/modules/daemon/session/service/recovery.py` → daemon（恢复链）：逻辑变更（recover 接线自动续跑入队）
- `backend/app/modules/daemon/session/service/queue.py` → daemon（排队派发）：逻辑变更（G10 派发时守卫+origin 解析+打标传递+edit/reorder 409）
- `backend/app/modules/daemon/session/service/inject.py` → daemon（注入）：接口变更（auto_resume_of 可选参，缺省零回归）
- `backend/app/modules/daemon/router/session_insights.py` → daemon（路由）：接口变更（SessionRunRead.metadata 出口）
- `backend/app/modules/daemon/schema.py` → daemon（DTO）：接口变更（SessionAutoResumeUpdateRequest）
- `backend/app/modules/daemon/router/session_crud.py` → daemon（路由）：接口变更（PATCH auto-resume 204）
- `backend/app/modules/daemon/session/service/session_lifecycle.py` → daemon（会话服务）：逻辑变更（config merge 开关写入）
- `frontend/src/lib/api-types.ts` → frontend_lib：配置变更（gen:types 重生成产物）
- `backend/openapi.json` → OpenAPI 契约：接口变更（新端点+SessionRunRead.metadata）
- `frontend/src/lib/daemon/sessions.ts` → frontend_lib：接口变更（手写 interface 补 metadata 可选字段）
- `frontend/src/components/sessions/session-config-bar.tsx` → frontend_components：新增可选控件（autoResume Switch，不传零渲染）
- `frontend/src/components/agent-log/run-error-item.tsx` → frontend_components：接口变更（fallbackHint 可选 prop）
- `frontend/src/components/daemon/turn-timeline.tsx` → frontend_components：逻辑变更（daemonRestartedHint 透传 + autoResumeOf 徽标渲染）
- `frontend/src/components/daemon/session-panel/page-helpers.tsx` → frontend_components：逻辑变更（enrichDisplayTurns 回填 autoResumeOf）
- `backend/app/modules/daemon/tests/test_auto_resume_integration.py` → daemon 测试：新增（全链集成验证 3 用例）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild——未匹配文件全部归入既有模块（daemon/agent/frontend_lib/frontend_components/迁移），索引未过期 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
