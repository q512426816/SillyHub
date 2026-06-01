# SillySpec CLI × SillyHub 平台统一方案（v2）

> 一套状态体系，CLI 用 SQLite 本地管理，平台用 PostgreSQL，通过 API 双向同步。

---

## 一、为什么 CLI 需要 SQLite

| 场景 | progress.json 的痛点 | SQLite 的优势 |
|------|----------------------|--------------|
| 多 change 并行 | 遍历目录才知道有哪些 change | `SELECT * FROM changes WHERE current_stage = 'execute'` |
| 阶段历史回溯 | history/ 目录散落 JSON 快照 | 一张表，按时间查 |
| 步骤输出过长 | artifacts/ 文件散落，progress.json 截断到 200 字符 | 完整存 BLOB/TEXT，按需读取 |
| JSON 损坏 | 正则修复 + .bak 兜底 | WAL + checkpoint，ACID 保证 |
| 批量统计 | 要手动算 | SQL 聚合 |
| 并发安全 | 靠 rename 原子操作 | 原生事务支持 |

**同时保留文件系统的优势**：
- 产出的 `.md` / `.yaml` 文件不变，git 可追踪、人可读
- SQLite 放 `.runtime/`（gitignore），存的是**状态和元数据**，不是产出

---

## 二、架构总览

```
┌─────────────────────────────────────────────────┐
│                 SillySpec CLI                     │
│                                                   │
│  .sillyspec/                                      │
│  ├── .runtime/                                    │
│  │   └── sillyspec.db    ← SQLite（状态 + 元数据）│
│  │       ├── project             替代 global.json │
│  │       ├── changes             替代 progress.json│
│  │       ├── stages              替代 stages.*    │
│  │       ├── steps               替代 steps[]     │
│  │       ├── artifacts           替代 artifacts/  │
│  │       ├── stage_history       替代 history/    │
│  │       └── approvals           新增：审批门禁   │
│  │                                                │
│  │   └── gate-status.json  ← hook 兼容（从 DB 生成）│
│  │                                                │
│  ├── changes/<name>/                              │
│  │   ├── proposal.md      ← 文档不变，git tracked │
│  │   ├── design.md                                │
│  │   ├── tasks/                                   │
│  │   └── ...                                      │
│  └── docs/<proj>/scan/                            │
│       └── *.md            ← 扫描文档不变          │
│                                                   │
│  API 同步层（best effort）                         │
│  ─────────────────────  ─────────────────────     │
│         │                              │          │
│         ▼                              ▼          │
│  ┌──────────────┐            ┌──────────────┐    │
│  │ 离线模式      │            │ 在线模式      │    │
│  │ sync=false    │            │ sync=true     │    │
│  │ 纯 SQLite     │            │ SQLite + API  │    │
│  │ 完整可用      │            │ 实时同步      │    │
│  └──────────────┘            └──────┬───────┘    │
└──────────────────────────────────────┼────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────┐
                        │     SillyHub 平台         │
                        │                          │
                        │  PostgreSQL               │
                        │  ├── changes              │
                        │  │   ├── current_stage    │
                        │  │   ├── stages (JSONB)   │
                        │  │   └── approval_status   │
                        │  ├── change_documents     │
                        │  ├── tasks                │
                        │  └── ...                  │
                        │                          │
                        │  Web UI                   │
                        │  ├── 阶段进度条            │
                        │  ├── 审批操作              │
                        │  └── 文档查看              │
                        └──────────────────────────┘
```

---

## 三、SQLite Schema

```sql
-- ============================================================
-- 项目信息（替代 global.json）
-- ============================================================
CREATE TABLE project (
    id INTEGER PRIMARY KEY DEFAULT 1,
    name TEXT NOT NULL,
    schema_version INTEGER DEFAULT 4,      -- 对应 progress.json 的 _version
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- ============================================================
-- 变更（替代 progress.json 主体）
-- ============================================================
CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,              -- 例：2026-05-31-qa-fix
    current_stage TEXT DEFAULT 'scan',      -- scan/brainstorm/propose/plan/execute/verify/archived/quick
    status TEXT DEFAULT 'pending',          -- pending/in-progress/completed/failed/blocked
    no_worktree BOOLEAN DEFAULT 0,
    created_at TEXT NOT NULL,
    last_active TEXT NOT NULL,

    -- 平台同步字段
    platform_change_id INTEGER,            -- SillyHub change ID（关联用）
    platform_workspace_id INTEGER,         -- SillyHub workspace ID
    platform_last_sync TEXT,               -- 上次同步时间
    platform_sync_enabled BOOLEAN DEFAULT 0
);

-- ============================================================
-- 阶段（替代 progress.json 的 stages.*）
-- ============================================================
CREATE TABLE stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,                    -- brainstorm/plan/execute/verify/...
    status TEXT DEFAULT 'pending',          -- pending/in-progress/completed/failed/blocked
    started_at TEXT,
    completed_at TEXT,
    UNIQUE(change_id, stage)
);

-- ============================================================
-- 步骤（替代 progress.json 的 stages.*.steps[]）
-- ============================================================
CREATE TABLE steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                     -- 例："状态检查"、"加载上下文"
    status TEXT DEFAULT 'pending',          -- pending/completed/skipped/failed
    output TEXT,                            -- 截断版（200 字符内）
    completed_at TEXT,
    ordering INTEGER NOT NULL DEFAULT 0     -- 步骤执行顺序
);

-- ============================================================
-- 步骤 artifact（替代 .runtime/artifacts/ 目录）
-- ============================================================
CREATE TABLE artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id INTEGER NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,                 -- 原始文件名（兼容查询）
    content TEXT NOT NULL,                  -- 完整输出
    created_at TEXT NOT NULL
);

-- ============================================================
-- 阶段历史快照（替代 .runtime/history/ 目录）
-- ============================================================
CREATE TABLE stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id INTEGER NOT NULL REFERENCES changes(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    snapshot TEXT NOT NULL,                 -- JSON 快照
    completed_at TEXT NOT NULL
);

-- ============================================================
-- 审批门禁（新增）
-- ============================================================
CREATE TABLE approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id INTEGER NOT NULL REFERENCES changes(id) UNIQUE,
    status TEXT DEFAULT 'not_required',     -- pending/approved/rejected/not_required
    requested_at TEXT,
    approved_by TEXT,
    approved_at TEXT,
    rejection_reason TEXT
);

-- ============================================================
-- 批量进度（替代 progress.json 的 batchProgress）
-- ============================================================
CREATE TABLE batch_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id INTEGER NOT NULL REFERENCES changes(id) UNIQUE,
    total INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0
);

-- ============================================================
-- 用户输入记录（替代 .runtime/user-inputs.md）
-- ============================================================
CREATE TABLE user_inputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_id INTEGER REFERENCES changes(id) ON DELETE CASCADE,
    stage TEXT,
    step_name TEXT,
    user_input TEXT,
    ai_output TEXT,
    created_at TEXT NOT NULL
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX idx_changes_current_stage ON changes(current_stage);
CREATE INDEX idx_changes_platform ON changes(platform_sync_enabled, platform_last_sync);
CREATE INDEX idx_stages_change ON stages(change_id);
CREATE INDEX idx_steps_stage ON steps(stage_id);
CREATE INDEX idx_artifacts_step ON artifacts(step_id);
CREATE INDEX idx_history_change ON stage_history(change_id);
CREATE INDEX idx_inputs_change ON user_inputs(change_id);
```

### SQLite 配置

```javascript
// 初始化时设置
db.pragma('journal_mode = WAL');        // 并发读写
db.pragma('busy_timeout = 5000');       // 等锁超时 5s
db.pragma('foreign_keys = ON');         // 外键约束
db.pragma('synchronous = NORMAL');      // 性能平衡
```

---

## 四、从 progress.json 迁移

### 检测逻辑

```javascript
function initDB() {
    const dbPath = path.join(runtimeDir, 'sillyspec.db');

    if (fs.existsSync(dbPath)) {
        return openDB(dbPath);  // 已有 SQLite，直接用
    }

    // 检测旧版数据
    const oldGlobal = path.join(runtimeDir, 'global.json');
    const oldProgress = path.join(runtimeDir, 'progress.json');
    const changesDir = path.join(sillyspecDir, 'changes');

    if (fs.existsSync(oldGlobal) || fs.existsSync(oldProgress)) {
        migrateFromV3(dbPath, oldGlobal, oldProgress);
    } else if (fs.existsSync(changesDir)) {
        // v3 但 global.json 可能被删了，扫描 changes/ 目录重建
        migrateFromChangesDir(dbPath, changesDir);
    } else {
        createFreshDB(dbPath);
    }
}
```

### 迁移步骤

1. 创建 SQLite 表结构
2. 读 `global.json` → 写 `project` 表
3. 扫描 `changes/*/progress.json` → 写 `changes` + `stages` + `steps` 表
4. 扫描 `changes/*/` 检查已有文档 → 记录到 `change_documents`（如需）
5. 旧文件不删除，改名为 `.v3.bak`（安全保障）
6. 输出迁移报告

### 向后兼容

- 旧版 CLI 遇到 SQLite 不认识 → 仍然能跑（读 .md 文件，不依赖 progress.json 的内容）
- 新版 CLI 遇到旧版 progress.json → 自动迁移
- 混用场景极少（一个人不会同时用两个版本的 CLI）

---

## 五、gate-status.json 兼容

Hook（`worktree-guard.js`）读 `gate-status.json` 文件。**不改 hook**，从 SQLite 生成：

```javascript
// ProgressManager._write() 中
function syncGateStatus(change) {
    if (['execute', 'quick'].includes(change.current_stage)) {
        const gateStatus = {
            stage: change.current_stage,
            changes: [change.name],
            updatedAt: new Date().toISOString(),
            noWorktree: change.no_worktree
        };
        fs.writeFileSync(gateStatusPath, JSON.stringify(gateStatus, null, 2));
    } else {
        // 不在 execute/quick 阶段，删除文件
        try { fs.unlinkSync(gateStatusPath); } catch {}
    }
}
```

**设计原则**：SQLite 是唯一数据源，gate-status.json 是 SQLite 的**物化视图**。

---

## 六、平台同步策略

### 同步时机

```javascript
// 每个 _write()（状态变更）后
async function syncToPlatform(changeId) {
    if (!getProjectSetting('platform.sync')) return;

    const change = db.prepare('SELECT * FROM changes WHERE id = ?').get(changeId);

    try {
        await apiClient.put(`/api/changes/${change.platform_change_id}/stage`, {
            stage: change.current_stage,
            stage_status: change.status,
            started_at: change.last_active,
            stages: buildStagesPayload(changeId),
            steps: buildStepsPayload(changeId)
        });

        // 更新同步时间
        db.prepare('UPDATE changes SET platform_last_sync = ? WHERE id = ?')
            .run(new Date().toISOString(), changeId);

    } catch (error) {
        console.warn(`⚠️ Sync to SillyHub failed: ${error.message}`);
        // 不阻塞 CLI 执行
    }
}
```

### 文档同步

```javascript
// 四件套生成后
async function syncDocuments(changeId) {
    const change = getChange(changeId);
    const docs = ['proposal.md', 'design.md', 'requirements.md', 'tasks.md'];

    const payload = docs
        .filter(doc => fs.existsSync(path.join(changeDir, doc)))
        .map(doc => ({
            doc_type: doc.replace('.md', ''),
            path: doc,
            content: fs.readFileSync(path.join(changeDir, doc), 'utf-8')
        }));

    await apiClient.post(`/api/changes/${change.platform_change_id}/documents/sync`, {
        documents: payload
    });
}
```

### 首次连接（离线 → 在线）

```bash
# 用户首次连接到平台
sillyspec platform connect --url http://sillyhub.local:8000 --token xxx

# CLI 做的事：
# 1. 测试 API 连通性
# 2. 查找或创建对应 workspace
# 3. 为所有本地 change 匹配或创建平台记录
# 4. 全量同步一次（stages + documents）
# 5. 更新 SQLite 中的 platform_* 字段
```

---

## 七、审批流程

### CLI 侧

```javascript
// execute 阶段启动前
async function checkApproval(changeId) {
    const change = getChange(changeId);

    // quick 模式自动跳过审批
    if (change.current_stage === 'quick') return true;

    // 离线模式不检查审批
    if (!change.platform_sync_enabled) {
        console.warn('⚠️ 离线模式：跳过审批检查');
        return true;
    }

    // 从平台获取最新审批状态
    try {
        const resp = await apiClient.get(`/api/changes/${change.platform_change_id}`);
        const approval = resp.data.approval_status;

        if (approval === 'approved' || approval === 'not_required') return true;

        console.error('❌ 变更未经审批，无法进入 execute 阶段');
        console.error(`   当前审批状态：${approval}`);
        console.error('   请在 SillyHub 平台上完成审批');
        console.error('   或使用 --skip-approval 跳过（需要管理员权限）');
        return false;
    } catch (error) {
        console.warn(`⚠️ 无法检查审批状态: ${error.message}`);
        return true;  // 网络问题不阻塞
    }
}
```

### 平台侧

```python
# plan 阶段完成 → 自动设置审批待审
# reparse 检测到 change 从 plan 完成 → approval_status = 'pending'

# 管理员操作
POST /api/changes/{id}/approve  → approval_status = 'approved'
POST /api/changes/{id}/reject   → approval_status = 'rejected'
```

---

## 八、CLI 命令变更

### 新增命令

```bash
sillyspec platform connect --url <url> --token <token>   # 连接平台
sillyspec platform disconnect                             # 断开连接
sillyspec platform sync [--full]                          # 手动同步
sillyspec platform status                                 # 查看同步状态
```

### 现有命令变化

```bash
# 不变的
sillyspec init                    # 多一步：创建 SQLite
sillyspec run brainstorm          # 多一步：写 SQLite + 同步 API
sillyspec run plan                # 同上
sillyspec run execute             # 多一步：检查审批
sillyspec run verify              # 同上
sillyspec run archive --confirm   # 同上
sillyspec run quick               # 同上
sillyspec status                  # 改为从 SQLite 读取（更快更准）
sillyspec doctor                  # 多一步：检查 SQLite 完整性

# 变化的
sillyspec status                  # 从读 progress.json → 读 SQLite
                                  # 输出格式不变，用户无感
```

### local.yaml 扩展

```yaml
# 新增
platform:
  api_url: "http://localhost:8000"
  api_key: ""
  sync: true                       # false = 纯离线模式
```

---

## 九、迁移风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 旧版 progress.json 数据丢失 | 迁移后旧文件重命名为 `.v3.bak`，不删除 |
| SQLite 文件损坏 | WAL 模式 + 定期 checkpoint + 备份 |
| 用户混用新旧 CLI | 新版 CLI 启动时自动迁移，迁移后旧文件 .bak |
| Hook 不兼容 | gate-status.json 从 SQLite 生成，hook 不用改 |
| worktree 中访问不到 SQLite | meta.json 记录主仓库路径，CLI 通过绝对路径访问 |
| 平台同步失败 | best effort，失败打 warning 不阻塞 |
| 二进制文件不方便 debug | 保留 `sillyspec doctor --dump-sql` 导出为可读 JSON |

---

## 十、实施顺序

### CLI 侧（你做）

| 阶段 | 内容 | 预计 |
|------|------|------|
| 1 | SQLite schema + 初始化 + 基础 CRUD | 1天 |
| 2 | 替换 ProgressManager 读写到 SQLite | 1-2天 |
| 3 | v3 → v4 自动迁移 | 0.5天 |
| 4 | gate-status.json 从 SQLite 生成 | 0.5天 |
| 5 | 平台同步层（connect/sync/status） | 1天 |
| 6 | 审批检查（execute 前置） | 0.5天 |
| 7 | 全量回归测试 | 1天 |
| **合计** | | **5-6天** |

### 平台侧（你改完 CLI 后我做）

| 阶段 | 内容 | 预计 |
|------|------|------|
| 1 | DB migration：Change 表加 current_stage + stages JSONB + approval 字段 | 0.5天 |
| 2 | 新增 API：`PUT /changes/{id}/stage` + `POST /changes/{id}/documents/sync` | 1天 |
| 3 | 审批 API：approve/reject | 0.5天 |
| 4 | 前端：阶段进度条 + 审批操作 | 1-2天 |
| 5 | 联调测试 | 1天 |
| **合计** | | **4-5天** |

---

## 十一、最终效果

### 场景 A：纯 CLI 用户（无平台）
```bash
sillyspec init
sillyspec run scan
sillyspec run brainstorm   # 自动创建 change，写入 SQLite
sillyspec run plan
sillyspec run execute      # 离线模式，跳过审批检查
sillyspec run verify
sillyspec run archive --confirm
```
体验和现在一样，底层从 JSON 换成了 SQLite，更稳更快。

### 场景 B：CLI + 平台
```bash
sillyspec platform connect --url http://sillyhub.local:8000 --token xxx
sillyspec run brainstorm   # 写 SQLite + 同步到平台
sillyspec run plan         # 同上
# 管理员在平台上点击「审批通过」
sillyspec run execute      # 检查审批 → 通过 → 执行
```
平台页面实时看到阶段进度，审批在平台上操作。

### 场景 C：纯平台用户（无 CLI）
在 Web UI 上创建 change → 触发后端生成文档 → 平台自己管状态。
CLI 用户后续可以 `sillyspec platform sync` 把平台数据拉到本地。
