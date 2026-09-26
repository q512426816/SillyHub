---
author: flow-machine-draft
created_at: 2026-09-26T11:47:46.139Z
---
# 提案书（Proposal）— 2026-09-26-knowledge-card-machine-block

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:e281ad29e0ff8fe57720e5af1e9052efdea7cf3166ee9b42ebab364746223062:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
任务原话转写：动机：知识库卡片视图把「测试绑定」机器管理块（test-bindings 注释行 + - row: YAML 行）当正文裸露渲染，原文视图里注释行不可见，两个视图口径不一致，用户看到机器 YAML 倾泻以为内容错了（生产实证：dogfood 工作区 knowledge/fr/cli-entry.md 的 FR-009/010 条目卡）。
成功标准：
- 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）
- 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tests 路径与 state，不再整块 YAML 倾泻
- 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格
- 无机器块的既有条目（decisions/fr/手册）渲染零回归；聚焦测试全绿 + tsc 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:dca32233f7a078e3f8490124ce27d804d0551712564e7749c4575a475d642aef:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）
2. 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tests 路径与 state，不再整块 YAML 倾泻
3. 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格
4. 无机器块的既有条目（decisions/fr/手册）渲染零回归
5. 聚焦测试全绿 + tsc 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:8e4799ad4795d9360e5adf3310321de72b881999e85908adb2207a03583db095:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-knowledge-card-machine-block 留痕重锚 -->
1. 卡片视图不再把整行 HTML 注释当正文渲染（与原文视图口径一致：注释不可见）
2. 测试绑定机器块（注释标记 + row 行 + 缩进键值行）解析为结构化数据，以紧凑只读行展示 tests 路径与 state，不再整块 YAML 倾泻
3. 机器块的「测试绑定：」空字段头不再以悬空空值字段行出现在字段网格
4. 无机器块的既有条目（decisions/fr/手册）渲染零回归
5. 聚焦测试全绿 + tsc 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
