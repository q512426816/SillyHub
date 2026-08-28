
## ql-20260828-011-1ec7 | 2026-08-28 11:00:28 | 预会话派团队配置确认后补待生效反馈标签
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/daemon/session-panel.tsx（TeamTriggerRow pendingTeam chip+预会话消费点）
- frontend/src/components/daemon/__tests__/session-panel-team.test.tsx（待生效 chip 两组用例+setupPre 提升文件级）
需求：预会话派团队配置确认后补待生效反馈标签
根因：预会话（无 sessionId）弹层确认后仅暂存 payload+回填 /team+关弹层，界面零反馈——用户不知道配置已生效待随首句创建（mission 随首句落库是 D-009 设计，无会话期间本就无 mission/chip），用户实测后误以为团队没建成
方案：TeamTriggerRow 加 pendingTeam 待生效 chip（虚线 brand 边框区分「进行中」实线；主体点击重开弹层修改、× 放弃暂存+清回填的 /team 输入框）；page 预会话消费点接 preTeamMission 非空渲染
结果：session-panel-team 18/18（新增确认后 chip 出现/× 放弃后消失+首句不带 team_mission）+ 相邻回归 130/130 + tsc 无错

## ql-20260828-012-4425 | 2026-08-28 11:16:47 | 派团队标签点击编辑回显当前配置
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/schema.py（summary 三字段）
- backend/app/modules/daemon/router.py（构造填充）
- frontend/src/lib/daemon.ts（类型同步）
- frontend/src/components/daemon/team-trigger-popover.tsx（initialConfig 回显+确认语义）
- frontend/src/components/daemon/session-panel.tsx（chip 派生/透传）
- frontend/src/lib/api-types.ts + backend/openapi.json（gen:types）
需求：派团队标签点击编辑回显当前配置
根因：chip 点击只 openTeamPopover(null) 弹层全初始值，用户重选全部配置；TeamMissionSummary 缺 project_id/worker_preset/main_agent_config 无法完整回显
方案：后端 summary 三字段补齐+gen:types；弹层 initialConfig 六项回显（含 mount 首跑 scope 不清修复 + 回显实例未展开预设确认原样回传）；session-panel 真会话从活跃 mission 派生（占位符目标过滤）、预会话从暂存 payload 回显
结果：前端 7 文件 185/185 + 后端 test_session_team_mission 26/26 + tsc 无错

## ql-20260828-013-a55b | 2026-08-28 13:03:17 | 团队任务状态永不收敛——分身失败/被杀后任务卡进行中
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/mission.py（_virtual_status 首run终态兜底）
- backend/app/modules/daemon/router.py（本地展开+行化同款）
- backend/app/modules/agent/tests/test_derive_status_matrix.py（守护用例×2）
需求：团队任务状态永不收敛——分身失败/被杀后任务卡进行中
根因：树内会话的 run 从 derive 输入剔除（防双计），run 终态信息完全丢失：_virtual_status 仅看会话侧——run killed 后会话 ended 无强收标记、run failed 后会话未收敛 active，两种形态虚拟 run 都卡 running（DB 实证 mission 1eae4f70 两形态并存）
方案：mission.py + daemon/router.py 两处 _virtual_status 加首 run 终态 failed/killed→虚拟 failed 兜底（mission 下带 role 的最早 run 查表；追问轮无 mission_id 不进首 run 集）；router 行化 row_status 同款；排序键 isoformat 规避 naive/aware datetime 混比；守护用例×2 锁定两形态收敛 + completed 不越权
结果：agent 全量 1181/1181（含 derive 矩阵 169 + team mission 端点）全绿；模块文档 agent.md 注意事项补双源同改警示
审计：⚖️ 归属切分：1 个窗口内未声明脏文件未计入文件行（并行会话改动或本会话漏声明）：backend/app/modules/agent/tests/test_derive_status_matrix.py
