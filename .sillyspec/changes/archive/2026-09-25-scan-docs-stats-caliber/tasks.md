---
author: flow-machine-draft
created_at: 2026-09-25T09:06:46.577Z
---
# 任务注册表（Tasks）— 2026-09-25-scan-docs-stats-caliber

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

<!-- MACHINE-DRAFT:tasks-rows:56980b3aa1dde58777953ae515732adc8043ea69274116e371b940f749f83b73:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
- [x] task-01: 模块层覆盖率的实有分子只数 modules/ 下的模块文档：排除 _module-map.yaml 与 *.change
- [x] task-02: 陈旧清单 / 新鲜度 / 8 周趋势 / 最近更新榜四处改用 source_mtime 优先、为空时回落 last_mo
- [x] task-03: 有效时间口径抽成一个 helper 并在 stats 内单点使用，避免四处各写一遍再漂移
- [x] task-04: 新增单测：① modules/ 内 .changelog.md 不计入 module_have
- [x] task-05: ② source_mtime 与 last_modified_at 不一致时四处指标按 source_mtime 判定（
- [x] task-06: 既有 scan_docs 模块测试零回归
<!-- MACHINE-DRAFT:tasks-rows:end -->

