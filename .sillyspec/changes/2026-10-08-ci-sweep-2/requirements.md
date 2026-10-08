---
author: flow-machine-draft
created_at: 2026-10-08T15:12:55.373Z
---
# 需求规格（Requirements）— 2026-10-08-ci-sweep-2

## 功能需求

### FR-01: git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿

- TABS 数量断言必须等于 16（知识图谱页签插入后），「Git 日志」仍必须为末位且 href=/git-log；用例名与头注释必须同步改 16。

#### 场景：主路径

Given WorkspaceTabs 注册 16 键（知识图谱插知识库后）/ When 渲染取 link / Then toHaveLength(16) 且 Git 日志末位。

### FR-02: test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿

- failed 分支 error_detail 期望必须等于新契约（reason/finished_by 两键），禁止 钉旧 startup_cleanup 文案；断言处必须注释溯源评审 P3 文案变更。

#### 场景：主路径

Given 无可恢复元数据的 stale run / When _cleanup_stale_runs_impl 执行 / Then error_detail 等于新文案两键。

### FR-03: sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿

- 心跳 mock 调用长度断言必须 为 11（machine-id 尾参平铺形态），8 处 必须 带 d6fabf408 尾参注释；ql-20260909 的「10 参」注释块必须 更新为 11 参演进链。

#### 场景：主路径

Given 心跳 11 参平铺（第 11 machineId，undefined 占位）/ When 断言 call.length / Then toBe(11) 且第 7 参槽位不变。

### FR-04: provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿

- 词表解析正则必须 匹配 agent_kinds: list[Literal[...]] 复数形态（仍取首处声明），失配 必须 响亮抛错（防哑绿保留）；注释 必须 记录单数→复数形态变更溯源。

#### 场景：主路径

Given backend schema 字段为复数 list Literal / When readBackendAgentKindVocab 解析 / Then 词表=["claude","pi","codex"] 且 ⊆ 聚合表键夹逼通过。

### FR-05: 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿

- 本地必须 只跑相关文件（daemon 3 文件 59 用例 + backend 1 文件 2 用例 + frontend 2 文件 13 用例 + 三端 lint/tsc 门）且全绿，全量必须 留给 CI；推送后五个 workflow 必须 全绿。

#### 场景：主路径

Given 修复落地 / When 本地相关面跑测 / Then 全绿；When push / When 五 workflow 完成 / Then 全部 success。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/git-log/__tests__/git-log-page.test.tsx「TABS 增至 16 项，「Git 日志」末位且 href 为 /git-log」
FR-02: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」
FR-03: sillyhub-daemon/tests/sillyspec-platform-command.test.ts「task-07 心跳携带…」全套件 + sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts「路径④ pending 可见性闭环」
FR-04: sillyhub-daemon/tests/provider-adapter-registry.test.ts「backend agent_kind 词表（源读取解析）⊆ 聚合表键（backend 可下发 kind 必有声明）」
FR-05: 不适用：CI 门（本地相关面绿已实证 daemon 59 + backend 2 + frontend 13 + 三端 tsc/ruff/eslint 0；五 workflow 全绿以推送后 Actions 实跑为准，盯到全绿）
