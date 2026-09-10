# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（7/7 task、AC1-7 实测全绿、真 CLI 冒烟 A/B 全链命中 mock 含 Bearer；NOTES 三条均为非阻断留痕：litellm 通道产物级验证（容器不在本机，R-02 残差注释+模块卡留档）/主仓模块文档随归档提交/daemon 真机 E2E 留部署后活体——冒烟测试即真实 CLI×真实 spawn 产物链的集成证据）

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: 真实 CLI 全链冒烟——applyProviderFileSettings 产物对 spike golden 逐字段一致后，真跑 codex-cli 0.147.0 exec 与 pi 0.81.1 各一条，mock 端点分别收到 POST /v1/responses 与 POST /v1/chat/completions 且 Authorization Bearer 命中测试 key（+热切换重写/absent 边界/litellm 产物级断言） | command: cd worktree/sillyhub-daemon && pnpm vitest run tests/provider-injection-smoke.integ.test.ts | exit: 0 | log: .sillyspec/.runtime/mpi-smoke-verify.log

## 任务完成度 [层：人工判断]
7/7 完成（execute 独立验收 PASS：daemon 144+38/backend 237/frontend 74/门禁全绿）。

## 设计一致性 [层：人工判断]
与 design 一致；三处实现期决策均留痕：写盘门槛 warn+跳过（design 权威，子代理纠正主代理转述错误）；pi model 缺失跳过（docstring 有据）；boot 孤儿清扫为可选轻量实现（宁留勿删）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:sillyhub-daemon/src/codex-settings.ts、NEW:sillyhub-daemon/src/pi-settings.ts、NEW:sillyhub-daemon/tests/codex-settings.test.ts、NEW:sillyhub-daemon/tests/pi-settings.test.ts、backend/app/modules/llm_provider/tests、frontend/src/components/llm-providers、NEW:.sillyspec/docs/sillyhub-daemon/modules

#### 探针 2：设计关键词覆盖
设计关键词全覆盖：codex-settings/pi-settings/applyProviderFileSettings/PROVIDER_CONFIG_CHANGED/pi×openai_chat 禁配/openai-completions/wire_api responses——双端（daemon/backend/frontend）grep 命中，无未实现关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-05: 模块目录（backend/app/modules/llm_provider、backend/app/modules/llm_provider/tests）找到 9 个测试文件（backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py、backend/app/modules/llm_provider/tests/test_llm_provider.py、backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py …）
- ✅ task-06: 模块目录（frontend/src/components、frontend/src/lib、backend、sillyhub-daemon/src）找到 72 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ✅ task-07: 模块目录（sillyhub-daemon/tests、.sillyspec/docs/sillyhub-daemon）找到 14 个测试文件（sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts、sillyhub-daemon/tests/adapters/pi-json.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
闭环：D-001~D-012 全 accepted；D-003（spike 事实）→task-01 golden；D-004→task-02 golden；D-005/D-011（per-session 文件载体）→task-03/04 路径形状测试；D-008（分层）→pi base_url 门控用例；D-009（热切换尽力）→byte-equal 重写用例；D-012（门槛）→三态用例。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2726 backend endpoints (live [scan-root 586 + worktree 586] + artifact 2344), 3 frontend calls [scope: change-diff (21 files @ worktree)] | 808 backend endpoints unused by frontend | 3 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 3 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）
- ⚠️ 808 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]
execute 验收实测底账：daemon 144+38 passed、backend 237 passed、frontend 74 passed+tsc 零错、typecheck/gen:types:check（双仓）/ruff/mypy 全绿；本阶段 CLI 统一对账另跑（FR-12 不重复）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-003 codex 三路 | FR-01 | 01 | golden+env 不通留档 spike | 闭环 |
| D-004 pi 注入面 | FR-02 | 02 | 三文件 golden（b1b 官方形状） | 闭环 |
| D-005 载体文件 | 01,02 | 产物测试+key 不入日志断言 | 闭环 |
| D-008 并行分层 | 02,05 | base_url 门控+词表衔接 4726893a5 | 闭环 |
| D-009 热切换尽力 | 03 | byte-equal 重写用例 | 闭环 |
| D-011 per-session | 03,04 | 路径形状+生命周期三路径 | 闭环 |
| D-012 门槛 per-form | 01,05 | 三态用例+422 用例 | 闭环 |

## 技术债务 [层：人工判断]
变更文件零 TODO/FIXME/HACK（探针 1+grep 双确认）。非阻断留痕三条见结论枚举。

## 变更风险等级 [层：人工判断]
<!--TODO: doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
- 长驻进程：无（冒烟测试内嵌 mock listen 127.0.0.1:0 内核临时端口，afterAll 关闭；无残留 PID 需登记）
- 触碰的服务端点：mock /v1/responses（codex Responses API）与 /v1/chat/completions（pi chat）
- 触发核心路径：applyProviderFileSettings（spawn 同链产物函数）→ 真跑 codex exec/pi -p → mock 命中（路径+Bearer+model 三断言）
- 日志关键片段：mpi-smoke-verify.log（[task-07 smoke A] codex exit=0 stdout="mock says hi"；[smoke B] pi exit=0 同）
- 生命周期终态断言：CLI 子进程超时杀树（taskkill /T /F）；mock afterAll closeAllConnections；测试目录临时区
- 失败模式排除：门槛缺→零 mkdir 零 env；IO 失败→error 跳 env 仍 spawn；absent→逐字现状；热切换 byte-equal
- 不涉及：daemon↔backend 长跑 E2E（留部署后活体；冒烟已覆盖注入链核心）

## 代码审查 [层：人工判断]
无阻断问题。三条 NOTES：① litellm 通道产物级验证（容器不在本机；config.toml base_url/auth/model 断言+R-02 注释+模块卡降级路径留档）② 主仓模块文档（codex-settings.md/pi-settings.md/_module-map）随归档提交 ③ daemon 真机长跑 E2E 留部署后（冒烟=真实 CLI×真实产物链已覆盖注入核心）。
总体：与设计高度一致（12 决策全闭环）；测试金字塔完整（daemon 182/backend 237/frontend 74 相关）；跨进程注入契约三层覆盖（单元 golden+wiring 集成+真 CLI 冒烟）；key 安全断言（不入日志/argv/env）齐备。可归档。
