# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| lib-api | `frontend/src/lib/api-types.ts` | 生成文件（gen:types 产物，W2 task-07 触发） | 否（生成物） |
| model-error | `sillyhub-daemon/src/model-error/types.ts` | 接口变更（ModelErrorType +context_overflow，W2 task-07） | 是 |
| model-error | `sillyhub-daemon/src/model-error/classifier.ts` | 逻辑变更（归类规则，W2 task-07） | 是 |
| policy | `sillyhub-daemon/src/policy/shell-paths.ts` | 逻辑变更（flag 过滤，W2 task-10） | 是 |
| policy | `sillyhub-daemon/src/policy/path-utils.ts` | 接口变更（anchor 可选参数，W2 task-10） | 是 |
| policy | `sillyhub-daemon/src/policy/filesystem-policy.ts` | 接口变更（anchor 透传）+逻辑变更（deny 双拼写，W2 task-10） | 是 |
| types | `sillyhub-daemon/src/types.ts` | 接口变更（wire timestamp 可选字段，W2 task-01） | 是 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `sillyhub-daemon/src/event-wire.ts`（daemon 事件轨；W2 task-01/02 逻辑变更+接口变更）
- `sillyhub-daemon/src/agent-log/message-coalescer.ts`（daemon 事件轨；W3 task-02 新增）
- `sillyhub-daemon/tests/agent-log/message-coalescer.test.ts`（daemon 测试；W3 task-02 新增）
- `backend/app/modules/daemon/run_sync/service/submit_steps.py`（daemon 后端域；W2 task-01 timestamp 取值）
- `backend/app/modules/daemon/agent_task_store.py`（daemon 后端域；W1 task-03 已落地：逻辑变更 tool_use_id 关联合并，commit 0526ded8）
- `backend/app/modules/daemon/session/service/export.py`（daemon 后端域；W1 task-06 已落地：逻辑变更读侧去重接入，commit 696f488a）
- `backend/app/modules/daemon/session/service/create.py`（daemon 后端域；W1 task-04 核查后零改动——绑定前 NULL 现状语义保持，回填落 inject.py，commit 830f34d6）
- `backend/app/modules/daemon/session/service/inject.py`（daemon 后端域；W1 task-04 已落地：逻辑变更非切换轮默认供应商快照回填，commit 830f34d6）
- `sillyhub-daemon/tests/model-error/classifier.test.ts`（daemon 测试；W2 task-07）
- `backend/app/modules/daemon/schema.py`（daemon 后端域；W2 task-07 Literal 扩展）
- `frontend/src/components/agent-log/normalize.ts`（frontend 组件域；W2 task-07）
- `frontend/src/components/agent-log/run-error-item.tsx`（frontend 组件域；W2 task-07 错误卡）
- `backend/app/modules/daemon/session/service/auto_resume.py`（daemon 后端域；W4 task-08 自动恢复分支）
- `backend/app/modules/daemon/session/service/helpers.py`（daemon 后端域；W3 task-09 会话状态语义）
- `sillyhub-daemon/src/interactive/session-manager/write-guard.ts`（daemon 交互域；W2 task-10 anchor 透传）
- `backend/app/modules/daemon/router/session_insights.py`（daemon 后端域；W1 task-06 已落地：逻辑变更列表去重接入，commit 696f488a）
- `docs/sillyspec/cli-cwd-coupling.md`（docs 域；W1 task-11 已落地：新增记档，commit eb3f9236）
- `docs/sillyspec/deps-gate-offline-fragile.md`（docs 域；W1 task-11 已落地：新增记档，commit eb3f9236）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/lib-api.md` | 更新lib-api模块卡（生成文件，gen:types 产物无需模块卡更新） | skipped |
| `modules/model-error.md` | 更新model-error模块卡（context_overflow 归类规则+错误卡，commit 4dabdc28/0841ede2） | done |
| `modules/policy.md` | 更新policy模块卡（flag 过滤+anchor 贯通+双拼写文案，commit e9975101） | done |
| `modules/types.md` | 更新types模块卡（wire timestamp 可选字段，commit 8371e41f） | done |
| `_module-map.yaml` | 未匹配文件均为既有模块内深路径（event-wire/agent_task_store 等），模块索引粒度使然，无需 rebuild | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
