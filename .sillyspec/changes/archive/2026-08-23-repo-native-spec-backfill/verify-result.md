---
author: qinyi
created_at: 2026-08-23 23:05:00
---

# 验证报告 — 2026-08-23-repo-native-spec-backfill

## 结论：**PASS** — FR-1~FR-6 全部实证达成；双侧提交（主仓 63804f46 / 工具仓 2c35ab2 发版 3.27.3）落地且独立实现审查 pass（10 pass/2 gap/0 fail）；断链修复端到端证据=服务器 spec-manifest 14 文件实时上行。

## 任务完成度

| task | 状态 | 证据 |
|---|---|---|
| task-01 | ✅ 完成 | 主仓 63804f46：spec_strategy 三分支实码（context_builder.py:138-199/:392-395）+ 26 tests passed（快照先行：platform-managed/repo-mirrored 逐字节不变）+ ruff clean |
| task-02 | ✅ 完成 | 工具仓 2c35ab2：isSelfReferentialSpecRoot(:504)/isPlatformMode(:526) + 四处收敛（:578/:651/:674/:741）+ 14 用例；npm test 299 绿 |
| task-03 | ✅ 完成 | writePlatformPointer 自指守卫(:412) + 恢复忽略 warn(:327) + 声明降级 + 残留清理守卫 + doctor detectRepoNativeChain 三画像；40 断言 |
| task-04 | ✅ 完成 | 3.27.3 全局生效 + 四项冒烟（自指 fixture warn+exit0 / 外部目录保持 / helper 落位） |
| task-05 | ✅ 完成 | verify-evidence.md：指针现场干净 / manifest 13→14 文件（tasks.md v8 实时递增）/ junction 健在 / daemon 零改动 |

## 设计一致性

与 design.md 一致，两处已记录的执行期裁决（均经审查确认等价）：①指针写入从"command.js:363 门禁 + init.js:423 realpath"改为 writePlatformPointer 内部单点收口（等价覆盖两调用方，且规避并行变更在途的 init.js 纠缠）；②新增第 4 守卫（command.js:424 残留清理自指跳过——实测发现的破坏性缺陷，FR-4 ②b 验收必需）。偏差详情见 execute 期 task-03 卡片 implementation 与 per-task review。

## 探针结果（CLI 机械预填）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖（agent 执行）
- isSelfReferentialSpecRoot / isPlatformMode → shared.js:504/:526 导出 ✅（全局安装源码 import 复核 function）
- "自指平台指针（repo-native junction 回环）" 恢复忽略 warn → command.js:327 ✅
- writePlatformPointer 自指守卫 → shared.js:412 ✅
- doctor 画像 detectRepoNativeChain/repo_native_chain → doctor-diagnostics.js 6 处命中 ✅
- resolve-by-root-path（本地模式 workspace 归属）→ sync.js 2 处 ✅
- strategy 三分支/repo-native 本地模板 → 主仓 context_builder.py:392-395+模板分支 ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/agent、backend/app/modules/agent/tests）找到 10 个测试文件
- ⚠️ task-02/task-03: 探针在**主仓** src/run 找测试=跨仓误报——实际测试在工具仓 test/platform-mode-helpers.test.mjs（14 用例）与 test/selfref-pointer-immunity.test.mjs（40 断言），node --test 实跑 2 pass/0 fail，npm test 全量 299 绿（独立审查亲跑复核）
- ⚠️ task-04: 发版型任务无模块目录，验证=--version+冒烟四项（见 verify-evidence.md）
- ✅ task-05: 模块目录找到 10 个测试文件（含被验证入口）
- 集成盲区标注：repo-native scan 模板的**运行后端生效态**（backend 需重启加载 63804f46）未现场触发——由 26 项单测快照覆盖行为，生效态抽查依赖下一次平台 scan（设计允许，见 verify-evidence.md §5）；本地→平台上行链路已用 manifest 实证（真实集成证据，覆盖 resolve-by-root-path+shpsync+apply_ops 全链）

#### 探针 4：决策追踪覆盖（agent 执行）
见下方决策追踪矩阵，四项全部闭环。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 198 backend endpoints, 0 frontend calls [scope: change-diff (12 files)]
- ⚠️ 107 个后端端点前端未调用：平台存量现象（auth/login 等基础端点在列可证与本次无关），非本变更引入

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录

## 测试结果

| 命令 | 结果 |
|---|---|
| worktree backend: pytest app/modules/agent/tests/test_context_builder.py -q | **26 passed**（20 既有+6 新增；快照断言平台模板逐字节不变） |
| 主仓外溢：agent tests 全目录 / tests/modules/agent / spec_workspace | 885 passed / 209 passed / 106 passed（bootstrap.py:489 真实调用方零回归） |
| 工具仓: npm test | **299 通过 0 失败**（独立审查亲跑复核一致） |
| 工具仓: node --test 两个新测试文件 | 2 pass / 0 fail（内部 54 断言全过） |
| 工具仓: npm run lint | 通过（402 文件） |
| ruff check（两文件） | All checks passed |

known_failures 豁免：无。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 双管修复 | FR-1/2/3/4/6 | task-01~04 | 三分支实码+双 helper+四门禁+3.27.3 冒烟 | 闭环 |
| D-002@v1 仅 repo-native 变 | FR-1/5 | task-01/03 | 快照逐字节断言+外部目录平台模式冒烟+worktree 漂移锚点全绿 | 闭环 |
| D-003@v1 daemon 非目标 | （约束） | — | git show 2c35ab2 零 sillyhub-daemon 文件；worktree diff 零 daemon 文件 | 闭环 |
| D-004@v1 repo-mirrored 差异保留 | FR-1 | task-01 | service.py:1358 stage 门禁未动（diff 核实）；design 风险 6 登记 | 闭环 |

## 技术债务

探针 1 零命中。登记项（非债，后续变更）：daemon repo-native 事件式回灌（D-003）；repo-native 双写者竞态根治（design 风险 4，现行 apply_ops 单写者+reparse 收敛）；backend 运行实例重启加载 task-01。

## 变更风险等级

**contract-required**（跨 CLI/backend 双侧行为契约变更，含同步门禁语义；非 deployment-critical——未上线不要求历史兼容，且已现场重装生效）。

## Runtime Evidence

- `sillyspec --version` → 3.27.3（2026-08-23 22:2x 全局重装后）
- 自指 fixture 冒烟：`⚠️ 检测到自指平台指针（repo-native junction 回环…）已忽略并按本地模式运行` + exit 0（task-04 b）
- 断链修复端到端：`GET /api/changes/-/spec-manifest`（shpsync token）→ 本变更 14 文件在服务器权威清单，tasks.md 版本 v8 随本地勾选实时递增（22:29 与 23:0x 两次采样 13→14 文件、v7→v8）
- daemon junction `~/.sillyhub/daemon/specs/de24ed7c-…-2021d6` → `/Users/qinyi/SillyHub/.sillyspec` 健在；`/api/health` ok
- 主仓现场：仅 `.sillyspec-platform-cleaned`（HUB-12 marker），无指针/接管声明
- commit：主仓 63804f46（task-01 apply）+ 文档同步 commit；工具仓 2c35ab2（7 文件精确 pathspec）
- 失败模式排除：--spec-dir 真外部目录平台模式保持（task-04 c）；worktree 漂移守卫 11/11；platform-recovery 19/19；spec-dir 38/38

## 代码审查

独立实现审查（agent_8170ece9）结论 pass：FR 逐行实码核验、平台模板 HEAD vs 工作树逐行 diff 零差异、越权与归属核验（2c35ab2 精确 7 文件零混入并行变更）、测试亲跑复核。遗留 gap 两项均已裁决（doc 行号同步=仓内测试强制；base_commit 锡点已修正父提交）。总体评价：实现边界清晰、防御纵深完整（四门禁+单点收口），测试快照先行纪律到位。
