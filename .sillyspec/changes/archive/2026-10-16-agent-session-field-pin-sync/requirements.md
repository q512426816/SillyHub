---
author: flow-machine-draft
created_at: 2026-10-16T11:14:00.159Z
---
# 需求规格（Requirements）— 2026-10-16-agent-session-field-pin-sync

## 功能需求

### FR-01: backend/app/modules/agent/tests/test_agent_session_model.py 期望字段集补 title_fallback（含来源注释），字段数断言 34→35

- 钉子测试的期望字段集**必须**包含 `title_fallback`（附 mem-polling task-08 来源注释），字段数断言**必须**与 `AgentSession.model_fields` 实际数量一致（35）；用例名**必须**同步为 `test_agent_session_has_all_35_fields`（名字即契约，禁止残留旧数值）。

#### 场景：主路径

Given AgentSession 模型（含 title_fallback 列，共 35 字段）
When 运行 `test_agent_session_has_all_35_fields`
Then 断言通过，missing/extra 均为空集

### FR-02: 该测试单跑通过；删除 .sillyspec/local.yaml 中 '^E\s+AssertionError: AgentSession field mismatch' 豁免行后质量扫描不再依赖豁免

- 移除该豁免行后，钉子测试**必须**全绿（12 passed），质量扫描**禁止**再因该断言失败或依赖豁免放行。

#### 场景：主路径

Given local.yaml 已删除 `^E\s+AssertionError: AgentSession field mismatch` 豁免行
When 运行 `uv run pytest app/modules/agent/tests/test_agent_session_model.py -q`
Then 12 passed、0 failed

### FR-03: 不改任何模型/业务代码，仅测试与配置

- 本变更交付**禁止**触碰任何模型/业务代码——只允许改动 `test_agent_session_model.py`（测试）与 `local.yaml`（本地配置，gitignore 不进提交）。

#### 场景：主路径

Given 本变更交付完成
When 核对 git diff
Then 变更仅含 `backend/app/modules/agent/tests/test_agent_session_model.py` 一个文件（local.yaml 为本地件）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/agent/tests/test_agent_session_model.py「test_agent_session_has_all_35_fields」
FR-02: backend/app/modules/agent/tests/test_agent_session_model.py「test_agent_session_has_all_35_fields」（单文件整跑 12 passed，豁免行已删除的配置态由 flow done 实测核）
FR-03: 不适用：纯范围约束（git diff 面核对），无可执行测试单元
