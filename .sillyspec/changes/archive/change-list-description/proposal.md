---
author: flow-machine-draft
created_at: 2026-09-28T05:26:25.186Z
---
# 提案书（Proposal）— change-list-description

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:d553101bf4ac809d34b170be8b13528c6569ba4e85e9d8daee68dcef5fa1d8a1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
任务原话转写：变更中心列表（进行中/已归档）里普通变更与轻量变更两类行都只能靠 change_key 辨识——title 提取自 proposal 模板 H1 会被归一化回退 key 派生名，动机描述没进列表也没进搜索，变更多了找目标只能逐个点开。让平台从 proposal.md 动机段提取变更描述入库并在列表展示、搜索可命中。
成功标准：
- Change 表新增 description 可空列（alembic 迁移），reparse 与文档推送两条写路径同源提取不互翻
- 提取规则：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功标准」行前，最长 500 字符
- ChangeSummary/ChangeRead 带 description；列表搜索 ILIKE 同时命中 change_key/title/description
- 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位
- 相关 backend pytest 与 frontend 测试通过；api-types 由 pnpm gen:types 再生成并随变更提交
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:8e86e7db21c977e10e69588409d4f8c42151e01d0a2d93fcf4b1db20b37026fe:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
按成功标准机械推导，共 8 条验收面：
1. Change 表新增 description 可空列（alembic 迁移），reparse 与文档推送两条写路径同源提取不互翻
2. 提取规则：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功标准」行前，最长 500 字符
3. ChangeSummary
4. ChangeRead 带 description
5. 列表搜索 ILIKE 同时命中 change_key/title/description
6. 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位
7. 相关 backend pytest 与 frontend 测试通过
8. api-types 由 pnpm gen:types 再生成并随变更提交
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:d840c31f0118603b8d72a8881cbe8ed287a02ddbf06970e79b62816a9e521321:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change change-list-description 留痕重锚 -->
1. Change 表新增 description 可空列（alembic 迁移），reparse 与文档推送两条写路径同源提取不互翻
2. 提取规则：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功标准」行前，最长 500 字符
3. ChangeSummary
4. ChangeRead 带 description
5. 列表搜索 ILIKE 同时命中 change_key/title/description
6. 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位
7. 相关 backend pytest 与 frontend 测试通过
8. api-types 由 pnpm gen:types 再生成并随变更提交
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
