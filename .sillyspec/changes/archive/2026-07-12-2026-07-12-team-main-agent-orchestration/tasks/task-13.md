---
id: task-13
title: e2e 三入口真跑 + 模块文档同步 + ROADMAP 更新
title_zh: 端到端验证与文档收尾
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P0
depends_on: [task-12]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - docs/multi-agent-platform/modules/backend.md
  - docs/multi-agent-platform/modules/frontend.md
  - docs/multi-agent-platform/modules/sillyhub-daemon.md
goal: >
  e2e 三入口真跑（需真 daemon + 多 provider），同步模块文档与 ROADMAP（v1 标停 + v2 接管）。
implementation:
  - e2e mission team：配主 agent + worker 列表 → 派 worker → 收敛（AC-1）
  - e2e execute·verify team：stage team → 多 worker → gate 合并（AC-2/3）
  - e2e 会话 team：「用团队分析」→ 绑 session（AC-4）
  - 模块文档同步：backend.md/frontend.md/sillyhub-daemon.md 加 v2 变更索引
  - ROADMAP 更新：v1 标停，v2 接管 team 范畴
acceptance:
  - 三入口 e2e 各真跑一次成功（AC-9）
  - 模块文档含 v2 变更条目（AC-10）
  - ROADMAP 反映 v1→v2 演进
verify:
  - 手动 e2e（mission/execute/会话，需真 daemon + 多 provider 配置）
  - grep "2026-07-12-team-main-agent-orchestration" docs/multi-agent-platform/modules/
constraints:
  - e2e 需真 daemon + 多 provider（claude/codex/glm），运行时验证不阻塞单测（task-12 守护）
  - 文档中文（CLAUDE.md 规则 12）
  - v1 标停在 ROADMAP 明确（Wave3-5 转交 v2）
---
