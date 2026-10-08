---
author: qinyi
created_at: 2026-10-09T01:10:00
---
# 符号影响面（Symbol Impact）— 2026-10-09-knowledge-graph-fullmap

- task-02: 方法内扩展（KnowledgeGovernanceHandler.graph 白名单数组加 dump + layout 校验分支 + dump 回包旁路裁剪）——无签名变更；测试文件追加用例。
- task-03: 新增面（schema.py GraphDumpNode/GraphDumpData、graph.py dump() 方法、router.py GET dump 端点）——无既有签名变更；test_graph.py 追加用例组。
- task-04: 新增导出（api-types 生成物、lib dump 函数、query key）——无签名变更。
- task-05: 组件内扩展（GraphCanvas mode 加 'full' 分支、lite 分支移除）——props 签名不变（mode 类型收窄）；纯函数新增导出 layoutFullGraph 消费。
- task-06: 页面内逻辑（默认加载链/胶囊两态/下钻）——组件签名不变；测试更新+追加。
- task-07: 无签名级变更（验收文档 verify-e2e.md 落主仓变更目录，不进 worktree 代码面）。
- （跨仓前置已完成：sillyspec 仓 layoutFullGraph+dump 已归档）
