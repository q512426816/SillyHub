# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/src/agent-log/registry.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/src/host-fs-handler.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/tests/agent-log/parse-cursor-agent-transcript.test.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts` — sillyhub-daemon 模块（agent-log 解析器矩阵 + host-fs-handler RPC 面）——接口变更（新增可选字段/新解析器注册）
- `backend/app/modules/platform_sync/schema.py` — backend 模块 platform_sync——接口变更（响应 schema 扩展）
- `backend/app/modules/platform_sync/router.py` — backend 模块 platform_sync——接口变更（响应 schema 扩展）
- `backend/app/modules/platform_sync/tests/test_agent_log_messages.py` — backend 模块 platform_sync——接口变更（响应 schema 扩展）
- `backend/openapi.json` — backend 生成物（schema 派生）
- `frontend/src/lib/api-types.ts` — frontend 生成物（gen:types 派生）
- `frontend/src/lib/agent-log-replay.ts` — frontend——新增（回放适配层纯函数）
- `frontend/src/components/daemon/agent-log-replay-body.tsx` — frontend——新增（回放主体组件）
- `frontend/src/components/daemon/session-panel/session-panel-page.tsx` — frontend——调用关系变更（挂载点替换 + dialog 门控）
- `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` — frontend——调用关系变更（挂载点替换 + dialog 门控）
- `frontend/src/components/daemon/session-panel/page-helpers.tsx` — frontend——调用关系变更（挂载点替换 + dialog 门控）
- `frontend/src/components/daemon/agent-log-card.tsx` — frontend——逻辑变更（AgentLogSessionBody 移除，其余保留）
- `frontend/src/lib/__tests__/agent-log-replay.test.ts` — frontend——新增（适配层测试）
- `frontend/src/components/daemon/__tests__/agent-log-replay-body.test.tsx` — frontend——新增（组件测试）
- `frontend/src/components/daemon/__tests__/agent-log-card.test.tsx` — frontend——逻辑变更（AgentLogSessionBody 用例组迁移）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | skipped：25 文件按目录前缀人工归类完毕（见未匹配文件节判定）；_module-map.yaml 粒度未覆盖 agent-log/session-panel 子目录属索引过期（scan 基线落后 88 天），modules rebuild 留给下轮 scan 变更统一处理，不在本变更扩 scope | done（判定完成，rebuild 转出） |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
