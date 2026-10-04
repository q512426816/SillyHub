---
author: flow-machine-draft
created_at: 2026-10-04T14:02:30.626Z
---
# 需求规格（Requirements）— 2026-10-04-takeover-tier3-agent-cwd-fallback

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主日志优先，缺省任一条目）参与 tier3 匹配
Given 系统就绪
When resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主
Then 行为符合本条标准描述

### FR-02: 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手
Given 系统就绪
When 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手
Then 行为符合本条标准描述

### FR-03: 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）
Given 系统就绪
When 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）
Then 行为符合本条标准描述

### FR-04: 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿
Given 测试 相关模块就绪
When 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_fallback_entry_agent_cwd（回退命中）+ test_tier3_fallback_prefers_main_log_entry（主日志优先/subagent 排除）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_fallback_entry_agent_cwd（会话行 cwd 空 + entry agent_cwd 唯一覆盖 + zcode handoff 档 → 201）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_no_cwd_anywhere_409（全空 cwd → 409「未携带机器身份」+ 目录「未知」）+ 既有 test_tier4_no_match_409_with_machine_name 回归

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py 全量 19 用例（含 3 个新增回退用例）绿