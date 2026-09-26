---
author: flow-machine-draft
created_at: 2026-09-26T07:26:45.049Z
---
# 提案书（Proposal）— 2026-09-26-assets-test-binding-raw-text

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:83696b13f13d443cf941eacaad6eb5980a53c06bfcdada0fcd07b2ff3563c809:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
任务原话转写：动机:test-trace.json 摘录时把测试绑定行的 ::用例名 后缀截断,资产卡测试绑定只显示文件级路径,用户看不到手写原文(含测试类/用例与描述文字);原文就在归档变更目录 requirements.md 的测试绑定槽里,可读不应浪费——展示层把原文带出来。

成功标准:
- 后端 assets 聚合解析归档 requirements.md 的 AGENT 测试绑定槽原文,按锚点匹配挂到 ChangeTestRow 新字段 raw_binding;requirements 缺失或解析失败时 raw_binding 为 None,既有行为零变化 fail-open
- ChangeTestRow schema 变更后按 CLAUDE.md 规则 21 跑 pnpm gen:types 并随提交更新 api-types.ts 与 backend/openapi.json
- 前端资产卡测试绑定行在 raw_binding 存在时于行下显示原文小字,超长截断且悬停可见全文
- 后端 test_assets 补用例:含绑定槽原文的 requirements 提取、无 requirements 容错为 None
- 前端 change-assets-card 组件测试补原文显示断言,既有 15 用例不回归;后端 change 聚焦测试全绿;frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:2f22875f37487682c2411f47ea372c0bc245d9574c825a8252e0613c7621eb9b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
按成功标准机械推导，共 8 条验收面：
1. 后端 assets 聚合解析归档 requirements.md 的 AGENT 测试绑定槽原文,按锚点匹配挂到 ChangeTestRow 新字段 raw_binding
2. requirements 缺失或解析失败时 raw_binding 为 None,既有行为零变化 fail-open
3. ChangeTestRow schema 变更后按 CLAUDE.md 规则 21 跑 pnpm gen:types 并随提交更新 api-types.ts 与 backend/openapi.json
4. 前端资产卡测试绑定行在 raw_binding 存在时于行下显示原文小字,超长截断且悬停可见全文
5. 后端 test_assets 补用例:含绑定槽原文的 requirements 提取、无 requirements 容错为 None
6. 前端 change-assets-card 组件测试补原文显示断言,既有 15 用例不回归
7. 后端 change 聚焦测试全绿
8. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:14b9f4fd4da6d3719dec505843fae82155fbd1010d03c6caebe6cf50cf927ed5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
1. 后端 assets 聚合解析归档 requirements.md 的 AGENT 测试绑定槽原文,按锚点匹配挂到 ChangeTestRow 新字段 raw_binding
2. requirements 缺失或解析失败时 raw_binding 为 None,既有行为零变化 fail-open
3. ChangeTestRow schema 变更后按 CLAUDE.md 规则 21 跑 pnpm gen:types 并随提交更新 api-types.ts 与 backend/openapi.json
4. 前端资产卡测试绑定行在 raw_binding 存在时于行下显示原文小字,超长截断且悬停可见全文
5. 后端 test_assets 补用例:含绑定槽原文的 requirements 提取、无 requirements 容错为 None
6. 前端 change-assets-card 组件测试补原文显示断言,既有 15 用例不回归
7. 后端 change 聚焦测试全绿
8. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
