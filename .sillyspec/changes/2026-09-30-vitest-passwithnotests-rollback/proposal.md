---
author: flow-machine-draft
created_at: 2026-09-30T08:51:56.125Z
---
# 提案书（Proposal）— 2026-09-30-vitest-passwithnotests-rollback

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:76b5ac967d58499f14cac0e33c361b3bc07cc3439452a2d031550d3ddb337a3e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
任务原话转写：sillyspec 仓依赖推断三缺陷已修复（注释剥离散/tsx 正则/e2e 目录过滤），vitest passWithNoTests 兜底不再必要，撤掉并归档工具缺陷记录。
成功标准：
- frontend/vitest.config.ts 移除 passWithNoTests，恢复正常 vitest 语义（空收集报错）
- 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在 sillyspec 仓验证）
- 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录
- 撤除后相关测试与门禁实测通过
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:6d4970d28c0993e413955ce4679712946f0289a3a3115a01ebebaf27c9c2a44f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. frontend/vitest.config.ts 移除 passWithNoTests，恢复正常 vitest 语义（空收集报错）
2. 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在 sillyspec 仓验证）
3. 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录
4. 撤除后相关测试与门禁实测通过
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:1a976b721a416719b2058061b9d7a45aef6391f4575abe1daecdbf80338f45b1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
1. frontend/vitest.config.ts 移除 passWithNoTests，恢复正常 vitest 语义（空收集报错）
2. 门禁复核：原始失败面下不再产生 vitest run e2e/auth.spec.ts 命令（已在 sillyspec 仓验证）
3. 工具缺陷文档移入 docs/sillyspec/finished/ 并附处置记录
4. 撤除后相关测试与门禁实测通过
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
