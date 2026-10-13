---
author: flow-machine-draft
created_at: 2026-10-12T23:57:14.731Z
---
# 提案书（Proposal）— 2026-10-13-daemon-module-map

## 动机

任务原话转写：2026-10-13-spawn-flush-e2e-test 收口时 5 条 FR 落伪域 fr/auto-sillyhub-daemon.md（工具建议域 daemon 实为项目级粗启发；真路由按模块卡前缀匹配、模块 id 即域名，task-runner 模块卡与真域 fr/task-runner.md 均在场）。本变更补模块卡登记并把 5 条 FR 迁回真域 task-runner。
成功标准：
- sillyhub-daemon 项目模块图（.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml）task-runner 模块 paths 补齐目录前缀登记：src/task-runner 包目录 + tests/task-runner 测试目录（前缀匹配制，非 glob）
- 用 sillyspec 源码 matchedModuleIds 实测：sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts 与 sillyhub-daemon/src/task-runner/spawn-stream.ts 均命中 task-runner 模块（未来变更自动落真域）
- fr/auto-sillyhub-daemon.md 的 FR-auto-sillyhub-daemon-034~038 五条目整体迁出，fr/task-runner.md 以 FR-task-runner-016~020 接续编号原样承接（变更/状态/摘要/全文/最近确认/测试绑定逐字段保持）
- sillyspec knowledge validate 通过、knowledge digest 伪域信号卡中 auto-sillyhub-daemon 待迁计数相应下降
- 不改任何 src 代码与归档件；sillyhub-daemon/backend 不需要跑测试（纯知识面变更）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. sillyhub-daemon 项目模块图（.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml）task-runner 模块 paths 补齐目录前缀登记：src/task-runner 包目录 + tests/task-runner 测试目录（前缀匹配制，非 glob）
2. 用 sillyspec 源码 matchedModuleIds 实测：sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts 与 sillyhub-daemon/src/task-runner/spawn-stream.ts 均命中 task-runner 模块（未来变更自动落真域）
3. fr/auto-sillyhub-daemon.md 的 FR-auto-sillyhub-daemon-034~038 五条目整体迁出，fr/task-runner.md 以 FR-task-runner-016~020 接续编号原样承接（变更/状态/摘要/全文/最近确认/测试绑定逐字段保持）
4. sillyspec knowledge validate 通过、knowledge digest 伪域信号卡中 auto-sillyhub-daemon 待迁计数相应下降
5. 不改任何 src 代码与归档件；sillyhub-daemon/backend 不需要跑测试（纯知识面变更）

## 成功标准（可验证）

1. sillyhub-daemon 项目模块图（.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml）task-runner 模块 paths 补齐目录前缀登记：src/task-runner 包目录 + tests/task-runner 测试目录（前缀匹配制，非 glob）
2. 用 sillyspec 源码 matchedModuleIds 实测：sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts 与 sillyhub-daemon/src/task-runner/spawn-stream.ts 均命中 task-runner 模块（未来变更自动落真域）
3. fr/auto-sillyhub-daemon.md 的 FR-auto-sillyhub-daemon-034~038 五条目整体迁出，fr/task-runner.md 以 FR-task-runner-016~020 接续编号原样承接（变更/状态/摘要/全文/最近确认/测试绑定逐字段保持）
4. sillyspec knowledge validate 通过、knowledge digest 伪域信号卡中 auto-sillyhub-daemon 待迁计数相应下降
5. 不改任何 src 代码与归档件；sillyhub-daemon/backend 不需要跑测试（纯知识面变更）
