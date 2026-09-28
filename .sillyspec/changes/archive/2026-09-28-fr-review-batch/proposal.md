---
author: flow-machine-draft
created_at: 2026-09-28T14:11:55.605Z
---
# 提案书（Proposal）— 2026-09-28-fr-review-batch

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:97e00f0363d87fc8ebd1e90be48c7f4c0e2d59e81a33b02668bc122bafb8445a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
任务原话转写：复核知识库「规则待复核」FR 条目：fr/ 九域共 263 条（lib-api 64、daemon 56、frontend 31、lib-changes 31、build 28、backend 26、components-shared 15、styles 7、lib-knowledge 5）逐条核对绑定与实态——相符且有真实测试的用 tests --confirm --evidence 翻正或 --bind 新绑；不符的修正内容或按 superseded+退役理由废弃。

成功标准：
- 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active，无行则 bind 真实测试）/ 绑定过时重绑 / 内容过时最小修正 / 特性已死标 superseded+退役理由 / 无测试面清标记留档报告
- 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路径
- 复核完成的条目清除「待复核：」标记行，未复核的不动
- fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
- sillyspec knowledge validate 无 errors
- 分批（按域分波）处理，每波显式 pathspec 提交
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:efb96a57c11640d640afe37f595fd6c934564cc98f4207c55637bf1e68a23524:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
按成功标准机械推导，共 6 条验收面：
1. 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active，无行则 bind 真实测试）/ 绑定过时重绑 / 内容过时最小修正 / 特性已死标 superseded+退役理由 / 无测试面清标记留档报告
2. 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路径
3. 复核完成的条目清除「待复核：」标记行，未复核的不动
4. fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
5. sillyspec knowledge validate 无 errors
6. 分批（按域分波）处理，每波显式 pathspec 提交
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:f136c1015c6ae7899c4a7e4f5b2d54addab5ccb9fc787da64e313d253414428d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-fr-review-batch 留痕重锚 -->
1. 263 条待复核条目逐条产出裁决：相符翻正（candidate 行 confirm 翻 active，无行则 bind 真实测试）/ 绑定过时重绑 / 内容过时最小修正 / 特性已死标 superseded+退役理由 / 无测试面清标记留档报告
2. 每条翻正的证据路径必须是盘上真实测试形态文件（test_*.py / *.test.*），不许悬空路径
3. 复核完成的条目清除「待复核：」标记行，未复核的不动
4. fr 文件条目格式不被破坏（标题/状态/场景正文/绑定子块结构保持）
5. sillyspec knowledge validate 无 errors
6. 分批（按域分波）处理，每波显式 pathspec 提交
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
