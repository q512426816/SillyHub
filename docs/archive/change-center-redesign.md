# 变更中心改造方案

## 目标

变更中心从"被动扫描展示"改为"用户主动发起 → Agent 执行 SillySpec 流程 → 进度实时展示"。

## 用户流程

```
变更中心首页 → 点击"新建变更"
     ↓
填写表单：标题、需求描述、规模选择（大需求/小修改）
     ↓
提交 → 后端创建变更目录 + 注册到 DB
     ↓
调度 Agent 执行 SillySpec：
  - 大需求: propose → plan → execute → verify → archive
  - 小修改: quick（5步快速路径）
     ↓
变更详情页实时展示：
  - 阶段进度条（scan→brainstorm→plan→execute→verify→archived）
  - 生成的文档（proposal/design/requirements/tasks/plan）
  - Agent 执行日志
  - 审批操作（在需要人工确认的节点）
```

## 改造拆分

### Phase 1: 变更创建入口（P0）

**后端：**
- `POST /workspaces/{id}/changes/create` 增强
  - 接收: title, description, scope("full"|"quick"), affected_components[]
  - 创建 `.sillyspec/changes/{change_key}/` 目录
  - 写入 `proposal.md` 初始内容（用户描述）
  - DB: 创建 Change 记录，current_stage="created", approval_status="not_required"

**前端：**
- 新建 `/workspaces/[id]/changes/create/page.tsx`
  - 表单：标题、需求描述（textarea）、规模选择（Radio: 大需求/小修改）
  - 提交后跳转到变更详情页

### Phase 2: Agent 对接 SillySpec（P0）

**后端 Agent 模块增强：**
- 新增 AgentRun 类型: `sillyspec_full` / `sillyspec_quick`
- 调度逻辑：
  - full: 运行 `sillyspec run --change <name>` (propose→plan→execute→verify→archive)
  - quick: 运行 `sillyspec quick "<description>"`
- Agent (CC) 在 worktree 中执行 SillySpec 命令
- 进度回写：Agent 完成每个阶段后调用 POST /progress API

**触发时机：**
- 变更创建后自动触发（或用户在详情页手动点"启动执行"）

### Phase 3: 变更列表改造（P1）

**前端 `changes/page.tsx`：**
- 列表项显示：标题 + 阶段 Badge（代替审批状态）
- 新增"新建变更"按钮
- 过滤器：按阶段/类型筛选

### Phase 4: 变更详情页完善（P1）

**前端 `changes/[cid]/page.tsx`：**
- 已有：阶段进度条 ✅
- 增强：
  - 文档 Tab：实时读取 SillySpec 生成的文件内容
  - Agent 执行状态：显示当前运行中的 Agent run
  - 操作按钮：启动执行、暂停、查看日志
  - "启动 Agent"按钮 → 调度 SillySpec Agent

### Phase 5: 实时进度同步（P2）

- 轮询/SSE：前端定时查询 change 的 current_stage 和 stages
- Agent 日志流：复用已有 /agent/runs/{id}/stream
- 文档变更通知：新文档生成后刷新文档 Tab

## 技术决策

1. **SillySpec CLI 是执行引擎**：平台不复制 SillySpec 的阶段逻辑，而是调度 CC 去跑 `sillyspec` 命令
2. **DB 为唯一状态源**：Change 表的 current_stage 字段是进度展示的依据，由 Agent 回写
3. **文件系统为文档源**：文档内容从 `.sillyspec/changes/{key}/` 目录读取，不存 DB
4. **大需求走 propose（非 brainstorm）**：brainstorm 需要多轮对话，平台先走 propose（7步自动化）更快落地
5. **小修改走 quick**：直接调用 `sillyspec quick`，跳过文档生成

## 实施顺序

1. ✅ 后端：增强 Change create endpoint
2. ✅ 前端：新建变更页面
3. ✅ 后端：Agent SillySpec 调度逻辑
4. ✅ 前端：变更列表页改造
5. ✅ 前端：变更详情页增强
6. E2E 联调验证
