---
author: flow-machine-draft
created_at: 2026-10-12T23:57:14.731Z
---
# 设计记录（Design Record）— 2026-10-13-daemon-module-map

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：2026-10-13-spawn-flush-e2e-test 收口时 5 条 FR 落伪域 fr/auto-sillyhub-daemon.md。读 sillyspec 源码定位路由机制（零猜测）：域=模块 id，`discoverModuleIndex`（decision-distill.js:230）合并 `.sillyspec/docs/*/modules/_module-map.yaml` 全部项目图，`matchedModuleIds`（fr-index.js）按「精确等于或目录前缀」匹配交付路径，无命中才走伪域路径段投票；收口告警里的「建议域 daemon」出自 `suggestDomainFromFilesRaw`（knowledge-digest.js:72 `/^sillyhub-daemon\// → 'daemon'`）——项目级粗启发，不是模块路由结论。task-runner 模块卡（docs/sillyhub-daemon/modules/task-runner.md）与真域文件 fr/task-runner.md 均在场，5 条 FR 内容即 task-runner 行为（spawnAndStream 收尾冲刷），语义与路由双重吻合。

方案：① 在 task-runner 模块的本体图（sillyhub-daemon 项目 `_module-map.yaml`，根图头部自述细粒度模块归各自项目图）补两条目录前缀：`sillyhub-daemon/src/task-runner`（包目录——一并修掉 src/task-runner/** 同样无登记的存量缺口）与 `sillyhub-daemon/tests/task-runner`（测试目录，本次伪域根因）。② 伪域 034~038 五条目整体迁入 fr/task-runner.md 接续编号 016~020（现最大 015），逐字段原样保持。③ 用 sillyspec 源码 discoverModuleIndex+matchedModuleIds 实测两代表路径命中 + knowledge validate/digest 工具自检收口。相对用户提示词的两处偏离（登记图从根图改项目图、迁移域从 daemon 改 task-runner）均有源码证据，属「满足意图的正确落点」：落 daemon 会让登记（语义错位进 daemon 模块=WS 核心）与迁移（未来同目录变更落 task-runner）互相矛盾成分裂态。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：改三个数据/知识文件，零代码：① `.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml` task-runner 模块 `paths` 数组从 1 条（facade 文件）扩为 3 条（+包目录前缀+测试目录前缀），schema 不变；② `knowledge/fr/auto-sillyhub-daemon.md` 删除 034~038 五条目（其余条目零扰动）；③ `knowledge/fr/task-runner.md` 追加 016~020 五条目（字段原样、仅段头 id 换域与编号）。对外 API / src / 测试 / 归档件：无变化。行为面效果：未来触及 `sillyhub-daemon/{src,tests}/task-runner/**` 的变更，FR 域路由自动落真域 task-runner（不再铸伪域）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立（数据面）。模块图与 fr 文件是纯静态数据，无事件序；fr-index 下次提炼按新模块图匹配路径，晚到的同目录变更直接落真域。迁移期间无并发提炼在跑（flow done 已收口，watcher 只读观测）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：本变更单会话串行编辑三文件；若并行会话同时归档新变更触发 fr-index 写 fr/task-runner.md，合并写以工具侧幂等提炼为准（条目按变更名+FR 锚去重），冲突面为追加段无交错覆盖；伪域侧同理。风险窗口极小且可重跑 digest 收敛。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。三文件改动原子性由单次 git commit 保证；迁移中途被打断最坏态=条目在两文件重复或双缺，`knowledge validate` 可检出、重放迁移步骤即收敛（幂等：按条目段头 id 定位搬移）。

4. 作用域：跨工作区/跨工作仓/多实例时数据会不会串台？

   答：不会。模块图合并是跨项目并集（discoverModuleIndex 全 docs/* 合并），登记的路径前缀带 `sillyhub-daemon/` 项目段，不与 backend/frontend 等其它项目路径相交；fr/task-runner.md 的 task-runner 模块 id 全局唯一（合并器按 id 并 paths）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险：手改 fr 文件违反文件头「机械解析契约勿手改」告示的字面——但迁移本身是工具 advisory 明示的 sanctioned 动作（「确认后可迁移」），且字段逐字保持 + FR-04 validate/digest 自检兜底；若未来 fr-index 重提炼按归档重放覆写，条目会以新域重新落位（我们已把域修对），重放与迁移结果一致。次风险：根图与项目图双处登记造成 paths 并集冗余——只在项目图登记避免（task-runner 模块本体在项目图）。

试过但放弃的方案：① 按告警字面把 5 条 FR 迁 fr/daemon.md（daemon 模块=daemon.ts WS 核心，测试目录登记进该模块语义错位；且登记若进 task-runner 模块则未来变更落 task-runner 域、与存量 daemon 域分裂，放弃）；② 在根图 docs/multi-agent-platform/modules/_module-map.yaml 登记（根图头部自述细粒度模块归各自项目图，task-runner 模块本体在项目图，跨图重复登记徒增并集冗余，放弃）；③ 给 tests 目录另铸新模块卡（如 task-runner-tests，新造伪模块 id 无对应域文件与语义，过度工程，放弃）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| 修改 | .sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml | task-runner 模块 paths 补 src 包目录 + tests 目录两条前缀登记 |
| 修改 | .sillyspec/knowledge/fr/auto-sillyhub-daemon.md | 迁出 FR-auto-sillyhub-daemon-034~038 五条目（其余零扰动） |
| 修改 | .sillyspec/knowledge/fr/task-runner.md | 接续编号 FR-task-runner-016~020 原样承接五条目 |
