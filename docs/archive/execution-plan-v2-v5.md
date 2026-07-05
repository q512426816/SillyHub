# 执行规划 V2 → V5

> 基于 plan.md + tasks.md，V1 P0 已完成（163 tests，task-01~06, 09, 10）。
> 本文件用于 goal 指令驱动开发，每个 goal 对应一个 `/loop` 周期。

---

## 现状盘点

| 已完成 | 未开始 |
|---|---|
| task-01 平台基建 | task-07 Runtime 展示 (V1 P1) |
| task-02 Workspace 扫描 | task-08 Knowledge 展示 (V1 P1) |
| task-03 Component 解析 | task-11 Git Tool Gateway (V2→V3) |
| task-04a Auth + RBAC | task-12 写入 Change 包 (V2 核心) |
| task-04 Scan Docs | task-13 审批 + 状态机 (V3) |
| task-05 Change 解析 | task-14 Agent Adapter (V4) |
| task-06 Task 解析 | task-15 Tool Gateway 通用 (V4) |
| task-09 Git Identity | task-16 部署闭环 (V5) |
| task-10 Worktree Manager | |

---

## Goal 1: V1 收尾 — Runtime + Knowledge 只读展示

**预估**: 1 个 loop 周期（~16h 编码量）
**依赖链**: task-07, task-08 均依赖 task-02（已完成）

### task-07 — Runtime 状态展示 (8h)
- 后端：读取 `.runtime/progress.json`，暴露 `/api/workspaces/{ws_id}/runtime` GET
- 前端：Workspace 详情页增加 Runtime tab，展示 progress 状态
- 模型：`RuntimeProgress` schema（无新 DB 表，纯文件读取）

### task-08 — Knowledge / Quicklog 展示 (8h)
- 后端：解析 `knowledge/*.md` + `quicklog/*.md`，暴露列表 + 详情 API
- 前端：Workspace 详情页增加 Knowledge tab，Quicklog 时间线
- 模型：`KnowledgeEntry`, `QuicklogEntry` schema

### DoD
- [ ] 后端新增测试 ≥ 15，全套无回归
- [ ] 前端 lint/typecheck/build 通过
- [ ] Docker compose 全栈可运行

---

## Goal 2: Git Tool Gateway (task-11)

**预估**: 1 个 loop 周期（~20h 编码量）
**依赖**: task-10（已完成）

### task-11 — Git Tool Gateway (20h)
- 核心：受控 Git 操作代理，拦截危险命令
- 后端模块 `git_gateway/`：
  - `model.py`: `GitOperationLog` 表（id, workspace_id, lease_id, user_id, operation, args_json, result_code, redacted_output, timestamp）
  - `service.py`: `GitGatewayService` — 白名单 command 映射、参数校验、超时控制、输出脱敏（移除 PAT）
  - `router.py`: `POST /api/worktrees/{lease_id}/git` — 在 lease 环境内执行 Git 操作
- 白名单操作：`status`, `diff`, `add`, `commit`, `push`, `pull`, `fetch`, `log`, `branch`, `checkout`, `merge`, `rebase`
- 黑名单：`push --force`, `clean -fd`, `reset --hard`, `reflog`, 任何含 `--exec` 的命令
- 审计：所有操作写入 `git_operation_logs` 表，输出中 PAT 脱敏
- 迁移：`2026060X0900_create_git_operation_logs.py`

### DoD
- [ ] 白名单/黑名单覆盖测试 ≥ 10
- [ ] 输出脱敏验证（grep 无明文 token）
- [ ] 操作日志写入验证
- [ ] 全套后端测试无回归

---

## Goal 3: 平台写入 SillySpec Change 包 (task-12)

**预估**: 1.5 个 loop 周期（~24h 编码量）
**依赖**: task-05, task-09, task-10, task-11

### task-12 — 写入 Change 包 (24h)

#### Phase A: Change 创建 + Markdown 生成 (12h)
- 后端 `change_writer/` 模块：
  - `service.py`: `ChangeWriterService`
    - `create_change(workspace_id, component_ids, title)` → 创建 change_key 目录 + MASTER.md
    - `generate_proposal(change_id)` → 生成 proposal.md
    - `generate_requirements(change_id)` → 生成 requirements.md
    - `generate_design(change_id)` → 生成 design.md
    - `generate_plan(change_id)` → 生成 plan.md + tasks.md + tasks/task-xx.md
  - `markdown_builder.py`: 模板渲染引擎（Jinja2 或 f-string 模板）
  - `router.py`: 扩展 Change router，增加写入端点
- 文件操作必须在 WorktreeLease 隔离环境内执行
- 前端：Change 创建向导（多步表单）

#### Phase B: Git 提交 + PR (12h)
- 在 GitGateway 基础上封装：
  - `git_commit_and_push(lease_id, message, branch)` → 自动 stage + commit + push
  - `create_pull_request(lease_id, title, body)` → 调用 GitHub API 创建 PR
- change_documents 表已有，更新文档状态跟踪
- 前端：查看 Git diff + 提交 + 创建 PR 的操作界面

### DoD
- [ ] 能从前端创建 Change 并生成完整 markdown 包
- [ ] 能提交到任务分支并创建 PR
- [ ] 文件操作在 worktree 隔离环境内
- [ ] 后端测试 ≥ 25，全套无回归
- [ ] 前端 build 通过

---

## Goal 4: 工作流、审批、审计 (task-13)

**预估**: 2 个 loop 周期（~32h 编码量）
**依赖**: task-05, task-06, task-12

### task-13 — 审批 + 状态机 (32h)

#### Phase A: Change 状态机 (12h)
- 后端 `workflow/` 模块：
  - `fsm.py`: `ChangeFSM` — 状态转移图
    ```
    draft → proposed → reviewed → approved → in_progress → completed → merged
                    ↘ rejected → draft (rework)
    ```
  - `model.py`: 扩展 Change 表增加 `status` 字段（或利用已有 status 字段）
  - `service.py`: `WorkflowService` — 状态转移 + 前置条件检查
  - `router.py`: `POST /api/changes/{id}/transition` — 状态推进

#### Phase B: Task 状态机 + Spec Guardian (12h)
- Task FSM: `pending → in_progress → completed / blocked / cancelled`
- `spec_guardian.py`: 提交前自动检查
  - 必须文档：proposal / requirements / design / plan 至少存在
  - 文档非空（字数 ≥ 100）
  - 关联组件存在
  - 无未解决的 review 意见
- 检查结果作为审批前的 gate

#### Phase C: Review 封驳 + 审计日志 (8h)
- `review/model.py`: `ChangeReview` 表（id, change_id, reviewer_id, verdict, comment, created_at）
- `audit/model.py`: `AuditLog` 表（id, actor_id, action, resource_type, resource_id, details_json, timestamp）
- 所有写入操作自动记录审计日志（SQLAlchemy event hook 或 service 层装饰器）
- 前端：Review 界面 + 审批流程 + 审计日志查看

### DoD
- [ ] Change FSM 全路径测试（正向 + 逆向）
- [ ] Task FSM 测试
- [ ] Spec Guardian 至少 5 条规则检查
- [ ] 审计日志覆盖所有写入操作
- [ ] 后端测试 ≥ 35，全套无回归
- [ ] 前端 build 通过

---

## Goal 5: Agent Adapter (task-14)

**预估**: 2-3 个 loop 周期（~40h 编码量）
**依赖**: task-10, task-11, task-13
**前置**: spike-03 Claude Code 受控执行验证通过

### task-14 — Agent Adapter (40h)

#### Phase A: Adapter 抽象层 (12h)
- 后端 `agent/` 模块：
  - `base.py`: `AgentAdapter` 抽象基类
    - `run(task_context, tool_policy) → AgentRunResult`
    - `validate_context(ctx) → bool`
    - `supported_tools() → list[str]`
  - `model.py`: `AgentRun` 表 + `AgentRunLog` 表
    ```
    agent_runs: id, task_id, lease_id, agent_type, status, started_at, finished_at, exit_code, output_redacted
    agent_run_logs: id, run_id, timestamp, channel(stdout/stderr/tool_call), content_redacted
    ```
  - 迁移：`202607XXXX_create_agent_runs.py`

#### Phase B: Claude Code Adapter (16h)
- `adapters/claude_code.py`: `ClaudeCodeAdapter(AgentAdapter)`
  - 子进程管理：`claude` CLI 启动 + 上下文注入
  - 上下文构建：从 Change/Task/Component 提取 spec → 写入 system prompt
  - `allowed_paths` / `denied_paths`：限制 Agent 只能操作 lease 目录
  - 输出流式收集：stdout/stderr → `agent_run_logs`
  - 超时控制 + kill 信号
- 首发只做 Claude Code，后续扩展 Codex / Cursor

#### Phase C: 上下文注入 + Diff 收集 (12h)
- `context_builder.py`:
  - 从 Change 包提取 proposal + requirements + design + plan
  - 从 Component 提取 scan docs + 结构信息
  - 注入 workspace 级约定（CONVENTIONS.md）
  - 生成 `CLAUDE.md` 到 lease 目录根
- `diff_collector.py`:
  - 执行后 `git diff` 收集代码变更
  - 关联到 AgentRun 记录
  - 前端展示 diff

### DoD
- [ ] Claude Code 子进程可受控启停
- [ ] 上下文注入生成正确 CLAUDE.md
- [ ] allowed_paths 隔离验证
- [ ] 输出流式收集 + 脱敏
- [ ] 后端测试 ≥ 30（mock 子进程），全套无回归
- [ ] 前端 Agent Run 监控页面

---

## Goal 6: Tool Gateway 通用化 (task-15)

**预估**: 1.5 个 loop 周期（~24h 编码量）
**依赖**: task-11, task-14

### task-15 — Tool Gateway 通用 (24h)
- 扩展 GitGateway 为通用 Tool Gateway：
  - `file tools`: read, write, list, search（限制在 lease 目录内）
  - `shell tools`: exec（白名单命令 + 超时 + 输出截断）
  - `test tools`: run_tests（触发 pytest/go test 等，收集结果）
  - `network tools`: http_get（限制白名单域名，只读）
- `tool_policy.py`: 统一策略引擎
  - 每个 Agent Run 关联一个 ToolPolicy（允许/禁止的工具列表）
  - 路径限制：所有文件操作限制在 lease root
  - 资源限制：超时、输出大小上限
- 审计：所有 tool 调用写入 audit_log

### DoD
- [ ] 4 类 tool 全部实现 + 测试
- [ ] 路径逃逸测试（确保不能访问 lease 外文件）
- [ ] 资源限制验证
- [ ] 后端测试 ≥ 20，全套无回归

---

## Goal 7: 部署、归档、知识沉淀闭环 (task-16)

**预估**: 2 个 loop 周期（~40h 编码量）
**依赖**: task-13, task-15

### task-16 — 部署闭环 (40h)

#### Phase A: 发布单 + 环境管理 (16h)
- `release/` 模块：
  - `model.py`: `Release` 表 + `ReleaseEnvironment` 表
  - `service.py`: Release 创建（关联多个 Change），环境状态管理
  - 状态：`draft → staging → approved → deploying → deployed → verified`
  - 前端：Release 管理页面

#### Phase B: 部署审批 + 回滚 (12h)
- 部署审批流：必须经过至少 1 人 approve
- 回滚方案：记录部署前 commit SHA + rollback script
- 部署执行：调用外部 CI/CD（GitHub Actions webhook）或本地脚本

#### Phase C: 监控回填 + 事故 + 复盘 (12h)
- 监控结果回填：部署后自动检查 health endpoint，记录到 Release
- `incident/` 模块：
  - `model.py`: `Incident` 表 + `Postmortem` 表
  - 事故记录 → 复盘 → 沉淀到 `knowledge/` 目录
- 前端：事故列表 + 复盘页面

### DoD
- [ ] Release 全生命周期可操作
- [ ] 部署审批流测试
- [ ] 回滚验证
- [ ] 事故→复盘→knowledge 闭环
- [ ] 后端测试 ≥ 30，全套无回归
- [ ] 前端 build 通过

---

## 执行顺序总览

```
Goal 1 (V1 收尾)
  ↓
Goal 2 (Git Gateway, task-11)
  ↓
Goal 3 (写入 Change, task-12)  ← V2 完成
  ↓
Goal 4 (审批状态机, task-13)   ← V3 完成
  ↓
Goal 5 (Agent Adapter, task-14)
  ↓
Goal 6 (Tool Gateway 通用, task-15)  ← V4 完成
  ↓
Goal 7 (部署闭环, task-16)     ← V5 完成
```

## 预估总工作量

| Goal | 阶段 | 编码量 | Loop 周期 |
|---|---|---:|---:|
| Goal 1 | V1 收尾 | 16h | 1 |
| Goal 2 | V2→V3 基础 | 20h | 1 |
| Goal 3 | V2 核心 | 24h | 1.5 |
| Goal 4 | V3 | 32h | 2 |
| Goal 5 | V4 核心 | 40h | 2-3 |
| Goal 6 | V4 扩展 | 24h | 1.5 |
| Goal 7 | V5 | 40h | 2 |
| **合计** | | **196h** | **~11 周期** |

## 每个 Goal 的 `/loop` 使用方式

```
/loop 实现 Goal N，参照 execution-plan-v2-v5.md 中 Goal N 的描述
```

Claude 会：
1. 读取本文件获取 Goal 详情
2. 探索现有代码库对齐模式
3. 逐步实现 model → migration → schema → service → router → tests
4. 每完成一个子模块运行测试验证
5. 完成后更新 `.loop-progress.md`
