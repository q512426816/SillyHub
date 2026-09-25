---
author: flow-machine-draft
created_at: 2026-09-25T01:54:21.475Z
---
# 需求规格（Requirements）— 2026-09-25-knowledge-quick-legacy-copy

## 功能需求（成功标准机械摘录）
<!-- MACHINE-DRAFT:requirements-frs:d0cbdebb2363da3efcf804cebc673bea0d8fcb44e3a5193e2db8121067450c45:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-knowledge-quick-legacy-copy 留痕重锚 -->
### FR-01: precipitate-dialog「快速修复」蒸馏源分段带存量标注，空态文案不
Given 平台按当前契约运行
When 本变更交付并运行
Then precipitate-dialog「快速修复」蒸馏源分段带存量标注，空态文案不再引导产生新 quick 条目

### FR-02: distill-task-bar 与 distill-history-dialo
Given 平台按当前契约运行
When 本变更交付并运行
Then distill-task-bar 与 distill-history-dialog 的 quick 相关文案带存量口径

### FR-03: knowledge/page.tsx 头部过时注释更新（快速修复 tab 已是存
Given 平台按当前契约运行
When 本变更交付并运行
Then knowledge/page.tsx 头部过时注释更新（快速修复 tab 已是存量口径）

### FR-04: 聚焦验证（tsc + 相关组件测试）全绿，存量蒸馏功能行为零改动（纯文案面）
Given 平台按当前契约运行
When 本变更交付并运行
Then 聚焦验证（tsc + 相关组件测试）全绿，存量蒸馏功能行为零改动（纯文案面）
<!-- MACHINE-DRAFT:requirements-frs:end -->

<!--AGENT:槽1 需求例外裁决（FR 语义改写不走此槽——直接编辑机器段后跑 flow amend-draft 留痕，槽内容不进 FR 索引）——例外裁决书写面（机器段之外合法） -->

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx（D-010 分组全组覆盖分段渲染与提示文案；:509 子串断言兼容新文案）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx:344（断言「正在从 2 条快速修复记录（存量）提炼知识」新口径）+ frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx:82（断言「快速修复（存量） · 2 条记录」）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
不适用：注释级变更无运行时行为；tsc --noEmit 覆盖语法面（exit 0 回执 .sillyspec/.runtime/logs/c1-tsc.log）。

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend tsc --noEmit exit 0 + vitest 三组件（precipitate-dialog/distill-task-bar/distill-history-dialog）38 passed——回执 .sillyspec/.runtime/logs/c1-tsc.log 与 c1-test.log。
