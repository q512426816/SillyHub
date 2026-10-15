---
author: flow-machine-draft
created_at: 2026-10-15T23:50:30.652Z
---
# 任务注册表（Tasks）— 2026-10-16-driver-audit-fixes

- [x] task-01: zcode 轮次进行中调用 close 时 consume 正常收敛返回（对照 codex _finishTurnOnClose 先例），协程与清理不悬挂
- [x] task-02: zcode stdout 跨 chunk 多字节 UTF-8 有状态解码，中文内容不再产生 U+FFFD
- [x] task-03: zcode close 阶梯 SIGTERM 到期后无条件升级 SIGKILL（仅以 exitCode 判活）
- [x] task-04: driver-factory 把 enableApproval/effectiveAskUserOnly 映射为 codex/pi/dsh/zcode 的 manualApproval/askUserOnly，并把 zcode 加入 sessionPermission 注入名单
- [x] task-05: dsh 驱动消费 stderr（诊断可见，管道不再可被子进程写满阻塞）
- [x] task-06: backend search.py 模块 docstring 与同步注释与当前实现（async 直调、无 DB uq 约束）一致
- [x] task-07: 聚焦测试全绿：daemon zcode/dsh 驱动与接线相关测试 + tsc 零错误；backend test_knowledge_search.py
