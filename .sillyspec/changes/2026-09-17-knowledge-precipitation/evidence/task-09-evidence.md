# task-09 端到端集成验证证据（deployment-critical）

| 元信息 | 值 |
| --- | --- |
| 变更 | 2026-09-17-knowledge-precipitation / task-09 |
| 执行日期 | 2026-09-17 |
| 验证对象（worktree） | `C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-17-knowledge-precipitation`，HEAD `9623bbf3b`（task-08 提交） |
| 环境 | Windows 10 19045 / Git Bash / uv（backend 内 .venv）/ pnpm + tsc 5.5.4 / sillyspec CLI（全局 nvm v24.15.0，`C:\Users\qinyi\AppData\Local\nvm\v24.15.0\node_modules\sillyspec`） |
| 约束遵守 | 本卡未改任何业务源码；SillySpec CLI 一律在主仓根目录跑（CLAUDE.md 规则 22），sandbox 经 `--spec-dir` 全局旗标定位；只跑 knowledge 面与前端相关面（规则 0，未跑全量） |

说明：应用装配冒烟命令的内联环境变量 `DATABASE_URL` / `SECRET_KEY` 为 conftest 同款安全占位值（`app.core.config.Settings` 仅这两个字段无默认值），不触碰真实 `.env`，import 阶段不连库。

---

## 1. 后端测试面

**验证内容**：knowledge 模块全量测试（parser/router/writer/distill）+ 权限矩阵 + migration 图一致性。

**命令**（worktree `backend/` 下）：

```bash
uv run pytest app/modules/knowledge -q
uv run pytest tests/modules/auth/test_permissions.py tests/test_migrations_graph.py -q
```

注：蓝图里 `tests/modules/auth/test_migrations_graph.py` 实际路径为 `backend/tests/test_migrations_graph.py`（worktree 实查），已按实际路径执行。

**关键输出摘录**：

```
59 passed, 13 warnings in 27.53s          # app/modules/knowledge
45 passed, 9 warnings in 9.91s            # auth permissions + migrations graph
```

**观察项（非失败）**：writer.py 三处 `HTTP_422_UNPROCESSABLE_ENTITY` DeprecationWarning（starlette 命名废弃，提示改 `HTTP_422_UNPROCESSABLE_CONTENT`）。不影响行为，属后续技术债，不在本卡修。

**结论**：通过（104 passed / 0 failed）。

---

## 2. 应用装配冒烟（import 链 + 路由装配 + 通配顺序）

**验证内容**：`app.main` 完整 import 链可装配；5 个新写端点 + 2 个 distill 端点已注册；字面量路由全部注册在 `GET /knowledge/{filename:path}` 通配**之前**（FastAPI 按声明序匹配，通配在前会吞掉同形字面量路径——router.py:47-53 声明的铁律）。

**命令**：

```bash
cd <worktree>/backend && DATABASE_URL=... SECRET_KEY=... uv run python -c "
from app.main import app
routes = [(getattr(r,'path',None), sorted(getattr(r,'methods',[]) or [])) for r in app.routes if getattr(r,'path',None)]
print('TOTAL_ROUTES', len(routes))
...  # 打印含 /knowledge 的路由及其注册序号
"
```

**关键输出摘录**（knowledge 路由注册顺序清单）：

```
TOTAL_ROUTES 624
379 GET  /api/workspaces/{workspace_id}/knowledge
380 POST /api/workspaces/{workspace_id}/knowledge/propose
381 PATCH /api/workspaces/{workspace_id}/knowledge/entries/{filename:path}
382 POST /api/workspaces/{workspace_id}/knowledge/proposed/{filename:path}/preview-merge
383 POST /api/workspaces/{workspace_id}/knowledge/proposed/{filename:path}/merge
384 POST /api/workspaces/{workspace_id}/knowledge/proposed/{filename:path}/reject
385 POST /api/workspaces/{workspace_id}/knowledge/distill
386 GET  /api/workspaces/{workspace_id}/knowledge/distill/tasks
387 GET  /api/workspaces/{workspace_id}/knowledge/{filename:path}   ← 通配殿后
```

**结论**：通过——import 链成功、624 条路由装配；task-04 的 5 个写端点（380-384）与 task-07 的 2 个 distill 端点（385-386）全部注册，且全部位于 `{filename:path}` 通配（387）之前。

---

## 3. CLI 同源交叉验证（R-03 核心：平台生成路由行 CLI 可解析检索）

**验证内容**：平台 writer 生成的 INDEX.md 路由行 / 目标文件追加段，能否被 sillyspec CLI 的 `knowledge validate`（结构合法、引用完整）与 `knowledge search`（关键词命中）接受——「平台写入 ↔ CLI 消费」同源硬证据。

**方法**：在 `%TEMP%\sillyspec-task09-sandbox\` 构造最小 `.sillyspec/knowledge` 树（INDEX.md 含 `## Known Issues` 段 + known-issues.md + 一份**逐字对齐 CLI `cmdPropose` 输出形态**的候选文件）；用 worktree 代码真实调用 writer 的 `build_route_line` / `_insert_route_line` / `_build_append_block` / `_extract_proposed_body` / `CATEGORY_SECTIONS` 模拟 `KnowledgeWriterService.merge` 的落盘计算（绕过 DB/apply_ops，写计算逻辑 100% 真源码）；再从主仓根目录跑真实 CLI 比对（`--spec-dir` 全局旗标指向 sandbox，CLI 源码 index.js:2631 确认透传）。

**命令与关键输出摘录**：

```bash
# ① 平台侧生成（worktree backend 下运行 simulate_merge.py，模拟 merge 落盘计算）
ROUTE_LINE>>>- 关键词a|关键词b → [known-issues.md#测试小节](known-issues.md#测试小节)
EXTRACTED_BODY>>>这是 task-09 端到端验证用的候选正文：平台合并后该段落应出现在 known-issues.md。
# sandbox INDEX.md 的 ## Known Issues 段内出现该路由行；known-issues.md 末尾追加「## 测试小节」段（CLI 尾注块已剥除）

# ② CLI validate（主仓根目录）
sillyspec knowledge validate --spec-dir <sandbox>\.sillyspec
{ "ok": true, "errors": [], "warnings": [] }

# ③ CLI search 命中平台生成行
sillyspec knowledge search --query 关键词a --spec-dir <sandbox>\.sillyspec
{ "ok": true, "query": "关键词a", "matches": [ {
    "id": "known-issues", "path": "knowledge\\known-issues.md",
    "score": 2,                       ← 两个关键词都被解析（关键词a|关键词b）
    "tags": ["关键词a", "关键词b"], "category": "Known Issues" } ] }

# ④ 负例对照（不相关查询词 → 零命中，证明命中来自平台生成行而非全量放行）
sillyspec knowledge search --query 毫无关系的查询词 --spec-dir <sandbox>\.sillyspec
{ "ok": true, "query": "毫无关系的查询词", "matches": [] }
# ⑤ 第二关键词 关键词b 同样命中（输出同 ③）
```

**格式同源源码对照**（字面一致）：

- 平台侧 `backend/app/modules/knowledge/writer.py:158-165`：`f"- {'|'.join(keywords)} → [{display}]({display})"`
- CLI 侧 `sillyspec/src/knowledge-classify.js:252`：`` `- ${kws.join('|')} → [${display}](${display})` ``

**过程记录（如实）**：首版 sandbox 候选文件的尾注块写成 `---` 与 blockquote 之间带空行，导致 `_extract_proposed_body` 剥除守卫未命中（尾注混入合并正文）。核对 CLI `cmdPropose` 源码（`stages/knowledge.js:451-457`：`'---', '> This is a proposed...'` 相邻无空行）后修正 sandbox 构造，剥除即生效——**属 sandbox 构造偏差而非代码缺陷**，反向证明了剥除逻辑与真实 CLI propose 格式逐字对齐。

**可复现工件**：`%TEMP%\sillyspec-task09-sandbox\simulate_merge.py`（模拟脚本）与该目录下整棵 `.sillyspec/knowledge` 结果树。

**结论**：通过——validate 零错误零告警；search 用合并条目关键词命中平台生成的路由行（score 2 / tags 双关键词 / 归入 Known Issues 分类）；负例零命中。R-03「平台生成路由行 CLI 可解析检索」成立。

---

## 4. 前端面

**验证内容**：TypeScript 全量类型检查 + knowledge 全部相关测试（沉淀弹层 / 条目编辑 / 合并弹窗 / 蒸馏任务条 / 知识库页面，以及间接引用 knowledge 菜单键的布局·会话·菜单权限测试）。

**命令**（worktree `frontend/` 下，先确认 node_modules 健康 `pnpm exec tsc --version` → 5.5.4）：

```bash
pnpm exec tsc --noEmit
pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx" \
  src/components/knowledge \
  src/components/layout/use-resizable-columns.test.tsx \
  src/hooks/use-page-session-context.test.ts \
  src/lib/__tests__/menu-permissions.test.ts
```

**关键输出摘录**：

```
tsc --noEmit → 零输出，exit 0
Test Files  8 passed (8)
     Tests  96 passed (96)
```

其中 knowledge 专属面为 5 个测试文件 46 用例（`src/components/knowledge/__tests__/` 4 件 + `knowledge-page.test.tsx`）；另 3 个文件为间接引用项一并求全跑过。

**结论**：通过（tsc 0 错误；vitest 8 文件 / 96 用例全绿）。

---

## 5. migration 装配

**验证内容**：alembic 迁移链单头（无分叉）。

**命令**（worktree `backend/` 下）：

```bash
uv run alembic heads -v
```

**关键输出摘录**：

```
Rev: 20260917104400 (head)
Parent: 20260914100000
Path: ...migrations\versions\20260917104400_add_knowledge_write_permission.py
    add knowledge:write permission + role seeding
```

**结论**：通过——单头，且 head 即本变更的迁移（`add_knowledge_write_permission`），父版本衔接既有链尾。

---

## 6. 不可自动化项（部署期 manual verify 清单）

以下项需起 dev 栈（backend + frontend + Postgres/Redis）+ 真实 daemon / repo-native 客户端，超出本卡自动化范围，**如实登记为待部署期验证**，不视作已通过：

| # | 验证项 | 需求/风险 | 建议部署期步骤 | 预期 |
| --- | --- | --- | --- | --- |
| M1 | 真实 workspace UI 全链：录入候选 → 待审核区置顶带徽标 → merge-dialog 合并（keywords 人工填写）→ known-issues.md 新增「##」小节 + INDEX.md 新路由行 → 页面可见 | FR-02 / FR-05 / D-007 | ① 本地起栈并用已授 `KNOWLEDGE_WRITE` 账号进知识库页；② 沉淀弹层手工 tab 录入一条候选；③ 待审核区确认置顶与徽标；④ 合并（填关键词）后 git diff 目标文件与 INDEX.md，并截图前后对照 | 全链无 4xx/5xx；diff 形态与本卡第 3 节 sandbox 产物一致（路由行落在对应分类段、目标文件 append-only） |
| M2 | daemon 在线蒸馏：记录提炼 tab 派发 → AgentRun 创建 → daemon 领取产出候选 → 上行同步回流待审核区；daemon 离线分支：任务立即 failed 且任务条透出失败态与日志入口 | FR-01 / FR-03 / D-002 | ① 在线：起 daemon，从记录提炼 tab 选已归档变更派发蒸馏，观察 AgentRun 终态 completed 与待审核区回流；② 离线：停 daemon 后派发，确认 AgentRun 立即 failed、前端 distill-task-bar 显示失败态并可打开日志 | 在线回流候选可走 M1 合并流；离线失败态与日志入口可见 |
| M3 | 同步一致性：平台直写后 spec_version 递增；repo-native 客户端下次 lease 拉取后本地 `.sillyspec` 出现同样改动 | D-005 | ① 记录 merge 前后 workspace manifest 的 spec_version；② 在挂载该 workspace 的机器跑 repo-native lease 拉取，diff 本地 `.sillyspec/knowledge` 前后对照 | spec_version 严格递增；下行文件与平台侧逐字一致 |
| M4 | 权限负例：未授 `KNOWLEDGE_WRITE` 的账号访问知识库页，零写入口 | R-06 | 用仅有 `KNOWLEDGE_READ` 的账号登录同一知识库页，遍历页面与待审核区 | 无任何写按钮/操作区/弹层触发（与现状一致）；API 侧写端点已被 `require_permission(KNOWLEDGE_WRITE)` 挡（单测已覆盖，UI 渲染层需人工目检） |

---

## 7. 总结表

| # | 验证项 | 面向 | 结论 |
| --- | --- | --- | --- |
| 1 | 后端 knowledge 模块全量 + auth 权限/迁移图 | 后端 | 通过（104 passed） |
| 2 | 应用装配冒烟 + 7 新端点注册序 + 通配殿后 | 后端装配 | 通过（624 路由） |
| 3 | CLI 同源交叉验证（validate + search 命中平台生成行，含负例与源码格式对照） | R-03 / D-003 | 通过 |
| 4 | 前端 tsc + knowledge 相关 vitest | 前端 | 通过（0 类型错误；96 用例） |
| 5 | alembic 单头 | 迁移装配 | 通过（head=20260917104400） |
| M1 | 真实 UI 全链（录入→合并→可见） | FR-02/FR-05 | 待部署期验证 |
| M2 | daemon 蒸馏派发回流 / 离线 failed | FR-01/FR-03 | 待部署期验证 |
| M3 | spec_version 递增 + repo-native 下行一致 | D-005 | 待部署期验证 |
| M4 | 未授权用户零写入口（UI 层） | R-06 | 待部署期验证 |

自动化面（1-5）全部通过，无失败项；M1-M4 为部署期人工验证项，步骤与预期见第 6 节。
