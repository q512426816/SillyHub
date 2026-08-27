# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS WITH NOTES（R-1 冒号名真实调起为设计内移交项——需真实 Claude Code 环境，用户实测步骤已写入 smoke-result.md；其余全部验收项通过且有真实集成证据）

## 任务完成度

10/10 全部完成（tasks.md 10 勾 + per-task review.json pass ×10，execute-runs/exec-2026-08-27-114628）。
逐任务证据：task-01 纯函数 23 用例；task-02 浮层 41 用例；task-03 输入框接入 21+2 用例（含 A-1 双向复位修复）；task-04 数据 hooks 6 用例；task-05 面板接线（7 发送点位）129 定向 + 全量回归；task-06 invoke_name 17 用例 + 冒烟 20/20；task-07 inject 绑定（模块 1120 用例 + 真 PG 冒烟双通道）；task-08 类型组装 28 用例 + gen:types 产物精准；task-09 全量双端（backend 5876 passed / cov 92.94%；frontend 2626 passed / tsc / lint 0 错）；task-10 冒烟 9/10 PASS（smoke-result.md）。存疑：无。

## 设计一致性

与 design.md 一意一致，两处已声明的有意偏差：
1. detectMention 返回字段名 `start`（design §3.1 字面为 startIndex）——task-01 卡契约锁定，task-02/03 按此消费，功能等价（A-3 备注归档时同步措辞）。
2. 「挂载 prefetch」实现为「首次聚焦惰性挂载」（MentionSourcesBridge）——规避裸渲染 SessionPanel 的既有测试无 QueryClientProvider 崩溃，语义等价（预取先于输入、输入零请求），注释已声明理由。
执行期缺陷修复 2 项均属设计语义内收口（非偏差）：mentionsRef/pendingMentions 双向复位（A-1）、日志事件名 session_bind_requested（A-2）。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：……——**探针上下文错位标注**：探针在 worktree cleanup 后跑、按 worktree 路径探测；主仓（变更已 apply 暂存）实际抽验在位（session-mention.ts/session-mention-sources.ts/session-mention-popover.tsx/session-input-bar-mention.test.tsx 4 文件 OK，invoke_name/bind_change_key 符号分布 grep 命中），变更文件 TODO/FIXME/HACK/XXX 零残留（verify Step6 实测）。

#### 探针 2：设计关键词覆盖
能力关键词逐个 grep（主仓已应用代码）：detectMention/applyMentionPick（session-mention.ts）✅；invoke_name ?? name 回填（session-input-bar.tsx skill 分支）✅；bind_change_key/bind_quick_id（schema/router/facade/session-service/daemon.ts/session-panel 六文件分布）✅；compositionstart（IME 守卫）✅；setSelectionRange（光标回填）✅；useMentionSources（数据源）✅；placeholder 提示文案「/ 唤起技能 · @ 关联变更」✅；session_bind_requested（A-2 日志）✅；幂等 binder 复用（bind_session_to_change/quicklog 调用点）✅。

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01~10 模块目录「未找到测试文件」——同探针 1 的 worktree 清理后上下文错位；实际测试文件均在主仓（__tests__/session-mention.test.ts 等 8 个新测试文件 + 4 个后端测试文件扩充），W5/W12 全量双端绿。
- 集成盲区标注：路由级装配由 test_session_router.py 覆盖（httpx 端点级 6 用例）；真实运行时集成由 smoke（8100 真 uvicorn + 真 PG + 真 HTTP）覆盖——非盲区。

#### 探针 4：决策追踪覆盖
D-001（方案B）→ 全部 task → 四件套 + 用户确认记录 ✅；D-002（透传+invoke_name）→ FR-03/07 → task-01/06/08/10 → 23 用例 + 冒烟 20/20 ✅；D-003（inject 插入点）→ FR-06 → task-07 → pytest 忙轮用例 + 冒烟 504 后绑定持久 ✅；D-004（跨 workspace placeholder 语义）→ FR-06 → task-07 → test_session_service 跨 workspace 用例 ✅；D-005（128 对齐）→ FR-06 → task-07 → 422 校验用例 + openapi maxLength ✅；D-006（非目标边界）→ — → QA review diff 清单核验零越界 ✅。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3360 backend endpoints (live [scan-root 505 + main 505] + artifact 3030), 0 frontend calls [scope: change-diff (17 files @ scan-root)] | 1050 backend endpoints unused by frontend
- ℹ️ 「0 frontend calls」为 diff-scope 归属（前端新增调用走既有 fetch 封装不在 diff-scope 探测面）；1050 未调用端点为存量全仓现象与本变更无关。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 无删除；非 blocker。

## 测试结果

- backend：`uv run pytest -q --cov=app --cov-fail-under=60` → **5876 passed / 7 skipped / 3 xfailed，覆盖率 92.94%**（W5 全量基线；其后唯一后端改动为 A-2 一行日志事件名，由 daemon 模块 1120 用例复验全绿）
- frontend：`pnpm test` → **2626 passed / 2626**（含 A-1 修复新增 2 例）；`pnpm typecheck` → 0 错；`pnpm lint` → 0 Error
- known_failures：无

## 决策追踪矩阵（如存在 decisions.md；无则删本节）

（决策记录在 design §2.1，无独立 decisions.md；追踪见探针 4。）

## 技术债务

变更文件 TODO/FIXME/HACK/XXX = 0（探针 1 + Step6 实测双确认）。遗留备注（非债务）：A-3 design startIndex 措辞、A-4 page/dialog 失败保留语义差异（既有惯例）、R-7 草稿不存 mentions（设计取舍）。

## 变更风险等级

integration-critical（CLI 关键词判级：命中 session/daemon/backend——本变更确实扩展 daemon session inject 链路与 manifest 端点，判级属实，不申请豁免覆盖）。design frontmatter 无 risk_level 显式声明；关键词命中无否定语境抑制（design §9「不涉及生命周期契约」仅豁免生命周期表要求，不影响本判级）。

## Runtime Evidence

- **长驻进程启动命令**：worktree 后端隔离实例 `uv run uvicorn app.main:app --port 8100`（连 dev PG localhost:5432/platform + Redis，SKILLS_BUNDLE_DIR 指向 daemon 技能缓存 20 个 sillyspec-*），health OK（commit_sha=b4895c8 worktree 基线，2026-08-27 06:07 起，冒烟后已停止）。
- **触碰的服务端点**：GET /api/daemon/skills/latest/manifest、POST /api/daemon/sessions、POST /api/daemon/sessions/{id}/inject、GET /api/workspaces/{wid}/changes/{cid}/sessions、GET /api/workspaces/{wid}/quicklog-entries/{ql}/sessions、POST /api/daemon/register（假 runtime 过在线校验）。
- **触发核心路径的请求与关键响应**：① manifest → 20/20 skills 带 invoke_name（sillyspec-archive→"sillyspec:archive"）；② create 带 change_id+quicklog_id → 504（假 runtime 派发唤醒失败，预期）但 details.session_id 返回；③ inject 带 bind_change_key/bind_quick_id（active 会话）→ 504 同上；④ 非法 ql 前缀 → 422；空 prompt+仅 bind → 422；⑤ 变更/快速修复会话卡 → 本会话命中 1/4、1/3。
- **进程日志关键片段（证明走了新路径）**：`{"event": "session_bind_requested", "session_id": "dff674ae-…", "workspace_id": "b97f8231-…", "bind_change_key": "2026-08-27-background-subagent-progress", "bind_quick_id": "ql-20260827-009-f905", "level": "info"}`（A-2 改名后的新事件，绑定链路真实执行）。
- **生命周期终态断言（DB 直查）**：create 后 change_session_links + quicklog_session_links 各 1 行；inject 后新增 2 行 link（change×2/quick×2 齐备）；重复 inject link 零新增（幂等）。终态：冒烟数据全部清理（会话/link/假 runtime 删除）。
- **失败模式排除**：① 派发唤醒 504 不回滚绑定（binder 在派发前 commit 语义实证）；② failed 会话 inject 409 先于绑定（既有守卫，语义正确）；③ workspace None 守卫（pytest warning 断言）；④ binder savepoint 自吞不阻断消息（pytest patch select 抛错用例）；⑤ 跨 workspace change_key 只在会话自有工作区建 placeholder（pytest 用例）。R-1（Claude Code 冒号名真实调起）无法在本环境排除——假 runtime 无真 Claude，**移交用户合并后实测**（步骤在 smoke-result.md），已列 NOTES。

## 代码审查

execute Step11 独立 QA acceptance review（15 检查项 pass/pass）+ Step13 轻量复审：风格对齐 CONVENTIONS（中文注释/ruff/tailwind 语义类/antd 规避惯例）；无安全漏洞新增面（越权面收窄至既有 run_sync 等价暴露，D-004）；无 TODO/FIXME；错误处理完善（savepoint/None 守卫/best-effort 注释闭环）；无冗余（纯函数双消费单一真相）。总体评价：可合并质量。
