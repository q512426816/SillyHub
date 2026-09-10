# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`——5/5 任务完成、目标测试全绿、真实库冒烟证据达标、决策链路闭环；两条非阻断备注（跨进程实机 E2E 未跑留部署后人工确认 / 边界类型 skippedLines 计数口径偏大无害）与一条已论证偏差（@types/node 精确 pin 而非 caret）。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（execute 五任务 review.json 均 pass，无 cannot_verify）

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: verify 窗口内实跑 E2E：readZcodeSqliteMessages 直读真实库（readOnly）死会话 de7e1282（rollout 文件已清）→ parsed totalSegments=1784（窗口 truncated=true, skipped=1207 计边界行）；叠加 execute 期冒烟：user_input 三判据零泄漏（7=7）、文件对照偏差 1.0%、tool 配对 is_error、beforeSeq 翻页逐 seq 相等 | command: cd worktree sillyhub-daemon && pnpm vitest run tests/agent-log/zcode-e2e-smoke.verify.test.ts（临时用例，跑完已删，零残留） | exit: 0 | log: .sillyspec/.runtime/verify-logs/zcode-e2e-final.log

## 任务完成度 [层：人工判断]

- task-01 ✅ 完成：三导出（extractZcodeSessId/createZcodeFixtureDb/setZcodeSqliteDbPathFactory）+11 用例绿
- task-02 ✅ 完成：readZcodeSqliteMessages 主体+9 用例（共 20 绿），窗口/摘要口径与 parse-zcode-model-io 单源对齐
- task-03 ✅ 完成：host-fs-handler 分派块（守卫后 registry 前）+6 用例（含越界守卫先行断言）
- task-04 ✅ 完成：content 端点 zcode 分支+11 用例（共 28 绿，既有 17 零改动）
- task-05 ✅ 完成：@types/node 22.13.0 精确 pin+lockfile、回归（daemon tests/agent-log 109 绿 + backend platform_sync 224 绿 + typecheck 零错）、真实库冒烟全达标
完成率 5/5=100%（worktree d91219e7..4634adfeb 五提交）

## 设计一致性 [层：人工判断]

与 design.md 一致，Phase 1/2/3 逐项落实（映射表/插入点/合成与回落/不截断）；已核偏差两处（均有论证注释，非违背）：
1. node:sqlite 经 createRequire 而非动态 import()——vite 5 无法外部化 node:sqlite 动态 import（两次实测失败），createRequire 走 CJS 加载器不被改写；只读语义经 { readOnly: true } 等价实现（D-006「惰性加载」意图保持）。
2. @types/node 精确 pin 22.13.0 而非 ^22.13.0——caret 解析 22.20.2 后 readdir 重载序破坏 terminal-observer.ts:82 类型（超出本变更 allowed_paths 不顺手改），task 卡「≥22.13」+「typecheck 绿」双约束下 pin 是正解。
边界类型（step-start/finish/timeline/file/compaction）计入 skippedLines 使计数偏大——design 未规定边界行计数口径，parsed 输出不受影响，无害。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts、NEW:sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts、NEW:sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts

#### 探针 2：设计关键词覆盖
✅ 十个能力关键词在改动源（read-zcode-sqlite.ts / host-fs-handler.ts / router.py）全部命中：readZcodeSqliteMessages(2)、extractZcodeSessId(2)、uiVisibility(1)、transcriptVisibility(1)、model-only(1)、readOnly(1)、beforeSeq(3)、_synthesize_pseudo_jsonl(1)、read_file 回落(2)、256KB 截断常量 262144(1)——无未实现关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/tests/agent-log）找到 9 个测试文件（sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts、sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts …）
- ✅ task-04: 模块目录（backend/app/modules/platform_sync、backend/app/modules/platform_sync/tests）找到 10 个测试文件（backend/app/modules/platform_sync/tests/conftest.py、backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py、backend/app/modules/platform_sync/tests/test_agent_log_messages.py …）
- ✅ task-02: 模块目录（sillyhub-daemon/src/agent-log、sillyhub-daemon/tests/agent-log）找到 9 个测试文件（sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts、sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts、sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests/agent-log）找到 11 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/agent-log/liveness/derive-claude.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-codex.test.ts、sillyhub-daemon/tests/agent-log/liveness/derive-zcode.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon）找到 11 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
✅ D-001~007 七条全部闭环（无 unresolved/superseded 引用）：requirements.md 覆盖矩阵逐条映射 FR，plan.md 覆盖矩阵映射 task，task 卡 decision_ids 落实，证据见下方决策追踪矩阵。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2091 backend endpoints (live [scan-root 572 + worktree 572] + artifact 1716), 0 frontend calls [scope: change-diff (8 files @ worktree)] | 591 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 591 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]

- `pnpm vitest run tests/agent-log/`（worktree sillyhub-daemon）：11 文件 109 用例全绿（新增 26：reader 20 + dispatch 6；既有零回归）
- `uv run pytest app/modules/platform_sync/tests/ -q --no-cov`（worktree backend）：224 passed（含 content 28：既有 17 零改动+新增 11；messages 19 全既有零回归）
- `pnpm typecheck`（worktree sillyhub-daemon）：tsc --noEmit 零错误（@types/node 22.13.0 下 node:sqlite 声明可用）
- 全量测试留 CI（CLAUDE.md 规则 0）；本变更触碰面（agent-log / platform_sync）已全覆盖

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 恒库+文件兜底 | FR-01/03 | task-02/03 | readZcodeSqliteMessages 主路径+ZD2a/2b/3 回落四态用例；冒烟死会话 parsed | 闭环 |
| D-002@v1 DB 路径不截断 | FR-02 | task-04 | test_parsed_large_payload_not_truncated（300KB 全量返回） | 闭环 |
| D-003@v1 隐藏三判据过滤 | FR-01 | task-02 | R1 隐藏零泄漏断言 + 冒烟 user_input 7=7 三判据独立反算 | 闭环 |
| D-004@v1 tool 单 part 两段 | FR-01 | task-02 | R1 running/pending 单段 + 冒烟 completed/error 配对 is_error | 闭环 |
| D-005@v1 守卫后 registry 前分派 | FR-03 | task-03 | diff 行级核验 + ZD5 越界 forbidden 先于分派 | 闭环 |
| D-006@v1 node:sqlite 版本带+types | 非功能 | task-02/05 | createRequire 惰性加载 + R6 不可用降级用例 + @types pin 22.13.0 | 闭环 |
| D-007@v1 九字段封闭+回落捕获 | FR-02 | task-04 | _AGENT_LOG_MESSAGE_FIELDS 固定键序断言 + except Exception 全族参数化回落 | 闭环 |

## 技术债务 [层：人工判断]

本变更新增代码零 TODO/FIXME/HACK（探针 1 命中 0）。遗留观察项（非债务）：@types/node 若日后升 >22.13 需顺带修 terminal-observer.ts:82 readdir 重载类型（超本变更范围未动）。

## 变更风险等级 [层：人工判断]

显式声明 = integration-critical（design frontmatter）。理由成立：动 daemon 读取链路（host-fs-handler 分派）+ backend 端点分支，跨进程 RPC 接缝。集成证据已按级落：真实库冒烟（见集成验证回执）+ dispatch 测试直调真实 handler 方法 + backend 用例走真实端点函数（mock 仅传输层）。未覆盖：backend↔daemon 实机联跑 E2E（需部署环境，备注非阻断）。无被否定语境抑制的关键词。

## Runtime Evidence [层：人工判断]

- 数据面：真实库 db.sqlite（readOnly:true）冒烟 2026-09-10 12:4x——sess_de7e1282（文件已清）parsed 1784 段翻页拼满；sess_subagent_agent_c8fc157d（文件在）sqlite 98 vs file 97；sess_01a91627 tool 配对 is_error 断言；beforeSeq=893 逐 seq 相等
- 现场反证：冒烟期间 rollout 目录两次轮转驱逐（b2da8d1d 文件被清；c941fd2b 被 resume 截断至 86 段 vs 库 1076 段）——「文件短命、库为权威」的运行时实证
- 生命周期终态/启动命令/端点请求响应：不涉及（本变更纯读取路径，无状态转移——design 自审 N/A 声明）
- commit 链：worktree d91219e7(baseline) → ff1053ed6(task-04) → a4a933b2(task-01) → 6265c31f(task-02) → task-03 dispatch commit → task-05 bump commit，终 4634adfeb

## 代码审查 [层：人工判断]

独立验收审查（execute-review-2026-09-10-125424）12 项 checklist 全 pass、零阻塞项；per-task review 5/5 pass（主代理逐一 diff 审查+独立复跑测试）。总体评价：实现收敛、注释带决策锚点、测试断言真实（双源内容证数据来源/零 IO spy/逐字段对照），fallback 语义四态全覆盖。遗留：跨进程实机 E2E 留部署后确认（备注非阻断）。
