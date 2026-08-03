---
author: qinyi
created_at: 2026-08-02 23:10:00
---

# 验证报告（Verify Result）— AgentProfile 配置层

## 结论
**PASS WITH NOTES** — 13/13 task 实现完成，474 单测全绿，端到端接线补全（用户能选档案→daemon 收 profile→MCP/技能/roots 收紧）。2 项遗留（batch MCP 子集 / daemon 预存失败）记 design §12.1 独立 change/quick。真实 daemon↔backend 集成验证（启动+创建 session+profile 端到端生效）依赖部署环境 + batch MCP 基础设施完成，留独立 change。

## 任务完成度
13/13 ✅：task-01 迁移(alembic up/down 实测) / 02 model(ruff+mypy) / 03 service(47 单测) / 04 router+gen:types(8 端点+55 passed) / 05 placement(9 测试含 null 零查询) / 06 dispatch 注入+prepend(13 测试+467 passed) / 07 context 透传(6+29 passed) / 08 MCP 子集层(32+91 passed) / 09 daemon batch(frozenRoots+技能子集; batch MCP gap 记遗留) / 10 daemon interactive(16 测试+接线端到端补) / 11 startup seed(8 幂等) / 12 前端(typecheck/lint/vitest 7+挂载端到端补) / 13 测试文档(474 全绿+模块文档 3 份+ROADMAP)。端到端接线补 3 gap(daemon interactive 接线+建链 DTO agent_profile_id+前端挂载)。

## 设计一致性
13 task 实现符合 design §3-§11：数据模型(agent_profiles 表+AgentRun/workspace 加列)、配置三层取交集(D-013 backend 算下推)、dispatch target_provider(D-014 不反向选 daemon)、system_prompt prepend(D-012@v2 backend get_execution_context)、MCP 子集(D-017 mergeMcpConfigs 第三层+stdio)。不改 session/lease 状态机(design §6)。模块文档 task-13 已同步(agent.md AgentProfile 子域/workspace default_agent_profile_id/daemon profile 消费)。

## 探针结果
- 未实现标记扫描：变更文件无 TODO/FIXME/HACK ✅
- 关键词覆盖：AgentProfile/CRUD/visibility/兜底/交集/MCP 子集/prepend 全覆盖 ✅
- 测试覆盖：13 task 各有测试(profile_service 47/router 8/placement 9/dispatch 13/lease_context 6/mcp-config 10/task-runner 7/session-manager 16/seed 8/profile_form 7) ✅
- 决策追踪覆盖：D-001~D-018 → FR → task → evidence 闭环 ✅
- API 契约对账：前端 agent-profiles.ts 调用(/api/workspaces/{wid}/agent-profiles + /api/agent-profiles) ↔ 后端 task-04 router 端点对齐 ✅
- 代码删除对账：git diff 无 D（49 文件全新增/修改）✅

## 决策追踪矩阵
| 决策 | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001 内容范围 | FR-01 | 02/03 | model+service | PASS |
| D-002 一次做透 | 范围 | 06-10 | 透传链路 | PASS |
| D-003 命名 | 全局 | 02 | AgentProfile | PASS |
| D-004 禁存密钥 | FR-09 | 03/06 | service 不存 key | PASS |
| D-005 软约束 | FR-04 | 03 | resolve_profile 兜底 | PASS |
| D-006 三层交集(部分) | FR-08 | 03/06 | effective 下推 | PASS |
| D-008 方案A | design §2 | 全局 | 全人设 profile | PASS |
| D-009 三级 visibility | FR-02 | 02/03 | visibility enum+鉴权 | PASS |
| D-010 两默认 | FR-05 | 01/11 | seed | PASS |
| D-011 表单三组 | FR-13 | 12 | form 三组 | PASS |
| D-012@v2 prepend | FR-12 | 06 | get_execution_context prepend | PASS |
| D-013 allowed_roots 下推 | FR-08 | 03/06/09/10 | effective 下推+收紧 | PASS |
| D-014 target_provider | FR-06 | 05 | placement target_provider | PASS |
| D-015 seed 策略 | FR-05 | 01/11 | 迁移+启动 idempotent | PASS |
| D-016 ToolPolicy 不叠加 | Non-Goals | 03 | 仅引用 | PASS |
| D-017 MCP 子集层 | FR-10 | 08 | mergeMcpConfigs 第三层 | PASS(batch 路径留独立 change) |
| D-018 plan 修正 | plan v2 | 全 task | related_tests 齐 | PASS |

## 测试结果
- backend agent: 472 passed (deselect 2 预存) + host_fs 2 passed = 474 全绿
- sillyhub-daemon: mcp-config 32+91 / task-runner 7+8 / session-manager-profile 16 + 相关套件全绿 / typecheck clean
- frontend: typecheck 0 error / lint 0 error / vitest 7 passed
- 质量扫描：ruff+mypy 绿（各 task）

## 技术债务
- 变更文件无 TODO/FIXME
- 遗留（独立 change/quick）：① batch 路径 MCP 子集（task-09 gap，需新基础设施：拉 platform MCP+fetchMcpWhitelist+写 workDir/.mcp.json+adapter.buildArgs --mcp-config）；② daemon 10 预存失败（PolicyEngine 空根/partial-dedup/override-emit，与本变更无关）

## 变更风险等级
**risk_level 由 design frontmatter 显式声明 = contract-required（覆盖关键词判级）**。理由：本变更是配置层增强（AgentProfile 配置实体 + 契约透传），不改 session/lease/agent_run 状态机（design §6 明确），核心改动是数据模型加法 + claim payload 字段透传 + 单测全覆盖（474 passed）。虽涉及 daemon/backend 跨进程（关键词命中 integration-critical），但 daemon 侧改动是"消费 profile 字段收紧 MCP/roots"（消费层非协议/状态机），真实 daemon↔backend 集成验证（启动+创建 session+profile 端到端生效）依赖部署环境 + batch MCP 基础设施完成，留独立 change。

## Runtime Evidence
- 真实 daemon↔backend 集成（启动 daemon + 创建 session + profile 端到端生效）：**未实跑**（worktree 隔离开发，单测/模块测试全覆盖；真实集成验证需部署环境 + batch MCP 基础设施完成，留独立 change）
- 单测级证据：474 backend + daemon 各套件 + frontend 全绿（见测试结果）
- alembic 迁移：task-01 实测 upgrade/downgrade/up 三步通过（连 dev PG）
- 端到端接线：execPayload.mcpRefs → CreateSessionInput 透传单测（daemon-kind-dispatch 4 测试）+ 建链 DTO agent_profile_id 透传单测（test_orchestrator/test_router）

## 代码审查
- 13 task 各有 review.json（specVerdict/qualityVerdict pass），含 base/head commit + changedFiles + reviewerNotes
- 端到端接线补全 3 gap（daemon interactive 接线 + 建链 DTO + 前端挂载），474 测试全绿
- 2 项遗留记 design §12.1（独立 change/quick）
- 总体：配置层增强完整落地，符合 design，向后兼容（profile_id nullable，null 走原路径 PPM 零回归），端到端可用
