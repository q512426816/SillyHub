# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：<待填：PASS 或 FAIL（+一句话理由）>

## 任务完成度
<!--TODO: 逐 task 对照 tasks.md 勾选与验收标准，完成/未完成/存疑三态-->

## 设计一致性
<!--TODO: 实现与 design.md 的偏差（无偏差也显式写「一致」）-->

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx
- ℹ️ 清单文件不存在（跳过）：frontend/src/components/git-log/__tests__

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-02: 模块目录（backend/app/modules/git_log、backend/app、.sillyspec）找到 78 个测试文件（backend/app/modules/git_log/tests/test_graph_layout.py、backend/app/modules/git_log/tests/test_router.py、backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py …）
- ✅ task-03: 模块目录（backend/app/modules/git_log、backend/app/modules/git_log/tests）找到 2 个测试文件（backend/app/modules/git_log/tests/test_graph_layout.py、backend/app/modules/git_log/tests/test_router.py）
- ✅ task-04: 模块目录（backend/app/modules/git_log、backend/app/modules/git_log/tests）找到 2 个测试文件（backend/app/modules/git_log/tests/test_graph_layout.py、backend/app/modules/git_log/tests/test_router.py）
- ✅ task-05: 模块目录（frontend/src/lib、backend）找到 56 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ✅ task-06: 模块目录（frontend/src/components、frontend/src/app/(dashboard)/workspaces/[id]/git-log、frontend/src/components/git-log）找到 15 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts、frontend/src/components/agent-log/__tests__/run-error-item.test.tsx …）
- ✅ task-07: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/git-log、frontend/src/components/git-log、frontend/src/components/git-log/__tests__、.sillyspec/changes/2026-08-25-workspace-git-log）找到 5 个测试文件（frontend/src/components/git-log/__tests__/commit-detail-drawer.test.tsx、frontend/src/components/git-log/__tests__/commit-graph.test.tsx、frontend/src/components/git-log/__tests__/file-tree.test.tsx、frontend/src/components/git-log/__tests__/git-log-page.test.tsx、frontend/src/components/git-log/__tests__/lane-palette.evidence.test.tsx）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 709 backend endpoints (live [scan-root 205] + artifact 615), 0 frontend calls [scope: change-diff (65 files @ scan-root)] | 333 backend endpoints unused by frontend
- ⚠️ 333 个后端端点前端未调用（warning 不阻断）：GET /agent/file-artifacts、GET /missions/status、POST /auth/login、GET /auth/captcha/confirm、POST /auth/captcha/verify …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果
<!--TODO: 测试命令 + 结果（通过数/失败数；known_failures 豁免逐条注明）-->

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
<!--TODO: | 决策 ID | FR | Task | Evidence | 状态 |（D-xxx@vN → FR-xxx → task → 证据回指闭环）-->

## 技术债务
<!--TODO: TODO/FIXME/HACK 统计（探针 1 的命中已预填在上方探针结果）-->

## 变更风险等级
<!--TODO: doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence
<!--TODO: 关键命令输出/时间戳/commit hash 证据链；integration/deployment-critical 必填，按实际触碰的运行时组件写（启动命令/端点/请求响应/日志片段/生命周期终态断言/失败模式排除），未涉及的行写「不涉及」-->

## 代码审查
<!--TODO: 问题列表 + 总体评价-->
