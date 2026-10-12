---
author: flow-machine-draft
created_at: 2026-10-12T07:30:00.000Z
---
# 需求规格（Requirements）— 2026-10-12-backfill-run-change-context

## 功能需求

### FR-01: 回填服务按会话内 run 时间序重放 sillyspec 绑定命令游标：run 先按当前游标打锚（无锚才写），再用该 run 消息里的命令更新游标（最后一条生效），与线上运行时语义一致

- 回填必须按 run 的 created_at（id 决胜）升序逐个处理：每个 run 必须先以「当前游标」打锚（仅当该 run 的 change_id 为 NULL 且游标非空），随后必须再从该 run 的 sillyspec 命令日志（channel=tool_call、tool_kind=sillyspec）解析绑定并覆盖游标（同 run 多条命令取消息序最后一条）——禁止先用本 run 命令更新游标再打锚（那会把整轮摊给轮中才出现的命令，与运行时「下一轮才继承」语义相悖）。
- 已有锚（change_id 非空，如派发 run）的 run 必须跳过打锚，但其消息里的命令必须照常推进游标。

#### 场景：主路径

- Given 会话依次有 r0（无命令日志）、r1（含 `flow start --change a`）、r2（含 `flow start --change b`）、r3（无命令日志），When 回填，Then r0 保持 NULL、r1 保持 NULL（首个命令所在轮不归新变更）、r2 打锚 a、r3 打锚 b。

### FR-02: 只回填 change_id 为 NULL 的 run，已锚 run（派发）跳过但命令照常推进游标；幂等可重跑

- 回填必须幂等：对已回填过的库重跑，结果数据不变、本轮新增打锚数为 0。
- 回填范围必须只写 agent_runs.change_id 与 agent_sessions.current_change_id，禁止改动 change_session_links、quicklog_session_links、agent_run_logs 或任何用量数值。

#### 场景：主路径

- When 对同一数据连续执行两次回填，Then 第二次 runs_stamped=0 且各 run 的 change_id 与第一次结束后一致。

### FR-03: 命令的 change_key 按（workspace_id, change_key）映射 Change 行，映射不到跳过计数；quicklog 链路与会话链接不改动

- 解析出的 change_key 必须按（会话 workspace_id, change_key）查 Change 行取 id；查不到时必须跳过该命令（游标不变）并计数上报，禁止在回填中创建 placeholder 变更行。
- quicklog（quicklog_session_links / quicklog 用量口径）禁止触碰；会话链接行禁止增删。

#### 场景：主路径

- Given 会话含命令 `flow start --change ghost`（workspace 内无该 key 的 Change 行），When 回填，Then 游标不变、commands_skipped_unknown_key 计 1、不新建任何 Change 行。

### FR-04: 会话回填结束时把游标终值写 agent_sessions.current_change_id（仅当该会话解析出过命令）

- 会话处理结束且至少解析出一条绑定命令时，必须把游标终值写入 agent_sessions.current_change_id（后续新轮自动接续正确上下文）；未解析出任何命令的会话禁止写该列。

#### 场景：主路径

- Given 会话以 `flow start --change b` 为最后一条绑定命令，When 回填，Then 该会话 current_change_id == b 的 id；无命令会话该列保持原值。

### FR-05: CLI 脚本默认 dry-run 输出计数，--apply 才落库；支持 --workspace 限定范围

- scripts/backfill_run_change_context.py 必须默认 dry-run（事务回滚、只打印每个会话与总计的计数：待打锚 run 数/已锚跳过/命令数/未知 key 数），--apply 才提交；--workspace <uuid>（可多次）必须把处理范围限定到指定工作区（缺省全工作区）。
- 会话选取必须限定为在 change_session_links 有链接的会话（命令绑定必然先建链接，链接是天然范围门）；dry-run 与 apply 的计数口径必须一致。

#### 场景：主路径

- Given dry-run 输出「待打锚 N」，When --apply 执行，Then 实际打锚数 == N，且再次 dry-run 显示待打锚 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_backfill_run_context.py「test_backfill_replays_cursor_in_run_order_splitting_two_changes」
FR-02: backend/app/modules/change/tests/test_backfill_run_context.py「test_backfill_is_idempotent_second_run_stamps_zero + test_anchored_run_skipped_but_advances_cursor」
FR-03: backend/app/modules/change/tests/test_backfill_run_context.py「test_unknown_change_key_skipped_without_placeholder」
FR-04: backend/app/modules/change/tests/test_backfill_run_context.py「test_session_cursor_written_only_when_commands_found」
FR-05: backend/app/modules/change/tests/test_backfill_run_context.py「test_workspace_scope_filters_linked_sessions（服务层工作区编排：无链接会话不处理）」
