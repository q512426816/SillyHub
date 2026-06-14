---
author: qinyi
created_at: 2026-06-14 23:55:00
---

# Module Impact — Agent Runtime Selection

> 变更：`2026-06-14-agent-runtime-selection`
> 阶段：archive / step 2（extract-module-impact）
> 依据：`.sillyspec/workflows/archive-impact.yaml` impact-analyzer 规则
> 数据源：worktree `git diff --name-only HEAD` + `git status --short`（真实变更）× design.md §6（声明范围）× plan.md tasks（任务范围）
> 注：`.sillyspec/docs/2026-06-14-agent-runtime-selection/modules/_module-map.yaml` 不存在，按 docs/ 目录结构（backend/frontend/sillyhub-daemon）+ 真实 git diff 路径 glob 推断模块归属。

## 三重交叉验证

| 来源 | 文件数 | 一致性 |
|---|---|---|
| 声明范围（design §6） | 后端 9 + 前端 7 | 基线 |
| 任务范围（plan.md tasks） | T1~T15 对应文件 | 与声明一致 |
| 真实变更（git diff + status） | 22 modified + 7 新增测试/组件 + 1 migration | **以 git diff 为准** |

真实 > 声明：git diff 额外捕获了 `change/router.py`、`change/schema.py`、`change/service.py`、`change_writer/router.py`、`workspace/router.py`、`workspace/service.py`、`agent/tests/test_router.py`、`frontend/src/lib/agent.ts`（声明未列但实现需要，属合理扩展，均在 design §5/§7 接口意图内）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| **workspace** | 数据结构变更 + 接口变更 + 调用关系变更 | `model.py`（default_agent 列）、`schema.py`（Create/Update/Read default_agent + ScanGenerateRequest/Response provider）、`service.py`（scan_generate provider 透传 start_scan_dispatch）、`router.py`（scan_generate 端点透传） | 新增 default_agent 列；workspace API 增 default_agent 可选字段；scan-generate 支持 provider 覆盖 | false |
| **agent** | 逻辑变更 + 接口变更 + 数据结构变更 | `placement.py`（_get_online_runtime provider 严格匹配 + 无在线回退 + placement_provider_fallback 告警）、`service.py`（start_run/start_stage_dispatch/start_scan_dispatch 三入口 resolved_provider 解析 显式>default_agent>None）、`schema.py`（AgentRunCreate.provider）、`router.py`（create_agent_run 透传 data.provider）、`tests/test_router.py` | placement 回退逻辑；三入口 provider 解析；AgentRunCreate provider 字段 | false |
| **change** | 接口变更 + 调用关系变更 | `dispatch.py`（dispatch/dispatch_next_step 增 provider 参数透传 start_stage_dispatch）、`router.py`（manual_dispatch 端点接收 provider）、`schema.py`（ManualDispatchRequest{provider?}）、`service.py` | stage 手动 dispatch 支持 provider；自动调度链路不传由 service 内部兜底 | false |
| **change_writer** | 接口变更 | `router.py`（execute_change 端点增 `provider: str \| None = Query(None)` + 透传 stage dispatch） | change execute 端点支持 provider 覆盖（FR-06，前端 `executeChange → /execute?provider=`） | false |
| **frontend_lib** | 接口变更 | `workspaces.ts`（Workspace.default_agent + updateWorkspace PATCH）、`changes.ts`（transitionChange/executeChange/triggerDispatch 增 provider）、`workflow.ts`（transitionChange 增 provider）、`agent.ts`（createAgentRun/CreateAgentRunInput.provider） | 前端 API 客户端透传 provider/default_agent | false |
| **frontend_components** | 新增 | `AgentProviderSelect.tsx`（新增，复用 listDaemonRuntimes + PROVIDER_META，受控 value/onChange + includeDefault + 离线 provider 标注） | provider 下拉共享组件 | false |
| **frontend_app** | 接口变更（UI） | `workspaces/[id]/page.tsx`（设置页默认 agent 下拉 + 保存）、`changes/[cid]/page.tsx`（stage 流转/手动 dispatch provider）、`changes/[cid]/tasks/[tid]/page.tsx`（task 触发 provider）、`workspace-scan-dialog.tsx`（scan 触发 provider） | 三处触发面板 + 设置页接入 AgentProviderSelect | false |
| **sillyhub-daemon** | 无 | — | 零改动（design §6.3，复用既有 multi-runtime 注册 + lease.metadata provider 传播） | false |

## 新增测试文件

| 文件 | 覆盖 FR |
|---|---|
| `agent/tests/test_placement_fallback.py` | FR-03 |
| `agent/tests/test_schema_provider.py` | FR-05 |
| `agent/tests/test_service_provider.py` | FR-02/04/05 |
| `change/tests/test_dispatch_provider.py` | FR-06（stage dispatch） |
| `workspace/tests/test_scan_provider.py` | FR-06（scan） |
| `workspace/tests/test_schema_default_agent.py` | FR-01 |

## 数据结构变更（migration）

| migration | 操作 | 状态 |
|---|---|---|
| `backend/migrations/versions/202606280900_add_workspace_default_agent.py` | `ADD COLUMN workspaces.default_agent VARCHAR(64) NULL`（+ downgrade） | ✅ 落地 |

## 未匹配文件（unmapped）

| 文件 | 类型 | 说明 |
|---|---|---|
| `backend/.sillyspec/` | untracked 目录 | worktree 内嵌套 sillyspec 元数据，非源码，归档时忽略 |
| `frontend/.sillyspec/` | untracked 目录 | 同上 |
| `meta.json` | untracked | worktree 元数据，非源码 |

## needs_review 汇总

无。所有 git diff 文件均已确认属于本变更（`change_writer/router.py` 经核实为 execute_change 端点 provider 透传，属 FR-06）。

## 结论

真实 git diff 与 design §6 声明范围基本一致，扩展文件（change/router/schema/service、workspace/router/service、change_writer/router、agent.ts）均在 design §5/§7 接口意图内。daemon 零改动确认。无 needs_review 项，可继续归档。
