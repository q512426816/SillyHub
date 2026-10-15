---
author: flow-machine-draft
created_at: 2026-10-15T01:13:32.946Z
---
# 决策记录（Decisions）— 2026-10-15-ci-recurrence-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：⑦ 三件套过度触发（如 ppm 区加菜单不改 permission.test.ts 的分区条目）——按既有口径走「确认不触及钉子断言则纳入评审说明」逃生门，fail-closed 优于 CI 补红。试过但放弃：把菜单数量锚改为从源常量推导（task-05 rejected）——推导锚等于断言与被测同源，钉子失去「源码长大必须显式跟」的契约语义，复发根因是本地缺拦截面而非锚形式，闸门⑦补齐已治本；另考虑过 pre-commit 阶段跑 typecheck（放弃：每次提交 1 分钟不可接受）。
