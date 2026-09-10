---
author: qinyi
created_at: 2026-09-10 21:08:00
---

# 决策记录（Decisions）

> 本变更的方案选择均来自用户在任务派发时的原话（两轮活体实证后给出的修复方向），非代理代选。

## D-001@v1: P0-1 artifact 承接通道与 kind 取值
- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: worker 结论未沉淀为 artifacts，daemon 侧承接面选哪条通道、artifact kind 用什么？
- answer: 用户原话「daemon 在 worker 终态时把最终 assistant 消息（或 worker 按约定标记的结构化段）落为 kind=summary/kind=final_output 的 artifact」。实现取：复用 backend worker_done 端点现成语义（AgentArtifact kind=summary 挂分身首 run，可重复置位取最新），kind 沿用 summary——mcp-server.ts:542-547 已向调用方声明该契约，final_output 全仓不存在，新值徒增消费方分支。
- normalized_requirement: FR-01/FR-02（门控、时序、容错、多轮幂等见 requirements）。
- impacts: [FR-01, FR-02, task-01, task-02, task-03, task-09]
- evidence: 任务派发原文 P0-1 段 + mcp_tools.py:2286 既有写入点 + mcp-server.ts:542-547 契约描述。

## D-002@v1: P0-2 独立配额池的作用域与实现层次
- type: architecture
- priority: P0
- status: accepted
- supersedes:
- source: user
- question: worker 执行器的 provider/API key 按什么作用域独立配置？
- answer: 用户原话「支持按 workspace 或按 agent_profile 独立配置（独立池或不同 provider）」。探查证实 profile 绑定链路已全通，真缺口=llm_provider schema 锁死 claude + daemon injector REGISTRY 无 pi；补齐后 per-(user, agent_kind=pi) 默认与 profile/workspace(default_agent_profile_id) 两条路都开放，不在本变更里强选一条。
- normalized_requirement: FR-03（schema 放开、injector 映射、缺省零回归、auth_field pattern）。
- impacts: [FR-03, task-04, task-05, task-07, task-08, task-09]
- evidence: 任务派发原文 P0-2 段 + llm_provider/schema.py:17 + credential-injector.ts:217-233 + lease/context.py:284-343 + spawn-env.ts:205-211。

## D-003@v1: P1-3 生效执行器暴露位置
- type: architecture
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: default_agent 为空导致白跑一轮，暴露当前生效执行器的位置选哪？
- answer: 用户原话「或至少在 mcp-tokens 签发响应/get_daemon_status 里暴露当前生效执行器」。选 get_daemon_status：mcp-tokens 是签发时快照会陈旧，token 是长期凭证不该背 status 类实时信息；daemon 注册/心跳已上报 providers（DaemonRuntime 现成数据）。「管理员把 default_agent 设为 pi」为运维动作随交付文档给出。
- normalized_requirement: FR-04（三新字段 + online 过滤 + 顺序口径）。
- impacts: [FR-04, task-06, task-09]
- evidence: 任务派发原文 P1-3 段 + mcp_gateway/tools.py:1009-1104 + hub-client.ts:74/:158 + workspace/model.py:95-98。
