---
author: qinyi
created_at: 2026-11-07 00:30:00
change: 2026-11-06-session-git-approval
---
# 任务清单（Tasks）

<!-- 任务名清单（唯一真相；编号与 plan.md 的 task 编号严格对应；细节在 execute 阶段展开为 tasks/task-NN.md TaskCard） -->

## daemon 侧（Wave 1/2）

- [x] task-01: git-command-guard 命令识别纯函数（拆段/解析/预填规则/sillyspec push 形态）
- [x] task-02: 工作区采集器（porcelain v2 + numstat 双口径 + ahead 提交明细）
- [x] task-03: permission.ts git 拦截挂载分支（askUserOnly 先序，D-017）
- [x] task-04: driver-factory.ts 仅写校验分支补 git 审批接线（D-016，含逃生阀 SILLYHUB_GIT_APPROVAL）
- [x] task-05: git-executor 代执行引擎（精确暂存区重整 commit / runner 分流 push，D-018）
- [x] task-06: 响应分发与结果回喂（批准→执行文本；拒绝→原因，D-007）
- [x] task-07: guard 单测（复合命令绕过/msg 多段/pathspec/-a/-C/sillyspec push 参数形态/--undo 不拦）
- [x] task-08: executor 单测（精确重整语义/commit/push 成败/拒绝不动暂存区）

## backend 侧（Wave 3）

- [x] task-09: 会话级 git-diff 只读端点（service + router 挂载 + openapi）
- [x] task-10: gen:types 双跑（前端 + daemon api-types 同步，规则 21 义务）

## 前端侧（Wave 4）

- [x] task-11: GitApprovalCard 组件（commit 态目录树勾选/msg 编辑/push 态按条明细可展开/拒绝态）
- [x] task-12: PendingDialogDock 分流挂载（:137-152 map 扩展 kind 判别）+ 双模式接线（page/dialog）
- [x] task-13: 卡片组件测试（三分流渲染/勾选交互/提交拒绝流/超时 deny 清卡路径 R-11）

## 联调与收尾（Wave 5）

- [x] task-14: 端到端联调（无 manual_approval 会话/门户会话/后台锚点态三场景，R-02/R-12 验证点）
- [x] task-15: 现有 dialog/审批测试回归 + 原型产物对账（prototype 重编译 git diff 为空）
