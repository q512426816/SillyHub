---
id: task-06
title: 'backend 复扫链 askwait 豁免（生产误杀修复）'
title_zh: 'backend 复扫链 askwait 豁免（生产误杀修复）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 08:55:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-014@v1]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/tests/modules/agent/test_stale_run_recheck.py
target_files:
  - backend/app/modules/agent/service.py
  - backend/tests/modules/agent/test_stale_run_recheck.py
goal: >
  复扫链 _recheck_deferred_runs 判死路径前插入 _run_awaiting_user_input 豁免——
  修复 2026-10-26 生产实证会话 388bb823（run 3b601319）等待交互轮被误杀
  （SERVICE_RESTART_INTERRUPTED）缺陷：AskUserQuestion 等待用户回答期间
  daemon_alive=None（无 lease 注入轮），日志停滞超宽限窗即被判死，pending
  提问联动取消、用户后续消息按 busy 入队永不消费、会话楔死。
provides:
  - "复扫豁免语义：daemon_alive 为 False/None 且 askwait 命中（最后 ask 信号晚于最后 user_input 且未超 24h 上限）→ 不判死、保持追踪等真终态；其余照旧判死"
implementation:
  - backend/app/modules/agent/service.py _recheck_deferred_runs：daemon 活性门判定之后、FOR UPDATE 判死之前插入豁免分支——`if await _run_awaiting_user_input(session, run_id, now)` 命中则记 `stale_run_recheck_deferred_awaiting_user` 日志并 `still_tracked.add(run_id); continue`（复用启动清理同款函数与 _ASKWAIT_EXEMPT_MAX_AGE 上限，零新判定语义）
  - backend/app/modules/agent/service.py 同步更新两处 docstring 防注释失配（仓库规则 18）：_recheck_deferred_runs docstring 四级判 bullet 的「False/None→判死」补注「askwait 命中豁免」；_recheck_stale_runs_loop docstring「判 failed」语义同步补豁免说明
  - backend/tests/modules/agent/test_stale_run_recheck.py 新增用例对齐既有 fixture 风格（_add_log 扩 channel/tool_kind 参数）：①ask 信号（tool_call+ask 晚于 user_input）+ 无 lease + 日志停滞超宽限窗 → 复扫后 run 仍 running（不判死）且记 deferred_awaiting_user；②同①但最后 ask 距 now 超 24h → 判死 SERVICE_RESTART_INTERRUPTED（超龄回落）；③user_input 晚于 ask（已回答后静默）+ 无 lease → 判死照旧（既有行为回归保护）
acceptance:
  - 复刻生产形态（ask 信号 + 无 lease + 日志停滞超宽限窗）复扫不判死、run 保持 running
  - 24h 超龄与非 askwait 轮判死行为与现状完全一致（负向断言，error_code 仍为 SERVICE_RESTART_INTERRUPTED）
  - 启动清理路径（_cleanup_stale_runs_impl）既有 askwait 豁免零改动
verify:
  - cd backend && uv run pytest tests/modules/agent/test_stale_run_recheck.py app/modules/agent/tests/test_cleanup_stale_runs_error_code.py -q（输出落盘 .sillyspec/.runtime/logs/ 只看尾部）
  - cd backend && uv run ruff check app/modules/agent/ && uv run mypy app/modules/agent/service.py（聚焦改动面）
constraints:
  - 禁改 _run_awaiting_user_input / _ASKWAIT_EXEMPT_MAX_AGE / 启动清理路径既有语义（纯复用）
  - 禁改 _mark_stale_run_failed 错误文案与 error_code（迟到成功回正兜底依赖 SERVICE_RESTART_INTERRUPTED 匹配键）
  - 豁免仅作用于复扫链判死路径，daemon_alive=True 放行分支不动
---
