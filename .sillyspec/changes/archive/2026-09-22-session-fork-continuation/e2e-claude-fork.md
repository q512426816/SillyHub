---
author: qinyi
created_at: 2026-09-22 23:55:00
---
# claude 真机 E2E 验收记录 — 会话任意点分叉「不知情」语义（task-08）

> 变更：2026-09-22-session-fork-continuation（task-08 / FR-02 / FR-03 / D-005@v1）
> 记录时间：2026-09-22 23:55（本地）
> 记录人：task-08 实现子代理（如实记录，禁伪造）

## 1. 执行形态结论

**平台级 E2E 未执行（环境未运行）——本记录为如实缓验，非执行记录。**

探测证据（2026-09-22 23:50 前后，本机 Windows 10）：

| 探测项 | 命令 | 结果 |
|---|---|---|
| backend 健康 | `curl http://127.0.0.1:8000/api/health`（另试 `localhost`） | 连接失败（exit 7 / HTTP 000，无监听） |
| frontend | `curl http://127.0.0.1:3000` | HTTP 000，无监听 |
| 常见端口监听 | `netstat -ano` 过滤 80/443/3000/3001/5173/8000/8080/9000 | 无命中 |
| 本机 Docker 容器 | `docker ps` | 空（无运行容器） |

结论：平台（backend + frontend + daemon）本机未运行。按任务卡约定
「平台没在跑→不要硬造」，未伪造任何执行记录；改为引用 SDK 级真机实证
（§2）+ 组件级测试证据（§3）+ 补验步骤清单（§4）。

## 2. 引用：claude 截断「不知情」语义的 SDK 级真机实证（task-02 已做，PASS）

来源：本变更 `spike-pi-fork.md`（§「claude resumeSessionAt×forkSession 组合行为」
—「实机断言结果（本机已做，PASS）」节）。环境：SDK 0.3.247 + claude.exe
2.1.216 + 本地 claude 代理（glm-5.3），真 SDK→CLI→代理链。

- 会话 `9b88e377…` 三轮铺垫：轮1 "name is Alice"、轮2 "secret code is
  BANANA-77"、轮3 "favorite color is purple"。
- **分叉点=轮 2 末**：`resume(9b88e377) + resumeSessionAt(轮2末 assistant uuid
  9019fe24…) + forkSession(true)` + 探针提问 →
  - 新 session id `8d2d674f…`（≠ 原 id，fork 成立）；
  - 探针回答 **"name=Alice; code=BANANA-77; color=none"** ——
    **B 知分叉点前（轮1+轮2）、不知分叉点后（轮3）**（「不知情」断言在
    SDK 级真机证明）；
  - **transcript 物理核验**：原会话文件 19 条目零改动（fork 后 A 字段/内容
    零变化 → D-005 语义 claude 侧成立）；新会话文件仅含轮1、轮2、探针轮。
- 平台链路等价性：backend fork 端点（task-05）将同一 `resumeSessionAt +
  forkSession` 参数组经 lease 白名单→daemon execPayload→claude-sdk-driver
  options 透传（task-06 实装+单测锁定），故平台级 E2E 的语义面与该 SDK 级
  实证同构，差异仅在编排层（建会话/轮锚点回填/HTTP 编排），由 §3/§4 覆盖。

## 3. 本卡已执行的验证（组件级，全部真实执行）

- `frontend` `pnpm exec vitest run src/components/daemon/__tests__/session-fork-lineage.test.tsx`
  —— 16 用例全绿：溯源块渲染（native/seed 档标注、第 N 轮后、降级占位）、
  多跳面包屑（A→B→当前，逐节点可点）、浮层泛化（title/statusHint/closeLabel
  透传 + 缺省「分身会话」零回归）、列表分叉附属分组（「↦ 分叉 N」头 + 「🔗 分叉」
  徽标 + 与分身组不混树 + 源不可见回落主行不丢行）、TurnForkEntry 接线
  （engineAnchor 缺失置灰 / 进行中置灰 / 可点上抛 (runKey, seq) / 未接线零渲染）。
- 连带回归：session-fork-entry（task-07，271 行）、session-list-panel（105
  用例）、session-panel-dialog 族（dialog/attachments/offline/changeid/
  connection/variant/draft-scope/usage-mount/suspended-display/ux-fixes，
  计 180+ 用例）全绿；`pnpm exec tsc --noEmit` 零错。
- backend：`uv run ruff check app/modules/daemon/router/session_insights.py` 通过
  （D-014③：SessionRunRead 增 `engine_anchor` 列透出，gen:types 已刷新
  openapi.json + api-types.ts）。

## 4. 补验步骤清单（verify 阶段或人工启动平台后照单执行）

前置：启动平台（backend :8000 + frontend + sillyhub-daemon 在线 + 至少一台
claude runtime 在线）；用有 TASK_RUN_AGENT 权限的账号登录前端。

1. 建会话 A（claude 引擎），发两轮可记忆内容：
   轮1「我的名字是 Alice」→ 等 OK；轮2「暗号是 BANANA-77」→ 等轮终态。
2. `GET /api/daemon/sessions/{A}/runs` → 记录轮1/轮2 run 的 `engine_anchor`
   （非空即 task-04 回填链通；D-014③ 透出项）。前端轮头「⑂ 从此分叉」在
   两轮上均可点（终态+锚点在）。
3. 轮2 入口点击 → 确认弹层显示「『A 标题』第 2 轮后」+「原生分叉·真截断」
   → 确认创建 → 进入 B（浮层）。
4. **不知情断言（正）**：在 B 问「我的名字和暗号分别是什么？」→ 应回答
   Alice / BANANA-77（知轮1+轮2）。
5. **不知情断言（负）**：回到 A 继续发轮3「我最喜欢的颜色是 purple」→ 等
   终态；回 B 问「我最喜欢的颜色是什么？」→ B 应不知情（回答不知道/未提及，
   不得复述 purple）。
6. **A 零变化断言**：fork 后 `GET /api/daemon/sessions/{A}` 与 fork 前快照逐
   字段比对（status/turn_count/last_active_at 等仅随 A 自身轮3 变化，fork
   本身零写入）；A 侧继续可正常对话。
7. 谱系 UI 断言：B 面板顶部溯源块常驻（分叉自「A 标题」第 2 轮后 + 引擎档
   pill）；点击溯源块 → 浮层可看 A 完整记录（含轮3）；若从 B 再分叉出 C，
   C 面包屑呈 A → B → 当前（多跳）；会话列表 B 挂 A 附属分组带「🔗 分叉」
   徽标，与分身组不混。
8. 结果回写本文件 §5（执行人/时间/每步 PASS-FAIL），缓验即转正式验收。

## 5. 执行记录（补验后填写）

（空——未执行。）

## 5. 平台级 E2E 执行记录（2026-09-23 09:05–09:20，远程生产环境）——**PASS**

环境：`https://crrcdt.ppdmq.top`（阿里云重新部署，backend/frontend 含本变更代码——部署面证据见 §6）+ 本机 daemon DESKTOP-HJ0AM09（build 20260923081838，owner=管理员，7 runtime online）+ 账号 admin2。

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1 | 建会话 A（provider=claude），轮 1「名字叫 Alice；秘密代码 FORK-E2E-99」 | A=`ba802543-e3c2-4794-abf5-bd78ef3f4787`，run1=`f1142a6f…` completed（01:08:33Z） |
| 2 | 轮 2「最喜欢的颜色是紫色」 | run2=`9816eb27…` completed（01:12:12Z）；A turn_count=2 |
| 3 | 锚点链验证：GET /runs | run1.engine_anchor=`41734d18…`、run2.engine_anchor=`61b74a90…`（真实链 UUID，daemon 补挂→backend 回填全链生产生效） |
| 4 | 快照 A（fork 前） | origin=chat、fork 三字段 null、agent_session_id=`55c57991…` |
| 5 | **POST /sessions/{A}/fork {at_run_id: run1}** | **HTTP 201，tier=native**，B=`978cf0f7-c9db-4654-a0ca-3c281c013eee`，lineage={source=A, at_run_seq:1} ✓ |
| 6 | B 注入探针「名字/秘密代码/最喜欢的颜色？格式 name=;code=;color=，不知道写 none」 | run=`a3bb140c…` completed |
| 7 | **B 的回答** | **`name=Alice;code=FORK-E2E-99;color=none`** —— 知分叉点前（轮1 两项全对）、**不知分叉点后（轮2 紫色→none）**：「不知情」断言 PASS（真截断，非转述） |
| 8 | A fork 后复核 | **全字段零差异**（运行时字段除外），turn_count 2/2 不变 —— D-005「A 零影响」生产实证 |

B 谱系行：origin='fork'、fork_of_session_id=A、fork_at_run_id=run1、engine_fork_anchor=轮1 锚、**agent_session_id=`18aaa855…`（≠A 的 55c57991——SDK forkSession 换新 id 生效）**。

**结论：平台级 E2E 八步全 PASS——§4 缓验清单兑现，本变更两项 manual-acceptance 移交项之 claude 项关闭。**

## 6. 部署面验证（2026-09-23 09:00，无凭据探针）

- 远程 openapi（513 端点）含：POST /api/daemon/sessions/{session_id}/fork、SessionForkLineage/Request/Response 三 DTO、AgentSessionRead fork 三字段、SessionRunRead.engine_anchor ✓
- 无鉴权 POST fork → **401**（路由真实挂载+鉴权拦截，非 openapi 残影）✓
- 机器列表：本机 daemon 在线（新 build 当日 08:18）✓

## 7. pi 平台链路分叉验证（2026-09-23 09:25–09:33，同环境）——装配层 PASS，对话级受环境阻断

| 步骤 | 结果 |
|---|---|
| 建 pi 会话 A（`43426ecf…`）+两轮 | run1/run2 均 failed——stderr 实证 `403 permission_error: Your current subscription does not have access to Kimi Code`（pi 上游订阅失效，D-008 已记录的 pi 吞上游错误故障面） |
| pi 锚点链 | run1.engine_anchor=`b5175f49…`（pi entryId 轮首锚回填链生产生效 ✓） |
| **POST fork at run1** | **HTTP 201 tier=native**，B=`93512b20…`，lineage={source=A, at_run_seq:1} ✓——backend 分派→claim 四键→daemon 短命 RPC 预 fork→B 建立全链通 |
| B 探针对话 | 注入成功但模型轮同样 403（订阅级，非链路问题）——对话级「不知情」断言 NOT EXECUTED |

结论：**pi 移交项的装配层验证兑现**（分派/预 fork/谱系/锚点四项全证）；对话级断言由 spike-pi-fork.md §pi 真机实证代位（当时用本地 claude 代理后端在真 pi 0.81.1 RPC 上证明 fork 截断+不知情）。pi 订阅恢复后可按同八步复跑对话级（可选项）。
