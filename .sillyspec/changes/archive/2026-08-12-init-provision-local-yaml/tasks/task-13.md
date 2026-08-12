---
id: task-13
title: 模块文档同步与 local.yaml 段注释
title_zh: 更新 platform_sync mcp_gateway agent daemon 模块文档记录 get_or_issue 与 init 下发 local.yaml 行为 补 local.yaml 段注释
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P2
depends_on: [task-01, task-02, task-03, task-04, task-06]
blocks: []
requirement_ids: [非功能-可维护性]
decision_ids: [D-001, D-002, D-004]
allowed_paths:
  - .sillyspec/docs/backend/modules/platform_sync.md
  - .sillyspec/docs/backend/modules/mcp_gateway.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
provides: []
expects_from: []
goal: >
  更新 platform_sync mcp_gateway backend sillyhub-daemon 四份模块文档记录 get_or_issue 方法与 init claim 时签发 token 不落库 daemon writeLocalYaml 写 local.yaml platform 覆盖 mcp 有才留 的行为，覆盖非功能可维护性，纯文档不改代码。
implementation:
  - 更新 platform_sync.md 记录 PlatformSyncTokenService.get_or_issue 内联吊销旧签新 供 init claim 时签发
  - 更新 mcp_gateway.md 记录 McpTokenService.get_or_issue 复用三件套 scope dispatch 供 init claim 时签发
  - 更新 backend.md 记录 init 流程在 claim 时 build_claim_payload 签发 shpsync 与 shmcp token 注入 payload 不落 lease.metadata
  - 更新 sillyhub-daemon.md 记录 handleInitLease 第4步 writeLocalYaml 写成员本地 local.yaml platform 覆盖 mcp 有才留 写失败 lease failed
  - 若平台维护 local.yaml 段注释范本则补注 init 自动写入 platform 段覆盖 mcp 段有才留
acceptance:
  - 四份模块文档记录 get_or_issue 或 init 下发 local.yaml 行为
  - local.yaml 段注释范本若存在则补 init 自动写入说明
  - git diff 确认仅文档变更 不含代码
verify:
  - git diff --stat 确认仅 .sillyspec/docs 下文档变更
constraints:
  - 纯文档不改任何代码
  - 不涉及 sillyspec 工具仓文档 D-005
  - allowed_paths 四文件均已确认存在 不列不存在路径
  - 文档中文 对齐 CLAUDE.md UI 与文档默认中文规则
---
