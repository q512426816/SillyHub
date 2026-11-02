---
author: flow-machine-draft
created_at: 2026-11-02T01:26:08.615Z
---
# 需求规格（Requirements）— 2026-11-02-stale-test-sync-contract

## 功能需求

### FR-01: 7 个 placeholder 主题用例改用日期前缀键（形如 2026-10-27-xxx，符合新契约合法名）后，占位行创建/change link/跨区 D-004/降级语义等原断言全部恢复且通过——测试验证的仍是占位与绑定行为本身，非快照现状

- 测试用的 change_key **必须**形如 `YYYY-MM-DD-<desc>`（1015aa22f 契约下绑定通道唯一接受建占位的名字形态）；各用例原行为断言（占位行数/link 落点/跨区隔离/降级不改目标区）**必须**逐条保留并恢复通过；**禁止**把「占位被拒后断言空集」的退化形态当作修复。

#### 场景：push 条目 change_key 建占位与 link

- Given push 上行 entries 携带日期前缀 change_key（目标区无同名行）
- When ingest 消费并触发绑定
- Then 占位 Change 行创建、change_session_links 落到正确会话/工作区——与 1015aa22f 之前该用例验证的行为一致

### FR-02: 2 个 messages 用例按新 schema 把 bg_task_final 纳入精确断言（item dict 增 bg_task_final: None / openapi properties 集合增 bg_task_final）后通过

- test_agent_log_messages.py 的 messages[0] 整包 dict 断言**必须**含 `"bg_task_final": None`；openapi 暴露用例的 properties 全集断言**必须**纳入 `bg_task_final`；其余字段断言**禁止**放松（保持整包精确形态防字段漂移再次漏检）。

#### 场景：schema 新字段进精确断言

- Given cdcb97fdb 后 AgentLogMessageItem 含 bg_task_final 可选字段（缺省 None）
- When /messages 端点返回 items、openapi 导出 schema
- Then 两用例精确断言（含新字段）通过，且若未来再增字段两类断言仍会红（防漏检性质保留）

### FR-03: tagging 回滚用例 monkeypatch 缝换为 resolve_session_provider_config 后恢复 DID raise 语义并通过（回滚断言原样保留）

- patch 目标**必须**改为生产实际入口 `app.modules.daemon.lease.context.resolve_session_provider_config`；`pytest.raises(DaemonSessionConfigInvalid)` 与事务回滚断言（无新 run/objective 占位不变/turn_count 不变）**禁止**改动。

#### 场景：切换轮解析破裂回滚

- Given 合法供应商 + patch 令 resolve_session_provider_config 返回 None
- When inject_session 切换轮
- Then DaemonSessionConfigInvalid 抛出，事务回滚断言全过

### FR-04: 触及的四个测试文件全量绿；platform_sync + daemon 注入相邻面零回归（CLI 亲测）

- 四个测试文件（test_agent_log_push / test_agent_log_messages / test_session_service / test_inject_orchestrator_tagging）**必须**全量通过；相邻面（platform_sync 全目录 + daemon tests test_inject_orchestrator* / test_session_switch_config）零新增失败；backend 触及文件 ruff/format 零告警。

#### 场景：收口实测

- Given 三簇修复全部落地
- When CLI 收口实测对账
- Then 触及面全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/app/modules/platform_sync/tests/test_agent_log_push.py「6 个 push 用例（日期前缀键后恢复占位/link/降级断言）」
FR-01: test/backend/app/modules/daemon/tests/test_session_service.py「TestInjectSessionBinding::test_bind_cross_workspace_only_placeholder_in_session_workspace（D-004 跨区语义）」
FR-02: test/backend/app/modules/platform_sync/tests/test_agent_log_messages.py「TestStatusLayering::test_parsed_200_camelcase_to_snake_case / TestOpenapiExposure::test_openapi_exposes_messages_schemas」
FR-03: test/backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py「TestSameTransactionAtomicity::test_late_failure_rolls_back_tag_and_backfill」
FR-04: 不适用：回归伞由 FR-01~03 绑定用例 + 收口 CLI 亲测对账覆盖
