---
author: qinyi
created_at: 2026-07-07 13:15:00
---

# 2026-07-07-daemon-skill-execution 设计文档

## 1. 背景

2026-07-06-daemon-host-fs-delegate 归档后的 e2e 暴露：daemon 跑 stage 任务前，`task-runner.ts:457-463` 把 stage prompt（`ctx.claudeMd`）覆盖写到 worktree 的 `.claude/CLAUDE.md`。verify stage 产出的 patch 基于 HEAD，apply 到被覆盖的 worktree 时基准不一致 → `does not match index` 冲突。

深挖发现两层根因：
1. **stage 投递机制错位**：stage prompt（任务说明）覆盖 `.claude/CLAUDE.md`（项目规则），语义错位 + 污染 worktree git 状态。
2. **daemon 无能力管理**：daemon-client 模式 claude 在宿主跑，但 daemon 不管 claude 的 skill/MCP 环境——worktree `.claude/skills/` 可能没有 sillyspec skills，claude 调不到 `/sillyspec-verify`，只能靠 backend 拼 prompt 兜底（写 CLAUDE.md）。

sillyspec 已有完整 skill 集（`.claude/skills/sillyspec-*` 共 ~20 个），stage 执行本应调 skill 跑流程，而非 backend 拼 prompt。

## 2. 设计目标

- **stage 投递重构**：backend 传 stage 元数据（change_id + stage 名 + skill 名 + spec_root_ref），claude 启动调对应 sillyspec skill（如 `/sillyspec-verify`），skill 读 specDir 文档 + 接收元数据跑完整流程。backend 不再拼完整 stage prompt。
- **daemon 能力管家**：daemon 管 claude 的 skill/MCP 环境——sillyspec 平台 skills 同步到宿主，workspace 自定义 skills + MCP servers 配置注入。
- **`.claude/CLAUDE.md` 不被覆盖**：删 task-runner.ts:457-463 写 stage prompt，worktree 原项目规则 CLAUDE.md 保留。patch 基准一致，冲突根除。
- **复用现有机制**：daemon self-update（bundle 分发）+ daemon-client spec sync（skill 读 specDir）+ AgentSpecBundle（已落地，backend stage 投递数据结构）。

## 3. 非目标

- 不改 daemon-client 架构本身（claude 宿主跑 + backend 容器调度模式保留）。
- 不改 host-fs-delegate（已归档，委托链路通）。
- 不重构 sillyspec skills 内部实现（只管投递/同步，不改 skill 内容）。
- 不做完整 MCP 市场（动态安装/权限/版本生态，YAGNI——本变更只到"配置注入"）。

## 4. 拆分判断

用户选方案 C（一次性全做）。单 Wave 完成 4 块（skill 同步 + MCP 注入 + stage 投递重构 + 验证），无中间态。trade-off：多机制同时上风险高，但避免代码改两次（点 1 单独做后再改点 2）。预估 6-8 task。

## 5. 总体方案

### 5.1 stage 投递重构（backend + daemon）

**backend 侧**（`agent/service.py` stage 投递）：
- `_build_stage_bundle()` 改为构造**stage 元数据**（不再拼完整 prompt）：
  ```python
  StageDispatchMeta = {
      "change_id": str,
      "stage": str,            # verify/execute/brainstorm/...
      "skill_name": str,       # "sillyspec-verify"
      "spec_root_ref": str,    # daemon-client spec root（已有）
      "workspace_id": str,
  }
  ```
- 通过 AgentSpecBundle 携带 stage 元数据（复用 base.py:57 AgentSpecBundle，加 `stage_meta` 字段）。
- 删 backend 拼 stage prompt（verify.md 等模板废弃/归档）。

**daemon 侧**（`task-runner.ts`）：
- 删 line 457-463 写 `.claude/CLAUDE.md`。
- claude 启动 prompt 改为简短指令：`"请使用 {skill_name} skill 执行 change {change_id} 的 {stage} 阶段"`（一句话），通过 claude `-p` 或 stdin 传（不写文件）。
- claude 启动后调 skill，skill 读 specDir + stage_meta 跑流程。

### 5.1.1 Grill gap 补充（Step 12 交叉审查）

**stage_meta 传递链**（gap 1）：claude 启动 prompt 内嵌简短指令 `/sillyspec-verify --change <id> --stage verify`（skill 自己解析参数）；备份用环境变量 `STAGE_META=<json>`（daemon spawn claude 时注入，skill 从 `process.env.STAGE_META` 读，应对 prompt 被截断）。

**claude 强制调 skill**（gap 2）：三层保障——① prompt 是明确 skill 调用指令（非开放式任务）；② claude `--allowedTools` 不限制 skill（确保 skill 可触发）；③ 兜底：daemon 检测 claude 输出 `skill not found` / 未调 skill（turn 结束无 skill 痕迹）→ 标记 run 失败 + 报错（不静默）。

**server-local 模式**（gap 3）：backend 容器内 claude 跑 stage——容器镜像构建时 `COPY .claude/skills/ /app/.claude/skills/`（sillyspec skills 进镜像）；stage_meta 同样通过 prompt + env 传；不涉及 daemon skill 同步（容器自带）。server-local 的 task-runner 等价路径（若有）同样删写 CLAUDE.md。

### 5.2 daemon skill 同步（daemon 新能力）

新建 `sillyhub-daemon/src/skill-manager.ts`：
- **平台 skills 同步**：daemon 启动/注册时从 backend 拉 sillyspec skills bundle（`.claude/skills/sillyspec-*.tar` 或单文件集），解压到宿主全局 `~/.sillyhub/daemon/skills/`（或 worktree `.claude/skills/`）。借鉴 daemon self-update 的 bundle 分发 + 版本比对。
- **workspace 自定义 skills**：workspace 绑定时（或 lease 时）从 specDir 拉 workspace 自定义 skills 到 worktree `.claude/skills/`。借鉴 daemon-client spec sync。
- **claude 启动时 skills 可用**：spawn claude 时 `cwd=workdir`，claude 自动加载 `.claude/skills/`。或通过 `--skill-dir` 显式指定（如 claude CLI 支持）。

### 5.3 MCP 配置注入（daemon 新能力）

新建 `sillyhub-daemon/src/mcp-config.ts`：
- **配置来源**：
  - 平台默认：admin 配全局 MCP（存 backend DB 或 specDir 全局），所有 workspace 共享。
  - workspace 级：workspace specDir 的 `.mcp.json`（用户配自己的 MCP，如 web 搜索/数据库）。
- **注入**：daemon 跑 claude 时合并平台 + workspace 的 MCP 配置，生成临时 `.mcp.json`，spawn claude 时 `--mcp-config <path>` 或写 worktree `.mcp.json`（claude 自动读）。
- **权限**：MCP server 白名单（admin 控制，防恶意 MCP）。

### 5.4 e2e 验证

- daemon-client workspace 触发 verify dispatch → claude 调 `/sillyspec-verify` skill（skills 已同步）→ skill 读 specDir + stage_meta 跑 verify → complete_lease patch apply（worktree CLAUDE.md 不被覆盖，基准一致，无冲突）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/task-runner.ts | 删 line 457-463 写 CLAUDE.md；claude 启动改传 stage_meta + skill 指令 |
| 新增 | sillyhub-daemon/src/skill-manager.ts | 平台 skills 同步（bundle 拉）+ workspace 自定义同步 |
| 新增 | sillyhub-daemon/src/mcp-config.ts | MCP 配置合并 + 注入 claude |
| 修改 | sillyhub-daemon/src/daemon.ts | 启动调 skill-manager 同步；spawn claude 注入 mcp-config |
| 修改 | backend/app/modules/agent/service.py | _build_stage_bundle 改构造 stage_meta（不拼 prompt） |
| 修改 | backend/app/modules/agent/base.py | AgentSpecBundle 加 stage_meta 字段 |
| 新增 | backend/app/modules/agent/skills-bundle 打包 | 平台 skills 打包分发（backend 端，类似 daemon bundle） |
| 废弃 | backend/.../stage templates（verify.md 等） | stage prompt 模板废弃（skill 自带流程） |

## 7. 接口定义

### StageDispatchMeta（backend → daemon → claude → skill）
见 §5.1。

### skill 同步协议
- backend `GET /api/daemon/skills/latest/manifest` + `/skills/latest/sillyspec-skills.tar`（平台 skills bundle 分发，仿 daemon install）。
- daemon 启动查 manifest，版本新则拉 bundle + 解压。

### MCP 配置格式
```json
// workspace 级 .mcp.json（specDir）
{
  "mcpServers": {
    "web-search": { "command": "...", "args": [...] }
  }
}
```

## 7.5 生命周期契约表

涉及 session/lease/skill 关键词：

| 实体 | 状态转移 | 触发点 | 修改影响 |
|---|---|---|---|
| lease | → completed | complete_lease | claude 调 skill 跑 stage；patch apply 时 CLAUDE.md 不被覆盖（基准一致）|
| skill | available | daemon 启动/lease | daemon 同步 sillyspec skills 到 worktree/.claude/skills/；版本旧则更新 |
| mcp config | injected | spawn claude | daemon 合并平台+workspace MCP 配置注入 claude --mcp-config |

## 8. 决策

- **D-001@V1**：stage 投递=混合（backend 传 stage 元数据 + skill 名，claude 调 sillyspec skill 跑流程，不拼完整 prompt）。
- **D-002@V1**：skill 同步=daemon 启动拉 sillyspec skills bundle（仿 self-update，全局）+ workspace 绑定时同步自定义（仿 spec sync，worktree）。trade-off：启动拉（简单，全 daemon 共享）vs lease 拉（按需，开销）—— 选启动拉（skills 变化低频）。
- **D-003@V1**：MCP 配置=workspace 级 `.mcp.json` + 平台默认，daemon 合并注入。trade-off：纯 workspace（隔离）vs 平台+workspace（共享+自定义）—— 选后者（平衡）。
- **D-004@V1**：skill 读 specDir=复用 daemon-client spec sync（不重复造）。
- **D-005@V1**：`.claude/CLAUDE.md`=保留项目规则不覆盖（删 task-runner:457-463 写 stage prompt）。
- **D-006@V1**：方案 C 一次性全做（用户选，无中间态）。

## 9. Wave 分组（一次性，task 内拆）

单 Wave，6-8 task：
- task-01：backend stage_meta 数据结构（AgentSpecBundle 扩展）+ _build_stage_bundle 改造
- task-02：daemon task-runner 改（删写 CLAUDE.md + claude 启动传 stage_meta/skill 指令）
- task-03：daemon skill-manager（平台 skills 同步，仿 self-update）
- task-04：daemon workspace 自定义 skills 同步（仿 spec sync）
- task-05：daemon mcp-config（合并 + 注入）
- task-06：backend skills bundle 打包分发端点
- task-07：废弃 stage prompt 模板 + 文档同步
- task-08：e2e 验证（stage 调 skill 端到端）

## 10. 验证策略

- **单测**：skill-manager（mock bundle 拉）、mcp-config（合并逻辑）、task-runner（stage_meta 传 + 不写 CLAUDE.md）、backend stage_meta 构造。
- **集成**：daemon 启动同步 skills + claude 启动调 skill + MCP 注入。
- **e2e**：daemon-client verify dispatch → claude 调 /sillyspec-verify → skill 跑流程 → complete_lease patch apply（无冲突）。
- **回归**：host-fs-delegate git_apply 链路仍通；server-local stage 不受影响。

## 11. 风险

- **skill 自主调用**：claude 启动 prompt 说"调 skill"，claude 是否一定调？需 claude 的 skill 触发可靠（skill description 明确）。兜底：prompt 强制指令 + skill 不可用时明确报错。
- **skill 版本管理**：平台 skills 更新怎么同步到 daemon（daemon 启动查 manifest，但运行中 skills 更新需重启或热更新）。
- **MCP 配置文件位置**：workspace 级 `.mcp.json` 放 specDir 哪里（docs/<ws>/?或 workspace 配置）。需定。
- **stage prompt 模板废弃的 brownfield 兼容**：现有 verify.md 等废弃，但已有 change 可能依赖？本变更未上线，允许重置。
- **agent-stage-dispatch 停滞变更清理**：本变更替代其方向，建议单独清理（archive 或 delete）。
- **skill 依赖 sillyspec CLI**：skill 跑流程调 sillyspec CLI，需 daemon 宿主装 sillyspec（或 spec sync 含）。

## 12. 自审

**完整性**：四件套（proposal/requirements/design/tasks）齐。方案 C 一次性 4 块覆盖点 1+2+3。决策 D-001~D-006。文件清单 8 项。

**正确性**：基于 e2e 真实证据（host-fs-delegate patch 冲突）+ 现有机制（self-update/spec sync/AgentSpecBundle）复用。核心假设（claude 能调 skill）依赖 skill 触发可靠（风险已列）。

**风险**：skill 自主调用 + 版本管理 + MCP 配置位置 是主要不确定项，plan 阶段细化。

**遗漏检查**：task-08 e2e 验证；brownfield 兼容（未上线，允许重置）；agent-stage-dispatch 清理（单独）。
