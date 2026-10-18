---
author: flow-machine-draft
created_at: 2026-10-18T13:39:27.067Z
---
# 提案书（Proposal）— 2026-10-18-change-list-type-filter

## 动机

任务原话转写：变更列表加类型标签与类型筛选

动机：变更类型 git 惯用前缀通道已上线（详情页类型行彩色标签 + 426 个存量回填），但变更中心列表页看不到类型信息、也无筛选入口。列表行加同源类型标签、筛选栏加类型下拉，与既有分类（出身）筛选正交组合。

成功标准：
- 后端 list_ 与 GET /changes 新增 change_type 筛选参数：白名单（conventional 前缀 + feature/prototype/quick 旧值），feat 筛选等价命中旧值 feature（与显示层映射口径一致），未知/缺省值不过滤
- CommitTypeChip 从详情页抽为公共组件，列表行 meta 行 change_key 后复用渲染类型彩色标签（含 feature→feat 显示映射、空值零占位）
- 前端筛选栏新增「类型」下拉（全部类型/feat/fix/docs/chore/test/refactor/perf/build/style/原型），URL 参数 type 持久化、tab 切换随既有筛选一并回默认、与 tab/搜索/分类/聚焦组合生效
- 聚焦测试：后端 change_type 筛选用例（feat 等价命中 feature、未知值不过滤）+ 前端列表页筛选与行标签用例全绿；tsc 通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 后端 list_ 与 GET /changes 新增 change_type 筛选参数：白名单（conventional 前缀 + feature/prototype/quick 旧值），feat 筛选等价命中旧值 feature（与显示层映射口径一致），未知/缺省值不过滤
2. CommitTypeChip 从详情页抽为公共组件，列表行 meta 行 change_key 后复用渲染类型彩色标签（含 feature→feat 显示映射、空值零占位）
3. 前端筛选栏新增「类型」下拉（全部类型/feat/fix/docs/chore/test/refactor/perf/build/style/原型），URL 参数 type 持久化、tab 切换随既有筛选一并回默认、与 tab/搜索/分类/聚焦组合生效
4. 聚焦测试：后端 change_type 筛选用例（feat 等价命中 feature、未知值不过滤）+ 前端列表页筛选与行标签用例全绿；tsc 通过

## 成功标准（可验证）

1. 后端 list_ 与 GET /changes 新增 change_type 筛选参数：白名单（conventional 前缀 + feature/prototype/quick 旧值），feat 筛选等价命中旧值 feature（与显示层映射口径一致），未知/缺省值不过滤
2. CommitTypeChip 从详情页抽为公共组件，列表行 meta 行 change_key 后复用渲染类型彩色标签（含 feature→feat 显示映射、空值零占位）
3. 前端筛选栏新增「类型」下拉（全部类型/feat/fix/docs/chore/test/refactor/perf/build/style/原型），URL 参数 type 持久化、tab 切换随既有筛选一并回默认、与 tab/搜索/分类/聚焦组合生效
4. 聚焦测试：后端 change_type 筛选用例（feat 等价命中 feature、未知值不过滤）+ 前端列表页筛选与行标签用例全绿；tsc 通过
