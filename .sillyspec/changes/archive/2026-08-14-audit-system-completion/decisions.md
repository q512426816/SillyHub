---
author: qinyi
created_at: 2026-08-14T22:30:00+08:00
---

# 决策台账（audit-system-completion）

## D-001@v1: 排除表策略——最小改动+观察
- type: boundary
- status: accepted
- source: user（AskUserQuestion 2026-08-14）
- question: 挂载 audit_hooks 后排除表范围？（决定审计量/性能风险）
- answer: 维持代码现状只排 audit_logs 防递归；hooks 只在有 audit_context 的 session 写审计，daemon/后台写（agent_run_logs 大头）天然不触发；上线观察量再扩排除。
- normalized_requirement: `_EXCLUDED_TABLES` 保持 `{"audit_logs"}` 不变；不预排除 sessions/agent_run_logs 等高频表；上线后观察 audit_logs 增速，超预期另立 quick 扩排除。
- impacts: [design §4.1, §3 非目标, R-02]
- evidence: `backend/app/core/audit_hooks.py:25`（_EXCLUDED_TABLES）、`:186-188`（ctx None 跳过）
- priority: P0

## D-002@v1: 登录失败审计——全零 UUID 占位
- type: architecture
- status: accepted
- source: user（AskUserQuestion 2026-08-14）
- question: AuditLog.resource_id 非空 UUID 但登录失败可能无 user_id，怎么处理？
- answer: 失败时 resource_id 用全零 UUID（00000000-0000-0000-0000-000000000000）占位，account/IP/原因存 details_json；成功用真实 user.id；不改 schema。
- normalized_requirement: `AUDIT_PLACEHOLDER_ID = uuid.UUID(int=0)` 单一定义于 workflow/model.py；失败/禁登审计 resource_id 恒取该占位，details_json 必含 account 与 reason。
- impacts: [design §4.2, §4.3, FR 登录审计]
- evidence: `backend/app/modules/workflow/model.py`（AuditLog.resource_id 非空）、`auth/service.py:94-106`
- priority: P0

## D-003@v1: 手工/hooks 双轨并存
- type: architecture
- status: accepted
- source: user（AskUserQuestion 2026-08-14）
- question: 挂 hooks 后与既有约 20 处手工 AuditLog 插入的去重策略？
- answer: 双轨并存，接受同一操作两条记录（手工语义化 action + hooks 通用 action）；零改动风险，不删手工插入。
- normalized_requirement: 不删除/不修改既有手工 AuditLog 插入点；新增手工插入沿用语义化 action 命名。
- impacts: [design §3 非目标, R-04]
- evidence: 约 20 处手工插入（auth/service.py:190、admin/roles_service.py:221、admin/users_service.py:603,630,669,705 等）
- priority: P1

## D-004@v1: settings 审计——手工插入
- type: architecture
- status: accepted
- source: user（AskUserQuestion 2026-08-14）
- question: settings/PlatformSetting（PK 非 UUID，挂 hooks 也不会自动审计）怎么处理？
- answer: settings service 写路径手工插 AuditLog：resource_id 全零占位、key 存 details_json，与登录审计同模式；不改 schema。
- normalized_requirement: settings create/update/delete 三路径各产生一条 AuditLog（action=platform_setting.*，details_json 必含 key，update 含 from/to）。
- impacts: [design §4.2, §4.4]
- evidence: `backend/app/modules/settings/model.py:15`（PK=key String）
- priority: P1

## D-005@v1: 实现方案——B 常量集中
- type: architecture
- status: accepted
- source: user（AskUserQuestion step4 2026-08-14）
- question: 实现组织方式（A 最小侵入 / B 常量集中 / C 帮助函数层）？
- answer: 方案 B：workflow/model.py 定义 action 常量 + 全零占位 UUID，service 引常量；不建 helper 层。
- normalized_requirement: 所有新增 action 字符串与占位 UUID 以常量定义于 workflow/model.py，service 代码不得内联字面量。
- impacts: [design §4.2, §5 文件清单]
- evidence: step4 方案对比 + 用户选择
- priority: P1
