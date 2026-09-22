# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

## 结论：PASS WITH NOTES（integration-critical 下依规附 Runtime Evidence，见对应章节——证据真实完整，故维持通过结论）

## 任务完成度

7/7 = 100%（tasks.md 全勾，勾选双路写入：agent 按 review gate 手动勾 + CLI autoCheckPlanFromReviews 机器勾）。

| task | 状态 | 主仓实测锚点 |
|---|---|---|
| task-01 数据层 | ✅ | model.py archived_at 5 处 / schema.py 1 处 / 迁移文件存在且已应用 dev 库（见 Runtime Evidence） |
| task-02 service | ✅ | group/service.py 三方法（archive_group/unarchive_group/delete_group）+ _get_group_locked + 旁路封堵 + list_groups 三态 |
| task-03 router | ✅ | 三端点 204 + archived Query(default=False)；openapi.json 实证 |
| task-04 后端测试 | ✅ | test_group_chat_management.py 34 用例（25 既有 + 9 新增），主仓实跑 34 passed |
| task-05 前端类型与 lib | ✅ | daemon.ts 三函数 + listGroupChats(opts)；api-types.ts 含三 operationId + archived_at；panel presence 适配 |
| task-06 前端交互 | ✅ | session-list-panel 群行 hover 三操作/徽标/降调/归档视图 + portal 三回调接线 |
| task-07 前端测试 | ✅ | session-list-panel.test.tsx 80 用例（71 既有 + 9 新增），主仓实跑绿 |

## 设计一致性

与 design.md（含 execute 期实证修订版 §4/§6.2b）一致。已核验项：
- 正交性：archive 只置群表 archived_at，不触碰群时间线 AgentSession（测试断言存在）；delete 双置位（群行+时间线行 deleted_at）
- delete 复用 end_group 幂等收口链（不重写私有方法，design §5.2 取舍落地）
- 旁路封堵：影子日志解析分支 deleted_at 过滤 + 属主 GET /sessions/{id} 404（测试双锚点）
- 三态过滤 HTTP 默认 False（有意分歧，注释锚定）；null 显式不可达（FastAPI bool 解析 422——execute 期双子代理交叉实证，design/FR 已同步修订，测试锁定边界）
- SSE 信号 status_changed/deleted，audience=全部用户成员（测试 payload 断言）
- 前端六要素（hover 操作/二选一按钮/徽标/降调/归档视图/清选中态）+ 计数「已归档群 N 个」（验收 gap 已修 ddc88952d）

已知偏差（design 已修订记录，非遗漏）：已归档群 presence 30s 轮询降级为选中时快照（传输层限制，与会话侧同款）。

## 探针结果（CLI 机械预填）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：backend/migrations/versions/20260903XXXXXX_add_group_chat_archived_at.py
  ——design §3.1 示例名占位符；实际文件 20260903170000_add_group_chat_archived_at.py 存在且已应用，语义复核通过

#### 探针 2：设计关键词覆盖（agent 执行）
| 关键词 | 实现锚点 | 结论 |
|---|---|---|
| 归档/取消归档 | service.py archive_group/unarchive_group + router 两端点 + lib 两函数 + 群行按钮 | ✅ |
| 删除/软删 | delete_group 双置位 + DELETE 端点 + deleteGroupChat + Trash2 按钮 | ✅ |
| 幂等 | 归档/取消归档 rollback 早退；已删群 404（测试断言） | ✅ |
| 行锁 | _get_group_locked with_for_update（仅三方法用） | ✅ |
| 旁路封堵 | 影子日志分支 deleted_at 过滤（测试 404 锚点） | ✅ |
| 三态过滤 | list_groups archived 分支 + Query(default=False)（防泄漏测试锚点） | ✅ |
| SSE 信号 | _publish_group_sessions_changed status_changed/deleted | ✅ |
| 已归档徽标/降调 | muted chip + opacity-60（测试类名断言） | ✅ |
| Modal.confirm/toast | 三处理 + notifyArchiveResult 复用 | ✅ |

#### 探针 3：验收标准测试覆盖
- CLI 预填结果见上（task-02/03 ⚠️ 为 co-located 测试目录不存在——daemon 模块测试统一落 daemon/tests/，task-04 覆盖，语义复核通过）
- **集成盲区标注**：router→service→DB 全链经 httpx ASGI 真实请求覆盖（test_group_chat_management.py 34 用例走真实 app）；前端 lib→组件→回调经 164 用例；SSE 前端订阅通道为既有链路（portal invalidate 已有覆盖）。真浏览器 E2E 无既有 harness，不属本仓库验证手段——遗留人工冒烟项（部署后「归档群→切已归档视图→取消归档→删除」一遍）
- **断言有效性抽查**（3 个核心用例）：①删除全链用例断言 DB 行状态（影子 ended/双 deleted_at 非空）非仅 HTTP 码；②三态过滤用例断言防泄漏（无参不含已归档）+ null→422 边界；③前端确认流用例断言回调参数与取消零回调——均为行为断言非空断言，边界/异常分支覆盖（403/404/422/幂等/取消），达标

#### 探针 4：决策追踪覆盖（agent 执行）
D-01@v1（方案 A 镜像会话）→ requirements FR-01~05（决策覆盖矩阵）→ plan 任务总表 D-01@v1 列 → 7 任务卡 decision_ids → 实现证据（本报告任务完成度表）——**闭环**，无未决 P0/P1。

#### 探针 5：API Contract Parity
- CLI 报 18 missing——**逐条归因后无真实缺口**：
  - 17 项为 daemon.ts 全文件进 change-diff 后被扫描到的**既有**调用（GET /api/daemon/sessions 等），后端端点实际存在（openapi.json:14241 实证 /api/daemon/sessions；runtimes/machines/shared-agents 同理均既有端点）——change-diff 口径下后端侧只对账本变更产物，既有调用成口径噪音
  - 1 项 `DELETE {param}/{param}`（daemon.ts:2616）为本变更 deleteGroupChat 的 const 间接模板字面量被探针误解析（产出无 /api 前缀的畸形路径）；后端端点 /api/daemon/group-chats/{group_id} DELETE 实际存在（openapi.json:10989）
  - 本变更三新调用 archive/unarchive 未在 missing 列表（对账命中）；delete 经误解析但后端实证存在
- 980 unused 为全仓端点 × 局部对账的常规 warning，不阻断

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录；本变更纯新增功能，无删码面

## 测试结果

| 命令 | 结果 | 时间 |
|---|---|---|
| CLI verify 对账 commands.test（backend 模块子集） | 首跑 **1 failed, 1228 passed** → 修复后复验 **全绿**（见下 remediation） | 2026-09-03 19:0x 主仓 |
| cd backend && uv run pytest app/modules/agent/tests/test_group_chat_models.py -q | 修复后 **28 passed** | 2026-09-03 19:0x |
| cd backend && uv run pytest app/modules/daemon/tests/test_group_chat_management.py -n auto -q | **34 passed**, 80 warnings（均既有 deprecation） | 2026-09-03 18:20 主仓 |
| cd frontend && pnpm exec tsc --noEmit | **0 错误**（exit 0） | 2026-09-03 18:24 主仓（一次瞬时报错为并行会话写入瞬间态，复检 0 错） |
| cd frontend && pnpm vitest run session-list-panel + create-group-wizard + group-chat-panel 三文件 | **3 files / 164 tests passed**（首跑 1 例滚动定时 flaky，复跑两连全绿） | 2026-09-03 18:24 主仓 |
| alembic 往返（scratch 库） | upgrade head → downgrade -1 → upgrade head 全成功 + 列类型核验 | 2026-09-03 17:25 worktree |
| uv run ruff check + format --check + mypy（本变更文件逐个） | 全绿 | execute 期 + verify 期复跑 |

**Remediation（CLI 对账拦截后的修复记录）**：`test_group_chat_models.py::test_agent_group_chat_table_contract` 断言 AgentGroupChat ORM 字段全集，task-01 加 `archived_at` 列后 extra={'archived_at'} 失败——该契约测试属 task-01 related_tests 漏声明（plan 审查盲区：co-located agent/tests 不在 daemon/tests 检索面）。修复=期望集合同步加 `'archived_at'`（机械同步，非弱化断言；同文件 `test_upgrade_creates_group_tables` 只跑群建表单迁移模块、不含新列，其断言不动）。修复后该文件 28 passed，CLI 复验全绿。

**Remediation 2（CLI 二次对账拦截 → 归因实证 → 修复）**：frontend 段 2 例失败（session-panel-pre-session.test.tsx 预会话创建失败用例）。**归因实证**（临时 worktree 检出对方提交父位跑同文件 36/36 绿 + 逐文件二分锁定 session-panel.tsx）：并行变更已提交的 ffef540e0（ql-20260903-012 错误出口中文化）在 session-panel 引入 `errMessage` 调用，而该测试文件 `vi.mock("@/lib/errors")` 只导出 useNotify——缺 `errMessage` 导出抛 unhandled rejection，preError 永不落、label 断言挂。与本变更 14 文件零交集（我的改动不含 session-panel）。修复=mock 补齐（`importActual` 部分mock：errMessage 透传真实实现 + useNotify noop 补 warning）——机械同步非弱化，修后 36/36 绿。该债属对方 quick 范围，此处按 CLI「仍失败才是本变更的」决策树与仓库「顺手修测试债」惯例代修并留痕。

known_failures 豁免：不涉及。全量测试按 CLAUDE.md 规则 0 留 CI。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-01@v1 方案 A 镜像会话（群级标志位+群主门+软删） | FR-01, FR-02, FR-03, FR-04, FR-05 | task-01~07 | 任务完成度表 + 测试结果节 | 闭环 |

## 技术债务

- 探针 1 零 TODO/FIXME 命中；无新增债务
- 已知限制（记录在案非债务）：FastAPI bool|null 无法显式传 null → presence 已归档群快照降级（daemon.ts 注释锚定后端补全量入口后的单点改造路径，另行需求）

## 变更风险等级

**integration-critical**（design 命中关键词 daemon/backend/session——实际触碰 daemon 群模块 + agent_sessions 时间线行软删，判级成立不申请降级）。Runtime Evidence 依规必填，见下节。

## Runtime Evidence

1. **迁移真实落库**（2026-09-03 18:36，主仓 dev 库）：
   - `alembic current` 前置位点 20260903090000（并行变更迁移已应用，链路无分叉）
   - `alembic upgrade head` → `Running upgrade 20260903090000 -> 20260903170000, agent_group_chats 加 archived_at 归档时间戳列`
   - information_schema 实查：`agent_group_chats.archived_at` = `timestamp with time zone`, `is_nullable=YES` ✅
   - 干净库往返（worktree scratch 库 platform_wt_verify_task01）：upgrade→downgrade→upgrade 全链成功
2. **HTTP 层真实请求响应**（httpx ASGI 传输，真实 FastAPI app 路由→service→DB 全链）：
   - POST /api/daemon/group-chats/{id}/archive → 204；重复调用幂等 204；?archived=true 列表出现；unarchive → 204 恢复默认列表
   - DELETE /api/daemon/group-chats/{id} → 204 + DB 实查：影子会话 status=ended、群时间线 AgentSession.status=ended 且群行+时间线行 deleted_at 双非空；此后 GET /{id} → 404、影子日志解析 → 404、属主 GET /api/daemon/sessions/{时间线id} → 404
   - 权限矩阵：普通成员三端点 403（中文文案断言）；非成员 404；workspace admin 放行
   - 传输层边界：?archived=null → 422（FastAPI bool 解析拒绝）
   - SSE：archive → status_changed、delete → deleted，payload 含 audience_user_ids=全部用户成员
   （以上均为 test_group_chat_management.py 34 用例断言内容，18:20 主仓实跑 34 passed）
3. **前端类型产物真实生成**（18:22 主仓）：pnpm gen:types 从后端 dump 再生成，api-types.ts 含 archive_group_chat/unarchive_group_chat/delete_group_chat 三 operationId 与 GroupChatRead.archived_at；tsc --noEmit 0 错误
4. **生命周期终态断言**：删除后 SSE deleted 信号 audience 送达（删除前成员集，订阅侧过滤命中）；幂等不重发断言存在
5. **失败模式排除**：daemon 离线场景——影子 end 收口的 WS 投递失败由 end_group 内部 warning 吞掉不阻断软删（既有语义，代码路径核对）；DB 失败整请求 500 无半态（删除未落库）
6. 不涉及：启动命令变更、部署脚本、跨进程协议——「不涉及」

## 代码审查

- execute 期三道审查：7 per-task review（主代理逐 diff 审查）+ 独立 QA acceptance review（FR 逐条/跨 task 交界/design 对照/组装实测，1 gap 已修）+ 本阶段探针终审
- 问题清单：无阻断项。已修：router docstring 幂等 204→404 失实（0bd760e78）、归档视图计数字面（ddc88952d）
- 总体评价：实现严格镜像会话先例，边界（权限/幂等/旁路/传输层）均有测试锚点；并行变更共存经增量 patch 合并后主仓并集全绿
