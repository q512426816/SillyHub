---
author: flow-machine-draft
created_at: 2026-09-25T08:10:16.780Z
---
# 提案书（Proposal）— 2026-09-25-change-detail-assets-usability

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:9b542b4f4a929577e3d9a73794a31b746ae1240eb9b2e0f066cec297e2051bb7:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
任务原话转写：变更详情「沉淀资产」卡与相邻范围对账卡的可用性修复：FR/决策索引点击不落位、测试绑定看不到测试文件、归档留档看不到具体改动，范围对账在降级态还误显三态全 0。
成功标准：
- FR/决策索引行点击后知识库页落到对应文件并滚动到该条目卡
- 测试绑定行提供入口，可在弹窗内读到仓库内该测试文件内容
- 归档留档列出 change-patch.json 的文件清单，点击可看到 change.patch 中该文件的红绿 diff
- 范围对账卡在 ok=true 且有降级原因时不再渲染三态 0/0/0，改为显式展示降级原因与口径
- 相关后端与前端测试全绿（新增用例覆盖上述四项），ruff 与 tsc 零错误
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:46d6f2e80f4f5db7be2984f965bfc6af4a2b417a3354401b8a3af1d1c456f2ef:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
按成功标准机械推导，共 6 条验收面：
1. FR
2. 决策索引行点击后知识库页落到对应文件并滚动到该条目卡
3. 测试绑定行提供入口，可在弹窗内读到仓库内该测试文件内容
4. 归档留档列出 change-patch.json 的文件清单，点击可看到 change.patch 中该文件的红绿 diff
5. 范围对账卡在 ok=true 且有降级原因时不再渲染三态 0/0/0，改为显式展示降级原因与口径
6. 相关后端与前端测试全绿（新增用例覆盖上述四项），ruff 与 tsc 零错误
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:391971d5c1a11d11cc83ecbd258bdbd6ae05f4d75927d6328c8c57985c4a3404:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-change-detail-assets-usability 留痕重锚 -->
1. FR
2. 决策索引行点击后知识库页落到对应文件并滚动到该条目卡
3. 测试绑定行提供入口，可在弹窗内读到仓库内该测试文件内容
4. 归档留档列出 change-patch.json 的文件清单，点击可看到 change.patch 中该文件的红绿 diff
5. 范围对账卡在 ok=true 且有降级原因时不再渲染三态 0/0/0，改为显式展示降级原因与口径
6. 相关后端与前端测试全绿（新增用例覆盖上述四项），ruff 与 tsc 零错误
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
