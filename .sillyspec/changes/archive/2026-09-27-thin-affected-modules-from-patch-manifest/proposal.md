---
author: flow-machine-draft
created_at: 2026-09-27T14:11:35.876Z
---
# 提案书（Proposal）— 2026-09-27-thin-affected-modules-from-patch-manifest

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:8b2fad760672f1b1061af9a38c8714411428825acd77dae279b2c6360186a092:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
任务原话转写：轻量变更收口冻结的 change-patch.json 自带 files 文件清单（CLI 新旧格式都有），平台 parser 推断 affected_components 只认 module-impact.md 与 tasks.md 代码路径，thin 的 tasks.md 是成功标准镜像无路径，导致 38 个存量 thin 变更里 32 个影响模块恒空、列表/详情不显示。让 parser 增加 change-patch.json files 第三来源，存量件重新解析即可回填。
成功标准：
- _infer_affected_components 在 module-impact.md 与 tasks 路径两来源之外增加 change-patch.json files 清单来源，三者合并后走既有 module-map 匹配
- files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），其余代码路径直接参与前缀匹配
- change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错，module-impact.md 优先级与既有两来源行为零变化
- 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impact.md 优先回归，全部通过
- 既有 change 模块测试（test_parser.py 全量）零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:da969b24c2c8745a52f16ab1b96470482816645ae7a8038bf2dfbed7165c899f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. _infer_affected_components 在 module-impact.md 与 tasks 路径两来源之外增加 change-patch.json files 清单来源，三者合并后走既有 module-map 匹配
2. files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），其余代码路径直接参与前缀匹配
3. change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错，module-impact.md 优先级与既有两来源行为零变化
4. 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impact.md 优先回归，全部通过
5. 既有 change 模块测试（test_parser.py 全量）零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:c6f74aa0142e8e681a38766cc573ee5fe2bc658230240dc2d3593c196f62d5cd:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
1. _infer_affected_components 在 module-impact.md 与 tasks 路径两来源之外增加 change-patch.json files 清单来源，三者合并后走既有 module-map 匹配
2. files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），其余代码路径直接参与前缀匹配
3. change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错，module-impact.md 优先级与既有两来源行为零变化
4. 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impact.md 优先回归，全部通过
5. 既有 change 模块测试（test_parser.py 全量）零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
