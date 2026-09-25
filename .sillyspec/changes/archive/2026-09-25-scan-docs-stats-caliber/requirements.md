---
author: flow-machine-draft
created_at: 2026-09-25T09:06:46.577Z
---
# 需求规格（Requirements）— 2026-09-25-scan-docs-stats-caliber

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 模块层实有分子只数模块文档

- Given：`modules/` 目录下与模块卡成对存在 `*.changelog.md` 变更日志，以及 `_module-map.yaml` 登记表
- When：`GET /workspaces/{id}/scan-docs/stats` 计算模块层覆盖率实有分子
- Then：只有模块文档计入——`_module-map.yaml` 与 `*.changelog.md` 均排除，使同一工作区满足
  `module_have <= module_expected`（不再出现 120% 之类虚高）

### FR-02: 时间口径按源文件时间判定

- Given：`scan_documents` 同时有 `source_mtime`（源文件时间）与 `last_modified_at`（镜像 mtime，
  会被 spec 同步重写）
- When：stats 计算陈旧清单 / 新鲜度 / 8 周趋势 / 最近更新榜
- Then：四处统一按 `source_mtime` 优先、为空回落 `last_modified_at` 的有效时间判定，
  `source_mtime` 缺失的存量行行为与修正前一致

### FR-03: 有效时间口径单点实现

- Given：四处时间消费面
- When：后续维护或再次调整口径
- Then：只改 `_effective_mtime` 一个 helper（纯函数、含 tz 归一），四处不再各写一遍时间取值

### FR-04: 变更日志与登记表判定的纯函数

- Given：任意 `modules/` 下的路径（含包裹/扁平双布局）
- When：判断是否算模块文档
- Then：`_is_module_doc` 按尾段判定（`.md` + 非登记表 + 非排除后缀），无 I/O、无副作用

### FR-05: 单测覆盖两条修正与临界形态

- Given：模块层 changelog 样本、source_mtime 与 last_modified_at 不一致样本、两列皆空样本
- When：跑 scan_docs 单测
- Then：断言 module_have 排除 changelog；四处指标按有效时间判定；两列皆空仍判陈旧

### FR-06: 既有行为零回归

- Given：scan_docs 模块既有 71 个用例（含 stats 手算复算、注入聚合、路由）
- When：跑 `cd backend && uv run pytest app/modules/scan_docs -q --no-cov`
- Then：全绿（当前 73 passed = 基线 71 + 本变更新增 2）
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: 模块层覆盖率的实有分子只数 modules/ 下的模块文档：排除 _module-map.yaml 与 *.changelog.md，使 module_have 不再虚高（同一工作区应满足 have ≤ expected）
FR-02: 陈旧清单 / 新鲜度 / 8 周趋势 / 最近更新榜四处改用 source_mtime 优先、为空时回落 last_modified_at 的有效时间口径
FR-03: 有效时间口径抽成一个 helper 并在 stats 内单点使用，避免四处各写一遍再漂移
FR-04: 新增单测：① modules/ 内 .changelog.md 不计入 module_have
FR-05: ② source_mtime 与 last_modified_at 不一致时四处指标按 source_mtime 判定（含 source_mtime 缺失回落 last_modified_at 的对照）
FR-06: 既有 scan_docs 模块测试零回归
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/scan_docs/tests/test_stats.py::test_module_layer_excludes_changelog_docs


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_stats.py::test_stats_effective_mtime_prefers_source_mtime


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_stats.py::test_stats_effective_mtime_prefers_source_mtime（四处消费面同一次断言内比对，helper 单点即此测试的观察面）+ test_module_layer_excludes_changelog_docs


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_stats.py::test_module_layer_excludes_changelog_docs（_is_module_doc 经 stats 间接覆盖：_module-map.yaml 与 *.changelog.md 两类排除 + 模块卡保留）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_stats.py::test_module_layer_excludes_changelog_docs + tests/test_stats.py::test_stats_effective_mtime_prefers_source_mtime


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归命令 cd backend && uv run pytest app/modules/scan_docs -q --no-cov（73 passed；基线 71）

