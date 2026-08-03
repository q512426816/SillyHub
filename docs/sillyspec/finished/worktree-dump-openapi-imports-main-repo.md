# 坑：worktree 下 `python scripts/dump_openapi.py` 导入主仓库 app，openapi.json 漏 worktree 专属路由

状态：活跃（待工具/流程修复）

## 现象
在 worktree 里改了 backend 路由（新增端点 / 改 response_model DTO），跑：

```
cd <worktree>/backend
python scripts/dump_openapi.py
```

生成的 `openapi.json` **不包含** worktree 专属的新端点 / 新 schema（path 数 / schema 数与主仓库一致，没涨）。但路由在运行时确实注册了（`from app.main import app; app.routes` 能看到，pytest 也能 200 命中）。

本次实例：2026-07-29-model-error-visibility task-07 新增 `GET /api/daemon/sessions/{id}/runs` + `SessionRunRead`。`dump_openapi.py` 写出 342 paths / 408 schemas（与 main 一致），新端点 + SessionRunRead 缺失。

## 根因
worktree 的 `backend/.venv` 是指向**主仓库** `.venv` 的 Junction（见 memory `sillyspec-execute-worktree-pitfalls.md` 第1条）。主仓库 backend 以 editable install（`pip install -e .` / `multi-agent-platform-api` 包）注册在共享 venv 的 site-packages，指向**主仓库** `backend/app`。

Python 的 `sys.path[0]` 规则：
- `python -c "..."`（cwd=worktree/backend）→ `sys.path[0]=''`（cwd）→ **worktree app 优先**（正确）。
- `python scripts/dump_openapi.py` → `sys.path[0]=scripts/ 目录`，cwd **不在** sys.path → `from app.main import app` 落到 venv site-packages 的 editable install → **主仓库 app**（不含 worktree 新代码）。

所以 dump 生成的是主仓库的 schema，丢 worktree 增量。

## 验证方法
脚本模式下打印 app 归属：
```python
# 用绝对路径跑一个临时脚本，复现 script 模式
python /tmp/probe.py   # sys.path[0]=/tmp，app.__file__ 指向主仓库
```
对照：`python -c "import app; print(app.__file__)"`（cwd=worktree/backend）指向 worktree。

## 解法
**方案 A（推荐）：直接 `pnpm gen:types`，别单独跑 dump_openapi.py。**
`frontend/scripts/gen-api-types.mjs` 用 `file:///.../<worktree>/backend` 显式 build `multi-agent-platform-api` 包再 dump，路径钉死 worktree，**不受共享 venv editable install 影响**。它内部会重 dump 一份正确的 `backend/openapi.json`（本次实测 343 paths / 411 schemas，含新端点）。即 CLAUDE.md 规则20 的 `pnpm gen:types` 一步本身就产出正确的 openapi.json + api-types.ts，前置的手动 dump_openapi.py 在 worktree 里是多余且有害的。

**方案 B（必须单独 dump 时）：`PYTHONPATH` 钉死 worktree backend。**
```
PYTHONPATH=<worktree>/backend python scripts/dump_openapi.py
```
PYTHONPATH 插在 site-packages 之前，worktree app 压过 editable install。

## 影响范围
- 任何 worktree 模式 execute/verify 里被要求「跑 dump_openapi.py 同步 openapi」的 task（如本 change task-07）。
- 主仓库（非 worktree）不受影响：cwd 与 editable install 指向同一份代码。

## 建议
- SillySpec 流程里「gen:types 同步类型」步骤应统一走 `pnpm gen:types`，移除单独的 `dump_openapi.py` 指令（或在 worktree 模式自动加 PYTHONPATH）。
- 记忆 `sillyspec-execute-worktree-pitfalls.md` 可补一条：worktree gen:types 只认 `pnpm gen:types`，手动 dump_openapi.py 会因共享 venv editable install 导入主仓库。
