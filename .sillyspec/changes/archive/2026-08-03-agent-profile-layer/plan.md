---
author: qinyi
created_at: 2026-08-02 18:24:19
plan_level: full
---

# 实现计划（Plan v2）— AgentProfile 配置层

> v2 修正：plan-review 独立审查 + system_prompt spike（D-012@v2 改 backend 注入）+ 全 task 补 related_tests（D-018）。

## Spike 前置验证（已闭环）
system_prompt 注入机制已 spike 闭环（D-012@v2）：claudeMd 由 backend 生成、daemon 写 .claude/CLAUDE.md，batch+interactive 共享 → backend get_execution_context 构造时 prepend。无需独立 spike。执行中现场确认的细节（mergeMcpConfigs signature 行 158、daemon fetch whitelist 在 hub-client.ts）在各 task implementation 标注。

## Wave 划分（含链式依赖执行顺序）

```
Wave 1（基础，顺序）: task-01 迁移 → task-02 model
Wave 2（配置层，顺序）: task-03 service → task-04 router+gen:types
Wave 3（dispatch 链路，task-05/06/07 顺序，task-08 可并行）:
  task-05 placement → task-06 dispatch注入 → task-07 context.py透传
  task-08 MCP子集层（与 task-05/06/07 并行，无依赖）
Wave 4（daemon 消费，task-09/10/11 依赖 Wave3）: task-09 batch, task-10 interactive, task-11 seed（三者可并行）
Wave 5（前端）: task-12（依赖 Wave2 的 task-04 API）
Wave 6（收尾）: task-13 测试+文档（依赖全部）
```
> Wave 内标注顺序者需串行（链式依赖）；task-08 与 Wave3 其他并行；Wave4 三任务互不依赖可并行。

## Tasks

- [x] task-01: alembic 迁移
- [x] task-02: model AgentProfile 与 AgentRun Workspace 加列
- [x] task-03: profile service
- [x] task-04: profile router 与 gen types
- [x] task-05: placement target provider
- [x] task-06: dispatch 注入 profile 与 prepend system prompt
- [x] task-07: context py 透传 profile
- [x] task-08: MCP 子集层与 whitelist
- [x] task-09: daemon batch 消费
- [x] task-10: daemon interactive 消费
- [x] task-11: startup seed idempotent
- [x] task-12: 前端管理页与选档案
- [x] task-13: 测试与文档

## 任务总表

| 编号 | 任务 | Wave | 依赖 | 覆盖 FR/D | 关键文件 |
|---|---|---|---|---|---|
| task-01 | alembic 迁移：建表+加列+首次 seed | 1 | — | FR-05/07, D-015 | migrations/20260802_agent_profile.py |
| task-02 | model：AgentProfile + AgentRun/workspace 加列 | 1 | 01 | FR-01/03/07 | agent/profile/model.py, agent/model.py, workspace/model.py |
| task-03 | profile service：CRUD+visibility+兜底+交集计算 | 2 | 02 | FR-01/02/04/08 | agent/profile/service.py |
| task-04 | profile router + gen:types | 2 | 03 | FR-01/14, D-011 | agent/profile/router.py, main.py, openapi.json, api-types.ts |
| task-05 | placement target_provider（D-014） | 3 | 03 | FR-06 | agent/placement.py |
| task-06 | dispatch 注入快照 + effective_allowed_roots + **execution-context prepend system_prompt（D-012@v2）** | 3 | 03,05 | FR-07/08/12 | agent/service.py, agent/execution.py |
| task-07 | context.py build_claim_payload 透传 profile 字段 | 3 | 06 | FR-10/11 | daemon/lease/context.py |
| task-08 | MCP 子集层 + whitelist fetch + type（D-017） | 3 | — | FR-10 | mcp-config.ts, hub-client.ts |
| task-09 | daemon batch 消费（MCP/技能子集+frozenRoots） | 4 | 07,08 | FR-10/11, D-013 | sillyhub-daemon/src/task-runner.ts |
| task-10 | daemon interactive 消费（MCP/技能子集+roots） | 4 | 07,08 | FR-10/11 | interactive/session-manager.ts, claude-sdk-driver.ts |
| task-11 | startup seed idempotent hook（D-015） | 4 | 01 | FR-05 | agent/profile/seed.py, main.py |
| task-12 | 前端档案管理页 + 选档案组件 | 5 | 04 | FR-13/14, D-011 | frontend/.../agent-profiles/, components/, lib/ |
| task-13 | 测试 + 模块文档 + ROADMAP | 6 | 全部 | FR-15, NFR-03 | tests/, docs/modules/, ROADMAP.md |

---

## 任务卡片

### task-01: alembic 迁移
```yaml
id: task-01
title: alembic 迁移—建 agent_profiles 表 + AgentRun/workspace 加列 + 首次 seed 两默认档案
allowed_paths:
  - backend/migrations/versions/20260802_agent_profile.py
related_tests: []
goal: 建 agent_profiles 表（design §3.1 全字段）+ AgentRun 加 agent_profile_id/agent_profile_snapshot(nullable) + Workspace 加 default_agent_profile_id(nullable) + 首次 seed 两默认档案
implementation: |
  - down_revision=202607311500（当前 head）；revision id 唯一；execute 前 alembic heads 确认单 head
  - AgentRun.agent_profile_id FK nullable；agent_profile_snapshot JSON nullable；Workspace.default_agent_profile_id FK nullable
  - 迁移内 op.bulk_insert seed「Claude Code 默认」(provider=claude)+「Codex 默认」(provider=codex)，is_system_default=true, visibility=platform
acceptance: [alembic upgrade/downgrade 成功, 两默认档案已 seed, 新列 nullable]
verify: [cd backend && uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head]
constraints: [down_revision=202607311500, 全新列 nullable]
depends_on: []
provides:
  - {contract: agent_profiles_table, fields: [id,name,owner_user_id,workspace_id,visibility,provider,model,system_prompt,tool_policy_id,mcp_refs,skill_refs,allowed_roots_overlay,version,is_system_default,created_at,updated_at]}
  - {contract: agent_run_profile_columns, fields: [agent_profile_id, agent_profile_snapshot]}
  - {contract: workspace_default_profile_column, fields: [default_agent_profile_id]}
expects_from: []
```

### task-02: model 定义
```yaml
id: task-02
title: model—AgentProfile + AgentRun 加 profile 字段 + Workspace 加 default 字段
allowed_paths:
  - backend/app/modules/agent/profile/model.py
  - backend/app/modules/agent/model.py
  - backend/app/modules/workspace/model.py
related_tests: [backend/tests/modules/agent/test_models.py]
goal: Python 模型对齐迁移
implementation: |
  - profile/model.py: class AgentProfile(BaseModel, table=True)，字段同迁移；visibility Enum
  - agent/model.py: AgentRun 加 agent_profile_id(uuid|None FK)+agent_profile_snapshot(dict|None JSON)
  - workspace/model.py: Workspace 加 default_agent_profile_id(uuid|None FK)
  - 复用已有 profile_version/spec_strategy（不删）
acceptance: [AgentProfile 落库可读写, AgentRun/Workspace 新字段可读写, mypy/ruff 通过]
verify: [cd backend && uv run ruff check app && uv run mypy app]
constraints: [继承 BaseModel, 新字段全 Optional]
depends_on: [task-01]
provides:
  - {contract: agent_profile_model, fields: [AgentProfile]}
  - {contract: agent_run_profile_fields, fields: [agent_profile_id, agent_profile_snapshot]}
  - {contract: workspace_default_profile_field, fields: [default_agent_profile_id]}
expects_from:
  - {task: task-01, contract: agent_profiles_table}
```

### task-03: profile service
```yaml
id: task-03
title: profile service—CRUD + 三级 visibility + 兜底 resolve_profile + effective_allowed_roots 交集
allowed_paths:
  - backend/app/modules/agent/profile/service.py
related_tests: [backend/app/modules/agent/tests/test_profile_service.py]
goal: AgentProfileService: create/list/get/update/delete/copy + visibility 过滤 + resolve_profile(兜底链) + compute_effective_allowed_roots(daemon∩overlay)
implementation: |
  - resolve_profile(run_profile_id, workspace, actor): run显式→workspace.default_agent_profile_id→平台默认(按 workspace.default_agent provider 选预置)→None
  - compute_effective_allowed_roots(daemon_roots, overlay): overlay 空返 daemon_roots；否则交集；服务端校验 overlay⊆daemon_roots 拒超集(D-013)
  - visibility: private=owner_user_id==actor; workspace=actor 是 member; platform=全可见仅 admin 可改
acceptance: [三级 visibility 鉴权正确, 兜底链顺序正确, 交集+拒超集]
verify: [cd backend && uv run pytest app/modules/agent -q --no-cov --deselect <2个预存失败>]
constraints: [不存密钥, overlay 只能收紧]
depends_on: [task-02]
provides:
  - {contract: profile_service, fields: [resolve_profile, compute_effective_allowed_roots, create, list, get, update, delete, copy]}
expects_from:
  - {task: task-02, contract: agent_profile_model}
```

### task-04: profile router + gen:types
```yaml
id: task-04
title: profile router(CRUD/copy API) + main.py 注册 + gen:types
allowed_paths:
  - backend/app/modules/agent/profile/router.py
  - backend/app/main.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
related_tests: [backend/app/modules/agent/tests/test_profile_router.py]
goal: /api/workspaces/{wid}/agent-profiles + /api/agent-profiles/{id}(platform) CRUD+copy；main.py include_router；gen:types
implementation: |
  - workspace 级挂 /workspaces/{wid}/agent-profiles；platform 级挂 /agent-profiles；鉴权用现有 RBAC
  - main.py include_router(profile_router, prefix="/api")
  - gen:types 前确认前端 node_modules 健康(pnpm exec tsc --version)，跑 pnpm gen:types 提交 api-types.ts+openapi.json
acceptance: [curl CRUD 200, 权限不足 403, api-types.ts 含 AgentProfile]
verify: [curl 各端点 + cd frontend && pnpm typecheck]
constraints: [前端类型 gen:types 生成禁手写(规则20)]
depends_on: [task-03]
provides:
  - {contract: profile_api, fields: [CRUD endpoints, copy endpoint]}
expects_from:
  - {task: task-03, contract: profile_service}
```

### task-05: placement target_provider
```yaml
id: task-05
title: placement target_provider—profile.provider 优先于 workspace.default_agent（不反向选 daemon, D-014）
allowed_paths:
  - backend/app/modules/agent/placement.py
related_tests: [backend/app/modules/agent/tests/test_dispatch_worker_worktree.py, backend/tests/modules/agent/test_placement.py]
goal: _resolve_dispatch_runtime/dispatch_to_daemon 中 target_provider=profile.provider ?? workspace.default_agent
implementation: |
  - 解析 profile 后 target_provider 优先取 profile.provider
  - _query_runtime_by_daemon_and_provider(did, target_provider) + borrow_resolver lender 用此 target_provider
  - profile=None 时回退 workspace.default_agent，零新增查询(C-07)
acceptance: [profile 带 provider 匹配对应 runtime, profile=None 行为同今天, null 零新增查询]
verify: [cd backend && uv run pytest app/modules/agent -q --no-cov --deselect <2个>]
constraints: [binding 仍为 daemon 选择唯一真相源]
depends_on: [task-03]
provides:
  - {contract: placement_target_provider, fields: [target_provider]}
expects_from:
  - {task: task-03, contract: profile_service, field: resolve_profile}
```

### task-06: dispatch 注入快照 + effective_allowed_roots + execution-context prepend system_prompt
```yaml
id: task-06
title: dispatch 三入口注入 profile 快照 + effective_allowed_roots + get_execution_context prepend system_prompt（D-012@v2）
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/agent/execution.py
related_tests: [backend/app/modules/agent/tests/test_dispatch_metadata.py, backend/app/modules/agent/tests/test_execution_context.py]
goal: 三入口 resolve_profile→写 AgentRun.agent_profile_id/snapshot→算 effective_allowed_roots→写 lease.metadata；**get_execution_context 构造 claudeMd 时 prepend profile.system_prompt（D-012@v2 核心）**
implementation: |
  - start_run/start_stage_dispatch/start_scan_dispatch 调 resolve_profile
  - profile 非 None：AgentRun.agent_profile_id/snapshot 赋值；compute_effective_allowed_roots→lease.metadata[effective_allowed_roots/system_prompt(供 claim payload 兜底)/mcp_refs/skill_refs/profile_version]
  - **get_execution_context（service.py execution-context 端点）：组装响应时若 run 绑 profile 且 profile.system_prompt 非空，prepend 到 claudeMd 顶部（render_bundle_to_claude_md 产出后）**
  - profile=None：lease.metadata 不加新键；claudeMd 不 prepend（向后兼容）
acceptance: [带 profile 的 run AgentRun+lease.metadata 含快照且 claudeMd 含 prepend prompt; 不带则无新键/不 prepend; effective=daemon∩overlay]
verify: [单测 带不带 profile 两路径 + claudeMd prepend 断言 + null 路径零新增查询断言]
constraints: [build_spec_bundle/render 函数零改动; null 零新增查询(C-07)]
depends_on: [task-03, task-05]
provides:
  - {contract: dispatch_profile_snapshot, fields: [agent_profile_id, agent_profile_snapshot, lease.metadata.profile_fields, claudeMd_prepended_system_prompt]}
expects_from:
  - {task: task-03, contract: profile_service, fields: [resolve_profile, compute_effective_allowed_roots]}
  - {task: task-05, contract: placement_target_provider}
```

### task-07: context.py 透传
```yaml
id: task-07
title: context.py build_claim_payload 透传 profile 字段（batch+interactive 双分支, C-13）
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
related_tests: [backend/app/modules/daemon/tests/test_cancel_lease_session.py, backend/app/modules/daemon/tests/test_lease_context.py]
goal: build_claim_payload 从 lease.metadata 读 profile 字段(effective_allowed_roots/mcp_refs/skill_refs/profile_version)写入 claim payload（system_prompt 注入走 task-06 的 claudeMd prepend，不经此）
implementation: |
  - context.py:158 build_claim_payload interactive 分支(:177-324)+batch 分支(:326-477)加 profile 字段透传
  - 字段：mcpRefs/mcp_refs, skillRefs/skill_refs, effectiveAllowedRoots/effective_allowed_roots, profileVersion/profile_version（camelCase+snake_case 双写）
  - lease.metadata 无键时 payload 不含
acceptance: [claim payload(batch+interactive)含 profile 字段(当 metadata 有); 无则不含]
verify: [单测 mock lease.metadata 含/不含 profile 字段断言 payload]
constraints: [双写 camelCase+snake_case]
depends_on: [task-06]
provides:
  - {contract: claim_payload_profile_fields, fields: [mcp_refs, skill_refs, effective_allowed_roots, profile_version]}
expects_from:
  - {task: task-06, contract: dispatch_profile_snapshot}
```

### task-08: MCP 子集层 + whitelist fetch + type
```yaml
id: task-08
title: MCP 子集过滤层 + daemon 拉 mcp.whitelist + McpServerConfig type 字段（D-017）
allowed_paths:
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/src/hub-client.ts
related_tests: [sillyhub-daemon/src/__tests__/mcp-config.test.ts]
goal: mergeMcpConfigs 加 mcp_refs 第三层过滤；daemon hub-client.ts 加 fetchMcpWhitelist；McpServerConfig 加 type 仅 stdio
implementation: |
  - mcp-config.ts:158 mergeMcpConfigs 现有 signature (whitelist, ...configs)，追加 mcp_refs 参数；结果再 ∩ mcp_refs（空则不过滤）
  - McpServerConfig(:20) 加 type 字段，强制 stdio，拒非 stdio（防 SSRF）
  - hub-client.ts 参照 fetchPlatformMcpConfig 加 fetchMcpWhitelist（GET /api/platform-settings/mcp-whitelist，端点 settings/router.py:215 已存在）
  - mcp_refs 由 claim payload 提供（task-07）
acceptance: [mergeMcpConfigs 结果只含 mcp_refs 子集(当提供); 非 stdio 被拒; whitelist 拉取成功]
verify: [cd sillyhub-daemon && pnpm test -- mcp-config]
constraints: [仅 stdio, 必过 whitelist]
depends_on: []
provides:
  - {contract: mcp_subset_filter, fields: [mergeMcpConfigs(mcp_refs), type validation, fetchMcpWhitelist]}
expects_from: []
```

### task-09: daemon batch 消费
```yaml
id: task-09
title: daemon batch（task-runner.ts）消费 profile—MCP/技能子集 + frozenAllowedRoots（system_prompt 已在 claudeMd, D-012@v2）
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
related_tests: [sillyhub-daemon/src/__tests__/task-runner.test.ts]
goal: batch 路径消费 claim payload：MCP 用 mcp_refs 子集(task-08)；技能 link skill_refs 子集；frozenAllowedRoots 用 effective_allowed_roots(D-013)。**不处理 system_prompt（task-06 已 prepend 进 claudeMd）**
implementation: |
  - MCP 注入调 mergeMcpConfigs(..., mcp_refs=payload.mcpRefs)
  - 技能 link 按 payload.skillRefs 子集（替代全量）
  - frozenAllowedRoots(:581)：payload.effectiveAllowedRoots 存在则用(∩物理沙箱兜底)，否则原值
acceptance: [batch run 带 profile: MCP/技能为子集, 写权限受 effective 收紧; 不带: 行为同今天]
verify: [cd sillyhub-daemon && pnpm test -- task-runner]
constraints: [不碰 CLAUDE.md/claudeMd(已含 prompt)]
depends_on: [task-07, task-08]
provides:
  - {contract: daemon_batch_profile_consume, fields: [mcp_subset, skill_subset, frozen_allowed_roots]}
expects_from:
  - {task: task-07, contract: claim_payload_profile_fields}
  - {task: task-08, contract: mcp_subset_filter}
```

### task-10: daemon interactive 消费
```yaml
id: task-10
title: daemon interactive（session-manager.ts+claude-sdk-driver.ts）消费 profile（C-12）
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
related_tests: [sillyhub-daemon/src/__tests__/session-manager.test.ts]
goal: interactive 路径(scan/quick-chat/变更会话)同 task-09：MCP 子集(mainAgentMcp/spec.mcpServers)+技能子集+allowedRootsProvider 用 effective。**不处理 system_prompt（task-06 已 prepend claudeMd，interactive 复用）**
implementation: |
  - session-manager.ts:873/987/2061 MCP 注入按 payload.mcpRefs 子集(经 mergeMcpConfigs)
  - claude-sdk-driver.ts:346 options.mcpServers 用子集
  - session-manager.ts:1119 _allowedRootsProvider 用 payload.effectiveAllowedRoots
acceptance: [interactive 带 profile: MCP/技能/roots 生效; 不带: 同今天]
verify: [cd sillyhub-daemon && pnpm test -- session-manager]
constraints: [覆盖 scan_dispatch(service.py:1277)等 interactive 入口; 不碰 CLAUDE.md]
depends_on: [task-07, task-08]
provides:
  - {contract: daemon_interactive_profile_consume, fields: [mcp_subset, skill_subset, allowed_roots_provider]}
expects_from:
  - {task: task-07, contract: claim_payload_profile_fields}
  - {task: task-08, contract: mcp_subset_filter}
```

### task-11: startup seed idempotent
```yaml
id: task-11
title: startup idempotent 补种默认档案（D-015）
allowed_paths:
  - backend/app/modules/agent/profile/seed.py
  - backend/app/main.py
related_tests: [backend/app/modules/agent/tests/test_profile_seed.py]
goal: 启动时 idempotent 补种两默认档案（is_system_default=true+name 去重）
implementation: |
  - seed.py: ensure_system_default_profiles(session)：查 is_system_default=true 的 claude/codex 档案，缺则 insert
  - main.py startup hook 调 ensure_system_default_profiles
acceptance: [启动后两默认档案存在; 重复启动不重复; 删除后重启可恢复]
verify: [单测 空库启动→2档案, 已有→不重复]
constraints: [idempotent, 仅补缺失系统默认不覆盖用户改动]
depends_on: [task-01]
provides:
  - {contract: startup_seed_idempotent, fields: [ensure_system_default_profiles]}
expects_from:
  - {task: task-01, contract: agent_profiles_table}
```

### task-12: 前端管理页 + 选档案组件
```yaml
id: task-12
title: 前端—档案管理页（三组表单 D-011）+ 选档案组件
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/agent-profiles/page.tsx
  - frontend/src/components/agent-profile-form.tsx
  - frontend/src/components/agent-profile-select.tsx
  - frontend/src/lib/agent-profiles.ts
related_tests: [frontend/src/components/__tests__/agent-profile-form.test.tsx]
goal: 管理页(列表+三组表单)+发起任务入口选档案下拉(含"不指定")
implementation: |
  - 管理页：列表+新建/编辑表单(①身份 name/visibility ②大脑 provider/model/system_prompt ③工具能力 tool_policy/mcp_refs/skill_refs)，对齐原型 v2
  - agent-profile-select.tsx：下拉选 profile 含"不指定，用默认"
  - lib/agent-profiles.ts：API 客户端(类型用 task-04 gen:types)
  - 发起任务入口集成选档案；遵循前端设计系统(规则19)
acceptance: [能 CRUD 档案, 发起任务能选档案, pnpm typecheck+lint 通过]
verify: [cd frontend && pnpm typecheck && pnpm lint && pnpm test]
constraints: [类型从 api-types.ts, 中文 UI, 遵循设计系统]
depends_on: [task-04]
provides:
  - {contract: frontend_profile_ui, fields: [管理页, 选档案组件]}
expects_from:
  - {task: task-04, contract: profile_api}
```

### task-13: 测试 + 文档
```yaml
id: task-13
title: 测试补全 + 模块文档同步 + ROADMAP
allowed_paths:
  - backend/app/modules/agent/profile/tests/
  - backend/tests/modules/agent/
  - sillyhub-daemon/src/__tests__/
  - frontend/src/**/__tests__/
  - .sillyspec/docs/SillyHub/modules/agent.md
  - .sillyspec/docs/SillyHub/modules/workspace.md
  - .sillyspec/docs/SillyHub/modules/daemon.md
  - ROADMAP.md
related_tests: []
goal: 补全测试(含 null 路径零查询断言 C-07)+同步模块卡+ROADMAP
implementation: |
  - 测试：profile CRUD/visibility/兜底/target_provider/claudeMd prepend/透传子集/向后兼容; null 路径查询数断言(保护 PPM); agent 模块 deselect 2 预存失败
  - 模块卡：agent.md 加 AgentProfile 子域; workspace.md 加 default_agent_profile_id; daemon.md 加 profile 消费(batch+interactive, 不含 system_prompt)
  - ROADMAP 已完成里程碑加 agent-profile-layer
acceptance: [module 级 verify 通过, null 路径查询数断言通过, 模块卡+ROADMAP 更新]
verify: [make test 或 module 级 + 对照 design FR 逐项]
constraints: [不改测试逻辑绕过(规则9), 预存失败按 local.yaml deselect]
depends_on: [task-01,task-02,task-03,task-04,task-05,task-06,task-07,task-08,task-09,task-10,task-11,task-12]
provides:
  - {contract: full_test_coverage, fields: [unit tests, module docs, ROADMAP]}
expects_from:
  - {task: task-01, contract: agent_profiles_table}
  - {task: task-06, contract: dispatch_profile_snapshot}
```

## 覆盖矩阵（decisions 当前版本）
| ID | 覆盖任务 |
|---|---|
| D-001@v1 | task-02/03 | D-009@v1 | task-02/03 | D-013@v1 | task-03/06/09/10 |
| D-002@v1 | task-06~10 | D-010@v1 | task-01/11 | D-014@v1 | task-05 |
| D-003@v1 | task-02 | D-011@v1 | task-12 | D-015@v1 | task-01/11 |
| D-004@v1 | task-03/06 | D-012@v2 | task-06(prepend)/09/10(不碰) | D-016@v1 | task-03 |
| D-005@v1 | task-03 | D-017@v1 | task-08 | D-018@v1 | 全 task(related_tests) |
| D-006@v1(部分) | task-03/06 | | | | |

## 验收（Plan 级）
- 13 任务覆盖 design §11 全部文件（含 task-08 hub-client.ts fetch）
- task id task-01~13 连续
- 跨任务 contract 对账闭环（task-13 补 expects_from）
- 每 task 含 allowed_paths/goal/implementation/acceptance/verify/constraints/depends_on/provides/expects_from/**related_tests**
- system_prompt 注入机制已 spike 闭环（D-012@v2 backend prepend claudeMd）
