---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 关注点（Concerns）

> 仅列本轮 Grep/Read 逐条核实过的问题，每条附代码位置。🔴 正确性/阻塞、🟡 半成品/防护面窄/锁版债、🟢 低风险维护项。

## 代码质量

### 🔴 正确性 / 阻塞

- 无新增（上一轮列的 interactive kill 假停、MissionControl cancel 造僵尸已随 daemon-kill-channel 变更修复关闭；本轮扫描未发现同级新问题）。

### 🟡 半成品 / 防护面窄

- **CI flaky 债未根治** — `backend/pyproject.toml` dev 依赖注释 + `backend-ci.yml:54-57`：2 核下 xdist + async fixture + in-memory SQLite 偶发竞态（task/change/runtime reparse created=0 → StopIteration / 文件列表空），本机 20 核 3931 passed 复现不了；loadscope + `--reruns 2` 只是兜底。
- **spec 同步 tar 解包 `filter="fully_trusted"`** — `app/modules/spec_workspace/service.py:717`。安全性全靠手工预校验（绝对路径拒绝 L698、resolve+relative_to 越界拒绝 L703-710、成员白名单 + `SERVER_EXCLUDED_FILENAMES` 过滤 L713），tarfile 内建 data 过滤（symlink/特殊文件）被显式关闭；预校验只查路径字符串，符号链接成员的间接越界路径未覆盖。
- **release 审批 reject 不阻断** — `app/modules/release/service.py:169-170` 仅 verdict=="approve" 时查阈值；`_check_approval_threshold`（L253-268）与 `_require_approvals`（L274-281）计数只数 approve，reject 仅落记录（L160-167）。先被甲 reject、再被乙丙 approve 仍可达 min_approvers 置 approved，生产发布门语义存疑。
- **spec_profile 骨架未收尾** — `policy.py:61`（stage 冲突检测）、`policy.py:97`（document 冲突检测）、`provider.py:75`（follow-up）三处 TODO 本轮 grep 确认仍在。
- **spec_guardian 死代码** — `app/modules/workflow/spec_guardian.py:193` `run_guard` 全 app 范围仅 `tests/test_spec_guardian.py` 调用，无任何生产调用点。
- **mypy 实质偏弱** — `pyproject.toml [tool.mypy]`：`strict=false` + `disable_error_code` 关闭 9 类（attr-defined/union-attr/assignment/arg-type/valid-type/operator/call-overload/call-arg 等）+ `ignore_missing_imports=true`，新代码类型错误基本不被拦截。
- **llm_provider 探测形态未实测收口** — `app/modules/llm_provider/probe.py:55/99`：spike-01 遗留，GLM/kimi 兼容端点 GET /v1/models 是否可用待实测后调整。

### 🟢 低风险维护项

- **OpenTelemetry 仍是 stub** — `app/core/telemetry.py:21`：配置 `OTEL_ENDPOINT` 才 init 且仅打 `status="stub"` 日志，无真实 exporter，生产链路追踪落空。
- **Redis 测试半隔离** — `backend/conftest.py:94-135`：用真实 redis db15 `FLUSHDB` 而非 fake/in-memory 替身；redis 不可用时 best-effort 跳过（限流分支静默降级放行），本机无 redis 的全量绿不等于覆盖限流路径。
- **上轮 deprecated 保留清单已过时** — `@deprecated` / `deprecated_method_called` 标记本轮 grep 已无匹配（多数随重构清理），旧 scan 文档相关条目应视为历史。

## 依赖风险

### 🔴 阻塞 / 易踩

- **alembic migration 多 head 分叉** — `backend/migrations/versions/` 已 144 个 .py（上轮扫 117，增长来自并行 change）。并行变更撞 revision/down_revision 即多 head → 启动 crash-loop，SQLite 单测抓不到（PG 才暴露）；新 migration 须接真实 head + 唯一 id（fix-platform-progress-pk change 踩过 down_revision 收敛单 head）。

### 🟡 锁版 / 方言 / 环境

- **mcp>=1.29,<2 锁版** — `pyproject.toml` L30-34 注释：mcp SDK v2.0.0（2026-07-28）breaking 移除 FastMCP 改 MCPServer，与 mcp_gateway 的 FastMCP ASGI mount 写法冲突，锁 <2；升级需重构 mcp_gateway，v1 线依赖上游 v1.x 分支收 bugfix/security patch。
- **aiobotocore>=3.8,<4 锁版** — `pyproject.toml` L29：v4 未评估，升级前需重过 spike 验证与现有异步栈兼容性。
- **python-jose[cryptography]>=3.3 + passlib[bcrypt]>=1.7** — 两个约束下限均为多年未发大版本的库（JWT/bcrypt 生态有更活跃替代），无 CVE 排查记录、未排期评估（本轮未做外部 CVE 核实）。
- **测试 SQLite vs 生产 PostgreSQL 方言差异** — `date_trunc` 等需方言分支；asyncpg Windows 装不上（README 常见问题），本地连容器 PG。
- **Python >=3.12 硬要求** — `requires-python = ">=3.12"`；CI 用 `uv python install 3.12`，部署镜像同版本线，低版本环境直接不兼容。

### 🟢 已缓解 / 可控

- **CI 15 分钟超时已放宽 30 分钟** — `backend-ci.yml:21-23`（2026-08-15 实测撞顶 99% 被取消后调整，注释在案）。
- **CI flaky 有双兜底** — loadscope（pyproject addopts）+ `--reruns 2`，代价仅重试时长。
- **redis 竞态已有 fixture** — `_reset_redis_state` 重建单例绑当前 loop + FLUSHDB（`conftest.py:94`），order-dependent 登录限流 flaky 已解。
