---
author: qinyi
created_at: 2026-06-23 10:09:12
---

# SillySpec Quick Log

## ql-20260623-003-7c2e | 2026-06-23 10:09:12 | TopBar 用户菜单新增「切换平台」入口 + 退出登录二次确认 + 侧边栏 LOGO 处显示平台名称
状态：已完成
结果：6 测试全过（top-bar 2 + logout-confirm-dialog 4）；tsc 改动文件无类型错误；eslint 无 warning。
实际改动文件：
- frontend/src/components/top-bar.tsx（导出 resolvePlatformSwitch 纯函数；用户菜单新增「切换平台」项，文案/跳转随当前平台切换）
- frontend/src/components/app-shell.tsx（退出登录拆 requestLogout/performLogout + 渲染确认弹窗；侧边栏 Brand 区 LOGO 旁显示当前平台名称；LOGO 链接随平台指向各自首页）
- frontend/src/components/logout-confirm-dialog.tsx（新建：退出登录二次确认弹窗，基于 ui/dialog）
- frontend/src/components/__tests__/top-bar.test.tsx（新建：resolvePlatformSwitch 平台判断纯函数，2 用例）
- frontend/src/components/__tests__/logout-confirm-dialog.test.tsx（新建：确认/取消回调，4 用例）

## ql-20260623-004-8f2c | 2026-06-23 14:35:00 | 修复 daemon notifySessionEnd 调 POST /sessions/{id}/end 因 user_id 不匹配返回 404（后端 /end 端点 daemon 身份改用 runtime 归属匹配）
状态：已完成
结果：pytest test_session_service.py 20 passed（原 4 个 end 回归 + 3 新用例：daemon owner 成功 / 跨 owner 404 / 前端回归）；ruff check 4 文件 All passed；router 导入 + end_session 签名验证 OK。未改 daemon、未碰 inject/interrupt/delete。
根因：daemon notifySessionEnd 经 X-API-Key 调 /sessions/{id}/end，get_current_principal 解析出 api-key owner 的 user.id，但 end_session 内 _get_owned_session_for_update 校验 AgentSession.user_id==user_id（前端创建者），不匹配 → DaemonSessionNotFound → 404。inject/interrupt/delete 只被前端调用不受影响，仅 end 被 daemon 共用。
方案（纯后端，不改 daemon）：/end 端点按认证头分流——Bearer JWT 走现有 user_id 校验（前端），X-API-Key 走新增 runtime 归属校验（session.runtime.user_id == api-key owner）。
文件：
- backend/app/modules/daemon/session/service.py（end_session 加 daemon 身份分支 + 新增 _get_runtime_owned_session_for_update join DaemonRuntime）
- backend/app/modules/daemon/service.py（facade end_session delegate 适配新参数）
- backend/app/modules/daemon/router.py（/end 端点按 Bearer/API-Key 分流，SessionEndRequest 不变）
- backend/app/modules/daemon/tests/test_session_*.py（新增 daemon 身份 end 用例 + 跨用户拒绝）
  不在本次范围：Q1（inject 竞态，低优先）、Q3（"Request interrupted by user"，需另查后端自动 interrupt 逻辑）

## ql-20260623-005-3e7a | 2026-06-23 15:50:00 | Q3 调研：silent running 期间 "Request interrupted by user" 根因排查（结论：非本项目 bug，无代码改动）
状态：已完成（纯调研；曾尝试 running-skip 修复已 revert）
结果：深挖确凿——4 分钟 interrupt 非 idle 扫描。证据：sessions.json 当前 session 42fe942b 创建于 ~15:12 CST（lastActiveAt=1782198895187ms 换算）、turnCount=0（silent running 首 turn 卡住）、4 分钟后 ~15:16 < idle 阈值 30min（默认 1800s；C:/Users/qinyi/daemon-start.bat 确认未设 SESSION_IDLE_TIMEOUT_SEC）。代码穷尽：后端 SESSION_INTERRUPT 仅 interrupt_session（用户手动端点）发出、无自动 interrupt；daemon q.interrupt() 仅 3 处（daemon.ts:1624 后端路由 / session-manager.ts:819 interrupt() / :938 idle _onIdleExpire），idle 30min 不触发 4 分钟。排除法结论：4 分钟 "Request interrupted by user" 只能是用户手动点中断 或 Claude Code SDK/GLM 代理（open.bigmodel.cn）上游层中断，非本项目 daemon 代码。silent running 本身是 GLM 代理在 SDK 下无输出（上游问题，见 memory ql-20260619-005 GLM 429/凭证遗留）。曾尝试 running-skip（idle 只回收 active）修 idle 误回收 running 缺陷，但深挖证明与 4 分钟无关 + 违背 task-07 D-004 原设计（_onIdleExpire interrupt 兜底即有意回收 running）+ 破坏 6+ 测试（AC-06/07/08/10/12），已 revert。daemon.log 为占位文件（"log line N"）无真实日志。
根因：daemon `_scanIdle`（session-manager.ts:910）对 active+running 都按 `lastActiveAt` 判空闲；但 `lastActiveAt` 仅在 turn 开始（inject/create L776）/结束（result L1254）/interrupt（L823）时更新，turn 执行期间（silent running，如 GLM 代理无输出）**不更新**。turn 执行时长 > `_idleTimeoutSec`（默认 1800s，env SESSION_IDLE_TIMEOUT_SEC 可调小）时，`_onIdleExpire`（L932）对 running session 先 `driver.interrupt(query)` → SDK 输出 "Request interrupted by user" → end。用户场景 silent running 4 分钟被中断即此路径。后端无自动 interrupt（interrupt_session 仅用户手动端点调用），中断源自 daemon idle 扫描。
方案：idle 扫描只回收 active（无 running turn）的 session，running 跳过（turn 在执行=工作中，非空闲；lastActiveAt 在 turn 执行期不更新，running 必被误判）。running 真卡死由用户手动 end/后端 lease 超时兜底，不靠 idle 粗暴 interrupt。
文件：
- sillyhub-daemon/src/interactive/session-manager.ts（_scanIdle guard：active-only，running 跳过 + 注释）
- sillyhub-daemon/tests/（idle 跳过 running 用例 + active 超阈值仍回收回归）
