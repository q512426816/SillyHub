---
id: task-05
title: 'backend-activation-content'
title_zh: '后端激活与内容：inject 懒激活 + origin 下发 + 内容端点'
author: qinyi
created_at: 2026-08-23 14:10:00
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-002, D-007, D-010]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/daemon/tests/test_tool_report_activation.py
  - backend/app/modules/platform_sync/tests/test_agent_log_content.py
goal: >
  tool_report 会话可继续（inject 懒激活，D-010 机器自选 + AppError 离线闭环）+
  列表/详情 origin 下发 + 标题派生 session.title 优先 + 日志内容读取端点
  （直连 ws_rpc、黑名单 format、字节截断，design §3.3.4/§3.3.5）。
implementation:
  - session/service.py：_inject_into_session 守卫前插 _activate_tool_report_session 分支（origin=tool_report 且 lease_id 空）——provider 保持、cwd=最新关联 entry.agent_cwd or workspace.root_path、prepare_interactive_dispatch（prompt=首条消息）+ turn_count=1 + config_snapshot 补 machine_name；无在线机器抛新 AppError 子类（中文 detail、http 409）
  - 列表/详情：SQL/DTO 增 origin；router 标题派生改 session.title ?? user_input 派生
  - platform_sync router：GET /agent-logs/{entry_id}/content（_read_auth）——定位 daemon（会话 runtime 优先→workspace 绑定）、直连 hub.send_rpc host_fs.read_file（不走 delegate degrade）、黑名单 format 409、尾部 262144 字节截断（decode errors=ignore）、404/409/503/504 中文映射
  - 新测试 test_tool_report_activation.py（daemon/tests/ 平铺）+ platform_sync 内容端点用例
acceptance:
  - 激活成功路径（lease 建立 + turn_count=1 + 状态流转）/离线 409 中文/已激活直通/内容四类失败 + 截断断言全绿；既有 daemon 套件零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests app/modules/platform_sync/tests -q
constraints:
  - 激活只走既有派发语义（不新增机器选择器，D-010）；NoOnlineDaemonError 不裸抛
  - 内容端点不落库（读即弃）
---

# task-05 补充说明
无。
