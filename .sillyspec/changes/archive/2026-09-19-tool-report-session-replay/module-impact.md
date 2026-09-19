# 模块影响分析（Module Impact）— 2026-09-19-tool-report-session-replay

> 归属按根级 _module-map.yaml（backend/** / frontend/** 粗粒度）判定；sillyhub-daemon 子项目路径见行内归属（根 map 无该 paths 条目，建议后续 modules rebuild 补录）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon | sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts | 数据结构变更（NormalizedLogMessage 可选五字段）+ 逻辑变更（CallMeta 附着/sender 归一/totalUsage） | 是（回放数据正确性核心） |
| sillyhub-daemon | sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts | 逻辑变更（sqlite 库等价字段提取，spike-01 采纳主路径） | 是（双源口径一致性） |
| sillyhub-daemon | sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts | 新增（claude-code 解析器） | 是 |
| sillyhub-daemon | sillyhub-daemon/src/agent-log/parse-cursor-agent-transcript.ts | 新增（cursor-agent 解析器，spike-02 tool_result 不落盘裁决） | 是 |
| sillyhub-daemon | sillyhub-daemon/src/agent-log/registry.ts | 接口变更（PARSERS 两键注册 + totalUsage 契约） | 否（扩展点内新增） |
| sillyhub-daemon | sillyhub-daemon/src/host-fs-handler.ts | 仅注释（透传确认零代码） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts | 逻辑变更（Z11-Z14 断言更新） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts | 逻辑变更（AL 系断言补字段） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts | 逻辑变更（R10 + 既有断言更新） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts | 新增（23 例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/parse-cursor-agent.test.ts | 新增（19 例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log-matrix.test.ts | 新增（30 例矩阵交叉） | 否 |
| backend | backend/app/modules/platform_sync/schema.py | 接口变更（AgentLogMessagesResponse 可选新字段 + total_usage） | 是（OpenAPI 契约面） |
| backend | backend/app/modules/platform_sync/router.py | 逻辑变更（messages 端点转换层一行映射 + docstring） | 否 |
| backend | backend/app/modules/platform_sync/tests/test_agent_log_messages.py | 逻辑变更（断言补齐 + camel→snake 端到端） | 否 |
| backend | backend/openapi.json | 配置变更（gen:types 产物，含 53c67e02a probe 描述债自然带出） | 否 |
| frontend | frontend/src/components/daemon/agent-replay-body.tsx | 新增（回放主体组件，本变更 UI 核心） | 是 |
| frontend | frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx | 新增（16 例） | 否 |
| frontend | frontend/src/lib/agent-log-turns.ts | 新增（适配器纯函数，回放装配核心） | 是 |
| frontend | frontend/src/lib/__tests__/agent-log-turns.test.ts | 新增（15 例） | 否 |
| frontend | frontend/src/components/daemon/turn-timeline.tsx | 数据结构变更（SessionProcessItem 增 system_event）+ 逻辑变更（中性行渲染） | 是（共享组件，实时链路零产生已钉死） |
| frontend | frontend/src/components/daemon/session-log-assembler.ts | 数据结构变更（镜像类型 parity 同步，task-10 涟漪） | 否（类型层，投影不产该项） |
| frontend | frontend/src/components/daemon/session-panel/dialog-helpers.ts | 逻辑变更（一行类型谓词守卫，task-10 涟漪） | 否（运行时不可达） |
| frontend | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 调用关系变更（isToolReportBody 分支换挂 AgentReplayBody） | 是（挂载点） |
| frontend | frontend/src/components/daemon/session-panel/page-helpers.tsx | 仅注释（组件名同步单词级） | 否 |
| frontend | frontend/src/components/daemon/agent-log-card.tsx | 逻辑变更（409 专属文案 + AgentLogSessionBody 退役删除） | 是 |
| frontend | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx | 逻辑变更（SessionBody describe 删除） | 否 |
| frontend | frontend/src/lib/agent-logs.ts | 仅注释（新字段语义与消费方表述） | 否 |
| frontend | frontend/src/lib/api-types.ts | 配置变更（gen:types 产物） | 否 |
| docs | docs/sillyspec/cursor-agent-transcript-report-pipeline.md | 新增（跨仓跟进记录） | 否 |

## 未匹配文件

（无——全部 30 个 diff 文件已在上表逐文件列出。）

## 更新结果

| 目标 | 结果 |
|---|---|
| _module-map.yaml: backend | done |
| _module-map.yaml: frontend | done |
| modules/frontend.md | done（契约摘要补回放链路） |
| modules/backend.md | skipped（内部接口扩展，卡片既有 platform_sync 概述已覆盖） |
