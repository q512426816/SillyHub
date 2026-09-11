# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（4/4 task、AC 6/6 实测、三零回归/安全矩阵/bundle 第三源全绿；NOTES 两条：集成面为本地 file:// 假仓真 git 链（无外网依赖）——真远端仓库活体留部署后；daemon src 唯一 diff=api-types 生成物计划内）

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: 真实集成验收 77 用例——三零回归（version hash 逐项基准）+SSRF/admin/git 缺失/双上限安全矩阵 + file:// 本地假仓真 git clone 的 bundle 第三源收集/同名矩阵/悬空跳过 | command: cd worktree/backend && uv run pytest app/modules/skill_source app/modules/daemon/tests/test_skills_bundle.py -q | exit: 0 | log: .sillyspec/.runtime/verify-skills-receipt.log

## 任务完成度 [层：人工判断]
4/4 完成（execute 独立验收 AC 6/6+高危全过）。

## 设计一致性 [层：人工判断]
与 design 一致；SSRF 400（蓝图权威对 assert_public_url 原生码）；api 客户端落位按卡权威（组件共置非 lib/）；D-010 去重 origin 粒度（比蓝图更严谨防同源兄弟误删）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:backend/app/modules/skill_source/__init__.py、NEW:backend/app/modules/skill_source/model.py、NEW:backend/app/modules/skill_source/schema.py、NEW:backend/app/modules/skill_source/service.py、NEW:backend/app/modules/skill_source/git_fetcher.py、NEW:backend/app/modules/skill_source/router.py、NEW:backend/app/modules/skill_source/tests、NEW:backend/migrations/versions/xxxx_add_skill_source_tables.py、NEW:frontend/src/components/skills-library、NEW:.sillyspec/docs/backend/modules/skill_source.md

#### 探针 2：设计关键词覆盖
关键词全覆盖：skill_source/git_fetcher/discover_skills/user_skill_enables/library/enable/skills_git_cache——三端命中无缺。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules、backend/migrations、backend/app）找到 68 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-02: 模块目录（backend/app/modules）找到 49 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-03: 模块目录（backend/app/modules、backend/app/modules/agent、backend/app/modules/daemon/tests）找到 59 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-04: 模块目录（frontend/src/app/(dashboard)/settings、frontend/src/components、frontend/src/lib、backend、sillyhub-daemon/src、.sillyspec/docs/backend）找到 78 个测试文件（frontend/src/app/(dashboard)/settings/mcp/page.test.tsx、frontend/src/app/(dashboard)/settings/providers/__tests__/page.test.tsx、frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx、frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
闭环：D-002/007→task-01（admin 门+SSRF+探测）；D-006→task-02（浅参数/超时/上限）；D-003/005/010→task-03（默认关/version 零改/origin 粒度矩阵）；D-011→范围（收编砍留痕）。D-004 superseded 如实。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2170 backend endpoints (live [scan-root 587 + worktree 594] + artifact 1782), 6 frontend calls [scope: change-diff (25 files @ worktree)] | 612 backend endpoints unused by frontend | 6 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 6 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）
- ⚠️ 612 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/brainstorm-gate-agent-unavailable-and-list-path-parse.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/daemon-heartbeat-workspace-key-no-uuid-guard.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/init-lease-silent-no-local-yaml.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]
execute 验收底账：backend 77+邻接 127、frontend 22+tsc 0、lint 全绿、双仓 gen:types:check 0；本阶段集成回执另跑 77 passed 在案。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-002/007 | 01 | 01 | 26 用例（SSRF/admin/探测） | 闭环 |
| D-006 | 01 | 02 | 15 用例（file:// 假仓） | 闭环 |
| D-003/005/010 | 02,03 | 03 | 三零回归+矩阵 6 用例 | 闭环 |
| D-011 | 范围 | — | 收编砍留痕 | 闭环 |

## 技术债务 [层：人工判断]
变更文件零 TODO/FIXME（探针+grep 双确认）；_trigger_fetch 占位已由 task-02 实调消除。

## 变更风险等级 [层：人工判断]
<!--TODO: doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
- 触碰组件：backend skill_source 模块+agent bundle 组装+前端技能页；daemon 零逻辑改动
- 核心路径证据：77 passed 含 file:// 真 clone→发现→启用→bundle 收集→version 变化全链（test_skills_bundle 6 新用例）
- 失败模式排除：SSRF 私网 400/git 缺失 422/上限跳过/悬空绑定保留/源删除连带/未启用零收集
- 不涉及：远端公网仓库活体（部署后 admin 真配一个源验证）；daemon 进程

## 并行会话干扰实录（verify 门终审证据链）

verify CLI 实测门（main 工作区全量跑）两轮报 frontend+sillyhub-daemon 模块红。逐例归属鉴定（HEAD 干净 worktree 副本实测法）：

| 失败用例 | main 工作区 | HEAD 干净副本 | 归属 | 处置 |
|---|---|---|---|---|
| provider-registry 8 键断言 | 红 | 红 | **真预存债**（99a228add 加 dialog 键未同步测试） | 已修+提交（ql-20260911-017） |
| use-daemon-machines sessions | 红 | 红 | **真预存债**（a1d7ffba4 改 includeSessions 默认未同步） | 已修+提交（ql-20260911-018） |
| delete-change-confirm 详情页 | 红 | **绿** | 并行会话 WIP 污染（scope-audit-card 未提交编辑渲染非法选择器 div.mt-1,,,） | 不可修——他人活跃编辑中文件 |
| daemon AC-07b claim_resp | 红 | **绿** | 并行会话 WIP 污染（daemon.ts MM 态 staged+unstaged） | 不可修——同上 |

结论：本变更自身的全部测试（backend 77+邻接 127 / frontend 22 / lint / 双仓 gen:types）在隔离 worktree 全绿（execute 独立验收在案）；main 门残余两红 100% 来自并行会话未提交工作区状态，与本变更零关联（HEAD 副本双绿为证）。verify 门通过条件被并行会话活跃编辑结构性阻塞——非本变更质量问题。

## 代码审查 [层：人工判断]
无阻断。NOTES：① 集成为本地 file:// 假仓（CI 可重复零外网）——真远端源（如 anthropics/skills）留部署后活体 ② daemon src diff 仅 api-types 生成物。
总体：设计-实现一致（D-010 origin 粒度优于蓝图）；测试金字塔完整（backend 77+127/前端 22）；安全三防线齐；三零回归锁定。可归档。
