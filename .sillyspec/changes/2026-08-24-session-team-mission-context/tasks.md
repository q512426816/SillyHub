---
author: qinyi
created_at: 2026-08-24 17:05:00
---
# 任务清单（Tasks）

- [ ] task-01: 共享 scope 查询+渲染函数——orchestrator.py 新增 collect_scope_workspace_statuses/render_scope_brief/render_session_orchestrator_briefing，render_orchestrator_prompt 改调共享函数（patrol 不引入探测）(W1)
- [ ] task-02: 非 git 三态探测 helper——delegate.py probe_workspace_git_mode（非降级通道 stat 绝对路径 .git；异常/未绑→unknown）(W1)
- [ ] task-03: mission_status backend 路由+DTO——GET /missions/status（X-Session-Id 定位，对齐 hub-client _missionActionPath；get_active_mission_for_session 定位，active=false 200）+ agent/schema.py MissionStatusResponse (depends_on: task-01,02) (W2)
- [ ] task-04: team_mission_entry flush-only 重构——抽预建 helper（add+flush 不 commit），本体=helper+commit 零回归 (W2)
- [ ] task-05: execution dispatch 三态分流——worktree 块前探测：direct→跳过 worktree/worktree_branch=None/prompt 直通变体（含结果落盘段 commit 指令调整）；unknown→现状 (depends_on: task-02) (W2)
- [ ] task-06: mission_context helper 新文件——首主控轮判定（空 prompt 排除/failed 不烧断）+简报组装（inject/create 共用） (depends_on: task-01) (W2)
- [ ] task-07: SessionCreateRequest.team_mission DTO——TeamMissionCreateBlock（含 orchestrator_workspace_id）+trigger 校验抽共享函数 (W2)
- [ ] task-08: service.py inject 路径简报前缀——SESSION_INJECT prompt 组装（简报+---+用户消息），user_input 保持干净 (depends_on: task-06) (W3)
- [ ] task-09: service.py create 路径预建+E2 解析——flush-only 预建+objective 直取首句+首 run 双标记+create 简报前缀+orchestrator_workspace_id（workspace_id/binding 钉定 422/cwd/默认配置） (depends_on: task-04,07,08) (W4)
- [ ] task-10: POST /workspaces/probe 端点——批量 git_mode+daemon_name+daemon_online（复用 collect+probe helper，任一成员 binding 口径） (depends_on: task-01,02) (W3)
- [ ] task-11: daemon mission_status 工具——mcp-server.ts 第 6 工具（参数可选+X-Session-Id）+hub-client getMissionStatus (depends_on: task-03) (W3)
- [ ] task-12: 前端弹层探测+主 agent 选择器——probe 一次拉取+机器名/在线/git 模式标签+选择器（仅 preSession 实例） (depends_on: task-07,10) (W4)
- [ ] task-13: 前端预会话解禁+create 携带——TeamTriggerRow 门控+payload 暂存+handlePreSessionSend 携 team_mission+daemon.ts client 扩展 (depends_on: task-09,12) (W5)
- [ ] task-14: 测试收尾+类型同步+文档——三态/一次性/回滚/边界轮/E2 422 用例+token 量化+全量回归+gen:types+模块文档 (depends_on: task-01,02,03,04,05,06,07,08,09,10,11,12,13) (W6)
