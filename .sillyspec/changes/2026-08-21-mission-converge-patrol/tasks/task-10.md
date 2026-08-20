---
id: task-10
title: full-regression-and-docs
title_zh: 全量回归与文档登记
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-09]
blocks: []
requirement_ids: [NFR-01, NFR-02]
decision_ids: [D-007]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - docs/project-team-mission-review-2026-08-21.md
goal: >
  task-01~09 全部落地后的收尾关卡——跑 backend agent+daemon 全量回归 + ruff +
  mypy 验证 NFR-01/NFR-02，并更新 backend.md MANUAL_NOTES 与审查报告登记项
  （BE-P1-6 项目维度 mission 收敛兜底接线已由本变更落地）。
implementation:
  - 跑 backend agent+daemon 全量 pytest（含 test_patrol.py 全部用例与 test_orchestrator.py 豁免用例），确认全绿且本次改动未破坏既有测试
  - 跑 ruff format --check 与 ruff check（agent 模块）及 mypy app——lint 与类型零报错
  - backend.md MANUAL_NOTES 区追加本变更条目（patrol 三职责 / Settings 四项 / lifespan 接线与 cancel+gather 关停契约 / 测试证据 / enabled=False 零回归边界）
  - docs/project-team-mission-review-2026-08-21.md 登记不做章节更新——BE-P1-6 的项目维度 mission 收敛兜底接线一项标注已落地，指向本变更目录 .sillyspec/changes/2026-08-21-mission-converge-patrol
acceptance:
  - agent + daemon 两模块 pytest 全绿
  - ruff format/check 与 mypy app 全部通过
  - backend.md MANUAL_NOTES 含本变更条目（变更名 + 要点 + 测试数据）
  - 审查报告登记不做章节中该项状态更新为已落地并指向本变更
verify:
  - cd backend && uv run pytest app/modules/agent/tests app/modules/daemon/tests -q --no-cov && uv run ruff check app/modules/agent && uv run mypy app
constraints:
  - 本卡只改两个文档文件不改代码——回归发现缺陷时反馈对应任务卡重派，不在本卡顺手修
  - R-04/D-007 登记边界照写——多实例分布式锁不做（单实例部署 + converged_at 守卫兜底）
  - 回归范围为 agent+daemon 两模块（其余模块未被本变更触碰，不跑全仓）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
