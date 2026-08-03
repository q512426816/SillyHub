---
author: qinyi
created_at: 2026-08-03 12:00:00
---

# 模块影响分析（Module Impact）— AgentProfile 配置层

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| agent | 新增+逻辑变更+数据结构+接口 | profile/{__init__,model,service,router,seed}.py + model.py(AgentRun 加 agent_profile_id/snapshot) + placement.py(target_provider D-014) + service.py(dispatch 三入口注入 profile 快照+effective_allowed_roots) + router.py(get_execution_context prepend system_prompt D-012@v2 + 建链透传 agent_profile_id) + schema.py(AgentRunCreate 加字段) + orchestrator.py(MainAgentConfig 提取) + mission_schema.py + tests(test_profile_service/router/seed/dispatch_profile/placement_target_provider/orchestrator/router 共 7 文件) | AgentProfile 配置层(表/CRUD/三级 visibility/兜底 resolve_profile/交集 compute_effective_allowed_roots) + dispatch 注入 profile + system_prompt prepend + target_provider + 建链 DTO agent_profile_id | false |
| workspace | 数据结构+配置 | model.py(加 default_agent_profile_id FK) + member_runtimes/tests/conftest.py(自建 metadata 补 agent_profiles/tool_policies 注册) | Workspace 加默认档案字段 + 测试 fixture 表注册修(task-02 FK 连锁) | false |
| daemon(backend) | 逻辑变更+配置 | lease/context.py(build_claim_payload 透传 profile 字段 batch+interactive 双分支) + host_fs/tests/test_delegate_integration.py(_selected_metadata 补注册) + conftest.py(import agent.profile 注册) + tests/test_lease_context.py | claim payload 透传 profile(mcp_refs/skill_refs/effective_allowed_roots/profile_version) + 测试基建表注册 | false |
| frontend | 新增+接口 | lib/agent-profiles.ts(API 客户端) + lib/agent.ts(CreateAgentRunInput 加 agent_profile_id) + lib/api-types.ts(gen:types) + app/.../agent-profiles/page.tsx(管理页) + components/agent-profile-{form,select}.tsx + components/__tests__/agent-profile-form.test.tsx + changes/[cid]/tasks/[tid]/page.tsx(挂载 AgentProfileSelect) + workspaces/[id]/page.tsx(nav chip) | 档案管理页(三组表单)+选档案组件+建链挂载+workspace nav 入口 | false |
| sillyhub-daemon | 逻辑变更+接口 | src/{daemon,types,mcp-config,task-runner}.ts + src/interactive/{session-manager,claude-sdk-driver,types}.ts + src/hub-client.ts + tests/{daemon-kind-dispatch,interactive/session-manager-profile,interactive/session-manager.partial-bucket,interactive/session-manager.partial-dedup,session-manager,mcp-config,policy/filesystem-policy,task-runner}.test.ts | MCP 子集层(mergeMcpConfigs mcp_refs 过滤 D-017 + type stdio) + whitelist fetch(hub-client) + batch 消费(task-runner frozenAllowedRoots 收紧+技能子集) + interactive 消费(session-manager MCP 子集+effective roots) + 端到端接线(execPayload→CreateSessionInput) + 预存 flaky 修(daemon-kind-dispatch waitForSpy) | false |
| migrations | 数据结构 | backend/migrations/versions/20260802_agent_profile.py | agent_profiles 表(16 字段+5 索引) + AgentRun 加列 + Workspace 加列 + seed 两默认档案(Claude/Codex) | false |
| docs | 文档 | ROADMAP.md + .sillyspec/docs/SillyHub/modules/{agent,workspace,daemon}.md | 模块文档同步(AgentProfile 子域/default_agent_profile_id/profile 消费) + ROADMAP 加 2026-08 里程碑 | false |

## 未匹配文件
无（53 文件全部匹配到模块）

## 三重交叉验证
- 声明范围（design §11/§15 文件清单）：53 文件
- 任务范围（plan/tasks 13 task）：覆盖全部
- 真实变更（git diff worktree apply）：53 文件
- 结论：一致（以 git diff 为准）

## 影响总结
配置层增强（AgentProfile），跨 agent/workspace/daemon(backend)/frontend/sillyhub-daemon 5 大模块 + 迁移 + 文档。向后兼容（profile_id nullable，null 走原路径，PPM 零回归）。不改 session/lease/agent_run 状态机（design §6）。遗留：batch 路径 MCP 子集（独立 change，需新基础设施）+ daemon systemic flake（local.yaml 隔离，独立 quick 根治）。
