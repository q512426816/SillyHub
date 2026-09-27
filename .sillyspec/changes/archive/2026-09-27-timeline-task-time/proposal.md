---
author: flow-machine-draft
created_at: 2026-09-27T14:21:02.876Z
---
# 提案书（Proposal）— 2026-09-27-timeline-task-time

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:f78b4664628adc1c36c521d15e28ec9ab8e3fadd55b40e5f6cf5159d37a8f5c2:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
任务原话转写：平台合成时间线卡的任务面只有勾选态+描述+提交锚，没有每任务勾选时刻（CLI watcher timeline 有 ≈翻格顺序推断，平台未复刻）——事件已回填平台库，推断有数据可依
成功标准：
- TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、尾部未勾不标断裂——CLI inferFlipTimes 同款语义，detail 兼容 stage 前缀格式）
- 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
- openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:77725c7d516b485baedfe66fbc062c9abb9adf480e2b4de42654db897a559839:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
按成功标准机械推导，共 3 条验收面：
1. TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、尾部未勾不标断裂——CLI inferFlipTimes 同款语义，detail 兼容 stage 前缀格式）
2. 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
3. openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:628bad2e79cb1a1790ba49c0752d37e701fad859d2b5f54f55690edb97d1f7a9:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-task-time 留痕重锚 -->
1. TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、尾部未勾不标断裂——CLI inferFlipTimes 同款语义，detail 兼容 stage 前缀格式）
2. 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
3. openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
