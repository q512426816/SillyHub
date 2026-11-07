# 端到端联调记录（task-14）

> 记录形态：本变更加急推进至 execute 收口时，运行中的平台栈（backend/daemon/frontend）仍为主仓版本——
> 本变更代码在 worktree 分支未部署，**真实三场景联调需部署后执行**。本记录如实区分
> 「已验证面（单测/组件级）」与「待部署验证面（真实栈三场景）」，不虚报联调完成。

## 已验证面（单测/组件级，全绿）

- **场景①单元语义（无 manual_approval 会话，D-001/D-016/R-12）**：
  `driver-factory-approval-wiring.test.ts` 用例「会话启动即拦截可达」——enableApproval=false +
  writeGuardEnabled 会话的**首个** Bash git commit 即触发 resolver.register（dialog_kind='git_approval'），
  resolver 已随会话启动构造（R-12 时序无空洞：与 approvalReady 分支同时机）；通道缺失 fail-soft 走现状。
- **场景②单元语义（门户 askUser_only，D-017）**：`session-manager-permission.test.ts` 用例
  「git commit 命中 → register 发 dialog_kind=git_approval（askUserOnly 会话不漏拦）」——git 分支置于
  askUserOnly 自动放行之前；同文件 AskUserQuestion 既有用例 28 条零回归（问答卡照常）。
- **场景③单元语义（后台锚点态，D-019）**：handler 的 register 携带 backgroundTaskFlag(state, mgr)
  （与 AskUserQuestion 分支同一行代码，resolver 层该标记触发 5min 兜底 deny 的语义有既有测试背书）；
  分发面 deny/reject 路径 3 组用例（畸形兜底/拒绝零 git 调用）全绿。
- **代执行语义（FR-04/D-002/D-018）**：`git-executor.test.ts` 7 用例——精确重整差集断言、
  identity 注入、push 缺省补 origin+当前分支、sillyspec 原样 argv + Windows shim 真实 PATH 解析
  （本机真 shim 只读解析，未执行）、commit 失败 stderr 原样回喂、reject 零调用。
- **识别面（R-01/R-09）**：`git-command-guard.test.ts` 41 用例——复合命令四种分隔符绕过形态、
  sillyspec push 参数矩阵（4 拦 + 3 不拦含 --undo）、git push --dry-run 不拦、不拦清单 9 例。
- **前端面**：`git-approval-card.test.tsx` 12 用例（三分组树/勾选联动/提交流 dialog_result/
  拒绝流/push 展开明细/畸形兜底/minimized）；`pending-dialog-dock.test.tsx` 7 用例零回归（分流后
  AskUser 卡既有行为不变）。
- **端点面（W3）**：`test_session_git_status.py` 16 用例零回归 + 路由注册冒烟
  （GET /daemon/sessions/{session_id}/git-diff 已进 _ENDPOINT_ORDER 断言面 + openapi +167 行）。
- **R-02（turn 保活）证据**：dialog_kind 存在时 resolver 不启 5min 兜底（permission-resolver.ts:213
  既有语义 + AskUser/plan_approval 生产长驻先例）；`PLATFORM_NO_RUNNING_TURN` 的触发面是
  writeChannelGuardDeny（canUseTool 入口，先于 git 分支）——挂起等待期间 SDK 持续 await
  register promise，turn 活性由 SDK 驱动，与 AskUser 长驻同构。本会话（dogfood）曾两度实证
  该拦截在非挂起场景真实生效，挂起场景未见复发。

## 待部署验证面（部署本变更后照 task-14 卡 implementation 执行）

1. 场景①全链路：真会话 agent 跑 git commit → 卡片改 msg/减选 → 代执行 → sha+文件集回喂 → 清卡；含挂起 >60s 的 turn 保活观察 + 刷新恢复。
2. 场景②真门户会话 git 拦截 + AskUser 并存。
3. 场景③真后台锚点态 5min 自动 deny + 前端无僵尸卡（respond unknown_request 静默降级）。
4. push 流冒烟（git/sillyspec 两形态真实推送 + 压扁语义核对 + R-05 凭据继承）。
5. diff 端点 curl 冒烟（含中文路径）。
6. 逃生阀对照（SILLYHUB_GIT_APPROVAL=off 行为与现状一致）。

**处置**：以上 6 项部署后由平台值班会话按卡面脚本执行；发现的缺陷回流对应任务卡修复。
（执行期裁决 D-020：联调拆「单测级已验证 + 部署后清单」两段如实记录，不虚报完成。）
