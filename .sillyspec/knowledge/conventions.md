---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 项目约定 (Conventions)

## SillySpec 文档驱动开发流程

本项目使用 SillySpec 文档驱动开发（见 `.claude/CLAUDE.md` 硬性规则）：

- **执行顺序：文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收**
- 禁止无文档改代码、禁止先写代码再补文档
- 新功能/大改动走完整流程：`sillyspec run brainstorm` → plan → execute → verify
- 小修复/小调整：`sillyspec run quick`
- 修改代码前必须说明依据的文档路径；实现完成后对照文档验收
- 本项目未正式上线，数据可清空，不考虑版本迭代兼容
- 提交被 hook 拦截时禁止跳过，必须解决问题再提交

## 子项目构建 / 测试 / lint 命令

monorepo 根无统一命令，必须 cd 到对应子项目：

| 子项目 | 技术栈 | test | lint |
|---|---|---|---|
| backend | FastAPI + uv | `cd backend && uv run pytest` | `cd backend && uv run ruff check .` |
| frontend | Next.js + pnpm | `cd frontend && pnpm test` | `cd frontend && pnpm lint` |
| sillyhub-daemon | Node + pnpm (ESM) | `cd sillyhub-daemon && pnpm test` | `cd sillyhub-daemon && pnpm lint` |

frontend/daemon 构建用 `pnpm build`；backend（Python）无独立 build 步骤。

## 目录约定

- `backend/` — FastAPI 后端（app/core 基础设施 + app/modules/<domain> 业务模块）
- `frontend/` — Next.js 14 前端（src/app App Router）
- `sillyhub-daemon/` — Node.js 本地守护进程（src/，ESM）
- `deploy/` — Docker Compose 部署配置
- `docs/` — 项目级设计文档
- `.sillyspec/` — SillySpec 规范、扫描文档、变更、知识库

## 提交规范

commit message 用类型前缀 + 中文描述，例：`fix(agent-run): 修复调度 scan 链路`、`feat(frontend): 新增 SSE hook`。常见前缀：feat / fix / docs / refactor / test / chore。

## SillySpec 变更状态机（StageEnum + TRANSITION map）

SillySpec 变更生命周期是显式 FSM，定义在工具内部 StageEnum + TRANSITION 映射：
- **StageEnum**：PROPOSE → PLAN → EXECUTE → VERIFY → ARCHIVE（正常前进），外加 BLOCKED（异常态）。
- **TRANSITION**：VERIFY **通过** → ARCHIVE（验收 OK 收尾）；VERIFY **不通过** → BLOCKED → 回退到 PROPOSE/PLAN/EXECUTE 之一重做（按失败原因）。
- 改 SillySpec 工具自身逻辑（stage 流转、auto_dispatch、verify 判定）时，所有状态变迁必须走 TRANSITION map，禁止跳态（如 EXECUTE 直接到 ARCHIVE）。
- 副作用约束：变更进入 ARCHIVE 后 `current_stage` 清空、`status=archived` 是终态判据，不复活。

## backend Python 工程约定（model.py 单数 / ruff 配置）

- **文件名单数**：SQLModel 数据模型文件名是 `model.py`（非 `models.py`），与 router.py / service.py 同级；找模型类 grep `model.py` 而非 `models.py`。
- **ruff 配置**（`backend/pyproject.toml`）：`line-length = 100`；select 含 `E/F/I/B/UP/N/SIM/RUF/BLE`；ignore = `E501 N818 RUF001-003 BLE001 SIM105 SIM117 B008 RUF012 RUF006 RUF005 UP037`（含 `mypy` 侧 `disable_error_code = ["attr-defined","union-attr","assignment","arg-type","valid-type","operator","call-overload","call-arg","unused-ignore"]`）。
- 提交前格式化：`cd backend && uv run ruff format .`（staged 文件先 format 再 add 再 commit，否则 pre-commit hook 拦）。
- APIRouter 统一 `prefix="/api"`（见 Backend 模块组织）。

## daemon ESM import 必须带 .js 扩展名

`sillyhub-daemon` 是 Node ESM（`"type": "module"`），**所有相对路径 import 必须显式写 `.js` 后缀**（即便源文件是 `.ts`）：`import { X } from './config.js'`、`from './types.js'`。
- 漏 `.js` 会在 `pnpm build`（tsc/tsx）或运行时报 ERR_MODULE_NOT_FOUND。
- 改 daemon import 时养成习惯：源码 `.ts`，import 路径写 `.js`；类型 import 用 `import type`。
