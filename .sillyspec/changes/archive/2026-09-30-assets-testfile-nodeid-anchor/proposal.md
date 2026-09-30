---
author: flow-machine-draft
created_at: 2026-09-30T01:36:37.062Z
---
# 提案书（Proposal）— 2026-09-30-assets-testfile-nodeid-anchor

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:6d613a7eba4144a2e0e6b72ea7df9d65196bf64f03195ad4e0209a0039922921:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
任务原话转写：变更详情「沉淀资产」测试绑定行，对含 :: 用例锚（pytest 节点 ID）的记录串误报「未在仓库中找到该测试文件」——2026-09-30-title-adopt-clobber-guard 归档件实证，文件实际存在。根因：读侧剥锚 normalizeTestFilePath 只实现了「」形态，未跟上 2026-09-26-binding-anchor-fidelity 落定的用例锚四形态契约（「」组/::/#/>），锚后粘联的全角括号注解残段也未剥，整串进 basename 必零命中。

成功标准：
- 记录串含 :: 用例锚（file::Class::method 形）时，点开测试文件弹窗按剥锚后纯路径搜索并等值/后缀命中，预览仓库内真实文件，不再零命中误报
- 锚后粘联的全角括号注解残段（未闭合截断形与闭合形）一并剥除，不影响搜索与路径比较
- # 与 > 两形态锚同样剥除（四形态契约对齐），既有「」剥离、短路径/反斜杠/点斜杠归一与 worktree 副本排除行为不回退，存量用例全绿
- 新增单元测试覆盖 :: 锚、括号残段、井号与大广于锚（含本轮生产实证串），并断言搜索入参为剥锚后干净 basename
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:3118f3513fcc33b268809193995f987e99348efb50cad1e9222e0ea57e09736e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
按成功标准机械推导，共 3 条验收面：
1. 记录串含 :: 用例锚（file::Class::method 形）时，点开测试文件弹窗按剥锚后纯路径搜索并等值/后缀命中，预览仓库内真实文件，不再零命中误报
2. 锚后粘联的全角括号注解残段（未闭合截断形与闭合形）一并剥除，不影响搜索与路径比较
3. 新增单元测试覆盖 :: 锚、括号残段、井号与大广于锚（含本轮生产实证串），并断言搜索入参为剥锚后干净 basename
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:b69491ff51a2fc563847e3e8c9daf35573a7cdcf523eaa3a387d1b20530ddc69:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
1. 记录串含 :: 用例锚（file::Class::method 形）时，点开测试文件弹窗按剥锚后纯路径搜索并等值/后缀命中，预览仓库内真实文件，不再零命中误报
2. 锚后粘联的全角括号注解残段（未闭合截断形与闭合形）一并剥除，不影响搜索与路径比较
3. 新增单元测试覆盖 :: 锚、括号残段、井号与大广于锚（含本轮生产实证串），并断言搜索入参为剥锚后干净 basename
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
