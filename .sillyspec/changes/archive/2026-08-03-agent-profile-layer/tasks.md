---
author: qinyi
created_at: 2026-08-02 18:09:30
---

# 任务清单 — AgentProfile 配置层（v2，含 Grill 修正；粗粒度，plan 阶段细化成 Wave）

- [ ] task-01：alembic 迁移 — 建 `agent_profiles` 表 + AgentRun 加 `agent_profile_id`/`agent_profile_snapshot` + workspace 加 `default_agent_profile_id` + **迁移内首次 seed 两默认档案**（D-015）
- [ ] task-02：backend `agent/profile/model.py` — AgentProfile 模型（visibility/version/is_system_default/allowed_roots_overlay）
- [ ] task-03：backend `agent/profile/service.py` — CRUD + 三级 visibility 权限过滤 + 软约束兜底解析（resolve_profile）+ **effective_allowed_roots 交集计算**（D-013）
- [ ] task-04：backend `agent/profile/router.py` — CRUD API + 复制；`pnpm gen:types` 重生成 openapi.json/api-types.ts
- [ ] task-05：backend `placement.py` — **target_provider 改造**（profile.provider 优先于 workspace.default_agent，影响 _query_runtime_by_daemon_and_provider + borrow lender；不反向选 daemon，D-014）
- [ ] task-06：backend `agent/service.py` + `execution.py` — 三入口（start_run/start_stage_dispatch/start_scan_dispatch）注入 profile 快照到 AgentRun + lease.metadata + 算 effective_allowed_roots
- [ ] task-06b（Grill C-13 新增）：backend `daemon/lease/context.py` — **build_claim_payload 透传 profile 字段**（mcp_refs/skill_refs/system_prompt/effective_allowed_roots，batch + interactive 双分支，camelCase+snake_case 双写）
- [ ] task-07：MCP 校验与子集层（D-017）— backend mcp.whitelist 端点确认 + daemon `mcp-config.ts` mergeMcpConfigs 加 mcp_refs 第三层过滤（改 signature）+ McpServerConfig 加 type 字段仅 stdio + daemon 拉 whitelist 端点链路
- [ ] task-08a（Grill C-12 拆分，batch）：daemon `task-runner.ts` — 写 CLAUDE.md **prepend profile.system_prompt**（D-012）+ MCP/技能子集注入 + frozenAllowedRoots 用下推 effective 值
- [ ] task-08b（Grill C-12 拆分，interactive）：daemon `interactive/session-manager.ts` + `claude-sdk-driver.ts` — 同 task-08a 的 interactive 路径（scan/quick-chat/变更会话全走此）
- [ ] task-08c（D-015 新增）：backend startup hook — **idempotent 补种默认档案**（按 is_system_default=true + name 去重）
- [ ] task-09：frontend 档案管理页 — `workspaces/[id]/agent-profiles/page.tsx` + 三组表单组件 + `lib/agent-profiles.ts` API 客户端
- [ ] task-10：frontend 选档案组件 — 发起任务/对话入口「选档案」下拉（含「不指定」），遵循设计系统
- [ ] task-11：测试 — profile CRUD/visibility/兜底/provider target_provider/透传子集/向后兼容；**null 路径查询数断言**（C-07）；agent 模块 deselect 2 个预存失败测试
- [ ] task-12：文档同步 — `agent.md`/`workspace.md`/`daemon.md` 模块卡 + ROADMAP（新增 AgentProfile 层）

## 依赖关系（粗）

- task-01（迁移+seed）→ task-02/03（model/service）→ task-04（router）→ task-09/10（前端）
- task-03（兜底+交集）→ task-05（target_provider）→ task-06（dispatch 注入）→ task-06b（context.py 透传）→ task-08a/08b（daemon 消费）
- task-07（MCP 子集层）须在 task-08a/08b 前定契约
- task-08c（startup seed）独立，依赖 task-01 表结构
- task-11（测试）贯穿每 Wave 增量；task-12（文档）收尾

## Grill 修正映射
- C-01/C-05（P0 system_prompt）→ D-012 → task-08a/08b prepend CLAUDE.md
- C-02/C-06（P0 allowed_roots）→ D-013 → task-03 交集计算 + task-06 下推 + task-08a/08b frozenAllowedRoots
- C-03（P1 provider 顺序）→ D-014 → task-05 target_provider
- C-04/C-15（P1 MCP 子集/whitelist）→ D-017 → task-07
- C-11（P1 seed 矛盾）→ D-015 → task-01 + task-08c
- C-12（P1 interactive 漏）→ task-08 拆 08a/08b
- C-13（P1 context.py 透传）→ task-06b
- C-14（P2 ToolPolicy）→ D-016 Non-Goals
