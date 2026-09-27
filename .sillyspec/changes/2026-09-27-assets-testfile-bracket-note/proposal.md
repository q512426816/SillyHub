---
author: flow-machine-draft
created_at: 2026-09-27T10:06:59.927Z
---
# 提案书（Proposal）— 2026-09-27-assets-testfile-bracket-note

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:aee4f180fa634b24a5be229dac6cdd273706b358563cc06eece5867ea9a6230a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
任务原话转写：test-trace tests[] 记录的测试文件路径可能粘着「用例描述」注解（sillyspec CLI flow done 补全产物，实证：sillyspec 仓 2026-09-27-ui-visual-guidance 的 FR-01~04/06 行为 test/ui-visual-guidance.test.mjs「detectUiTouch 正例：…」），前端 normalizeTestFilePath 未剥离该注解，basename 连注解进 explorer search 必零命中，用户点开测试文件恒见「未在仓库中找到该测试文件」误报。

成功标准：
- normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍按未找到处理
- TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值/后缀命中并打开真实测试文件预览
- 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文件名
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:d0abcfd5bc63c7453b20a2dbb79ecafc03c3a98301dc09f2537cdfb2c3728413:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍按未找到处理
2. TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值
3. 后缀命中并打开真实测试文件预览
4. 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文件名
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:4bdc71fe69591f9aef1f946979e6f9c7ae9d9ff04171738afbd8e0e5940fca4f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
1. normalizeTestFilePath 剥离路径中的「…」注解段（支持一段或多段），剥离后为空仍按未找到处理
2. TestFileBody 用剥离后的文件名发起 explorer search，粘注解路径可等值
3. 后缀命中并打开真实测试文件预览
4. 既有 change-assets-card 路径解析用例全绿，新增用例覆盖多段注解与搜索入参为干净文件名
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
