---
author: qinyi
created_at: 2026-08-23 13:40:00
---

# 决策记录（Decisions）— 工具上报 Agent 日志会话化

> D-001~D-010 正文见 design.md §8（D-001~004 为用户拍板，D-005~008 工程决策）。本文件记录 Design Grill 结论与修订。

## D-011@v1: Design Grill 审查结论（独立子代理，18 交叉点，5 P1 全修订）
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: design 是否存在与真实代码相反的断言/时序错误/语义稀释？
- answer: 5 P1 全部修订入 design：P1-1 agent_sessions 无 title 列（迁移加列 + router 派生 session.title 优先）；P1-2 激活机器选择改回落 prepare_interactive_dispatch 既有自选（D-010）；P1-3 CLI 上报块移至 change/quick 解析后；P1-4 restore/_reloadSession env 从零重建（两处增传 state.sessionId）；P1-5 全量重推稀释 ctx（改 entry 级 ctx 归属，D-009）。P2 十项随手修（内容端点直连 ws_rpc 防 degrade 空串、字节截断、format 门控、NoOnlineDaemonError 包 AppError、僵尸行口径、测试目录更正 daemon/tests/、query-keys 入清单、turn_count 判据与置 1、_SessionStatusQuery 符号名）。
- impacts: [design §3.1/§3.2/§3.3.1/§3.3.3/§3.3.4/§3.3.5/§3.4/§6/§8, tasks 全部条目]
- evidence: review.json（.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-08-23-133028/）
