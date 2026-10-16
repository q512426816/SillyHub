---
author: flow-machine-draft
created_at: 2026-10-15T23:50:30.651Z
---
# 提案书（Proposal）— 2026-10-16-driver-audit-fixes

## 动机

任务原话转写：动机：24h 只读风险审查发现 zcode 驱动三处缺陷（轮次进行中 close 令 consume 永久挂起 / SIGTERM-SIGKILL 升级死码 / stdout 逐 chunk UTF-8 解码烂字），新引擎审批桥 manualApproval 从未接线致 codex 族恒 allow-through 且 zcode 漏注入名单，dsh stderr 管道不消费，backend knowledge search.py 两处注释与实现失真（run_in_threadpool / DB uq 兜底已删）。
成功标准：
- zcode 轮次进行中调用 close 时 consume 正常收敛返回（对照 codex _finishTurnOnClose 先例），协程与清理不悬挂
- zcode stdout 跨 chunk 多字节 UTF-8 有状态解码，中文内容不再产生 U+FFFD
- zcode close 阶梯 SIGTERM 到期后无条件升级 SIGKILL（仅以 exitCode 判活）
- driver-factory 把 enableApproval/effectiveAskUserOnly 映射为 codex/pi/dsh/zcode 的 manualApproval/askUserOnly，并把 zcode 加入 sessionPermission 注入名单
- dsh 驱动消费 stderr（诊断可见，管道不再可被子进程写满阻塞）
- backend search.py 模块 docstring 与同步注释与当前实现（async 直调、无 DB uq 约束）一致
- 聚焦测试全绿：daemon zcode/dsh 驱动与接线相关测试 + tsc 零错误；backend test_knowledge_search.py

## 变更范围

按成功标准机械推导，共 7 条验收面：
1. zcode 轮次进行中调用 close 时 consume 正常收敛返回（对照 codex _finishTurnOnClose 先例），协程与清理不悬挂
2. zcode stdout 跨 chunk 多字节 UTF-8 有状态解码，中文内容不再产生 U+FFFD
3. zcode close 阶梯 SIGTERM 到期后无条件升级 SIGKILL（仅以 exitCode 判活）
4. driver-factory 把 enableApproval/effectiveAskUserOnly 映射为 codex/pi/dsh/zcode 的 manualApproval/askUserOnly，并把 zcode 加入 sessionPermission 注入名单
5. dsh 驱动消费 stderr（诊断可见，管道不再可被子进程写满阻塞）
6. backend search.py 模块 docstring 与同步注释与当前实现（async 直调、无 DB uq 约束）一致
7. 聚焦测试全绿：daemon zcode/dsh 驱动与接线相关测试 + tsc 零错误；backend test_knowledge_search.py

## 成功标准（可验证）

1. zcode 轮次进行中调用 close 时 consume 正常收敛返回（对照 codex _finishTurnOnClose 先例），协程与清理不悬挂
2. zcode stdout 跨 chunk 多字节 UTF-8 有状态解码，中文内容不再产生 U+FFFD
3. zcode close 阶梯 SIGTERM 到期后无条件升级 SIGKILL（仅以 exitCode 判活）
4. driver-factory 把 enableApproval/effectiveAskUserOnly 映射为 codex/pi/dsh/zcode 的 manualApproval/askUserOnly，并把 zcode 加入 sessionPermission 注入名单
5. dsh 驱动消费 stderr（诊断可见，管道不再可被子进程写满阻塞）
6. backend search.py 模块 docstring 与同步注释与当前实现（async 直调、无 DB uq 约束）一致
7. 聚焦测试全绿：daemon zcode/dsh 驱动与接线相关测试 + tsc 零错误；backend test_knowledge_search.py
