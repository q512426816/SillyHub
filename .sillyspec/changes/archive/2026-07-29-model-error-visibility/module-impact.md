# 模块影响分析（Module Impact）— 模型调用失败可见性完整修复（claude code 会话）

> 变更：2026-07-29-model-error-visibility | base c0190979..HEAD
> 三重交叉验证：声明范围(design §4 文件清单) = 任务范围(plan/task 卡片路径) = 真实变更(git diff)。以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend（daemon 子模块） | 数据结构变更 + 接口变更 + 逻辑变更 + 新增 | `app/modules/daemon/model_error.py`（新增 ModelErrorType+ModelErrorDTO）<br>`app/modules/daemon/router.py`（InteractiveRunResultRequest.error + GET /sessions/{id}/runs + SSE run_error）<br>`app/modules/daemon/run_sync/service.py`（close_interactive_run 写 error_detail）<br>`app/modules/daemon/service.py`（facade 透传 error）<br>`app/modules/daemon/tests/test_close_interactive_run_model_error.py`（新增 6 测）<br>`app/modules/daemon/tests/test_session_runs_endpoint.py`（新增 8 测） | 三端同构 ModelErrorDTO；close_interactive_run 三层透传写 error_detail（run→failed）；新增 GET runs 读端点 + SSE run_error 事件 | false |
| backend（agent 子模块） | 数据结构变更 | `app/modules/agent/model.py`（AgentRun.error_detail JSON 列）<br>`migrations/versions/202607291100_add_agent_run_error_detail.py`（add_column error_detail） | AgentRun 加 nullable JSON error_detail 列（与 error_code 正交，D-009） | false |
| backend（基础设施） | 配置变更 | `conftest.py`（db_engine fixture 加 ppm.project model import——主键 FK 真实需要）<br>`openapi.json`（gen:types 同步，+SessionRunRead schema/GET runs 路径） | 测试 schema 注册补全；OpenAPI 契约同步 | false |
| sillyhub-daemon | 逻辑变更 + 接口变更 + 新增 | `src/model-error/{types,index,classifier}.ts`（新增三端同构 ModelError + classifier 8 类归类）<br>`src/adapters/stream-json.ts`（is_error 时产出 ModelError）<br>`src/hub-client.ts`（notifyRunResult payload +error）<br>`src/daemon.ts`（payload 映射）<br>`src/interactive/session-manager.ts`（turn 收尾近源 classify）<br>`src/api-types.ts`（gen:types）<br>`tests/model-error/classifier.test.ts`（新增 25 测） | daemon 侧错误归类 + 跨进程 notifyRunResult 携带结构化 error 贯通 daemon→backend | false |
| frontend | 逻辑变更 + 接口变更 + 新增 | `src/components/agent-log/normalize.ts`（error_detail→error 类日志项 + 修正 :352 误判 + brownfield 兜底）<br>`src/components/agent-log/run-error-item.tsx`（新增 RunErrorItem 组件）<br>`src/components/agent-log/__tests__/run-error-item.test.tsx`（新增 32 测）<br>`src/components/agent-log-viewer.tsx`（接 RunErrorItem + failed 标红）<br>`src/components/agent-run-panel.tsx`（agent 页接通）<br>`src/components/daemon/interactive-session-panel.tsx`（runtime 聊天窗接通）<br>`src/components/daemon/runtime-session-dialog.tsx`（failed 标红）<br>`src/lib/daemon.ts`（listSessionRuns helper）<br>`src/lib/api-types.ts`（gen:types）<br>`src/app/(dashboard)/workspaces/[id]/agent/page.tsx`（agent 页接线） | 会话页两面（agent 页 + runtime 聊天窗）run failed 显示 RunErrorItem + 原因 + hint + actions | false |
| docs | 新增 | `docs/sillyspec/worktree-dump-openapi-imports-main-repo.md` | 记录 worktree execute 下 dump_openapi.py 导入 main app 的工具坑 | false |
| .sillyspec | 配置变更 | `local.yaml`（modules 块 daemon/agent 条目——task-12 验证既有）<br>`meta.json` | verify test_strategy=module 配置；变更元数据 | false |

## 未匹配文件

| 文件 | 说明 |
|------|------|
| `backend/tests/modules/auth/test_login_captcha.py`<br>`backend/tests/modules/auth/test_refresh_token_index.py` | **与本变更无关**——属 baseline checkpoint(c0190979) 之后捆绑的 captcha/auth-refresh 变更(eb68743a 等)，非 model-error 改动。module-impact 不计入本变更影响。 |

## 影响总结

本变更跨三端（daemon / backend / frontend）+ 新增 alembic migration。核心影响：
- **数据结构**：AgentRun 加 error_detail JSON 列（migration 202607291100，真实 PG apply 验证）。
- **接口**：新增 GET /sessions/{id}/runs（读 error_detail）+ SSE run_error 事件；notifyRunResult 加可选 error 字段（向后兼容）。
- **逻辑**：daemon classifier 8 类归类 + 三端 ModelError 协议贯通；前端 normalize 识别 + RunErrorItem 渲染 + 两面集成。
- **不影响**：PPM 模块（已上线）零触碰；session/lease 状态机 + daemon spawn 路径未改（failed 转换本就存在，仅附加 error_detail）。
