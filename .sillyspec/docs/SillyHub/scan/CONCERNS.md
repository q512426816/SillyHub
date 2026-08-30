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

- **变更删除闭环四处收尾尾巴（2026-08-29-change-delete-closure-and-spec-pull 已知裁量/遗留，随 worktree 分支交付）**：① spec-sync 的 service 层结果已含 `platform_deleted` 诊断键（apply_ops 返回 dict），但 `POST /changes/-/spec-sync` HTTP 响应模型暂不透出——CLI 感知「被平台删除拒绝」待后续接线（`spec_workspace/service.py` apply_ops 返回处注释明示契约先行）；② `ChangeRead` 无 `last_pushed_at`（仅列表 ChangeSummary 投影），详情页「最后信号」由 steps 明细派生（`changes/[cid]/page.tsx` `lastSignalFromSteps`，禁新增网络请求）；③ X3 步骤开始上报的渲染侧一行接线（sillyspec 仓 `run/stage.js`/`run/prompt.js` 调 `triggerStepStartSync`）受跨仓 taskcard allowed_paths 约束留后续变更（活跃坑见 `docs/sillyspec/2026-08-29-sillyspec-x1-x4-cli-receipts.md`）；④ `_compute_reparse_scope` docstring 仍写「scoped 零删除」，与 task-03 后「scope∩磁盘确认消失可删」的收窄语义漂移（`spec_workspace/service.py:1987` 一带，规则 18 待修）。
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
- **daemon bundle / self-update 版本对齐**：daemon 按 backend manifest 对齐 bundle，升降级需退出重启（2026-08-28 复核坐实：代码原假设"外部 supervisor 重启"从未落地——install wrapper 是一次性 exec、无 systemd/服务/计划任务，更新完进程死掉需手动拉起；已修复 ql-20260828-004-5798：更新成功改为 stop 释放资源后 detached 自拉起新进程，拉起失败旧进程保活。2026-08-30 更新：开机（或登录）自启已补——2026-08-30-daemon-autostart 提供 CLI `autostart` 子命令三平台注册（Windows 计划任务 / macOS launchd / Linux systemd user service），机器重启/重新登录后可自动拉起；崩溃保活仍无，按 D-002 决策刻意不做（非待办债），自更新 respawn 仍是进程交接的唯一机制）。
