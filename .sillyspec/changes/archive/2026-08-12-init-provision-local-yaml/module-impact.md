---
author: qinyi
created_at: 2026-08-12 15:20:00
---
# 模块影响分析（Module Impact）— init 自动下发 local.yaml

## 变更概述

工作区「初始化」时，后端在 daemon claim init lease 时现算签发 `shpsync_`（platform_sync）+ `shmcp_`（mcp_gateway，scope=dispatch）两 token，注入 claim payload（**明文不落 lease.metadata_**，P0/D-002）；daemon 的 `handleInitLease` 第4步 `writeLocalYaml` 写成员本地 `.sillyspec/local.yaml`（platform 段覆盖/mcp 段有才留，写失败 ok:false→lease failed）。点完初始化进度同步 + MCP 接入即可用，不用手跑 `sillyspec platform connect`。

## 三重交叉验证

| 数据源 | 说明 |
|---|---|
| 声明范围（design.md §6） | backend（platform_sync/mcp_gateway/agent/daemon.lease）+ sillyhub-daemon（local-yaml-writer/spec-sync/task-runner）+ 测试 + 4 模块文档 |
| 任务范围（plan.md 13 task） | 同上，13 task 全过 |
| 真实变更（git 35112e79+07c848bc） | 与声明一致，无越界（未触及 sillyspec 工具仓 D-005） |

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| platform_sync | 逻辑变更 | backend/app/modules/platform_sync/token_service.py | 新增 `get_or_issue(*, workspace_id, created_by)`：内联 select 旧未吊销 + UPDATE 吊销（无 public revoke）+ 调 create 签新。供 init claim 时签发 shpsync_ | false |
| mcp_gateway | 逻辑变更 | backend/app/modules/mcp_gateway/service.py | 新增 `get_or_issue(*, workspace_id, created_by)`：复用 list/revoke/create 三件套，scope=['dispatch']（MCP_SCOPES 合法值） | false |
| daemon（lease） | 接口变更 | backend/app/modules/daemon/lease/context.py | `build_claim_payload` mode=='init' 分支 claim 时调两 get_or_issue 注入 payload.platform_config.local_yaml（明文不落 lease.metadata_，`{**_init_pc_src}` 断引用别名） | true（P0 安全点） |
| agent | 调用关系变更 | backend/app/modules/agent/service.py | start_init_dispatch 补 B1 注释（token claim 时签不落库），确认 actor_user_id 落 metadata | false |
| sillyhub-daemon（spec-sync） | 逻辑变更 | sillyhub-daemon/src/spec-sync.ts | handleInitLease 第4步 writeLocalYaml（if local_yaml 守卫 + 失败 ok:false→_finish(false) D-003） | true（跨进程） |
| sillyhub-daemon（task-runner） | 逻辑变更 | sillyhub-daemon/src/task-runner.ts | _runInitLease 透传 local_yaml + serverOrigin 改 config.server_url 唯一源（D-002） | false |
| sillyhub-daemon（新增） | 新增 | sillyhub-daemon/src/local-yaml-writer.ts | TS 重写 sillyspec sync.js 顶层段替换算法，writeLocalYaml 写 local.yaml（platform 覆盖/mcp 有才留） | false |
| daemon（测试） | 新增 | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | claim 注入测试（P0 明文不落库 DB+内存断言） | false |
| platform_sync（测试） | 新增 | backend/app/modules/platform_sync/tests/test_get_or_issue.py | get_or_issue 4 场景测试 | false |
| mcp_gateway（测试） | 新增 | backend/app/modules/mcp_gateway/tests/test_get_or_issue.py | get_or_issue 5 场景测试（scope=dispatch） | false |
| agent（测试） | 逻辑变更 | backend/app/modules/agent/tests/test_start_init_dispatch.py | B1 防回退断言（dispatch metadata 不含 local_yaml） | false |
| sillyhub-daemon（测试） | 新增/逻辑变更 | sillyhub-daemon/tests/test_local_yaml_writer.test.ts + test_init_lease.test.ts | writer 16 用例 + handleInitLease 编排 16（含失败语义） | false |
| docs | 配置变更 | 4 模块文档 MANUAL_NOTES | platform_sync/mcp_gateway/backend/sillyhub-daemon 各加本变更条目 | false |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| .sillyspec/changes/2026-08-12-init-provision-local-yaml/* | 变更规范文档（design/plan/tasks 等），非代码模块 |
| backend/app/modules/daemon/host_fs/tests/test_delegate_integration.py | verify 阶段顺手清 main 预存债（漏 llm_provider import，非本变更逻辑，commit 07c848bc） |

## 风险点（needs_review=true 的项）

1. **P0 明文不落 lease.metadata_（daemon lease context.py）**：claim 时注入 payload 的 token 明文，任何未来改动不得把它写回 lease.metadata_（持久化+进审计）。`{**_init_pc_src}` 断引用别名是关键防线。
2. **跨进程链路（spec-sync）**：backend claim 签发 → payload 透传 → daemon writeLocalYaml 写盘，三段耦合。改任一端需同步验证另两端（url 用 config.server_url 唯一源、失败语义 ok:false）。

## 结论

变更影响 3 个 backend 模块（platform_sync/mcp_gateway/daemon.lease）+ 1 个调用点（agent）+ sillyhub-daemon 3 文件（2 改 1 增）+ 对应测试/文档。不涉及数据库 schema 变更（复用既有 token 表）、不涉及前端、不涉及 sillyspec 工具仓。影响面与 design.md §6 声明一致。
