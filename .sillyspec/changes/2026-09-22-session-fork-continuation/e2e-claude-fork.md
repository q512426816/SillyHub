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
