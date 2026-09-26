---
author: flow-machine-draft
created_at: 2026-09-26T06:57:07.026Z
---
# 提案书（Proposal）— 2026-09-26-assets-testfile-path-resolve

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:6ad67e6aa0242881a3e593eb7255621b185a6444bdd141a616c3ce3cbb5a9f08:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
任务原话转写：动机:沉淀资产卡测试绑定行记录的测试文件路径存在短路径数据瑕疵——如 tests/test_full_sync_convergence.py 实为 backend/app/modules/spec_workspace/tests/ 下同名文件——点开预览走 explorer 原样寻径必 404,且 not_found 文案「工作区目录可能已被移动或删除」误导用户以为工作区丢失(2026-09-26 生产实证)。参考知识库页深链前缀归一先例 normalizeKnowledgeFileParam,为测试文件预览补路径解析兜底。

成功标准:
- 测试文件预览弹窗打开时先按文件名调 explorer search,记录路径与命中路径等值或唯一后缀匹配时自动用真实路径预览;后缀匹配多个时排除 .sillyspec/.runtime/ 工作树副本前缀后再判,仍多个则列出候选路径由用户点选
- 路径归一纯函数对反斜杠与点斜杠前缀等形态做与知识库归一同款处理;路径救回时弹窗在真实路径旁标注原记录路径
- 零命中与多候选时显示中性文案(未在仓库中找到该测试文件、路径可能不完整或已被移动删除),不再出现工作区目录可能已被移动或删除的误导语义
- explorer 后端 not_found 错误文案改为中性表述:路径可能不完整或文件已被移动删除
- 前端 change-assets-card 组件测试补齐用例(等值命中、短路径唯一后缀救回、worktree 副本排除、零命中中性文案)全绿且既有 10 用例不回归;后端 explorer 聚焦测试全绿;frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:b57a6a40742f23c1e3131cc9e0d47eae7929057d4b9fade903d66ae3ef89e9e1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. 测试文件预览弹窗打开时先按文件名调 explorer search,记录路径与命中路径等值或唯一后缀匹配时自动用真实路径预览
2. 后缀匹配多个时排除 .sillyspec/.runtime/ 工作树副本前缀后再判,仍多个则列出候选路径由用户点选
3. 路径归一纯函数对反斜杠与点斜杠前缀等形态做与知识库归一同款处理
4. 路径救回时弹窗在真实路径旁标注原记录路径
5. 零命中与多候选时显示中性文案(未在仓库中找到该测试文件、路径可能不完整或已被移动删除),不再出现工作区目录可能已被移动或删除的误导语义
6. explorer 后端 not_found 错误文案改为中性表述:路径可能不完整或文件已被移动删除
7. 前端 change-assets-card 组件测试补齐用例(等值命中、短路径唯一后缀救回、worktree 副本排除、零命中中性文案)全绿且既有 10 用例不回归
8. 后端 explorer 聚焦测试全绿
9. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:70aebbc45e3887a4afa393ab8146928a00388e180078d40c47db23f41fd0d87e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
1. 测试文件预览弹窗打开时先按文件名调 explorer search,记录路径与命中路径等值或唯一后缀匹配时自动用真实路径预览
2. 后缀匹配多个时排除 .sillyspec/.runtime/ 工作树副本前缀后再判,仍多个则列出候选路径由用户点选
3. 路径归一纯函数对反斜杠与点斜杠前缀等形态做与知识库归一同款处理
4. 路径救回时弹窗在真实路径旁标注原记录路径
5. 零命中与多候选时显示中性文案(未在仓库中找到该测试文件、路径可能不完整或已被移动删除),不再出现工作区目录可能已被移动或删除的误导语义
6. explorer 后端 not_found 错误文案改为中性表述:路径可能不完整或文件已被移动删除
7. 前端 change-assets-card 组件测试补齐用例(等值命中、短路径唯一后缀救回、worktree 副本排除、零命中中性文案)全绿且既有 10 用例不回归
8. 后端 explorer 聚焦测试全绿
9. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
