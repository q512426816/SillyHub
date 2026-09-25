---
author: flow-machine-draft
created_at: 2026-09-25T09:06:46.576Z
---
# 提案书（Proposal）— 2026-09-25-scan-docs-stats-caliber

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:eb61998d26d801b13afea113085003eea3c6d44c225c245c65bf627fe488e529:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
任务原话转写：动机：扫描文档页两个统计口径与设计意图不符——① 模块层覆盖率把 modules/ 下的 *.changelog.md 变更日志也算作模块文档，分子虚高（生产实测 module_have 245 > module_expected 240，覆盖率显示 120%）；② 陈旧/新鲜/最近更新/周趋势全部用 last_modified_at（镜像文件 mtime），而 spec 同步会重写镜像 mtime（合并/同步当天全量"新鲜"、陈旧恒 0 条），设计里真正的源文件时间是 source_mtime（spec_workspace/schema.py 已注明用途）。

成功标准：
- 模块层覆盖率的实有分子只数 modules/ 下的模块文档：排除 _module-map.yaml 与 *.changelog.md，使 module_have 不再虚高（同一工作区应满足 have ≤ expected）
- 陈旧清单 / 新鲜度 / 8 周趋势 / 最近更新榜四处改用 source_mtime 优先、为空时回落 last_modified_at 的有效时间口径
- 有效时间口径抽成一个 helper 并在 stats 内单点使用，避免四处各写一遍再漂移
- 新增单测：① modules/ 内 .changelog.md 不计入 module_have；② source_mtime 与 last_modified_at 不一致时四处指标按 source_mtime 判定（含 source_mtime 缺失回落 last_modified_at 的对照）
- 既有 scan_docs 模块测试零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:c002e2a5c2f983d1c802b4b3e4b98d0add902c5546f0c245640526d671906d51:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
按成功标准机械推导，共 6 条验收面：
1. 模块层覆盖率的实有分子只数 modules/ 下的模块文档：排除 _module-map.yaml 与 *.changelog.md，使 module_have 不再虚高（同一工作区应满足 have ≤ expected）
2. 陈旧清单 / 新鲜度 / 8 周趋势 / 最近更新榜四处改用 source_mtime 优先、为空时回落 last_modified_at 的有效时间口径
3. 有效时间口径抽成一个 helper 并在 stats 内单点使用，避免四处各写一遍再漂移
4. 新增单测：① modules/ 内 .changelog.md 不计入 module_have
5. ② source_mtime 与 last_modified_at 不一致时四处指标按 source_mtime 判定（含 source_mtime 缺失回落 last_modified_at 的对照）
6. 既有 scan_docs 模块测试零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:fd4064f9758400239f783758dc5c8e2511b6d684bd02d344945833fed7fed67f:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-scan-docs-stats-caliber 留痕重锚 -->
1. 模块层覆盖率的实有分子只数 modules/ 下的模块文档：排除 _module-map.yaml 与 *.changelog.md，使 module_have 不再虚高（同一工作区应满足 have ≤ expected）
2. 陈旧清单 / 新鲜度 / 8 周趋势 / 最近更新榜四处改用 source_mtime 优先、为空时回落 last_modified_at 的有效时间口径
3. 有效时间口径抽成一个 helper 并在 stats 内单点使用，避免四处各写一遍再漂移
4. 新增单测：① modules/ 内 .changelog.md 不计入 module_have
5. ② source_mtime 与 last_modified_at 不一致时四处指标按 source_mtime 判定（含 source_mtime 缺失回落 last_modified_at 的对照）
6. 既有 scan_docs 模块测试零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
