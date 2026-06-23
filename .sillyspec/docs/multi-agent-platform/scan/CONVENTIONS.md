---
source_commit: fcbf3fa7
updated_at: 2026-06-23T00:00:00Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 01:56:21
---

# multi-agent-platform 代码约定

monorepo 根项目（path=.），含三个子项目：backend（FastAPI + Python 3.12）、frontend（Next.js 14 + Antd 6）、sillyhub-daemon（Node ≥ 20 ESM）。本文件由 SillySpec scan 扫描子代理基于 `.claude/CLAUDE.md` 与各子项目配置生成，作为后续变更/生成的输入参考。

## 框架隐形规则

1. **文档驱动开发是硬性规则，不可跳过**：禁止无文档改代码、禁止先写代码再补文档。每次改动代码前必须说明所依据的文档路径，完成后对照文档验收。
2. **执行顺序固定**：`文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收`。后端测试放在 `tests/` 与 `app/` 内（pyproject `testpaths = ["tests", "app"]`，`python_files = ["test_*.py"]`）。
3. **流程分两条**：新功能 / 大改动走完整链路 `sillyspec run brainstorm → plan → execute → verify`；小修复 / 小调整走 `sillyspec run quick`。不要为新功能跳过 brainstorm 直接 execute。
4. **数据可清空**：项目未正式上线，无需考虑版本迭代兼容，schema/migration 可直接重置。
5. **提交流程被 hook 拦截时禁止跳过**：必须解决问题再提交，不得用 `--no-verify` 绕过。
6. **回答风格**：禁止阿谀奉承式回复（如"你说得对"）。

## 代码风格

### backend（Python 3.12，pyproject.toml）
- 工具：ruff（format + lint）+ mypy。`line-length = 100`，`target-version = "py312"`，格式化 `quote-style = "double"`。
- ruff lint `select = ["E","F","I","B","UP","N","SIM","RUF","BLE"]`；显式 ignore 一批：E501（交给 formatter）、N818（异常命名按事件而非 Error 后缀）、RUF001/002/003（中文注释/字符串）、BLE001（async 常裸 catch）、SIM105/SIM117、B008（FastAPI Query 默认值）、RUF012（Pydantic 可变类属性）、RUF006（fire-and-forget）、RUF005、UP037。
- per-file-ignores：`tests/*` 与 `**/tests/*` 放宽 N802/N803/N806/E402/B017；`migrations/versions/*` 放宽 UP035。
- mypy：`python_version = "3.12"`，非 strict，启用 `warn_unused_ignores`/`warn_redundant_casts`/`ignore_missing_imports`，加载 `pydantic.mypy` 插件；大量 error_code 被 disable（attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg/unused-ignore）。
- 运行：`uv run ruff format`、`uv run ruff check --fix`、`uv run mypy`。

### frontend（Next.js 14，eslint 8 + next/core-web-vitals）
- lint script：`next lint`（`.eslintrc.json` 继承 `next/core-web-vitals`）。
- 规则：`no-unused-vars` 设为 warn，`argsIgnorePattern`/`varsIgnorePattern = "^_"`（下划线前缀变量/参数允许未使用）。
- typecheck：`tsc --noEmit`；测试：vitest（`vitest run`）。
- packageManager：`pnpm@9.6.0`，engines `node >= 20.0.0`。

### sillyhub-daemon（Node ≥ 20，ESM，`"type": "module"`）
- 目前 `package.json` 未声明 `lint` script，无独立 eslint 配置文件；类型与正确性靠 `tsc --noEmit` typecheck 守护，测试 `vitest run --passWithNoTests`。
- pnpm overrides 将 claude-agent-sdk 各平台二进制统一重定向到 `@anthropic-ai/claude-agent-sdk@0.3.181`。

## 提交规范

- **双层 hook 拦截**：
  - claude `PreToolUse`（`.claude/settings.json`）：matcher `Bash`，`if: Bash(git commit*)` / `Bash(git push*)` 触发 `node .claude/hooks/pre-commit-ci-check.cjs`（全量 mypy + frontend 检查，timeout 300s）。
  - git `pre-commit`（`.git/hooks/pre-commit` → `backend/.pre-commit-config.yaml`）：`uv run ruff format` + `uv run ruff check --fix`。
- **已知陷阱：复合命令绕过 claude 层**。claude 层按命令前缀匹配 `Bash(git commit*)`，因此 `git add ... && git commit ...` 这类复合命令以 `git add` 开头会绕过 claude 的 mypy/frontend 检查，仅触发 git 层 ruff。要跑全量检查须单独执行 `git commit`。
- **commit message 风格**（取自最近 git log）：Conventional Commits，`<type>(<scope>): <subject>`。
  - 常用 type：`fix` / `feat` / `refactor` / `style` / `chore`。
  - scope 多为子域：`agent-run` / `ppm` / `frontend` / `daemon` / `spec`。
  - subject 中文为主，可含破折号补充（如 `fix(agent-run): 修复调度 sillyspec scan 链路 + 优化前端日志展示`）。
  - 复杂提交用 `Merge sillyspec/<date>-<change>: ...` 格式合入 SillySpec 变更分支。

## 目录约定

- `.claude/CLAUDE.md`：项目级硬性规则与执行顺序（本扫描文档的来源）。
- `.claude/settings.json`：claude PreToolUse hook 配置（CI gate）。
- `.claude/hooks/pre-commit-ci-check.cjs`：claude 层 CI 检查脚本。
- `.sillyspec/changes/<change>/`：SillySpec 变更工作区（proposal / design / plan / tasks / progress）。
- `.sillyspec/docs/<project>/scan/`：扫描文档（本文件所在位置）。
- `docs/`：项目级设计文档。
- `backend/`：FastAPI 应用（`app/` + `tests/` + `migrations/versions/` + `.pre-commit-config.yaml` + `pyproject.toml`）。
- `frontend/`：Next.js 14 应用。
- `sillyhub-daemon/`：Node ESM daemon。

### 环境变量约定

- **`SPEC_TRANSPORT`**（enum `shared|tar`，默认 `shared`）：spec 文档在 daemon 与 backend 间的同步模式（D-001: 正交于 `SpecWorkspace.strategy`，不入库；D-002: 全局开关）。读自 backend `Settings.spec_transport`，`field_validator` 规范化（小写 + 枚举校验）。
  - `shared`（默认）：同机部署，靠 Docker bind mount 共享物理盘（`SPEC_DATA_HOST_DIR` ↔ 容器 `/data/spec-workspaces`），向后兼容现有拓扑。未配置 `SPEC_TRANSPORT` 时回退此模式（SC-1 不变性）。
  - `tar`：异机部署，daemon 与 backend 两台独立设备无共享盘时，spec 文档整树 tar 回传到 backend 权威源 `/data/{ws}`。daemon 侧改用本地 `~/.sillyhub/daemon/specs/{ws}` 缓存，session 终态 `postSpecSync` 回传 + backend `apply_sync` 整树覆盖（D-003 双向同步）。
  - **transport 不入库**（D-001）：不新增表字段、不写 `SpecWorkspace` 列；纯运行时全局开关，避免 spec 数据模型因部署拓扑耦合。对应 design §8 无表结构变更。
  - 切换 transport 不做历史 spec 数据迁移（CLAUDE.md 规则7，数据可清；D-005）：清空 `SPEC_TRANSPORT`（回退 shared）+ 重新 scan 即可。
  - 与 `SPEC_DATA_HOST_DIR` 关系：shared 模式下两者配合（host dir ↔ 容器 bind mount）；tar 模式下 `SPEC_DATA_HOST_DIR` 仍指向 backend 权威源宿主路径，但 daemon 侧不再依赖它（改用本地缓存）。

## 已知陷阱

- **claude.exe 孤儿进程**：清理时禁止 `taskkill /IM` 通杀（会杀掉当前会话自身），必须按 PID 精确终止并排除当前会话 PID。
- **daemon 多实例**：本机可能同时存在"连本地"（`daemon-start.bat`）与"连远程"（手动 cmd）两类 daemon；停止 daemon 时须按 `--server` 区分，避免误杀另一类。无自动拉起机制。
- **复合 git 命令绕过 hook**：见上文提交规范。`git add && git commit` 复合命令以 `git add` 开头，绕过 claude 层 mypy/frontend，仅剩 ruff。
- **daemon 重启 session 恢复**：turn 卡死的真因是 `cli.ts` 漏传 `persistence/recoveryClient`（见 fix-interactive-daemon-lifecycle design §11 / tasks W4，execute 待办）。
