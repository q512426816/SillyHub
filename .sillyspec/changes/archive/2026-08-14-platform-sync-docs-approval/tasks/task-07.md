---
id: task-07
title: E2E CLI verification + interface-map unmark
title_zh: CLI 端到端验证 + 接口地图撤标
author: qinyi
created_at: 2026-08-14 21:55:00
priority: P2
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - docs/sillyspec/finished/mcp-client-no-initialize-session-fails.md
goal: >
  CLI 真机实跑三条命令闭环验证（sync-docs / approve / reject）+ 接口地图 §2 撤除"后端未实现"标注。
  注：接口地图在 sillyspec 仓（docs/sillyspec/platform-interface-map.md），属跨仓文档改动，随本
  task 手动完成不进主仓 allowed_paths。
implementation:
  - 部署方式对齐本机现状（backend 容器跑则 docker cp/rebuild 或按 dev 流程重启 uvicorn）
  - 用测试 change 数据实跑：sillyspec platform sync-docs --change <test>（200 synced>0）
  - sillyspec platform approve --change <test>（200）→ curl GET approval 核验 approved
  - sillyspec platform reject <test> --reason "api-sweep 测试"（200）→ GET 返回 rejected
  - sillyspec platform sync-docs / approval 对真实活跃 change 不触碰（仅造测试 change 名验证）
  - 测试数据清理（DB 删测试行）
  - sillyspec 仓 docs/sillyspec/platform-interface-map.md §2：撤 documents/approval 两行"后端未实现"标注
acceptance:
  - 三条 CLI 命令端到端 200；reject 后 GET approval 反映 rejected（FR-03 闭环证据）
verify:
  - CLI 输出 + curl GET approval 响应留证
constraints: 不动真实活跃 change（conversation-driven 等）的审批与文档数据。
---
