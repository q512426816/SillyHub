---
author: flow-machine-draft
created_at: 2026-10-18T13:39:27.068Z
---
# 任务注册表（Tasks）— 2026-10-18-change-list-type-filter

- [x] task-01: 后端 list_ 与 GET /changes 新增 change_type 筛选参数：白名单（conventional 前缀 + feature/prototype/quick 旧值），feat 筛选等价命中旧值 feature（与显示层映射口径一致），未知/缺省值不过滤
- [x] task-02: CommitTypeChip 从详情页抽为公共组件，列表行 meta 行 change_key 后复用渲染类型彩色标签（含 feature→feat 显示映射、空值零占位）
- [x] task-03: 前端筛选栏新增「类型」下拉（全部类型/feat/fix/docs/chore/test/refactor/perf/build/style/原型），URL 参数 type 持久化、tab 切换随既有筛选一并回默认、与 tab/搜索/分类/聚焦组合生效
- [x] task-04: 聚焦测试：后端 change_type 筛选用例（feat 等价命中 feature、未知值不过滤）+ 前端列表页筛选与行标签用例全绿；tsc 通过
