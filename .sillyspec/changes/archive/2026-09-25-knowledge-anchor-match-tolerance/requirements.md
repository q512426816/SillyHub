---
author: flow-machine-draft
created_at: 2026-09-25T08:42:20.106Z
---
# 需求规格（Requirements）— 2026-09-25-knowledge-anchor-match-tolerance

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: 命中锚点归一回退匹配

- Given：命中遥测 `matchedFiles` 的锚点是 CLI 写 INDEX 路由行时的原样字符串，条目锚点是平台按
  当前文件标题现算的 slug，两侧存在三类系统性规则漂移（emoji 前缀、点号保留、短横折叠）
- When：`GET /workspaces/{id}/knowledge/stats` 聚合同工作区的命中行
- Then：命中锚点先精确比对条目锚点（结果与改动前逐字一致）；精确未中时按归一键（小写 + 仅保留
  `0-9a-z_` 与中文）回退到唯一候选条目锚点，聚合键即条目锚点

### FR-02: 歧义与真实内容漂移保守处理

- Given：归一键映射到 ≥2 个条目锚点（归一后碰撞），或映射不到任何条目（标题被改过的内容漂移）
- When：同一次聚合处理该类命中锚点
- Then：不猜测——保持原锚点原样进榜（可见性不丢），但既不计入覆盖率分子，也不从死条目清单消掉

### FR-03: 四项数值统一用解析后锚点

- Given：覆盖率分子、死条目清单、使用率榜、文件级计数四个消费面
- When：命中锚点完成解析（含回退）
- Then：四项均以解析后的锚点归属计算，同一份数据下四项互相自洽；HTTP DTO/字段/前端零变化

### FR-04: 存量真实数据复算收益

- Given：本仓本地知识树 + 3760 行真实命中遥测（`.sillyspec/.runtime/knowledge-hits.jsonl`）
- When：用出厂 `anchor_match_key` 复算可归属率与歧义数
- Then：可归属率 87.4% → 98.7%（+3234 次），歧义锚点 0 个；CLI 仓同口径复算不误认（+1 次，
  其漂移属知识面换代非规则差异）

### FR-05: 单测覆盖三类漂移与两条边界

- Given：emoji 前缀 / 点号保留 / 短横折叠三类真实漂移样本，以及精确命中与歧义两态
- When：跑知识模块单测
- Then：归一键单测钉三类样本同键 + 反向（真实内容不同不同键）；聚合集成测试钉漂移归位、精确优先、
  歧义不认、榜单保留原锚点四态

### FR-06: 既有行为零回归

- Given：知识模块既有 124 个用例（含 hits 手算复算、parser slug 校准、路由鉴权）
- When：跑 `cd backend && uv run pytest app/modules/knowledge -q --no-cov`
- Then：全绿（当前 126 passed = 基线 124 + 本变更新增 2）
<!--
参考摘录（非约束——agent 可采纳/改写/忽略；每条格式 ### FR-NN: 标题 + Given/When/Then）
FR-01: 命中锚点与条目锚点匹配改为「精确优先 + 归一化回退」，归一键=小写且仅保留 0-9a-z_ 与中文（丢 emoji/点号/短横/斜杠等符号）
FR-02: 归一化后出现多候选（歧义）时不猜测，仍按未命中处理（保守，绝不虚增覆盖）
FR-03: 覆盖率分子/死条目清单/使用率榜/文件级计数四项统一用解析后的锚点归属，页面四项数字互相自洽
FR-04: 平台仓本地真实数据实测：命中可归属率 87.4% → 98.7%（+3234 次），歧义锚点 0 个
FR-05: 新增单测覆盖：emoji 前缀、点号保留、短横折叠三类真实漂移样本各一条 + 精确优先 + 歧义保守共三态
FR-06: 既有知识模块测试零回归（基线 124 passed）
-->


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/knowledge/tests/test_parser.py::test_anchor_match_key_normalizes_cross_rule_drift（三类漂移同键）+ tests/test_hits.py::test_stats_anchor_drift_tolerant_matching（聚合面归位）


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_anchor_drift_tolerant_matching（歧义锚 conventions.md#foo.bar 与内容漂移锚均不计命中且榜单保留原锚点；内容漂移小节仍列死条目）


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_hits.py::test_stats_anchor_drift_tolerant_matching（used_entries=3/6、dead_entries 三条、usage_board 五个锚点键、entry_counts 两行——四项同一次断言内自洽）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
不适用：该条是存量数据复算（脚本 .tmp-analysis/measure_normalize.py，消费出厂 anchor_match_key 跑真实 3760 行命中），非 pytest 用例面；单测面由 FR-01/FR-02 覆盖


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
tests/test_parser.py::test_anchor_match_key_normalizes_cross_rule_drift + tests/test_hits.py::test_stats_anchor_drift_tolerant_matching


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
定向回归命令 cd backend && uv run pytest app/modules/knowledge -q --no-cov（126 passed；基线 124）

