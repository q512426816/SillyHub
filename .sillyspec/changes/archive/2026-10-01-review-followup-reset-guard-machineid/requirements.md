---
author: flow-machine-draft
created_at: 2026-10-01T11:23:25.837Z
---
# 需求规格（Requirements）— 2026-10-01-review-followup-reset-guard-machineid

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: reset_tool_report_session 会话查询补 deleted_at IS NULL
Given 测试 相关模块就绪
When reset_tool_report_session 会话查询补 deleted_at IS NULL 守卫，软删会话重置返回 404，与 takeover 同款
Then 行为符合本条标准描述

### FR-02: readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid 
Given 系统就绪
When readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid 形损坏覆写自愈，注释如实描述不再宣称原子落盘，附单测
Then 行为符合本条标准描述

### FR-03: 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-dae
Given 测试 相关模块就绪
When 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-daemon config-machine-id 用例），全部通过
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py::TestResetToolReport::test_reset_soft_deleted_session_rejected（软删会话重置 404，先红后绿）；回归面同文件 test_reset_rolls_back_to_pending / test_reset_running_rejected / test_reset_chat_session_rejected

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/config-machine-id.test.ts::readOrCreateMachineId 非 uuid 形半写残片自愈——不采纳残片，覆写为新 uuid（先红后绿）；回归面同文件既有三用例（生成幂等/既有文件优先/空白自愈）+ pnpm typecheck

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/daemon/tests/test_takeover.py 全文件 16 passed（uv run pytest）+ sillyhub-daemon/tests/config-machine-id.test.ts 4 passed（vitest）+ ruff 两触达文件 All checks passed；flow done 实测门 test: passed + lint: passed（test-result.json 留档）