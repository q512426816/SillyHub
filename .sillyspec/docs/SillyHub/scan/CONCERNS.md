---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 关注点（Concerns）

本文件只列平台级真实问题，每条给依据文件（含实测行号的为本轮 2026-08-18 重扫核验；标「未复核」的为沿用旧版 / 审计记录）。分级：🔴 高（正确性 / 安全）、🟡 中（质量 / 演进风险）、🟢 低（维护性 / 体验）。2026-08-08 多代理安全审计的逐条 file:line 详单见 `docs/agent-platform-deep-audit-2026-07-12.md` 与旧版 CONCERNS（source_commit 5a00fc7e）。

## 代码质量

### 🔴 高

- **2026-08-08 多代理审计多项 🔴 未确认闭合（本轮未逐一复核）**：授权引擎 `workspace_id=None` 退化越权（`core/auth_deps.py` / `auth/rbac.py`）、`user:write` 持有者提权链（`admin/users_service.py`）、后端无周期性 sweeper（lease / 会话 / daemon 回收零生产调度）、worktree 资源与明文凭证多源泄漏（`agent/execution.py` / `worktree/service.py`）、daemon 停止 / 崩溃不杀子进程（`sillyhub-daemon/src/cli.ts` / `daemon.ts`）、Codex 交互第二轮必崩（`input-queue.ts` / `codex-app-server-driver.ts`）。依据：`docs/agent-platform-deep-audit-2026-07-12.md` + 旧版 CONCERNS。**另一批 5 高危已由 `2026-08-14-security-audit-remediation` 闭合**（WS 鉴权 / claim 归属 / llm-proxy master key 不出进程 + 路径白名单 / file IDOR / platform_sync 写 403，见 `.sillyspec/changes/archive/2026-08-14-security-audit-remediation/`）；前端 Markdown 存储型 XSS 已修（`frontend/src/components/ui/markdown-text.tsx` 已配 rehypeSanitize + MARKDOWN_SANITIZE_SCHEMA，本轮实测）。动手前须逐项重验行号与状态。

### 🟡 中

- **CI 资源受限竞态 flaky 债（预存、非业务回归）**：GitHub Actions 2 核下 xdist + async fixture + in-memory SQLite 偶发竞态（task/change/runtime reparse created=0 → StopIteration），本机 20 核全量绿复现不了；已用 `dist=loadscope` 挡大部分 + `--reruns 2 --reruns-delay 1` 兜底（`backend/pyproject.toml` dev 依赖注释、`.github/workflows/backend-ci.yml:54-57` 注释）。CI 红而本机同命令绿时停止盲改。
- **双根命名空间并存**：`.sillyspec/docs/` 下 `SillyHub/`（scan 8 篇 + 模块文档）与 `multi-agent-platform/`（scan / flows / modules / glossary）两套平台级文档并行，另有 backend / frontend / sillyhub-daemon 子项目目录；根项目视角的文档归属在两个名字间分裂，职责未收敛，检索与维护双份成本（本轮 ls 实测）。
- **spec_profile 模块骨架未实现**：`backend/app/modules/spec_profile/provider.py:75`、`policy.py:61`、`policy.py:97` 三处「后续任务实现」占位注释——阶段冲突与文档冲突检测尚未实现；backend 源码内未完成标记全部集中在此模块（grep 实测）。
- **workflow/spec_guardian 死代码**：`run_guard` 全仓仅被 `workflow/tests/test_spec_guardian.py` 引用，G3-G7 质量 / 文档 / 组件守护门从未在生产路径生效（grep 实测）。
- **tool_policies 注释引用不存在的方法**：`backend/app/modules/tool_gateway/tool_policy.py:175` docstring 写「loaded by the caller (e.g., ToolGatewayService._load_policy)」，但全仓 grep 无 `def _load_policy` 定义——注释与实现不一致（项目规则 18：注释和实现不一致是万恶之源）。
- **release 生产审批门只数 approve 票**：`_require_approvals` 仅统计 `verdict=="approve"`，reject 完全不阻断；`deploy_policy.min_approvers` 直接 `policy.get(...)` 无下界钳制（`backend/app/modules/release/service.py:271-290` 本轮实测；create 侧是否校验未复核，审计原判 🔴，未复核部分降 🟡）。
- **spec tar 解包残余风险**：成员名绝对路径 / `..` 越界已拒（`backend/app/modules/spec_workspace/service.py:696-715` 本轮实测，422 拒整体），但 `extractall(filter="fully_trusted")` 保留（`:717`），tar 内软链 linkname（链接目标）是否校验未在该段见到——残留逃逸面未核实。

### 🟢 低

- **daemon interactive 兼容入口 @deprecated 未清**：`sillyhub-daemon/src/interactive/types.ts:369`、`claude-sdk-driver.ts:226`、`:246` 三处（grep 实测），确认无外部引用后应清理。
- **daemon god 文件未拆分**：`daemon.ts` / `task-runner.ts` 高耦合、lease payload 鸭子类型几十处，无低风险切片（旧 scan 记录，未复核）。
- **scan 漂移门 warn-only**：scan 文档过期只告警 + PR 评论，不阻塞 merge，修复仍需人工重跑（`.github/workflows/scan-drift.yml` 头部注释）。
- **vitest 配置注释数字过期**：`sillyhub-daemon/vitest.config.ts` 注释写「84 个测试文件 / 20 核」，现实测 141 个——注释随规模漂移未同步。

## 依赖风险

### 🟡 中

- **mcp Python SDK 锁 `>=1.29,<2`**：v2.0.0（2026-07-28）为 breaking 大改（移除 FastMCP 改用 MCPServer），与平台 FastMCP ASGI mount 设计冲突，锁 v1 线取 1.29.x；v1.x 仅持续收 critical bugfix / security patch，未来升 v2 需重写 mount 方案（`backend/pyproject.toml:30-34` 注释）。
- **`@anthropic-ai/claude-agent-sdk` 硬钉 0.3.181 + 8 平台 override**：主依赖钉死，`pnpm.overrides` 再将 win32/linux/darwin × x64/arm64/musl 共 8 个平台子包全部绑定同版本（`sillyhub-daemon/package.json:29,36-47`）——升级须同步 9 处，跨平台打包链路长，任一平台子包缺失即安装失败。
- **aiobotocore `>=3.8,<4`**：对象存储异步客户端上界锁定（`backend/pyproject.toml:29`），major 升级时与 botocore 生态的联动需验证。
- **前端双浏览器自动化依赖**：`@playwright/test ^1.60` 与 `puppeteer ^24.43` 并存于 devDependencies，且仓库内无 playwright 配置文件（`frontend/package.json:44,58` + Glob 实测无 config）——E2E 能力实际未启用，两套依赖职责重叠，留着即持续升级负担。
- **运行时版本下限钉**：Python `>=3.12`（`backend/pyproject.toml requires-python`）、Node `>=20.0.0` + pnpm 9.6.0（frontend / daemon `package.json` engines + packageManager）；CI 按 pnpm 9.6.0 + Node 20 固定复现（`frontend-ci.yml`）。低于下限的本地环境直接不可跑。

### 🟢 低

- **asyncpg Windows 本地安装受限**：本地开发经 Docker 起 PostgreSQL、后端连容器；生产 asyncpg 与单测 aiosqlite 走不同 async 驱动，存在 JSONB / 数组 / UPSERT 方言差异风险（旧 scan 记录，未复核）。
- **前端双 UI 体系**：antd 6 + Tailwind 3.4 + @xyflow/react + radix/shadcn 并存（`frontend/package.json` dependencies 实测），样式混合类名与优先级冲突需持续治理。
- **daemon bundle / self-update 版本对齐**：daemon 按 backend manifest 对齐 bundle，升降级都需 `need_restart` 退出重启（旧 scan 记录，未复核）。
