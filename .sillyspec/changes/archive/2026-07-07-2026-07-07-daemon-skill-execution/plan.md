---
author: qinyi
created_at: 2026-07-07 13:30:00
plan_level: full
---

# 实现计划

> 来源：`proposal.md` / `requirements.md`（FR-01~06, NFR-01~04）/ `design.md`（§5 方案 §6 文件清单 §9 Wave §7.5 生命周期 §5.1.1 gap 补充）/ `tasks.md` / `decisions`（D-001~D-006@V1 散落 design §8）。
> 本文件只做 Wave 分组 + 任务总表 + 依赖 + 验收，**不放接口签名/代码示例**（细节落 task-NN.md 蓝图）。

## plan 阶段决策落地

design 把 D-002 / D-003 的细节委托给 plan，此处定档：

- **D-002（skill 同步机制）= daemon 启动拉 sillyspec skills bundle（仿 self-update）+ workspace 自定义经 spec sync**。
  - 平台 skills：daemon 启动/注册时 `GET /api/daemon/skills/latest/manifest`（backend 分发，task-06），版本新则拉 `sillyspec-skills.tar` 解压到 `~/.sillyhub/daemon/skills/sillyspec-*`。claude 启动 `cwd=workdir`，daemon 在 workdir `.claude/skills/` 建 symlink（或 `--skill-dir` 若 claude CLI 支持）指向 daemon skills 目录。
  - workspace 自定义：workspace 绑定时经 daemon-client spec sync（已有）拉 workspace `skills/` 到 worktree `.claude/skills/`。
- **D-003（MCP 配置模型）= workspace `.mcp.json`（specDir）+ 平台默认（admin 全局），daemon 合并注入**。
  - 平台默认：admin 后台配（存 backend DB 或 specDir 全局 `mcp-defaults.json`）。
  - workspace 级：specDir/docs/<ws>/.mcp.json（或 workspace 配置卡）。
  - daemon spawn claude 前合并平台+workspace → 写 worktree `.claude/.mcp.json`（claude 自动读）或 `--mcp-config <path>`。白名单校验（NFR-03）。
- **D-007@V1（plan 新增）= stage_meta 传递 = claude 启动 prompt 内嵌 skill 调用指令 + env STAGE_META JSON 备份**。
  - prompt：`/sillyspec-verify --change <id> --stage verify`（skill 解析 args）。
  - env：`STAGE_META='{"change_id":"...","stage":"verify","skill_name":"sillyspec-verify","workspace_id":"...","spec_root_ref":"..."}'`（skill 从 process.env 读，应对 prompt 截断）。
- **D-008@V1（plan 新增）= skills bundle 打包 = tar.gz（多目录）+ manifest（版本+sha256）**。
  - backend 打包 `.claude/skills/sillyspec-*` → `sillyspec-skills-<sha>.tar.gz` + manifest.json（版本=git sha + 文件列表 + sha256）。仿 daemon bundle 分发。

## Wave 1 — 全量（方案 C 一次性）

design D-006 定档方案 C（一次性全做）。单 Wave 10 task，按依赖排序执行（不强分 sub-wave，但 task 总表标 blockedBy）：

- [x] task-01: backend stage_meta 数据结构 + _build_stage_bundle 改造（FR-01, D-001 D-006 D-007）
- [x] task-02: daemon task-runner 改（删写 CLAUDE.md + claude 启动传 stage_meta/skill 指令）（FR-01 FR-02, D-001 D-005 D-007）
- [x] task-03: daemon skill-manager 新建（平台 skills 同步，仿 self-update）（FR-03, D-002 D-008）
- [x] task-04: daemon workspace 自定义 skills 同步（仿 spec sync）（FR-04, D-002 D-004）
- [x] task-05: daemon mcp-config 新建（合并注入 + 白名单）（FR-05, D-003 NFR-03）
- [x] task-06: backend skills bundle 打包分发端点（FR-03, D-002 D-008）
- [x] task-07: server-local skills（容器 COPY + stage 对齐）（FR-06）
- [x] task-08: claude 调 skill 强制保障（prompt 指令 + 不限 skill + 兜底检测）（NFR-01, D-001）
- [x] task-09: 废弃 stage prompt 模板 + 模块文档同步（清理）
- [x] task-10: e2e 集成验证（全 FR + NFR-04 零回归）

## 任务总表

| 编号 | 任务 | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|
| task-01 | backend stage_meta + _build_stage_bundle | P0 | — | FR-01 D-001 D-007 | AgentSpecBundle 加 stage_meta 字段（base.py）；service.py _build_stage_bundle 改构造元数据（不拼完整 prompt）；废弃 verify.md 等 stage 模板的引用点 |
| task-06 | backend skills bundle 打包分发 | P0 | — | FR-03 D-008 | 新端点 `/api/daemon/skills/latest/{manifest,bundle}`；打包脚本（.claude/skills/sillyspec-* → tar.gz + manifest） |
| task-03 | daemon skill-manager（平台同步） | P0 | task-06 | FR-03 D-002 | 新 skill-manager.ts；启动查 manifest + 拉 bundle 解压；claude 启动 symlink skills |
| task-04 | daemon workspace 自定义 skills 同步 | P1 | task-03 | FR-04 D-002 D-004 | workspace 绑定/lease 时拉 workspace skills（复用 spec sync 框架） |
| task-05 | daemon mcp-config（合并注入） | P1 | — | FR-05 D-003 NFR-03 | 新 mcp-config.ts；合并平台+workspace .mcp.json；spawn claude 注入；白名单 |
| task-02 | daemon task-runner 改（删写 CLAUDE.md + stage_meta） | P0 | task-01 | FR-01 FR-02 D-001 D-005 D-007 | 删 task-runner.ts:457-463；claude 启动 prompt 内嵌 skill 指令 + env STAGE_META |
| task-07 | server-local skills（容器 COPY） | P1 | task-01 | FR-06 | backend Dockerfile COPY .claude/skills/；server-local stage 投递对齐 prompt+env |
| task-08 | claude 调 skill 强制保障 | P0 | task-02 | NFR-01 D-001 | prompt 明确 skill 调用 + --allowedTools 不限 skill + 兜底检测（未调 skill 报错） |
| task-09 | 废弃 stage 模板 + 文档 | P2 | task-01 task-02 | 清理 | 归档 verify.md 等模板；backend.md/daemon.md 模块文档注意事项 |
| task-10 | e2e 集成验证 | P0 | task-01~09 | 全 FR NFR-04 | daemon-client verify dispatch → claude 调 skill → patch 无冲突；零回归 |

## 关键路径

`task-06（skills bundle 分发）→ task-03（daemon skill-manager）→ task-02（task-runner 改）→ task-08（强制保障）→ task-10（e2e）`

- task-01（backend stage_meta）独立可并行，但 task-02/07/08 消费它。
- task-04 依赖 task-03（skill-manager 框架）。
- task-05（mcp-config）独立，与 task-03/04 并行。
- task-09（清理）最后，task-10（验证）依赖全部。

## 文件覆盖映射（design §6 → task）

| design §6 文件 | 操作 | 覆盖 task |
|---|---|---|
| sillyhub-daemon/src/task-runner.ts | 修改（删 L457-463 + stage_meta 传） | task-02, task-08 |
| sillyhub-daemon/src/skill-manager.ts | 新增 | task-03, task-04 |
| sillyhub-daemon/src/mcp-config.ts | 新增 | task-05 |
| sillyhub-daemon/src/daemon.ts | 修改（启动调 skill-manager + spawn 注入 mcp） | task-03, task-05 |
| backend/app/modules/agent/service.py | 修改（_build_stage_bundle 改元数据） | task-01 |
| backend/app/modules/agent/base.py | 修改（AgentSpecBundle 加 stage_meta） | task-01 |
| backend skills-bundle 打包端点 | 新增 | task-06 |
| backend Dockerfile | 修改（COPY .claude/skills/） | task-07 |
| stage templates（verify.md 等） | 废弃/归档 | task-09 |

## 跨任务契约（provider → consumer）

| 契约 | provider | consumer | 关键字段 |
|---|---|---|---|
| StageDispatchMeta（stage_meta） | task-01 | task-02, task-07, task-08 | `{change_id, stage, skill_name, workspace_id, spec_root_ref}` |
| skills bundle + manifest | task-06 | task-03 | manifest.json（版本+sha256）+ sillyspec-skills.tar.gz |
| daemon skills 同步协议 | task-03 | task-04（自定义复用框架） | `GET /api/daemon/skills/latest/*` + 解压约定 |
| MCP 配置合并 | task-05 | task-02（spawn 时注入） | 平台+workspace .mcp.json → claude --mcp-config |
| claude 调 skill 强制 | task-08 | task-02（task-runner spawn） | prompt 指令 + --allowedTools + 兜底检测 |

## 全局验收标准

- [ ] backend：`uv run pytest -q` 全绿（stage_meta 构造 + skills bundle 端点单测）
- [ ] sillyhub-daemon：`pnpm test` 全绿（skill-manager mock bundle 拉 / mcp-config 合并 / task-runner stage_meta 传 + 不写 CLAUDE.md / 强制保障兜底）
- [ ] daemon-client verify dispatch：claude 调 `/sillyspec-verify` skill 跑流程（backend 不拼完整 prompt）
- [ ] `.claude/CLAUDE.md` 不被覆盖 → complete_lease git_apply patch 无 `does not match index` 冲突
- [ ] daemon 启动同步 sillyspec skills（manifest 版本比对 + bundle 解压）
- [ ] MCP 配置（workspace + 平台）注入 claude 生效
- [ ] **零回归**：host-fs-delegate git_apply 链路、server-local stage、现有 complete_lease 不受影响
- [ ] 模块文档 backend.md / sillyhub-daemon.md 同步本变更

## 覆盖矩阵（D-001~D-008@V1 + FR/NFR）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001（混合投递） | task-01, task-02, task-08 | stage_meta + claude 调 skill + 强制保障 |
| D-002（skill 同步） | task-03, task-04, task-06 | daemon 拉 bundle + workspace 自定义 |
| D-003（MCP 配置） | task-05 | 合并注入 + 白名单 |
| D-004（复用 spec sync） | task-04 | workspace skills 经 spec sync |
| D-005（CLAUDE.md 不覆盖） | task-02 | 删 task-runner:457-463 |
| D-006（方案 C 一次性） | 全 task | 单 Wave 10 task |
| D-007（stage_meta 传递，plan 定） | task-01, task-02 | prompt 内嵌 + env 备份 |
| D-008（skills bundle 打包，plan 定） | task-06 | tar.gz + manifest |
| FR-01~06 / NFR-01~04 | task-01~10 | 见任务总表覆盖列 |

## 自检结果（full）

- [x] 每个 task 编号（task-01~10）
- [x] 任务总表（优先级 + 依赖列，无估时）
- [x] 关键路径标注
- [x] 全局验收标准（含零回归条款）
- [x] D-001~D-008 全在覆盖矩阵
- [x] 无 P0/P1 unresolved blocker（decisions 全 @V1）
- [x] brownfield 兼容：server-local 零回归（task-07）+ host-fs-delegate 不受影响（task-10 验证）
- [x] 无实现细节（接口签名/代码示例不在 plan.md，落 task-NN.md 蓝图）
- [x] 文件覆盖自检：design §6 每个源码文件被至少一个 task 覆盖
- [x] 跨任务契约自检：provider/consumer 关键字段已列
- [x] 入口文件检查：daemon.ts（task-03/05 改启动接线）+ service.py（task-01 改 stage 投递）均 in allowed_paths
- [x] 无 Mermaid（关键路径 + 任务总表依赖列已表达）
