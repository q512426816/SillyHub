---
author: qinyi
created_at: 2026-09-07 13:44:15
change: 2026-09-07-arch-large-file-split
task: task-06
scope: backend 四模块拆分对账基线（R-04 导出面遗漏防护 + D-007 延迟解析白名单）
---

# backend 拆分前置对账基线（task-06）

> 全部数据于 2026-09-07 在 worktree `.sillyspec/.runtime/worktrees/2026-09-07-arch-large-file-split` 的 `backend/` 下 grep 实测（只读，源码零改动）。
> 四目标模块行数实测：router.py 5468 / session/service.py 7176 / group/service.py 4844 / run_sync/service.py 4055（合计 21543，与 design.md 一致）。
> 可复现命令（在 worktree 根目录执行；`cd` 进 worktree 仅限 grep，跑 sillyspec CLI 一律在主仓根）：
>
> ```bash
> grep -rn "session\.service import\|run_sync\.service import\|group\.service import\|daemon\.router import" backend/app --include=*.py   # import 语句，167 处
> grep -rn 'patch("app\.modules\.daemon' backend/app --include=*.py                                          # patch() 字符串目标（全 daemon 220 处）
> grep -rnE '(monkeypatch|mp)\.setattr\("app\.modules\.daemon' backend/app --include=*.py                    # setattr 字符串形态
> git status --porcelain -- backend/openapi.json && git diff --stat HEAD -- backend/openapi.json             # openapi 基线
> ```

## 0. 实测计数总表（与任务卡/design 对账）

| 目标模块 | import 语句数（实测=任务卡） | patch() 字符串目标数（实测=任务卡） | setattr 字符串形态 | __init__ 导出面符号数（import∪patch∪别名setattr 去重） |
|---|---|---|---|---|
| session/service.py | 74 | 69 | +1（mp.setattr get_redis） | 47 |
| run_sync/service.py | 42 | 45 | 0 | 15 |
| group/service.py | 24 | 33 | 0（另有别名形态 2） | 42 |
| router.py | 27 | 10 | +2（SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC） | 14 |
| **合计** | **167** | **157** | **+3** | **118** |

结论：import 计数（74/42/24/27）与 patch 计数（69/45/33/10，合计 157）与任务卡、design §5/§7 数字**逐项一致，无出入**。单引号 `patch('...')` 形态实测 0 处；`patch.object` 实测无四目标模块命中（88 处 patch.object 全部指向其它对象，不进入本基线）。

---

## 1. import 符号清单（按目标模块，跨模块非测试 / 测试分列）

### 1.1 session/service.py（74 处：跨模块非测试 26 + 测试 48）

**跨模块非测试 import（26 处）**：

| 消费方 | 行号 | 导入符号 |
|---|---|---|
| app/modules/agent/mission_context.py | 411 | SessionService（函数级 lazy import） |
| app/modules/agent/mission_context.py | 515 | SessionService（lazy） |
| app/modules/agent/mcp_tools.py | 1382 | **_merge_lease_metadata**（私有①，lazy） |
| app/modules/agent/finalizer.py | 670 | SessionService（lazy） |
| app/modules/agent/patrol.py | 92 | DAEMON_INTERRUPTED_ERROR_CODE |
| app/modules/agent/patrol.py | 866, 958 | SessionService（lazy） |
| app/modules/agent/worker_redispatch.py | 59 | DAEMON_INTERRUPTED_ERROR_CODE |
| app/modules/agent/worker_redispatch.py | 318 | **_merge_lease_metadata**（私有③，lazy） |
| app/modules/change/service.py | 3027 | DaemonSessionNotActive, DaemonSessionTurnConflict, SessionService（lazy 多行） |
| app/modules/daemon/permission_service.py | 641 | **_resolve_daemon_id_for_runtime**（私有④，lazy） |
| app/modules/daemon/lease_service.py | 669, 752 | **_resolve_daemon_id_for_runtime**（两处 lazy） |
| app/modules/daemon/service.py | 60 | ACTIVE_SESSION_STATUSES, ACTIVE_TURN_STATUSES, TERMINAL_TURN_STATUSES, DaemonOffline, DaemonSessionInvariantViolation, DaemonSessionNoAgentSession, DaemonSessionNoCurrentRun, DaemonSessionNotActive, DaemonSessionNotFound, DaemonSessionResumeUnsupported, DaemonSessionTurnConflict, SessionControlResult, SessionDispatchResult, SessionRecoveryResult（noqa: F401 再导出聚合层） |
| app/modules/daemon/service.py | 94 | SessionService（lazy） |
| app/modules/daemon/sweep.py | 71 | DAEMON_INTERRUPTED_ERROR_CODE, RECONNECTING_RETRY_WINDOW_SEC, **_resolve_daemon_id_for_runtime** |
| app/modules/daemon/router.py | 139 | SessionService, get_session_readiness |
| app/modules/daemon/group/service.py | 187 | DaemonSessionTurnConflict, SessionService |
| app/modules/daemon/group/service.py | 4518 | **_merge_lease_metadata**（私有③，lazy） |
| app/modules/daemon/group/service.py | 4571 | DaemonRuntimeOffline（lazy） |
| app/modules/daemon/group/service.py | 4669 | **_resolve_daemon_id_for_runtime**, get_session_readiness（lazy 多行） |
| app/modules/daemon/lease/provider_switch.py | 105 | **_resolve_daemon_id_for_runtime**（lazy） |
| app/modules/daemon/run_sync/service.py | 47 | TERMINAL_TURN_STATUSES, **_apply_session_terminal_status**（私有①）, **_send_session_end_best_effort**（私有②）, get_session_readiness（顶部多行 import——run_sync 反向依赖 session.service 私有符号的唯一点） |
| app/modules/daemon/run_sync/service.py | 2597 | dispatch_next_queued_message（lazy） |
| app/modules/platform_sync/router.py | 561 | **_resolve_daemon_id_for_runtime**（lazy） |

**测试 import（48 处）**：

| 测试文件 | 行号 | 导入符号 |
|---|---|---|
| daemon/tests/conftest.py | 24 | SessionReadiness |
| daemon/tests/test_apply_session_terminal_status.py | 15 | **_apply_session_terminal_status** |
| daemon/tests/test_group_cross_mention.py | 56 | DAEMON_MSG_SESSION_SWITCH_CONFIG, SessionService, **_prepend_group_chain_marker**, **_split_group_chain_marker** |
| daemon/tests/test_group_cross_mention.py | 1297 | DaemonSessionTurnConflict（lazy） |
| daemon/tests/test_group_direct.py | 668 | DaemonSessionTurnConflict, SessionService, **_split_group_chain_marker** |
| daemon/tests/test_group_direct.py | 1359 | **_prepend_group_chain_marker**, **_split_group_chain_marker** |
| daemon/tests/test_group_direct.py | 1474 | SessionService, **_split_group_chain_marker** |
| daemon/tests/test_group_direct.py | 538, 1402 | SessionService（lazy） |
| daemon/tests/test_group_mention_pipeline.py | 1572, 1649 | DaemonSessionTurnConflict, SessionService（lazy） |
| daemon/tests/test_group_realtime.py | 659 | DaemonSessionTurnConflict, SessionService（lazy） |
| daemon/tests/test_control_command_dispatch.py | 922, 928, 962 | SessionService / get_session_readiness / 两者（lazy） |
| daemon/tests/test_control_commands.py | 542 | SessionService（lazy） |
| daemon/tests/test_inject_empty_prompt.py | 328 | DaemonSessionNotActive（lazy） |
| daemon/tests/test_inject_first_turn_briefing.py | 32 | DAEMON_MSG_SESSION_SWITCH_CONFIG |
| daemon/tests/test_inject_orchestrator_tagging.py | 36 | DaemonSessionConfigInvalid, DaemonSessionTurnConflict |
| daemon/tests/test_inject_orchestrator_tagging.py | 234 | SessionService（lazy） |
| daemon/tests/test_inject_session_model.py | 36 | DAEMON_MSG_SESSION_SWITCH_CONFIG, DaemonSessionConfigInvalid |
| daemon/tests/test_inject_session_model.py | — | （同文件单行 import 已计） |
| daemon/tests/test_run_sync_session_gate_failover.py | 34 | get_session_readiness |
| daemon/tests/test_session_ctx_window.py | 28 | DaemonSessionNotFound |
| daemon/tests/test_session_create_attachments.py | 29 | DaemonSessionAttachmentInvalid, DaemonSessionAttachmentsUnsupported, DaemonSessionNotFound |
| daemon/tests/test_session_create_config.py | 53 | DaemonSessionLlmProviderKindMismatch, DaemonSessionLlmProviderNotFound, DaemonSessionNotActive, DaemonSessionRuntimeNotFound, DaemonSessionRuntimeUnavailable |
| daemon/tests/test_session_optimize_round2.py | 39 | DaemonSessionNotActive, SessionService |
| daemon/tests/test_session_provider_caps.py | 37 | DaemonSessionAttachmentsUnsupported, DaemonSessionNotActive, DaemonSessionResumeUnsupported, SessionService |
| daemon/tests/test_session_queue.py | 30, 398 | DaemonSessionQueueEntryNotFound, DaemonSessionQueueFull, DaemonSessionTurnConflict / DaemonSessionNotFound（lazy） |
| daemon/tests/test_session_queue_actions.py | 63 | DaemonRuntimeOffline, DaemonSessionNotActive, DaemonSessionQueueEntryNotEditable, DaemonSessionQueueEntryNotFound, DaemonSessionQueueOrderMismatch, SessionService |
| daemon/tests/test_session_readiness.py | 36, 255 | SessionReadiness / get_session_readiness（lazy） |
| daemon/tests/test_session_reconnect_sweep.py | 28 | RECONNECTING_RETRY_WINDOW_SEC |
| daemon/tests/test_session_review_fixes.py | 36 | DaemonSessionInvariantViolation |
| daemon/tests/test_session_service.py | 38, 1318 | DaemonSessionWorkspaceNotFound / RECONNECTING_RETRY_WINDOW_SEC（lazy） |
| daemon/tests/test_session_suspend.py | 43 | DAEMON_INTERRUPTED_ERROR_CODE, DAEMON_STOPPED_ERROR_CODE, SessionService |
| daemon/tests/test_session_switch_config.py | 39, 713 | DAEMON_MSG_SESSION_SWITCH_CONFIG, DaemonSessionLlmProviderKindMismatch, DaemonSessionLlmProviderNotFound, DaemonSessionNotActive, SessionEmptyPrompt / DaemonSessionConfigInvalid（lazy） |
| daemon/tests/test_session_events_cross.py | 45 | RECONNECTING_RETRY_WINDOW_SEC |
| daemon/tests/test_session_team_mission.py | 897, 925, 951 | DaemonSessionTeamMissionInvalid（三处 lazy） |
| daemon/tests/test_resilience_integration.py | 48 | DAEMON_STOPPED_ERROR_CODE |
| daemon/tests/test_tool_report_activation.py | 35 | DaemonSessionNotActive, ToolReportActivateNoDaemon |
| daemon/tests/test_worker_redispatch.py | 59 | DAEMON_INTERRUPTED_ERROR_CODE, DAEMON_STOPPED_ERROR_CODE, SessionService |
| change/tests/test_approval_notify_session.py | 38, 507 | DaemonSessionNotActive, DaemonSessionNotFound, DaemonSessionTurnConflict, SessionService / get_session_readiness（lazy） |

### 1.2 run_sync/service.py（42 处：跨模块非测试 6 + 测试 36）

**跨模块非测试 import（6 处）**：

| 消费方 | 行号 | 导入符号 |
|---|---|---|
| app/modules/change/dispatch.py | 1237 | RunSyncService（lazy） |
| app/modules/change/router.py | 785 | RunSyncService（lazy） |
| app/modules/daemon/service.py | 79 | SubmittedMessages（TYPE_CHECKING 内） |
| app/modules/daemon/service.py | 92 | RunSyncService（lazy） |
| app/modules/daemon/router.py | 64 | publish_bash_chunk_event, publish_session_event, publish_submitted_messages |
| app/modules/mcp_gateway/tools.py | 1267 | RunSyncService（lazy） |

**测试 import（36 处）**：

| 测试文件 | 行号 | 导入符号 |
|---|---|---|
| change/tests/test_reconcile_gate.py | 25 | RunSyncService |
| daemon/tests/test_advance_team_stage.py | 41 | RunSyncService |
| daemon/tests/test_extract_sdk_attribution.py | 17 | TOOL_RESULT_MAX_CHARS, _extract_sdk_messages |
| daemon/tests/test_extract_sdk_edit_patch.py | 19 | _extract_sdk_messages |
| daemon/tests/test_group_bridge_projection.py | 48 | publish_submitted_messages |
| daemon/tests/test_group_direct.py | 57 | publish_submitted_messages |
| daemon/tests/test_group_direct.py | 1343 | extract_group_broadcast_segments（lazy） |
| daemon/tests/test_group_p1.py | 449, 484 | GROUP_FALLBACK_SUMMARY_CHARS / GROUP_PROJECTION_FALLBACK_TEMPLATE（lazy） |
| daemon/tests/test_run_sync_agent_events.py | 553 | _extract_sdk_messages, _persist_agent_event（lazy 多行） |
| daemon/tests/test_run_sync_agent_events.py | 647, 732, 876, 955 | publish_submitted_messages（lazy ×4） |
| daemon/tests/test_run_sync_assistant_override.py | 440, 923, 976, 1021, 1083 | publish_submitted_messages（lazy ×5） |
| daemon/tests/test_run_sync_ctx_tokens.py | 34 | publish_submitted_messages |
| daemon/tests/test_run_sync_fire_background_task.py | 25 | RunSyncService |
| daemon/tests/test_run_sync_gate_decision_task.py | 37 | RunSyncService |
| daemon/tests/test_run_sync_gate_enqueue.py | 29 | RunSyncService |
| daemon/tests/test_run_sync_golden_parity.py | 429, 595, 693 | _extract_sdk_messages / publish_submitted_messages（lazy） |
| daemon/tests/test_run_sync_golden_parity.py | 764 | _extract_sdk_messages, _persist_agent_event（lazy） |
| daemon/tests/test_session_sse.py | 28 | publish_submitted_messages |
| daemon/tests/test_subagent_log_attribution.py | 38 | _tool_use_run_lru |
| daemon/tests/test_team_change_lifecycle.py | 33 | RunSyncService |
| daemon/tests/test_wave5_integration.py | 1053, 1082, 1107 | _extract_sdk_messages（lazy ×3） |
| mcp_gateway/tests/test_change_stage_tools.py | 538, 579, 619 | RunSyncService（lazy ×3） |

### 1.3 group/service.py（24 处：跨模块非测试 10 + 测试 14）

**跨模块非测试 import（10 处）**：

| 消费方 | 行号 | 导入符号 |
|---|---|---|
| app/modules/agent/file_artifacts.py | 142 | get_active_user_membership, get_group_chat_by_session（lazy 多行） |
| app/modules/daemon/router.py | 3660 | get_group_accessible_session（lazy） |
| app/modules/daemon/router.py | 3679 | group_presence_key, group_typing_channel, publish_member_presence, release_member_presence（lazy 多行） |
| app/modules/daemon/group/router.py | 38 | GroupChatCreateRead, GroupChatPinnedRead, GroupChatService, GroupDirectMessageRead, GroupMemberAddRead, GroupMemberInterruptRead, GroupMessageSendRead, get_group_unread_counts, get_last_mention_previews, get_last_message_previews, get_online_member_ids, get_online_member_ids_bulk |
| app/modules/daemon/run_sync/service.py | 2520 | _publish_group_typing_event, _typing_payload（lazy 多行） |
| app/modules/daemon/run_sync/service.py | 2547 | run_cross_mention_detection（lazy） |
| app/modules/daemon/session/service.py | 1040, 6243, 6898 | get_group_accessible_session（lazy ×3） |
| app/modules/daemon/session/service.py | 3131 | prepare_shadow_direct_turn（lazy） |

**测试 import（14 处）**：

| 测试文件 | 行号 | 导入符号 |
|---|---|---|
| daemon/tests/test_group_chat_management.py | 1899 | GroupChatService（lazy） |
| daemon/tests/test_group_cross_mention.py | 48 | GROUP_CHAIN_DEPTH_FIELD, _build_group_prompt, detect_cross_mentions, group_chain_key, run_cross_mention_detection |
| daemon/tests/test_group_direct.py | 380, 617, 1401 | SHADOW_DIRECT_SOURCE（lazy ×3） |
| daemon/tests/test_group_direct.py | 536 | _MID_TURN_NOTICE（lazy） |
| daemon/tests/test_group_direct.py | 1538 | GroupChatService（lazy） |
| daemon/tests/test_group_p1.py | 47 | GROUP_CHAIN_TTL_SECONDS, GROUP_CROSS_MEMBER_TRIGGER_LIMIT, GROUP_RATE_LIMIT_PER_MINUTE, GroupChatService, _group_guardrail_settings, group_chain_key |
| daemon/tests/test_group_p2.py | 60 | GROUP_LAST_MENTION_SCAN_ROWS, GroupChatService, GroupMemberTriggerRead, _group_pinned_snapshot, _group_typing_preview_enabled |
| daemon/tests/test_group_realtime.py | 68 | get_online_member_ids, publish_member_presence, release_member_presence |
| daemon/tests/test_group_mention_pipeline.py | 56 | _build_group_prompt, _load_group_context_lines, _parse_group_mentions |
| daemon/tests/test_group_mention_pipeline.py | 884 | _GROUP_REPLY_MARKER_REQUIREMENT（lazy） |
| daemon/tests/test_group_mention_pipeline.py | 1467, 1571 | _MID_TURN_NOTICE（lazy ×2） |

### 1.4 router.py（27 处：跨模块非测试 5 + 测试 22）

**跨模块非测试 import（5 处）**：

| 消费方 | 行号 | 导入符号 |
|---|---|---|
| app/main.py | 36 | close_llm_proxy_client |
| app/main.py | 37 | router as daemon_router |
| app/modules/agent/router.py | 50 | PermissionServiceDep |
| app/modules/daemon/dist_router.py | 25 | DAEMON_DOWNLOAD_URL, get_daemon_latest_version |
| app/modules/daemon/session/service.py | 1524 | validate_team_mission_block（lazy） |

**测试 import（22 处）**：

| 测试文件 | 行号 | 导入符号 |
|---|---|---|
| daemon/tests/test_close_interactive_run_model_error.py | 27 | InteractiveRunResultRequest |
| daemon/tests/test_group_realtime.py | 74 | _stream_sessions_events |
| daemon/tests/test_interactive_lifecycle_patch.py | 643, 668, 718, 807, 855 | router（lazy ×5） |
| daemon/tests/test_llm_proxy.py | 67 | router（lazy） |
| daemon/tests/test_sessions_events_stream.py | 40 | _stream_sessions_events, stream_sessions_events |
| daemon/tests/test_session_team_mission.py | 1203, 1236, 1489, 1522 | _team_mission_summary（lazy ×4） |
| daemon/tests/test_team_mission_create_block.py | 226–346 | validate_team_mission_block（lazy ×7） |
| daemon/tests/test_ws_auth.py | 92 | router（lazy） |
| daemon/tests/test_ws_handshake_daemon_id.py | 89 | router（lazy） |

### 1.5 裸模块 import（`import app.modules.daemon.<目标> as _alias`，import ... as 命名空间形态）

非 `from ... import` 的模块别名 import 全部在测试内（拆包后同名包 `__init__` 聚合即可保持这些命名空间可 setattr，是 D-007 别名形态 patch 的落点）：

- session.service：agent/tests/test_mission_context.py:472、test_worker_subsession_done.py:165、test_subsession_recursion_dispatch.py:369、test_worker_subsession_lifecycle.py:271、test_worker_subsession_dispatch.py:723（`_lease_svc_mod`）、daemon/tests/conftest.py:41、test_session_events.py:23、test_session_readiness.py:127/339
- group.service：daemon/tests/test_group_p2.py:52、test_group_chat_management.py:1191（均 `as group_service_module`）
- router：daemon/tests/conftest.py:40（`as router_mod`）、test_allowed_roots_policy_push.py:216（`as _router`）、test_session_readiness.py:126（`as router_mod`）

## 2. 6 私有符号消费点基线（__init__.py 聚合导出保底项）

定义点（全部在 session/service.py）：`_apply_session_terminal_status`:199、`_send_session_end_best_effort`:261(async)、`_merge_lease_metadata`:318(async)、`_resolve_daemon_id_for_runtime`:233(async)、`_split_group_chain_marker`:552、`_prepend_group_chain_marker`:518。
注意：permission_service.py:620 有一个**同名类方法** `PermissionService._resolve_daemon_id_for_runtime`（其内部 :641 仍 lazy import session.service 的模块级同名函数并委托）——两者是不同绑定，拆分只影响后者。

| 私有符号 | 跨文件消费点（文件:行号） | 消费点数 |
|---|---|---|
| `_apply_session_terminal_status` | run_sync/service.py:47（import）、:2310（调用）；tests/test_apply_session_terminal_status.py:15（import）+ :44/51/58/72/83/93/100/107/114/132/139/146/156/163/170（15 处调用） | 非测试 2 + 测试 16 = 18 |
| `_send_session_end_best_effort` | run_sync/service.py:47（import）、:2351（调用） | 非测试 2（无测试直接消费） |
| `_merge_lease_metadata` | agent/mcp_tools.py:1382（import）/1395（调用）；agent/worker_redispatch.py:318（import）/320（调用）；group/service.py:4518（import）/4520（调用）；agent/tests/test_worker_subsession_dispatch.py:728（setattr 别名 patch） | 非测试 6 + 测试 1 = 7 |
| `_resolve_daemon_id_for_runtime` | lease_service.py:669（import）/686（调用）、:752（import）/755（调用）；permission_service.py:641（import）/643（调用，委托自同名类方法）；sweep.py:71（import）/742（调用）；group/service.py:4669（import）/4677（调用）；lease/provider_switch.py:105（import）/120（调用）；platform_sync/router.py:561（import）/607（调用） | 非测试 14（无测试直接 import；test_permission_http_uplink.py:419、test_provider_switch.py:14 仅注释提及） |
| `_split_group_chain_marker` | tests/test_group_cross_mention.py:60（import）+ :1187/1208/1218/1223/1230（5 处调用）；tests/test_group_direct.py:671、:1361、:1476（3 处 import）+ :716/1371/1380/1503（4 处调用） | 测试 12（非测试 0） |
| `_prepend_group_chain_marker` | tests/test_group_cross_mention.py:59（import）+ :1185/1205/1216/1228/1229（5 处调用）；tests/test_group_direct.py:1360（import）+:1370（调用） | 测试 7（非测试 0） |

**6 符号合计消费点：非测试 24 + 测试 36 = 60。** 拆分后 session/service/__init__.py 必须原样重导出全部 6 个名字（含 `_` 前缀），以上任何一处 import 失败即为 R-04 命中。

## 3. patch 字符串目标清单（按目标模块分组，D-007 延迟解析白名单）

grep `patch("app.modules.daemon` 实测全仓 220 处，其中四目标模块 157 处（任务卡数字逐项吻合）；另有关联但不在 157 计数的 ws_hub 61 处、session_events 2 处（不在拆分范围，忽略）。单引号形态 0 处。

### 3.1 session.service 命名空间（patch() 69 处 + setattr 1 处）

| 被 patch 符号 | 次数 | 消费测试（文件 ×次数） | D-007 处置 |
|---|---|---|---|
| `get_redis` | 59（patch）+1（mp.setattr，test_permission_http_uplink.py:150） | agent/tests/test_borrow_run_output.py；daemon/tests/ 下 test_auth_transient_autoretry、test_close_interactive_run_model_error、test_close_interactive_run_session_status、test_control_command_dispatch、test_e2e_model_usage_flow、test_group_bridge_projection、test_group_cross_mention、test_group_direct、test_group_p1、test_group_realtime、test_inject_empty_prompt、test_inject_first_turn_briefing、test_inject_orchestrator_tagging、test_inject_session_model、test_interactive_lifecycle_patch、test_page_context_preamble、test_permission_owner_notify、test_ppm_session、test_resilience_integration、test_run_sync_agent_events、test_run_sync_agent_session_id_backfill、test_run_sync_assistant_override、test_run_sync_cache_parse、test_run_sync_ctx_tokens、test_run_sync_gate_enqueue、test_run_sync_golden_parity、test_run_sync_model_usage、test_run_sync_session_gate_failover、test_session_create_attachments、test_session_create_config、test_session_delete_active、test_session_events_cross、test_session_optimize_round2、test_session_permissions、test_session_queue、test_session_queue_actions、test_session_readiness、test_session_recovery、test_session_reopen_resume_key、test_session_review_fixes、test_session_service、test_session_suspend、test_session_switch_config、test_session_team_mission、test_session_user_log、test_submit_messages_no_overwrite_terminal、test_terminating_at_lifecycle、test_tool_report_activation、test_ws_hub_permission；change/tests/test_approval_notify_session.py（共 51 文件） | **子模块必须延迟解析**：`__init__.py` 保留 `from app.core.redis import get_redis`（源 :31），create/inject/recovery 等一切调用 `get_redis()` 的子模块统一 `import app.modules.daemon.session.service as _svc` 后 `_svc.get_redis()` |
| `get_session_readiness` | 7（patch）+2（别名 setattr：conftest.py:47、test_session_readiness.py:130） | test_group_attachments、test_group_direct、test_group_mention_pipeline、test_group_p1、test_group_p2、test_group_realtime、test_group_team | 原模块自有函数（:941 定义）。定义可下沉 results.py，但 `__init__` 必须重导出同名绑定；子模块内调用点经 `_svc.get_session_readiness()` 延迟解析 |
| `log` | 3（patch）+1（别名 setattr：test_session_readiness.py:342） | test_ppm_session（:356 等 3 处）、test_session_service、test_session_readiness | 原模块模块级 logger（:104）。`__init__` 保留 `log = get_logger(__name__)`；子模块用 `_svc.log` 记日志的调用点延迟解析（新子模块自带 logger 时不得改变原模块 `log` 名字存在性） |
| `publish_sessions_changed`（别名 setattr 形态，不在 69 计数） | 1 | test_session_events.py:139（`setattr(svc_mod, ...)`，注释明示「顶部 from ... import 把名字绑进自身命名空间」） | **子模块必须延迟解析**：`__init__` 保留 :84 `from app.modules.daemon.session_events import publish_sessions_changed` 绑定；子模块全部调用点（原 :2133/2134/2421/2768 等）经 `_svc.publish_sessions_changed` |
| `SessionService`（别名 setattr 形态） | 5 | agent/tests/test_mission_context.py:474、test_subsession_recursion_dispatch.py:378、test_worker_subsession_lifecycle.py:281/413、test_worker_subsession_done.py:174（patch `_svc_mod.SessionService` 为 Fake） | mission_context/finalizer/patrol 等 lazy `from session.service import SessionService` 的消费方在运行时才解析，拆包后 `__init__` 必须导出真类；fake 替换发生在原命名空间 → 类壳留在 `__init__`（D-004 类壳方案天然满足） |
| `_merge_lease_metadata`（别名 setattr 形态） | 1 | agent/tests/test_worker_subsession_dispatch.py:728 | 子模块调用点延迟解析（同 get_redis 规则） |

### 3.2 run_sync.service 命名空间（patch() 45 处，无 setattr 形态）

| 被 patch 符号 | 次数 | 消费测试 | D-007 处置 |
|---|---|---|---|
| `get_redis` | 43 | agent/tests/test_borrow_run_output.py；daemon/tests/ 下 test_advance_team_stage、test_agent_session_tasks、test_agent_task_status_payload、test_auth_transient_autoretry、test_close_interactive_run_model_error、test_close_interactive_run_session_status、test_e2e_model_usage_flow、test_group_bridge_projection、test_group_direct、test_group_p1、test_interactive_lifecycle_patch、test_run_sync_agent_events、test_run_sync_agent_session_id_backfill、test_run_sync_assistant_override、test_run_sync_cache_parse、test_run_sync_ctx_tokens、test_run_sync_gate_decision_task、test_run_sync_gate_enqueue、test_run_sync_golden_parity、test_run_sync_model_usage、test_run_sync_session_gate_failover、test_session_events_cross、test_session_plan_bash_events、test_session_readiness、test_session_reopen_resume_key、test_session_review_fixes、test_session_sse、test_submit_messages_no_overwrite_terminal、test_team_change_lifecycle（共 30 文件） | **子模块必须延迟解析**：`__init__` 保留 :31 `from app.core.redis import get_redis`；sdk_pipeline/publish/submit_* 等子模块调用点经 `_svc.get_redis()` |
| `get_session_factory` | 1 | test_run_sync_gate_decision_task.py:419 | **子模块必须延迟解析**：`__init__` 保留 :29 `from app.core.db import get_session_factory`；gate 决策子模块 :2870 调用点经 `_svc.get_session_factory()` |
| `_run_gate_via_delegate` | 1 | test_run_sync_gate_decision_task.py:250 | **子模块必须延迟解析**：`__init__` 保留 :42 `from app.modules.change.dispatch import _run_gate_via_delegate`；gate 子模块 :2910 调用点经 `_svc._run_gate_via_delegate` |

### 3.3 group.service 命名空间（patch() 33 处 + 别名 setattr 2 处）

| 被 patch 符号 | 次数 | 消费测试 | D-007 处置 |
|---|---|---|---|
| `SessionService` | 15（patch）+1（别名 setattr：test_group_chat_management.py:1202，patch 类属性 end_session） | test_group_cross_mention.py（:679 等）、test_group_p1.py | **子模块必须延迟解析**：`__init__` 保留 :187 `from app.modules.daemon.session.service import SessionService`；shadow/messages/members 等子模块全部 `SessionService(...)` 调用点（:2242/:3322/:3907/:3918/:3988/:4273 等 7 处）经 `group_service 命名空间别名` 解析（`import app.modules.daemon.group.service as _gsvc` 后 `_gsvc.SessionService`） |
| `get_redis` | 18（patch）+2（别名 setattr：test_session_suspend.py:220 等实为 session 侧；group 侧 0） | test_group_attachments、test_group_chat_management、test_group_cross_mention、test_group_direct、test_group_mention_pipeline、test_group_p1、test_group_p2、test_group_realtime、test_group_team（9 文件） | **子模块必须延迟解析**：`__init__` 保留 :163 `from app.core.redis import get_redis`；typing_presence/publish 类子模块调用点经命名空间别名 |
| `GROUP_LAST_MENTION_SCAN_ROWS`（别名 setattr 形态，不在 33 计数） | 1 | test_group_p2.py:626 | 原模块常量。`__init__` 必须保留该常量绑定；消费该常量的子模块读取点延迟解析（经命名空间取值，不得拆分时烧死字面量） |

### 3.4 router 命名空间（patch() 10 处 + setattr 字符串 2 处 + 别名 setattr 3 处）

| 被 patch 符号 | 次数 | 消费测试 | D-007 处置 |
|---|---|---|---|
| `get_redis` | 10（patch） | test_group_realtime.py（:1166 等）、test_sessions_events_stream.py | **子模块必须延迟解析**：router/`__init__.py` 保留 :39 `from app.core.redis import get_redis`；唯一调用点 :3556（`_stream_sessions_events` 内）落在 session_crud.py 子模块 → 该子模块 `import app.modules.daemon.router as _router` 后 `_router.get_redis()` |
| `SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC`（setattr 字符串形态，不在 10 计数） | 2 | test_group_realtime.py:495、test_sessions_events_stream.py:61 | 原模块常量（:458，25.0）。常量留在 router/`__init__.py`；`_stream_sessions_events` 子模块读取点经 `_router.SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC` 延迟解析 |
| `get_session_readiness`（别名 setattr 形态） | 2 | conftest.py:48、test_session_readiness.py:131（`setattr(router_mod, ...)`） | **子模块必须延迟解析**：`__init__` 保留 :139 `from ...session.service import SessionService, get_session_readiness`；唤醒点 :2127 所在子模块经 `_router.get_session_readiness()` |
| `_derive_policy_version`（别名 setattr 形态） | 1 | test_allowed_roots_policy_push.py:224 | 原模块函数（:714）。定义可下沉，`__init__` 重导出；调用点 :1123 所在子模块经 `_router._derive_policy_version()` |

### 3.5 D-007 白名单总览（子模块内禁止 from 原点直接导入后调用的符号）

| 模块 | 延迟解析白名单符号 |
|---|---|
| session/service | get_redis、get_session_readiness、log、publish_sessions_changed、_merge_lease_metadata、SessionService |
| run_sync/service | get_redis、get_session_factory、_run_gate_via_delegate |
| group/service | SessionService、get_redis、GROUP_LAST_MENTION_SCAN_ROWS |
| router | get_redis、SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC、get_session_readiness、_derive_policy_version |

规则（design §5）：被 patch 符号一律「`__init__.py` 保持原绑定（from 原点 import 或原定义重导出）+ 子模块 `import <原模块路径> as _ns` 延迟解析」。凡子模块直接 `from 原点 import` 被白名单符号后调用，对应 patch 即拦截失效 → 测试红。

## 4. __init__ 导出面基线（import 清单 ∪ patch 清单去重，拆分后核对清单）

### 4.1 session/service/__init__.py（47 符号）

公共符号（38）：ACTIVE_SESSION_STATUSES、ACTIVE_TURN_STATUSES、TERMINAL_TURN_STATUSES、RECONNECTING_RETRY_WINDOW_SEC、DAEMON_INTERRUPTED_ERROR_CODE、DAEMON_MSG_SESSION_SWITCH_CONFIG、DAEMON_STOPPED_ERROR_CODE、DaemonOffline、DaemonRuntimeOffline、DaemonSessionAttachmentInvalid、DaemonSessionAttachmentsUnsupported、DaemonSessionConfigInvalid、DaemonSessionInvariantViolation、DaemonSessionLlmProviderKindMismatch、DaemonSessionLlmProviderNotFound、DaemonSessionNoAgentSession、DaemonSessionNoCurrentRun、DaemonSessionNotActive、DaemonSessionNotFound、DaemonSessionQueueEntryNotEditable、DaemonSessionQueueEntryNotFound、DaemonSessionQueueFull、DaemonSessionQueueOrderMismatch、DaemonSessionResumeUnsupported、DaemonSessionRuntimeNotFound、DaemonSessionRuntimeUnavailable、DaemonSessionTeamMissionInvalid、DaemonSessionTurnConflict、DaemonSessionWorkspaceNotFound、SessionControlResult、SessionDispatchResult、SessionEmptyPrompt、SessionReadiness、SessionRecoveryResult、SessionService、ToolReportActivateNoDaemon、dispatch_next_queued_message、get_session_readiness、＋错误基类经 daemon/service.py:60 消费面确认（前述 noqa 聚合块 15 符号全含于上）。
私有符号（6，保底项，见 §2）：_apply_session_terminal_status、_send_session_end_best_effort、_merge_lease_metadata、_resolve_daemon_id_for_runtime、_split_group_chain_marker、_prepend_group_chain_marker。
patch 专用绑定（2，无 import 消费但必须存在）：get_redis（from app.core.redis）、log（= get_logger(__name__)）。另 publish_sessions_changed（from app.modules.daemon.session_events，测试别名 patch 用）。

> 备注：daemon/service.py:60 的聚合再导出块（14 符号 + noqa: F401）依赖本 `__init__` 全部就位，任一缺失即 main.py 启动 ImportError。

### 4.2 run_sync/service/__init__.py（15 符号）

公共/被导入（12）：RunSyncService、SubmittedMessages、GROUP_FALLBACK_SUMMARY_CHARS、GROUP_PROJECTION_FALLBACK_TEMPLATE、TOOL_RESULT_MAX_CHARS、extract_group_broadcast_segments、publish_bash_chunk_event、publish_session_event、publish_submitted_messages。
私有被导入（3）：_extract_sdk_messages、_persist_agent_event、_tool_use_run_lru。
patch 专用绑定（3）：get_redis（from app.core.redis）、get_session_factory（from app.core.db）、_run_gate_via_delegate（from app.modules.change.dispatch）。

### 4.3 group/service/__init__.py（42 符号）

公共常量（6）：GROUP_CHAIN_DEPTH_FIELD、GROUP_CHAIN_TTL_SECONDS、GROUP_CROSS_MEMBER_TRIGGER_LIMIT、GROUP_LAST_MENTION_SCAN_ROWS、GROUP_RATE_LIMIT_PER_MINUTE、SHADOW_DIRECT_SOURCE。
DTO（7）：GroupChatCreateRead、GroupChatPinnedRead、GroupDirectMessageRead、GroupMemberAddRead、GroupMemberInterruptRead、GroupMemberTriggerRead、GroupMessageSendRead。
服务/函数（17）：GroupChatService、detect_cross_mentions、get_active_user_membership、get_group_accessible_session、get_group_chat_by_session、get_group_unread_counts、get_last_mention_previews、get_last_message_previews、get_online_member_ids、get_online_member_ids_bulk、group_chain_key、group_presence_key、group_typing_channel、prepare_shadow_direct_turn、publish_member_presence、release_member_presence、run_cross_mention_detection。
私有被导入（10）：_GROUP_REPLY_MARKER_REQUIREMENT、_MID_TURN_NOTICE、_build_group_prompt、_group_guardrail_settings、_group_pinned_snapshot、_group_typing_preview_enabled、_load_group_context_lines、_parse_group_mentions、_publish_group_typing_event、_typing_payload。
patch 专用绑定（2）：SessionService（from app.modules.daemon.session.service）、get_redis（from app.core.redis）。

### 4.4 router/__init__.py（14 符号）

对象（1）：router（= APIRouter(prefix="/daemon", tags=["daemon"])，:460；main.py:37 以 `router as daemon_router` 挂载，agent/router.py:50 PermissionServiceDep 依赖链均经本对象）。
函数/类（9）：close_llm_proxy_client（:4546）、get_daemon_latest_version（:196）、validate_team_mission_block（:4252）、stream_sessions_events（:3036）、_stream_sessions_events（:3544）、_team_mission_summary（:3917）、InteractiveRunResultRequest（:1818）、PermissionServiceDep（:2509）、DAEMON_DOWNLOAD_URL（:154）。
patch 专用绑定（4）：get_redis、SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC（:458）、get_session_readiness（from session.service，:139）、_derive_policy_version（:714）。

> router 拆分额外不变量（design R-05）：`__init__.py` 先 include change_write/audit/grants/group_chat 四子路由（router.py:469–499）再触发 83 端点子模块注册；同形状路由保序对：`/sessions/events` → `/sessions/{session_id}`、`/runtimes/usage`+`/runtimes/page` → `/runtimes/{runtime_id}`。

## 5. openapi 基线（task-12 零 diff 对比锚点）

- worktree 路径：`backend/openapi.json`（1,946,955 字节，2026-09-07 09:04 mtime）。
- git 状态：`git status --porcelain -- backend/openapi.json` 输出为空、`git diff --stat HEAD -- backend/openapi.json` 输出为空——**已跟踪且与 HEAD 完全一致（干净基线）**。
- task-12 验收：router 拆包后在 worktree 重导出 openapi 并与本基线 diff，应零差异；任何 diff 即路由注册顺序/形状回归（R-05）。

## 6. 对账结论与差异声明

1. import 计数 74/42/24/27（合计 167）、patch 计数 69/45/33/10（合计 157）与任务卡 acceptance、design §5/§7 预估**完全一致，零差异**。
2. 额外实测发现（超出 157 计数但同属命名空间兼容面，已并入白名单）：setattr 字符串形态 3 处（router.SESSIONS_EVENTS_KEEPALIVE_INTERVAL_SEC ×2、session.service.get_redis ×1）＋ setattr 模块别名形态 14 处（§3 各表已逐条登记，覆盖符号：SessionService、publish_sessions_changed、get_session_readiness、log、_merge_lease_metadata、_derive_policy_version、GROUP_LAST_MENTION_SCAN_ROWS、get_redis）。
3. 6 私有符号全部定位到定义行（session/service.py:199/233/261/318/518/552）与全部消费点（§2，非测试 24 + 测试 36）。
4. 本任务零源码改动：worktree `git status --porcelain -- backend/` 为空（四源文件 + openapi.json 均与 HEAD 一致）；唯一写盘产物即本文件（落主仓 changeDir，不写 worktree）。
