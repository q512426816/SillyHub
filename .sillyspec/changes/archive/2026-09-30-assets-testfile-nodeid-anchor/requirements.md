---
author: flow-machine-draft
created_at: 2026-09-30T01:36:37.063Z
---
# 需求规格（Requirements）— 2026-09-30-assets-testfile-nodeid-anchor

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: `::` 用例锚剥离——pytest 节点 ID 记录串可定位真实文件
Given 变更详情「沉淀资产」卡渲染归档 test-trace 的测试绑定行，tests[] 条目为 `file::Class::method` 形整串（pytest 节点 ID，生产实证：2026-09-30-title-adopt-clobber-guard 归档件）
When 用户点开该测试文件
Then 归一层剥掉 `::` 起的用例锚得到纯路径，按干净 basename 发起 explorer search 并等值/后缀命中，弹窗预览仓库内真实文件——不再恒显「未在仓库中找到该测试文件」误报（文件实际存在）

### FR-02: 锚后粘联的全角括号注解残段一并剥除
Given tests[] 条目的用例锚后粘联全角括号注解残段——flow done 摘录按空白切 token 产生的未闭合截断形（如 `test_x（documents`），或闭合形（`（…）`）
When 归一层剥锚
Then 残段随锚一并剥除得到纯路径，不影响 basename 搜索入参与路径等值/后缀比较

### FR-03: `#` 与 `>` 形态锚同样剥除（四形态契约对齐）且既有归一行为不回退
Given tests[] 条目按 2026-09-26-binding-anchor-fidelity 契约带锚原样收录，锚形态共四种（「」组 / `::` / `#` / `>`）
When 归一层剥锚
Then `#`/`>` 形态与 `::` 同归纯路径；既有「」注解剥离、反斜杠/`./` 归一、短路径唯一后缀救回与 worktree 副本排除行为全部保持（存量路径解析用例全绿）

### FR-04: 单元测试覆盖四形态锚与括号残段剥离
Given change-assets-card 组件测试套件
When 覆盖 `::` 锚（含本轮生产实证串）、全角括号残段（截断形与闭合形）、`#`/`>` 锚
Then 断言 explorer search 入参为剥锚后干净 basename、弹窗预览真实路径；存量用例不回退

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「:: 用例锚（pytest 节点 ID）剥离：按纯路径等值命中预览，无重定向注记」

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「:: 锚后粘联全角括号残段（截断未闭合形）一并剥离（生产实证串）」
- frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「闭合形全角括号注解粘联（无锚界符）同样剥除」

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「# 与 > 形态锚剥离：同归纯路径，短路径唯一后缀救回」
- backend 无涉；存量不回退由同套件「ChangeAssetsCard 测试文件路径解析」既有用例整组保证

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「2026-09-30-assets-testfile-nodeid-anchor 新增四用例（:: 锚/截断残段/闭合残段/#> 锚）整体」
