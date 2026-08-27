---
author: qinyi
created_at: 2026-08-28 04:37:52
task: task-11
change: 2026-08-28-daemon-agent-share
worktree: .sillyspec/.runtime/worktrees/2026-08-28-daemon-agent-share
---

# task-11 回归确认报告（regression-report）

验证型任务：跑测试、分类失败、编清单，未改任何代码。全部命令在 worktree
`.sillyspec/.runtime/worktrees/2026-08-28-daemon-agent-share` 执行（HEAD = 23ff959c，
含 12 个实现提交 53f045e1..9a5dcde0 + 2 个测试适配提交 162d2f94/23ff959c，
工作区干净）。

## ① 各套件通过数与失败清单（归因：本变更 / 预存债 / 环境）

| 套件 | 命令 | 结果 | 归因 |
|---|---|---|---|
| daemon 全量（排除 fragile 三件） | `pnpm exec vitest run --exclude tests/task-09-spec-pull-push.test.ts --exclude tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts --exclude tests/daemon-borrow-sandbox.test.ts` | **166 文件 / 2901 passed，9 skipped，0 failed**（155.6s） | 全绿 |
| daemon fragile 三件串行（含 R-02） | `pnpm exec vitest run tests/task-09-spec-pull-push.test.ts tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts tests/daemon-borrow-sandbox.test.ts --poolOptions.forks.maxForks=1` | **3 文件 / 33 passed，0 failed**（14.2s；daemon-borrow-sandbox 3 用例绿——R-02 marker/prepareWorkspace/registerBorrowSandbox 链路回归通过） | 全绿 |
| daemon typecheck | `pnpm typecheck`（tsc --noEmit） | **0 错误** | 全绿 |
| backend 受影响模块 | `uv run pytest app/modules/daemon app/modules/agent app/modules/workspace tests/modules/workspace -q --no-cov -n auto` | **2827 passed，2 skipped，0 failed**（109s） | 全绿；2 skip 均环境性（Windows 无符号链接特权 / SQLite FOR UPDATE no-op，与本变更无关） |
| frontend 全量 | `pnpm test` | **242 文件：239 passed / 3 failed；2733 用例：2729 passed / 4 failed**（两次运行结果一致，非偶发） | 4 个失败全部为**预存 baseline 债**，归因证据见下 |
| frontend tsc | `pnpm exec tsc --noEmit` | **0 错误** | 全绿 |
| frontend lint | `pnpm lint` | **0 error**（仅既有 warning，含本变更触碰文件 0 error） | 达标（改动文件 0 error） |

### frontend 4 个失败逐个归因（全部「预存债」，非本变更）

判定方法：测试是否涉及本变更触碰文件 / 断言是否涉及本变更新行为 +
git 取证（本变更对相关文件的改动范围）。

1. `src/components/daemon/__tests__/session-panel-variant.test.tsx:354`
   「逻辑零分叉：SSE 建流入参与 variant 无关」——断言 `streamSession` 两参调用，
   实现为三参。取证：`git show ab368432:frontend/src/lib/daemon.ts` 在 baseline
   checkpoint 之前就已有第三参 `options`（cursor/resyncTimeoutMs/initialSync，
   来自并行在途 ctx-tokens 变更 ql-20260827-018），variant 测试文件未被本变更
   触碰（`git log ab368432..HEAD` 为空）。**= 已知预存债 #1，不修。**

2. `src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx:255`
   「弹层确认 → 输入框回填 /team 前缀」——`getByRole("button", { name: "派团队" })`
   找不到按钮。取证：失败 DOM 显示 📎/派团队按钮已被收敛进 antd Dropdown
   「更多功能」＋菜单（title="附件 / 派团队 / 选择技能 / 关联变更·快速修复"）；
   该收敛来自 quick 变更 604c32fa（ql-20260827-020-c8d0），`git merge-base --is-ancestor
   604c32fa ab368432` 确认其早于 baseline；本变更未触碰
   `session-input-bar.tsx`（`git log ab368432..HEAD -- session-input-bar.tsx` 为空），
   ux-fixes 测试文件亦未触碰。**= 已知预存债 #2，不修。**

3. `src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx:281`
   「idle 首句：附件入口禁用」——`getByTitle("发送首条消息创建会话后可添加附件")`
   找不到（clip 按钮已收进上述「更多功能」菜单，同 604c32fa）。

4. `src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx:287`
   「codex 引擎：附件入口禁用」——`getByTitle("当前引擎不支持附件")` 同因找不到。
   #3/#4 为**已知预存债的同族第三件**（同一输入栏重构所致，此前清单未列，
   本次已补齐归因证据：三个失败测试文件均未被本变更触碰，本变更对
   session-panel.tsx 的 diff 仅 import/徽标派生/条件徽标渲染三处，不可能影响
   输入区按钮）。**登记为预存债，不修。**

**结论：4 个失败无一由本变更引起；本变更引入的新测试（shared-machines-section /
platform-shared-agents-card / floating-session-host / session-config-bar /
runtimes page 及两个测试适配提交）全部通过。**

## ② 写约束证据链核对结论（D-009 / D-011 落地确认）

读测试代码与断言核对（非起服务），两组断言真实存在且本次全部实跑全绿：

### backend 侧（D-009 下推 + D-011 字段）
`backend/app/modules/daemon/tests/test_session_create_config.py :: TestPlatformProfileBranch`
（**单独复跑 5/5 passed**，包含在 2827 全绿内）：
- `test_shared_profile_only_creates_pinned_session`：lease metadata
  `tool_config.mode == "acceptEdits"`、白名单 `{Read, Glob, Grep, Edit, Write,
  mcp__sillyhub-file, mcp__sillyhub-worker}`、显式断言 `"Bash" not in
  allowed_tools` 且 `"NotebookEdit" not in allowed_tools`（D-009 无 Bash 工具集）；
  `meta["effective_allowed_roots"] == ["/srv/platform/out"]`（= writable_dir），
  且 `build_claim_payload` 产物 snake/camel 双键 `effective_allowed_roots` /
  `effectiveAllowedRoots` 均断言（D-011 下推两路透传）。
- `test_request_runtime_and_workspace_overridden`：同传自有 runtime/workspace 被
  服务端覆写，tool_config 无 Bash + effective_allowed_roots 防伪造形态一致。
- `test_disabled_grant_falls_back_to_normal_semantics`：停用回退普通语义，
  无 tool_config/cwd 残留。
- `test_offline_pinned_runtime_falls_back`：pinned runtime 离线 → 二选一 4xx。
- `test_admin_normal_session_same_runtime_not_tightened`：D-010/R-09 隔离——
  下推字段不污染普通会话。

### daemon 侧（D-011 写守卫 overlay 交集收紧）
`sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts`
（**单独复跑 7/7 passed**，包含在 2901 全绿内），7 用例覆盖三态+零变化+Bash 组合：
1. writable_dir 内（且 PolicyCache 内）→ allow（透传 updatedInput）；
2. writable_dir 外（但 PolicyCache 内）→ deny，overlay 文案
   `path outside allowed_roots`（新增强制，旧实现会 allow）；
3. overlay 命中但 PolicyCache deny → 仍 deny（PolicyEngine 中文文案，
   机器级边界不被 session roots 绕过）；
4. effective 全越出物理 provider 兜底 → 交集为空 deny（fail-closed）；
5. 无 effectiveAllowedRoots 字段 → 与既有 policyEngine 语义逐字节一致；
6. 空数组 → 视为未启用（同无字段）；
7. Bash 重定向提取路径同受 overlay 收紧（writable_dir 内 allow / 外 deny）。

**结论：D-009（platform 会话禁 Bash 工具集 + effective_allowed_roots=[writable_dir]
下推）与 D-011（daemon 写守卫 session 级 overlay 交集收紧）证据链完整落地，
断言真实、测试全绿。**

## ③ 发现的本变更缺陷

**无。** 全部命中套件绿、typecheck/tsc/lint 0 错、4 个 frontend 失败均有确凿
预存债归因（见 ①）。无最小修复建议需要主代理裁决。

预存债登记（不修，供后续 quick/change 收口）：
- `session-panel-variant.test.tsx`：streamSession 断言需补第三参（源：并行
  ctx-tokens 变更 ql-20260827-018 在途）。
- `session-panel-ux-fixes.test.tsx` / `session-panel-dialog-attachments.test.tsx`：
  「派团队」与附件 clip 按钮断言需改为经「更多功能」＋菜单交互（源：quick
  604c32fa ql-20260827-020-c8d0 输入框功能收敛）。

## ④ 手工验收清单（供用户执行，本验证未代跑）

前置：按 local.yaml / Makefile 起 backend + daemon + frontend；管理员账号 A
（platform admin）+ 普通账号 B（无自有守护进程）。对照原型
`prototype-daemon-agent-share.html`。

### A. 守护进程页面走查（7 项，账号 B 或任一有共享数据的账号）

| # | 项目 | 操作步骤 | 预期（对照原型） |
|---|---|---|---|
| A1 | 共享区块卡片 | 账号 B（所在工作区有成员开启共享）打开「守护进程」页，滚动到「共享给我的」区块 | 虚线边框卡片（区别于自有实线卡），卡片含共享人名 / 来源工作区 / 系统 / 版本 meta，仅「会话」按钮，无别名/可写目录/升级/禁用/移除等配置入口 |
| A2 | 统计计数 | 同页顶部统计行 | 新增「共享给我」统计卡，数字 = shared_to_me 生效条目数（与区块卡片数一致） |
| A3 | 管理卡四字段表单 | 账号 A 打开守护进程页，「平台共享智能体」管理卡点「+ 新建共享」 | 表单四字段：智能体档案（visibility=platform）/ 绑定守护进程（pinned runtime）/ 平台源码工作区（只读锚定）/ 共享输出目录 writable_dir（⊆ 守护进程可写目录，有 ⊆ 徽标提示）；下方生效列表含状态列与操作列 |
| A4 | 停用交互 | 账号 A 在生效列表对某条目点「停用」 | 条目状态由「生效中 · 全体可用」变停用态；普通用户选择器中该共享智能体随之消失（active 端点不再返回） |
| A5 | 选择器共享徽标三入口 | 账号 B 分别打开：① 守护进程页共享区块「会话」弹窗 ② 会话页（/sessions）新建会话的机器/档案下拉 ③ 右下角悬浮助手会话 | 三处机器/智能体选择器中共享条目带「共享」徽标（机器场景含共享人名；平台共享智能体 hover 提示「读平台源码不受限，写操作限制在共享输出目录」）；非共享条目无徽标 |
| A6 | 「平台共享」会话徽标 | 账号 B 用平台共享智能体开一个会话，看会话头 | 会话头显示「平台共享」徽标（非「只读」），hover 提示写约束说明；普通会话头无此徽标 |
| A7 | 离线禁用 | 共享人将共享守护进程下线（或等离线），账号 B 刷新守护进程页 | 该共享机器卡「会话」按钮禁用置灰，在线徽标变离线；在线共享机器按钮可点 |

补充红线走查：无任何共享数据的普通用户，守护进程页与会话选择器与改造前零变化
（无空区块/无多余统计/无徽标）。

### B. E2E 写约束冒烟（2 项，需真实 daemon + 管理员账号）

B1 workspace 共享会话创建 → 审计行：
1. 账号 A（机器所有者）在机器设置开启工作区共享；账号 B 在「共享给我的」点「会话」发首条消息；
2. 预期：会话创建成功；DB `daemon_borrow_audit` 新增一行且 `grant_id` 非空
   （对照 grants 授权源，task-06 同事务双写）；
3. 顺手抽查 FR-03：账号 B 对该会话尝试改名/删除等修改类端点 → 仅 owner
   （会话属主）可改，B 非 owner 时拒绝语义未变。

B2 platform 共享会话三态写约束（D-009/D-011 集成冒烟）：
1. 账号 A 建平台共享智能体（writable_dir 如 `C:\share\outputs`，源码工作区只读）；
2. 账号 B 用该共享智能体会话，让智能体 `Write` 写 writable_dir 内文件（如
   `C:\share\outputs\note.md`）→ 成功；
3. 让智能体 `Write` 写 writable_dir 外（如源码工作区根 `README.md` 或任意
   `C:\other\x.txt`）→ 拒绝，报错含 allowed_roots 语义（overlay 收紧文案
   `path outside allowed_roots`）；
4. 让智能体跑任意 `Bash` 命令 → canUseTool gate 直接拒绝（D-009 工具集白名单
   无 Bash；含 `echo x > writable_dir外路径` 的重定向间接写同样拒绝）。

## ⑤ 结论

**可以进入 worktree apply。** 依据：
- daemon 全量（含 fragile 三件串行 + R-02 borrow-sandbox 回归）与 typecheck 全绿；
- backend 受影响四模块 2827 用例全绿（2 skip 为 Windows 环境性）；
- frontend 全量 4 失败全部归因预存 baseline 债（两件已知 + 同族第三件已补证），
  本变更触碰文件 tsc 0 错、lint 0 error；
- D-009 / D-011 写约束证据链断言真实存在且对应测试全绿（backend 5/5 + daemon 7/7）；
- 未发现本变更范围的缺陷，无需修复裁决。

遗留：④ 的 9 项手工验收（7 走查 + 2 E2E）留给用户按清单执行；三件预存债
测试断言过期问题建议另开 quick 收口（与本变更解耦）。
