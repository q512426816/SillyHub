---
author: flow-machine-draft
created_at: 2026-09-26T06:57:07.027Z
---
# 需求规格（Requirements）— 2026-09-26-assets-testfile-path-resolve

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
<!-- 参考摘录 9 条按实现结构合并为 FR-01~04（FR-01 吸收摘录 01~04、FR-02 吸收 05~06、FR-03 对应 07、FR-04 对应 08~09） -->

### FR-01: 测试文件预览路径解析兜底（归一 + 文件名搜索 + 后缀救回）
Given 归档件 test-trace.json 记录的测试文件路径可能是短路径（如 `tests/test_full_sync_convergence.py`，实为仓库内 `backend/app/modules/spec_workspace/tests/` 下同名文件）或含反斜杠/`./` 前缀的写法，
When 用户在沉淀资产卡「测试绑定」行点开测试文件预览，
Then 弹窗先对记录路径做知识库同款字符串归一（反斜杠→斜杠、去 `./` 前缀），再按文件名调 explorer search 全树搜索：命中路径与归一路径**等值**或**唯一后缀匹配**（命中路径以 `/{归一路径}` 结尾）时自动用真实路径打开预览，并在真实路径旁标注原记录路径；后缀匹配多个时先排除 `.sillyspec/.runtime/` 前缀的工作树副本再判唯一，仍多个则列出候选路径由用户点选打开。

### FR-02: 未命中走中性文案，消除「工作区目录可能已被移动或删除」误导
Given 记录路径在仓库内零命中或多候选（用户需自选），
When 预览弹窗渲染解析结果，
Then 前端显示中性提示（未在仓库中找到该测试文件、路径可能不完整或已被移动/删除；多候选时列候选），不出现「工作区目录可能已被移动或删除」语义；explorer 后端 not_found 错误文案同步改为中性表述「文件或目录不存在：路径可能不完整，或文件已被移动/删除」。

### FR-03: 前端组件测试补齐且既有用例不回归
Given 路径解析逻辑落盘，
When 运行 change-assets-card 组件套件，
Then 新增用例（等值命中直用、短路径唯一后缀救回、worktree 副本排除后救回、零命中中性文案）与既有 10 用例全部通过。

### FR-04: 后端聚焦测试与类型门禁全绿
Given explorer 文案修改落盘，
When 运行后端 explorer 聚焦测试与 `frontend tsc --noEmit`，
Then 全部通过且类型检查 0 错。
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: 测试文件预览弹窗打开时先按文件名调 explorer search,记录路径与命中路径等值或唯一后缀匹配时自动用真实路径预览
FR-02: 后缀匹配多个时排除 .sillyspec/.runtime/ 工作树副本前缀后再判,仍多个则列出候选路径由用户点选
FR-03: 路径归一纯函数对反斜杠与点斜杠前缀等形态做与知识库归一同款处理
FR-04: 路径救回时弹窗在真实路径旁标注原记录路径
FR-05: 零命中与多候选时显示中性文案(未在仓库中找到该测试文件、路径可能不完整或已被移动删除),不再出现工作区目录可能已被移动或删除的误导语义
FR-06: explorer 后端 not_found 错误文案改为中性表述:路径可能不完整或文件已被移动删除
FR-07: 前端 change-assets-card 组件测试补齐用例(等值命中、短路径唯一后缀救回、worktree 副本排除、零命中中性文案)全绿且既有 10 用例不回归
FR-08: 后端 explorer 聚焦测试全绿
FR-09: frontend tsc 无错误
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
`frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`::短路径唯一后缀救回 / worktree 副本排除后救回 / 等值命中直用 用例（fetchSearch mock + FilePreview 替身断言收到的解析后路径与原记录路径标注）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
前端零命中中性文案用例（同上文件）；后端文案 `backend/tests/modules/explorer/test_explorer.py`（既有套件回归——旧文案无断言，改后跑聚焦确认零破坏）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同 `change-assets-card.test.tsx` 全套（新增 4 用例 + 既有 10 用例一次跑过）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
`backend/tests/modules/explorer/test_explorer.py` 聚焦全绿；`pnpm exec tsc --noEmit` exit 0（2026-09-26 实测）
