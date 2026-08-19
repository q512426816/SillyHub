
## ql-20260818-003-14d3 | 2026-08-18 09:52:53 | 切档案后人格实际不生效
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：切档案后人格实际不生效。
根因：SDK systemPrompt 选项 resume 时被 CLI 忽略（jsonl 固化，人格热切换从未生效过）；另有等值+空 prompt 落普通 inject 致 run 卡 pending 堵死会话。
方案：带人格 reload 走 forkSession=true（fork 新会话使 system prompt 生效+历史复制）；forkedInitPending 标记让 init 新 session_id 更新 state；driver 透传 forkSession/extraArgs；后端等值+空 prompt 409 拒绝；reload 吞错补日志。
结果：E2E 实证模型自报「当前会话角色：智能体档案设计师」；daemon 21+43 用例过、全量 2364（2 失败=既有基线+抖动）；后端 802 过。backend+daemon 已在运行环境生效，待 commit+push。

## ql-20260818-008-637c | 2026-08-18 13:40:32 | 档案可切不可取消
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：档案可切不可取消，不对称。
根因：inject 契约仅非空 agent_profile_id，「不指定」纯展示。
方案：空串=取消（与供应商对称）——后端取消分支（列/run NULL+快照 None+metadata 三键删+空载荷）；daemon 空提示词归一 null（preset-only 无人格）+档案切换（含取消）fork；前端「不指定（无人格）」可点。
结果：后端 804/daemon 43/前端 1613 全绿；E2E 取消后模型自报无人格。backend+daemon 已部署，待 commit+push+rebuild frontend。

## ql-20260818-010-90db | 2026-08-18 22:47:48 | 左侧会话列表加单条删除和批量删除
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/sessions/page.tsx, frontend/src/components/sessions/session-list-panel.tsx
需求：左侧会话列表加单条删除和批量删除。
根因：纯新增，后端 DELETE /sessions/{id} 软删端点已有，纯前端 UI。
方案：SessionListPanel 加批量管理模式（批量管理按钮→条目变勾选框→全选/删除选中）+ hover 单条删除按钮；page.tsx onDeleteSessions 回调调 deleteAgentSession 软删后 invalidate 列表+清选中态。
结果：列表组件 13 用例全过，前端全量 1632 全绿，eslint 0 error。待 commit+push+rebuild frontend。

## ql-20260819-001-b742 | 2026-08-19 16:35:01 | 会话列表和面板头部增加工作区信息显示
状态：已完成
关联变更：2026-08-19-sessions-workspace-selector
文件：
- frontend/src/components/sessions/session-list-panel.tsx（新增 workspaceIdToName map + 工作区 Tag chip）
- frontend/src/app/(dashboard)/sessions/page.tsx（新增 workspaceName 派生 + 头部工作区显示）
需求：会话列表和面板头部增加工作区信息显示。
根因：workspace-session-selector 变更已为新建会话增加了工作区选择器，但已有会话列表和会话面板未展示工作区归属。
方案：session-list-panel.tsx 左栏 chips 区新增工作区 Tag（workspace_id 解析名称）；sessions/page.tsx 右栏面板头部 badge 区显示工作区名称。两个组件通过 listWorkspaces() 获取工作区列表做 id→name 映射。
结果：tsc 类型检查通过（仅 file-preview 预存错误），lint 通过（无新增 warning），162 测试通过（2 预存失败与本次无关）。
