---
author: qinyi
created_at: 2026-08-26 00:18:30
change: 2026-08-25-workspace-git-log
---
# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节已由 QA 主代理（2026-08-26 00:18）填实。

## 结论：PASS（七任务全部落地、三端静态/单测/构建全绿、真机 daemon↔backend 端到端六场景实测通过；遗留均为低风险已登记项，见「技术债务」）

## 任务完成度

| 任务 | 状态 | 证据 |
|---|---|---|
| task-01 daemon 四只读方法+平名注册 | ✅ 完成 | host-fs-handler.ts 四方法 + daemon.ts 4 处平名注册；33 用例（守卫矩阵/解析边界/空态/截断/只读 argv 逐 token 断言）；独立复跑通过 |
| task-02 backend 模块骨架+local.yaml 映射 | ✅ 完成 | git_log 九文件 + main.py:40/739 挂载；ruff/mypy/import 冒烟过；local.yaml:101 映射条目在（主仓直接落地，gitignored 文件 apply 不覆盖已注记） |
| task-03 graph_layout lane 计算器 | ✅ 完成 | 24 用例全过（七类拓扑+确定性三重验证含跨 PYTHONHASHSEED） |
| task-04 service 数据链路+集成测试 | ✅ 完成 | 36 集成测试（七分支+分页过滤+鉴权）；pytest app/modules/git_log 60 passed；explorer 回归 39 passed |
| task-05 gen:types+hooks | ✅ 完成 | openapi 三路径在（行 2605/2697/2750）；api-types 三主 schema+5 子 schema 零手写零漂移（diff 逐块核验）；tsc 0 error |
| task-06 前端页面组件 | ✅ 完成 | 七文件+四测试文件（35 用例）；全量 2232 用例零回归；grep 无 hex 无视口前缀；三主题色板逐主题=themes.ts（测试断言） |
| task-07 主题合规与验收 | ✅ 完成 | verify-evidence-theme.md：§12 清单 13 pass/0 gap；≥8 泳道辨识度成立（同色复用间隔恒 5 不相邻）；三子项目 build 全绿 |

完成率 7/7 = 100%。

## 设计一致性

实现与 design.md（含 Grill 修正 v2）一致。execute 期四处已声明偏离/勘误，均不违反契约：

1. `git_diff_file` 命令补空 `--pretty=format:` 去 commit 头（design §5.2 已同步勘误，测试固化断言）；
2. `backend/.../tests/__init__.py` 空文件补录 design §6 清单（pytest 包收集惯例）；
3. path 预检采用纯拒绝面（拒绝对路径/`..`/盘符/magic）而非 `_join_within_root` join 语义——安全面等价（daemon assertWithinAllowedRoots 为主防线），docstring 已说明；
4. `get_commit_detail` 对 probe=direct 返回 404（design 未细化该端点 no_git 形态，前端 no_git 时不发详情请求，无用户可见缺陷）。

## 探针结果（CLI 机械预填）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项已手动展开复核：frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx 存在且无标记
- ℹ️ 清单文件不存在（跳过）：frontend/src/components/git-log/__tests__ —— 目录项，实际 5 个测试文件全在（见探针 3 task-07 行）

#### 探针 2：设计关键词覆盖（QA 执行）

| 关键词（design §2/§5） | 实现命中 | 结论 |
|---|---|---|
| 泳道/lane | graph_layout.compute_lanes + commit-graph.tsx SVG | ✅ |
| 虚拟滚动 | commit-list.tsx @tanstack/react-virtual 固定行高 36px | ✅ |
| 目录树/文件树 | file-tree.tsx buildFileTree 按斜杠聚合 +x/-y | ✅ |
| unified diff | FileDiff 组件 + parseUnifiedDiff 纯函数 | ✅ |
| 分支过滤/作者过滤 | page.tsx Select(branches[])+Input → query 参数 branch/author → git log 参数 | ✅ |
| HEAD 标注 | refs kind=head 双写（commit.refs+顶层 head），泳道虚线环 | ✅ |
| 三态/probe/no_git | service probe 映射 direct→no_git、unknown→502 | ✅ |
| 平名注册 | daemon.ts registerRpcHandler('git_log'…) ×4 | ✅ |
| lookahead | service LOOKAHEAD=50 + 窗口截取 + 退化测试 | ✅ |
| 截断/truncated/binary | 64KB 截断 + Binary files 检测（daemon）+ 前端提示条 | ✅ |

无「可能未实现」项。

#### 探针 3：验收标准测试覆盖
（CLI 预填七行 ✅ 保留如上，略——见骨架原表）
- 集成盲区标注：**路由/跨进程装配已由本报告 Runtime Evidence 真机端到端覆盖**（列表/翻页/过滤/详情/diff/空态/离线全走真实 daemon↔backend 链路，非 mock）；前端路由装配（tab 注册）由 git-log-page.test.tsx 断言 TABS 15 项与 href 覆盖。
- 断言有效性抽查（3 个核心测试）：① test_router.py「正常列表」断言到 lane 数组/HEAD 双写/peeled tag 挂载/RPC 调用序与超时值（真实输出断言，非空断言）；② test_graph_layout.py「窗口一致」断言前缀计算与全量计算逐条相等（行为断言，重构不破）；③ commit-graph.test.tsx 断言 path d 属性精确坐标与 HEAD 环数量（副作用断言）。均达标，无 ⚠️。

#### 探针 4：决策追踪覆盖（QA 执行）

| 决策 | requirements 覆盖 | plan/task 覆盖 | 实现证据 | 闭环 |
|---|---|---|---|---|
| D-001@v1 自研泳道 | FR-01/08 | task-03/06/07 | commit-graph.tsx + 零新 npm 依赖 + 辨识度证据 | ✅ |
| D-002@v1 方案A链路 | FR-05/07 | task-01/02/04 | daemon RPC + 新模块 + 直连链路 + Runtime Evidence | ✅ |
| D-003@v1 只读边界 | FR-03/07 | task-01/02 | 只读四子命令逐 token 测试断言 + 无 DB 模型 | ✅ |
| D-004@v1 lane 后端算 | FR-01/06 | task-03/04 | compute_lanes + 全前缀窗口截取（真机 seq 连续实测） | ✅ |
| D-005@v1 三点补充 | FR-02/03/04/06 | task-04/06 | author/branch 过滤实测 + 文件树 + 虚拟滚动/按需 diff | ✅ |
| D-006@v1 Grill 修正 | FR-01/04/05/06 | task-01/02/04/06 | 平名注册 + git_mode 两态（真机 no_git 实测）+ 退化测试 | ✅ |

无 P0/P1 unresolved/blocking 决策（decisions.md 全 confirmed）。

#### 探针 5：API Contract Parity
- ✅ API parity check passed（CLI 原文保留）
- ⚠️ 333 个后端端点前端未调用：全仓现状 warning，与本变更无关（本变更三端点前端调用在 lib/git-log.ts 落地，探针 scope 为 change-diff 的调用统计口径，非缺陷）。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录（design §6 也无删除行，一致）

## 测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| backend git_log 模块 | `uv run pytest app/modules/git_log -q --no-cov` | **60 passed**（24 graph_layout + 36 router；1 条既有全局 DeprecationWarning 非本变更引入） |
| daemon | `pnpm test` / `pnpm typecheck` | **2785 passed + 9 skipped（既有）**，tsc 0 error |
| frontend | `pnpm test` / `pnpm exec tsc --noEmit` | **2232 passed**（新增 41 含证据用例，基线零回归），tsc 0 error（execute 期 TS2322 已修复复验） |
| 构建 | frontend `pnpm build` / daemon `pnpm build` / backend ruff+format+mypy | 全 exit 0（路由表含 /workspaces/[id]/git-log 18.8kB） |

known_failures 豁免：无。CLI 统一测试对账（--done 触发 local.yaml commands.test 按命中模块）见下方执行记录。

## 决策追踪矩阵

（同探针 4 表，D-001~D-006 全闭环 ✅——CLI 校验字面 ID 已全部出现。）

## 技术债务

- 探针 1 零 TODO/FIXME 命中。
- 已登记低风险遗留（verify-evidence-theme.md「附加源码观察」+ design §12）：① antd Drawer width=560 运行时弃用警告（功能正常，antd 6 API 演进，可在后续 UI 变更换 styles 形态）；② dark 主题 lane0/lane1 同为青系相邻（themes.ts 单一源逐字取值的既定取舍，8 泳道实测辨识度成立）；③ 真机手测期间发现的 ws-client Bearer 预留路径未实现属**既有代码**（非本变更引入，daemon 形态用 X-API-Key 是设计内行为）。

## 变更风险等级

**integration-critical**（CLI 判级，design 命中 daemon/backend 关键词，非误伤——本变更确实新增 daemon↔backend RPC 通道四方法）。集成证据见 Runtime Evidence（真实 daemon↔backend 端到端，非 mock）。design frontmatter 未显式声明 risk_level，维持 CLI 判级。

## Runtime Evidence

真实集成（e2e，非 mock）：本地起 backend（主仓代码，`uv run uvicorn app.main:app --port 8000`，PID 落盘）+ 第二 daemon 实例（`node dist/cli.js start --server http://127.0.0.1:8000 --api-key shk_live_…`，临时 6h API key）连同一 PG/Redis（Docker 栈 8001 全程未动）。WS 握手 `ws_daemon_connected total_connected=1`（backend log 16:10:46Z）。六场景 curl 实测（Authorization Bearer admin JWT）：

1. **列表**：`GET /git-log/commits?limit=3` → 200；git_mode=git；中文多行 message 保真；**真实 merge 拓扑 lane 边正确**（seq1 双父边 straight→seq3 + curve→seq2/lane1）；refs 合并（HEAD+main+workers/8d2d0392+origin/main）；branches[] 全量；has_more=true。
2. **详情**：`GET /commits/8a29e78…` → 200；29 文件 numstat（+45/0 等）；committer_date 在。
3. **diff**：`GET /commits/8a29e78…/diff?path=.sillyspec/quicklog/QUICKLOG-qinyi.md` → 200；纯 unified diff（diff --git 开头，无 commit 头）；truncated=false binary=false。
4. **过滤**：branch=workers/8d2d0392 → 该分支历史；author=qinyi → 作者全匹配；非法 sha / branch 首字符 - / skip=99999 → 全 422（预检先于 RPC）。
5. **翻页**：skip=3 → seq=[3,4,5] 全局绝对序、lane 与全量计算一致、页间无重叠。
6. **异常形态**：非 git 工作区（initverify-ws2-root2）→ 200 `git_mode=no_git` 空态（commits[]/head null）；绑定指向离线 daemon 的工作区 → 502 `HTTP_502_GIT_LOG_DAEMON_OFFLINE`（reason=probe_unknown）；无 token → 401。

日志片段（backend，结构化）：
```
{"daemon_id": "78cf1b41-…", "total_connected": 1, "event": "ws_daemon_connected", "level": "info", "timestamp": "2026-08-25T16:10:46.073845Z"}
{"method": "probe_workspace_git_mode", "workspace_id": "76baff71-…", "error": "DaemonRuntimeOffline", "event": "host_fs_rpc_failed", …}  ← 离线分支（切绑定前）
INFO: GET /api/workspaces/76baff71-…/git-log/commits?limit=3 → 200
```

现场清理与数据恢复（验证后即时执行）：workspace_member_runtimes 两行绑定恢复原 daemon_id（68c63051）；临时 API key 已 revoke（revoked_at=now）；backend 8000 与第二 daemon 进程树已停（8000 零监听确认；8001 Docker 栈健康未受影响）。

## 代码审查

- execute 独立 acceptance 审查（tier=independent 子代理）：specVerdict=pass / qualityVerdict=pass，12 条 checklist（11 pass + 1 gap）；gap 为证据测试 tsc 错误，已当场修复复验（tsc 0 error，6/6 用例通过）。
- 真机验证补充暴露并排除的失败模式：WS 握手 403（旧 JWT daemon 残留进程重连所致，杀进程后 api-key 实例即连上——非本变更缺陷）；per-server config token/api_key 切换语义正确。
- 总体评价：实现质量良好——安全守卫（argv/白名单/422 预检）在真机全部生效，错误映射中文文案完整，lane 算法在真实多分支仓库（sillyspec 仓，含 workers/* 与 sillyspec/* 多分支）上输出正确拓扑。
