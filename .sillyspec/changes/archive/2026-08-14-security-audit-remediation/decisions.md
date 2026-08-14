---
author: qinyi
created_at: 2026-08-15 00:34:00
---

# 决策台账（Decisions）— security-audit-remediation

## D-001@v1

- type: convention
- status: accepted
- source: brainstorm step3（用户预授权 + 审查代理发现）
- question: 跨用户访问被拒时返回 403 还是 404？
- answer: 404。不存在与无权统一，不泄露资源存在性。
- normalized_requirement: 所有归属校验失败统一 404（WS 场景为 close code）。
- impacts: FR-01/02/04/07；所有 service 层归属断言。
- evidence: 287eed60 owner-only 404 先例（会话页跨用户 attach 必 404）。
- priority: P0

## D-002@v1

- type: implementation-pattern
- status: accepted
- source: brainstorm step4（方案 A 选定）
- question: 修复采用什么统一模式？
- answer: endpoint 层加归属依赖或 service 层加 owner 断言（就近原则）；路径校验统一 pathlib relative_to；权限收紧复用现有 require_permission workspace-scoped 依赖。
- normalized_requirement: 12 个修复点均按此模式，不引入新抽象层。
- impacts: 全部 FR。
- evidence: 项目既有范式（change read_file/write_file relative_to、require_permission）。
- priority: P0

## D-003@v1

- type: security-architecture
- status: accepted
- source: 审查 H-1（密钥泄露高危）
- question: LiteLLM master key 如何不下发又保住 openai_chat 供应商可用性？
- answer: master key 仅存 backend 进程；新增 /api/daemon/llm-proxy 透传端点（daemon X-API-Key 鉴权 + 归属校验，backend 注入 master key 转发 LiteLLM，流式）；provider_config 下发 proxy 路径标记替代明文 key。
- normalized_requirement: FR-03；claim payload / WS push / 日志零 master key 出现。
- impacts: daemon/lease/context.py、daemon/router.py、daemon spawn-env.ts。
- evidence: 密钥审查代理 H-1（master key 可经 /model/info 取其它用户上游明文 key）；litellm 不映射端口仅内网可达为缓解非根治。
- priority: P0

## D-004@v1

- type: api-contract
- status: accepted
- source: Design Grill UB-3
- question: platform_sync JWT/shk_live_ 写端点如何获得 workspace 归属？
- answer: 一律 403，只保留 shpsync_ 写；JWT/shk_live_ 仅读端点（CHANGE_READ 并集聚合）。不从 body 补 workspace 字段。
- normalized_requirement: FR-05。
- impacts: platform_sync/auth.py、router.py。
- evidence: Grill 核验三个写端点路径与 body 均无 workspace_id；改 body 会破坏 CLI 六表 JSON 契约。
- priority: P0

## D-005@v1

- type: data-model
- status: accepted
- source: Design Grill UB-1
- question: agent_runs 无 user_id 列，quick-chat 归属如何过滤？
- answer: 归属链 agent_runs.lease_id → daemon_task_leases.metadata.actor_user_id；placement.dispatch_to_daemon 补写 metadata["actor_user_id"]；读/杀端点 join 比对。不加列不加迁移。
- normalized_requirement: FR-07。
- impacts: main.py、agent/placement.py。
- evidence: Grill 核验 agent_runs 无 user_id；lease metadata 已是 daemon 上下文持久化点。
- priority: P0

## D-006@v1

- type: scope
- status: accepted
- source: 用户 2026-08-15 补充汇总
- question: 用户汇总的新增项（markdown XSS / 部署硬化 / 依赖升级）哪些入本变更？
- answer: markdown rehype-sanitize + compose 弱口令 fail-fast 与端口收紧入本变更；部署面其余（备份、.env 扩散、root IP 硬编码、镜像删除策略）与依赖升级（Next.js 安全补丁、passlib/bcrypt）独立 change。
- normalized_requirement: FR-13/FR-14；非目标章节同步。
- impacts: markdown-text.tsx、docker-compose.yml。
- evidence: 用户提供的审查汇总（36 条排序清单）。
- priority: P0（XSS）/ P1（compose）

## D-005@v2

- type: data-model
- status: accepted
- source: task-08 实现期核实
- question: D-005@v1 的 agent_runs.lease_id 锚点被核实为不可实现（FK 指向 worktree_leases 非 daemon_task_leases，写 daemon lease id 会 ForeignKeyViolation，agent/service.py:1729 注释明确记载）
- answer: 归属链改反向链 daemon_task_leases.agent_run_id → agent_runs.id + lease metadata.actor_user_id（placement 补写）。lease INSERT 本就写 agent_run_id，无需回填 UPDATE。supersedes: D-005@v1。
- normalized_requirement: FR-07 不变。
- impacts: main.py、agent/placement.py（与 v1 相同）。
- evidence: task-08 子代理核实 FK 约束 + 15 用例回归（agent+daemon 1331 passed）。
- priority: P0
