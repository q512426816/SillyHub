---
author: flow-machine-draft
created_at: 2026-09-28T13:57:00.341Z
---
# 提案书（Proposal）— 2026-09-28-knowledge-touch-live

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:18451b30e5a481578f162f813166e26f9080f4dbbd506a90960ae2565732bf3c:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
任务原话转写：变更详情页资产卡「知识触达」改实时：现在只做 flow done 打的「待复核：」标记反查（归档后才有数据），而 knowledge_hits 表的 inject 行（带 change_name + matched_anchors）执行时即实时入库无人消费。
- backend assets.py：knowledge_touch 并入实时命中——查本变更 inject 行的 matched_anchors（file#slug / 裸文件两形态），与标记反查行合并去重（key=file+id），live 上限 100 条防载荷
- frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；空态文案改写（在途也能有知识触达，FR/决策/测试绑定仍是归档产物）
- 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，设计内

成功标准：
- 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits inject 行，非标记）
- 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
- 裸文件锚点（无 #）可显示；live 合并上限 100 条
- backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿；tsc/eslint/ruff/mypy 0
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:5b74b2a6579297f90f8c435c2ad354dfc32196bc7d4a9bce5a6b7d5f7d1faecf:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. backend assets.py：knowledge_touch 并入实时命中——查本变更 inject 行的 matched_anchors（file#slug / 裸文件两形态），与标记反查行合并去重（key=file+id），live 上限 100 条防载荷
2. frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；空态文案改写（在途也能有知识触达，FR/决策/测试绑定仍是归档产物）
3. 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，设计内
4. 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits inject 行，非标记）
5. 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
6. 裸文件锚点（无 #）可显示
7. live 合并上限 100 条
8. backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿
9. tsc/eslint/ruff/mypy 0
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:459ff8e827abc4dab10219ea401c261c12f03334f02a7f3826cc018c37e422c3:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
1. backend assets.py：knowledge_touch 并入实时命中——查本变更 inject 行的 matched_anchors（file#slug / 裸文件两形态），与标记反查行合并去重（key=file+id），live 上限 100 条防载荷
2. frontend 资产卡：在途态标签「知识触达（注入命中 · 实时）」区分归档态「待复核标记反查」；空态文案改写（在途也能有知识触达，FR/决策/测试绑定仍是归档产物）
3. 审计结论（不动）：文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为归档时生成的结构化产物，设计内
4. 在途变更（未归档）若已有知识注入，资产卡即可见知识触达条目（数据来自 knowledge_hits inject 行，非标记）
5. 归档后标记反查与实时命中合并且去重（同一条目不重复出现）
6. 裸文件锚点（无 #）可显示
7. live 合并上限 100 条
8. backend 资产测试新增在途命中用例 + frontend 卡测试同步，全绿
9. tsc/eslint/ruff/mypy 0
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
