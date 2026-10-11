---
author: flow-machine-draft
created_at: 2026-10-11T14:27:11.533Z
---
# 需求规格（Requirements）— 2026-10-11-ci-red-batch-fix

## 功能需求

### FR-01: backend tests/modules/agent/test_agent_run_log_tool_kind.py 定向 pytest 绿（PublishIntent 夹具补 duration_api_ms=None，21eb98d53 加必填位漏更夹具）

- PublishIntent 测试夹具必须携带 `duration_api_ms=None`（2026-10-10-live-token-speed-daemon-timing 将该字段加为必填位后，全部直接构造 PublishIntent 的测试夹具必须同步携带该参数），且 `tests/modules/agent/test_agent_run_log_tool_kind.py::test_session_channel_payload_contains_tool_kind` 定向 pytest 必须通过。

#### 场景：主路径

- Given：PublishIntent 构造签名含必填位 `duration_api_ms`（21eb98d53 引入）。
- When：以关键字参数构造 PublishIntent（夹具补 `duration_api_ms=None`）并执行 `publish_submitted_messages`。
- Then：session 频道 log 事件含 `tool_kind=skill` 与 `parent_tool_use_id`，pytest 绿。

### FR-02: backend tests/test_align_platform_change_events_migration.py 定向 pytest 绿（head 锚 20261010190000→c515ffd62859 并续写注释链，cc3c022b6 merge 迁移漏更锚）

- 迁移链尾锚测试的 head 断言必须随主线迁移接续前移：merge 迁移 `c515ffd62859`（2026-10-11-alembic-single-head-guard 并入）成为唯一 head 后，`tests/test_align_platform_change_events_migration.py::TestMigrationStructure::test_file_exists_and_single_head_chain` 必须断言 `heads[0] == "c515ffd62859"` 且注释链续写该锚来历，整文件定向 pytest 必须通过。

#### 场景：主路径

- Given：versions 目录含 merge 迁移 c515ffd62859（down_revision = 双头 20261011020000 + 20261011160000）。
- When：ScriptDirectory.get_heads 取当前链尾。
- Then：单头且等于 c515ffd62859，7 个测试全过。

### FR-03: frontend admin/menus page.test.tsx 组内上移/下移声明序 19/20/21→17/18/19（8a928588f 删 components/topology 两项）+ git-log-page.test.tsx TABS 数 16→15，两文件定向 vitest 绿

- 前端钉子测试必须与生产契约同步：菜单注册表删 2 项后 menus 页组内上移/下移用例的声明序锚必须为 users=17 / organizations=18 / roles=19，WorkspaceTabs 组件页 tab 下线后 git-log 页用例的 TABS 数量锚必须为 15（「Git 日志」仍末位、href 不变），两测试文件定向 vitest 必须全绿。

#### 场景：主路径

- Given：MENU_PERMISSION_GROUPS 已删 components/topology 两项（8a928588f）、TABS 已删组件 tab。
- When：点击 system 组 roles「上移」/organizations「下移」。
- Then：双 PUT payload 的 sort_order 为 18/19 互换；TABS 链接总数 15 且「Git 日志」末位。

### FR-04: sillyhub-daemon pnpm gen:types 重生成 src/api-types.ts 并提交，gen:types:check 语义（重生成后 git diff 为空）+ daemon typecheck 过

- daemon 生成物必须与 `backend/openapi.json` 单一契约源零漂移：以已提交的 openapi.json 重生成 `sillyhub-daemon/src/api-types.ts` 并提交（重生成后与提交内容 git diff 为空，即 daemon-ci api-types drift check 语义通过），且 daemon `tsc --noEmit` 必须零错误。

#### 场景：主路径

- Given：backend/openapi.json 已含 report_linked_repos_sync_result 等新端点与 WorkspaceBrief 改名，daemon/src/api-types.ts 停在旧契约（872 行漂移）。
- When：`pnpm -C sillyhub-daemon gen:types` 重生成并提交。
- Then：drift check 重生成后 diff 为空；daemon typecheck 0 错（改名 schema 无消费方受波及）。

### FR-05: 不跑全量测试（规则 0），全量留给 CI

- 本变更必须只跑定向相关测试（两个 backend pytest 面 + 两个 frontend 测试文件 + daemon typecheck），禁止跑全量测试套件，全量验证留给 CI。

#### 场景：主路径

- Given：CLAUDE.md 规则 0（全量测试留给 CI）。
- When：本变更各任务验证。
- Then：仅定向面被执行，未触发任何全量套件。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/agent/test_agent_run_log_tool_kind.py「test_session_channel_payload_contains_tool_kind」
FR-02: backend/tests/test_align_platform_change_events_migration.py「TestMigrationStructure::test_file_exists_and_single_head_chain」（整文件 7 例）
FR-03: frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx「组内上移/组内下移」+ frontend/src/components/git-log/__tests__/git-log-page.test.tsx「TABS 15 项」（两文件 17 例）
FR-04: sillyhub-daemon pnpm typecheck（tsc --noEmit）+ daemon-ci api-types drift check 语义（重生成后 git diff 为空；CI 复核）
FR-05: 不适用：流程约束条款（禁止跑全量），无独立测试面——由各定向测试命令范围本身佐证
