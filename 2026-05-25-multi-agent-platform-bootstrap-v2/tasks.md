# tasks — 平台搭建任务总表

> 所有 task 已按 `task-01.md` 模板重写。每个 task 详情含真实 API / 表 / 文件 / 验收 / 风险 / DoD。

## 总览

| 编号 | 任务 | 阶段 | 优先级 | 估时 (h) | 依赖 | 说明 |
|---|---|---|---|---:|---|---|
| task-01 | 初始化平台仓库与基础工程 | V1 | P0 | 16 | — | 前后端骨架 + Postgres / Redis |
| task-02 | 实现 Workspace 识别与扫描 | V1 | P0 | 16 | 01 | 识别 `.sillyspec` |
| task-03 | 实现 projects 组件配置解析 | V1 | P0 | 14 | 02 | **注意：projects 是项目组组件，不是项目列表** |
| task-04a | 实现用户认证与 RBAC（horizontal slice） | V1 | P0 | 20 | 03 | 替换 X-Debug-User 占位；下游 task 才能验证 403 / 401 |
| task-04 | 实现 scan docs 解析与展示 | V1 | P0 | 10 | 04a | 组件认知文档 |
| task-05 | 实现 Change 解析与变更中心 | V1 | P0 | 18 | 02 | change / archive |
| task-06 | 实现 Task 解析与任务看板 | V1 | P0 | 16 | 05 | tasks.md + tasks/*.md |
| task-07 | 实现 Runtime 状态展示 | V1 | P1 | 8 | 02 | `.runtime` 读取 |
| task-08 | 实现 Knowledge / Quicklog 展示 | V1 | P1 | 8 | 02 | 知识与日志 |
| task-09 | 实现 Git Identity Manager | V1/V2 | P0 | 24 | 01, 02 | 多人 Git 权限基础（**spike 01 必须先通过**） |
| task-10 | 实现 Worktree Manager | V1/V2 | P0 | 24 | 09 | 单服务器隔离核心 |
| task-11 | 实现 Git Tool Gateway | V2/V3 | P0 | 20 | 10 | 拦截危险 Git 操作 |
| task-12 | 实现平台写入 Change 包 | V2 | P1 | 24 | 05, 09, 10, 11 | 生成 markdown + outbox + PR |
| task-13 | 实现审批与状态机 | V3 | P1 | 32 | 05, 06, 12 | 生命周期 FSM + Spec Guardian |
| task-14 | 实现 Agent Adapter 接口与首个 Adapter | V4 | P1 | 40 | 10, 11, 13 | **spike 03 必须先通过**；首发 Claude Code |
| task-15 | 实现 Tool Gateway 通用能力 | V4 | P1 | 24 | 11, 14 | file/shell/test/git/network |
| task-16 | 实现部署、归档与知识沉淀闭环 | V5 | P2 | 40 | 13, 15 | release / archive / knowledge |
| **合计** |  |  |  | **354** |  | ≈ 单人 9 周满负荷 / 实际 15-21 周 |

## 第一批必须完成（V1 P0）

```text
task-01 → task-02 → task-03 → task-04a → task-04 → task-05 → task-06
                                     ↘ task-09 → task-10
```

完成后平台具备：

- SillySpec Native Viewer
- Workspace / Component / Change / Task 全部能解析展示
- 多人 Git 隔离基础（数据模型 + 凭据加密 + 临时执行环境）

## 前置门禁 — V0 Spikes（必须先跑）

| Spike | 验证内容 | 不通过的后果 |
|---|---|---|
| `spikes/01-git-isolation` | 单机多用户 Git 凭据 / 环境隔离 | **task-09 / task-10 推翻重设计** |
| `spikes/02-workspace-scan` | 真实 `.sillyspec` 可解析、≤ 200ms | task-02 ~ task-08 受阻 |
| `spikes/03-claude-code` | Claude Code 子进程可受控 | task-14 改用 Docker 沙箱 |

详见 `spikes/README.md`。

## 推荐执行顺序

```text
V0 (spikes)
  ↓
task-01 (基建)
  ↓
┌── task-02 (Workspace)
│     ↓
│  ┌── task-03 (Component)
│  │     ↓
│  │  task-04a (Auth + RBAC, horizontal slice)
│  │     ↓
│  │  task-04 (Scan Docs)
│  └── task-05 (Change)
│        ↓
│     task-06 (Task)
│     task-07 (Runtime, P1)
│     task-08 (Knowledge, P1)
└── task-09 (Git Identity)
      ↓
    task-10 (Worktree)
      ↓
    task-11 (Git Gateway)
      ↓
    task-12 (写入 Change)  ← V2 起点
      ↓
    task-13 (审批 + FSM)   ← V3
      ↓
    task-14 (Agent Adapter) ← V4
      ↓
    task-15 (Tool Gateway 通用)
      ↓
    task-16 (Release / Archive) ← V5
```

## 估时口径

- 单人专注、AI 辅助编码、含自测，**不含联调 / Review / 修 bug**
- 实际工期建议按 × 2 ~ × 2.5 估算（含审查、改 bug、文档同步、依赖等待）
- P0 任务建议 2 人结对，关键路径不要单点
