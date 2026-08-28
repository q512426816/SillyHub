
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
