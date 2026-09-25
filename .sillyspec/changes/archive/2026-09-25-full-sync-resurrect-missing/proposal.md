---
author: flow-machine-draft
created_at: 2026-09-25T12:38:54.861Z
---
# 提案书（Proposal）— 2026-09-25-full-sync-resurrect-missing

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:7d4b709629b6ee60871dd9402e447ee52001486e692ed82bebcf9dfd7fb90a5b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
任务原话转写：动机：spec 全量同步（POST /spec-workspace/sync 整树覆盖）的逐文件循环在「scan_documents 既有行内容哈希相同」时直接 continue 不落盘——该跳过隐含「磁盘已有该文件」假设。生产 c84182bc 实证：镜像缺 16 个知识文件，重推全量 tar 后仍缺（行存在、哈希相同、磁盘无文件 / 行软删 exists=False 的幽灵态），全量推送永远修不回，页面数据持续残缺。

成功标准：
- 同内容跳过分支增加「磁盘已有该文件且行在线（exists=True）」前提；磁盘缺失或行软删时按复活语义落盘（move 文件 + 行翻回 exists=True），不再要求 mtime 更新才写
- 复活时内容一致的文件不产生冲突归档行（内容相同无冲突可言）；内容不同仍走既有冲突归档
- 新增单测：①幽灵软删行（exists=False 且哈希相同）+ 磁盘缺文件 → 落盘且行翻回在线；②磁盘缺文件但哈希相同（行在线）→ 落盘；③正常「哈希相同且磁盘已有」仍跳过（零回归钉死）
- 既有 spec_workspace 全量同步测试零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:b4774cd6ce27be77c951f550d047cbd48f3f8a7cc12229eadaa12ebe6fc32458:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
按成功标准机械推导，共 8 条验收面：
1. 同内容跳过分支增加「磁盘已有该文件且行在线（exists=True）」前提
2. 磁盘缺失或行软删时按复活语义落盘（move 文件 + 行翻回 exists=True），不再要求 mtime 更新才写
3. 复活时内容一致的文件不产生冲突归档行（内容相同无冲突可言）
4. 内容不同仍走既有冲突归档
5. 新增单测：①幽灵软删行（exists=False 且哈希相同）+ 磁盘缺文件 → 落盘且行翻回在线
6. ②磁盘缺文件但哈希相同（行在线）→ 落盘
7. ③正常「哈希相同且磁盘已有」仍跳过（零回归钉死）
8. 既有 spec_workspace 全量同步测试零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:658b91f1b0762be391337b9d301f90afecce9011fc09e7f17371df032ed179f6:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-full-sync-resurrect-missing 留痕重锚 -->
1. 同内容跳过分支增加「磁盘已有该文件且行在线（exists=True）」前提
2. 磁盘缺失或行软删时按复活语义落盘（move 文件 + 行翻回 exists=True），不再要求 mtime 更新才写
3. 复活时内容一致的文件不产生冲突归档行（内容相同无冲突可言）
4. 内容不同仍走既有冲突归档
5. 新增单测：①幽灵软删行（exists=False 且哈希相同）+ 磁盘缺文件 → 落盘且行翻回在线
6. ②磁盘缺文件但哈希相同（行在线）→ 落盘
7. ③正常「哈希相同且磁盘已有」仍跳过（零回归钉死）
8. 既有 spec_workspace 全量同步测试零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
