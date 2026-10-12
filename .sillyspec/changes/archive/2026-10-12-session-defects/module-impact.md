# 模块影响分析（Module Impact）— 2026-10-12-session-defects

> 归档终审版（与真实 diff 930d739bc..HEAD 对齐，`git diff --name-only` 为准——真实 > 记录）。
> 测试文件随实现同卡交付，影响类型统一标「测试」。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| lib-api | `frontend/src/lib/api-types.ts` | 生成文件（gen:types 产物，ModelErrorType +context_overflow） | 否（生成物） |
| model-error | `sillyhub-daemon/src/model-error/types.ts` | 接口变更（ModelErrorType +context_overflow） | 是 |
| model-error | `sillyhub-daemon/src/model-error/classifier.ts` | 逻辑变更（context_overflow 归类规则） | 是 |
| model-error | `backend/app/modules/daemon/model_error.py` | 接口变更（StrEnum 成员 + R-05 宽松校验 validator） | 是 |
| policy | `sillyhub-daemon/src/policy/shell-paths.ts` | 逻辑变更（flag token 捕获即弃，bash/PS/CMD） | 是 |
| policy | `sillyhub-daemon/src/policy/path-utils.ts` | 接口变更（anchor 可选参数，三函数） | 是 |
| policy | `sillyhub-daemon/src/policy/filesystem-policy.ts` | 接口变更（anchor 透传）+逻辑变更（deny 双拼写提示） | 是 |
| types | `sillyhub-daemon/src/types.ts` | 接口变更（wire timestamp 可选字段） | 是 |
| daemon（backend） | `backend/app/modules/daemon/agent_task_store.py` | 逻辑变更（幽灵行 tool_use_id 关联合并/重映射） | 是 |
| daemon（backend） | `backend/app/modules/daemon/task_snapshot_dedupe.py` | 新增（任务快照读侧去重纯函数） | 是 |
| daemon（backend） | `backend/app/modules/daemon/session/service/auto_resume.py` | 逻辑变更（context_overflow 压缩续跑分支+熔断） | 是 |
| daemon（backend） | `backend/app/modules/daemon/session/service/helpers.py` | 逻辑变更（可恢复失败豁免，会话状态语义） | 是 |
| daemon（backend） | `backend/app/modules/daemon/session/service/export.py` | 逻辑变更（导出任务快照去重接入） | 是 |
| daemon（backend） | `backend/app/modules/daemon/session/service/inject.py` | 逻辑变更（非切换轮默认供应商快照回填） | 是 |
| daemon（backend） | `backend/app/modules/daemon/run_sync/service/submit_steps.py` | 逻辑变更（wire 事件时间戳解析+落库/SSE 一致） | 是 |
| daemon（backend） | `backend/app/modules/daemon/router/session_insights.py` | 逻辑变更（任务列表 API 去重接入） | 是 |
| daemon（backend） | `backend/openapi.json` | 生成文件（dump_openapi 产物） | 否（生成物） |
| event-wire（daemon） | `sillyhub-daemon/src/event-wire.ts` | 接口变更（timestamp 注入）+逻辑变更（coalescer 接入、decline 留痕行） | 是 |
| event-wire（daemon） | `sillyhub-daemon/src/agent-log/message-coalescer.ts` | 新增（delta 合并缓冲器） | 是 |
| interactive（daemon） | `sillyhub-daemon/src/interactive/session-manager/write-guard.ts` | 逻辑变更（四分支 anchor 透传） | 是 |
| agent-log（frontend） | `frontend/src/components/agent-log/normalize.ts` | 接口变更（ModelErrorType 联合扩展+集合） | 是 |
| agent-log（frontend） | `frontend/src/components/agent-log/run-error-item.tsx` | 逻辑变更（context_overflow 错误卡 + FileWarning 图标） | 是 |
| docs | `docs/sillyspec/cli-cwd-coupling.md` | 新增（sillyspec CLI 缺陷记档） | 否 |
| docs | `docs/sillyspec/deps-gate-offline-fragile.md` | 新增（sillyspec CLI 缺陷记档） | 否 |
| 测试（backend） | `backend/app/modules/daemon/tests/`（test_agent_session_tasks / test_apply_session_terminal_status / test_auto_recover_failed_turn / test_close_interactive_run_model_error / test_run_sync_submit_timestamp / test_session_switch_config / test_session_tasks_dedupe ×7）+ `backend/tests/modules/daemon/test_session_export.py` | 测试（随实现同卡交付，先红后绿留痕） | 否 |
| 测试（daemon） | `sillyhub-daemon/tests/`（event-wire / event-wire-timestamp / task-runner / agent-log/message-coalescer / model-error/classifier / policy×3 / interactive/session-manager-write-guard ×8） | 测试（含 golden 比较器剥离动态字段适配） | 否 |
| 测试（frontend） | `frontend/src/components/agent-log/__tests__/run-error-item.test.tsx` | 测试（context_overflow 渲染用例） | 否 |

## 未匹配文件

零改动裁决（plan 声明、调查后确认无需改动，verify 对账已从 target_files 移除并逐卡留痕）：

- `backend/app/modules/daemon/session/service/create.py` — 绑定前 NULL 为既有钉子语义，回填落 inject.py（task-04）
- `backend/app/modules/daemon/schema.py` — ModelErrorType 实际落 model_error.py StrEnum（task-07 实测纠偏）
- `sillyhub-daemon/src/interactive/session-manager/turn-control.ts` — abortAll 全 deny 经 approval_decision=decline 同一事件形态，补口落 event-wire（task-05）
- `backend/app/modules/daemon/run_sync/service/close_run_steps.py` — 修正落点 helpers.py，闸拒绝覆写逻辑原样保留（task-09）

其余 diff 文件（.sillyspec/changes/**、.sillyspec/knowledge/**）为流程产物，不参与模块核对。模块索引无需 rebuild（未命中文件均为既有模块内深路径，索引粒度使然）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/lib-api.md` | 生成文件（gen:types 产物）无需模块卡更新 | skipped |
| `modules/model-error.md` | 模块卡同步（context_overflow 归类规则+错误卡，commit 4dabdc28/0841ede2） | done |
| `modules/policy.md` | 模块卡同步（flag 过滤+anchor 贯通+双拼写文案，commit e9975101） | done |
| `modules/types.md` | 模块卡同步（wire timestamp 可选字段，commit 8371e41f） | done |
| `_module-map.yaml` | 未命中文件均为既有模块内深路径，索引粒度使然，无需 rebuild | skipped |
