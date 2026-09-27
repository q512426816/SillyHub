---
author: flow-machine-draft
created_at: 2026-09-27T09:00:33.251Z
---
# 提案书（Proposal）— 2026-09-27-change-list-is-thin

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:b7eaf511c31c150cc2a0a4c22fcf9619eb7dd1127b36bbdc2ab50933212aea2d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
任务原话转写：变更列表投影加 is_thin 字段（2026-09-27-thin-display-fix 遗留收口）：归档轻量变更在列表行也显示出身标识。后端 ChangeSummary 加 is_thin 计算字段（零 migration），enrich_summaries 投影处判定（三分支与前端 lib/thin-lineage.ts 同口径：stage=thin / quick 且 created_at>=2026-09-25 / latest_progress.steps 全无标准四阶段痕迹且同时间窗——steps 数据已在投影 JSON 内零新增查询）；前端 gen:types 后列表行消费 is_thin 渲染出身徽章（归档轻量行=合并勾+「轻量」琥珀小徽章并存，对齐详情页双徽章口径）。
成功标准：
- ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向
- 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存
- 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
- 部署后浏览器验证归档区轻量行出身标识
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:ae1fcfa7be74e26fa829d355ae18d302b09351ab72c13792cb977a58154b0151:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向
2. 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存
3. 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
4. 部署后浏览器验证归档区轻量行出身标识
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:b90cae5ad60c86638b3f748fae285d00032611aa6da7fbf82cc8ebb9a0c3c9b4:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
1. ChangeSummary 含 is_thin（bool，default False 零破坏），后端投影测试覆盖三分支+时间窗负向
2. 前端 api-types 重生成（gen:types）+ 列表行 is_thin=true 时标题行显示「轻量」琥珀徽章，归档轻量与已归档状态并存
3. 后端相关测试全绿 + 前端列表测试全绿 + tsc 0 + openapi.json 同批提交
4. 部署后浏览器验证归档区轻量行出身标识
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
