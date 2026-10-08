---
author: qinyi
created_at: 2026-10-08 19:05:00
---
# 端到端验收记录 — 2026-10-08-platform-knowledge-graph（task-10）

> 分层实测（本会话环境约束：docker compose 栈跑的是 main 镜像，worktree 代码进栈需重建镜像——真实栈
> 全链路列为部署后验证项）。所有结论附命令与数字。

## 已实测项

| # | 检查项 | 方法 | 结果 |
|---|---|---|---|
| 1 | 后端 HTTP 三端点行为（五查询/六键全态/overview 容错/路由序/403/422） | `uv run pytest app/modules/knowledge/tests/test_graph.py -q --no-cov`（FastAPI TestClient 真路由真信封） | **14 passed** |
| 2 | daemon RPC 消毒与回码（注入矩阵 9 恶意样本×3 参数/白名单/钳制/三态回码/top-50 裁剪 count 保真/命令拼装字面断言） | `pnpm test -- knowledge-governance runtime-handler`（全注入零真子进程） | **57 passed** |
| 3 | 前端页面与组件（六键全文案/默认 orphans 自动查询/lite↔切片状态机/补全静默降级/entry 深链/preset 深链/图卡三态+清单 href/四卡零回归/力场收敛/NaN 自愈/容差/>200 降级/确定性布局） | `pnpm test -- graph knowledge` | **13 文件 170 用例全绿** |
| 4 | 类型链完整性（后端 schema → openapi → 前端生成类型零手写） | `pnpm gen:types` + `pnpm gen:types:check`（重生成与提交物一致） | ✅ openapi +894 行（527 paths/724 schemas；3 个 graph 端点 + 19 个 Graph schema 落案，路由序由 #1 的 200 断言钉死） |
| 5 | 静态门 | `uv run mypy app`（995 文件）/ `ruff check` / `pnpm exec tsc --noEmit` / `pnpm lint` / daemon `pnpm typecheck` | 全零错（lint 仅 2 条新文件 props 回调形参未用告警，仓内既有同类惯例） |
| 6 | 前端生产构建 | `pnpm build` | exit 0，45/45 静态页生成（3 条 warning 属既有 src/lib/errors.ts，非本次文件） |
| 7 | CLI 前置真实数据 | sillyspec 仓 `knowledge graph summary --clusters 3` / `nodes --search`（本仓真图） | 5789 节点/10338 边/883 簇；dangling 1807 条 662KB 实测印证 top-50 裁剪必要 |

## 环境受限项（部署后验证清单）

以下需要 worktree 代码进 docker 栈（重建镜像）+ 已绑定 daemon 在线 + 登录态浏览器，列为部署后首验项：

- [ ] 真实 daemon 绑定态五查询闭环（浏览器操作图谱页，抽 orphans count 与 CLI 对照）
- [ ] 三主题换肤截图（blue/ai-native/dark）
- [ ] 六键降级实测（停 daemon→offline；解绑→unbound；恶意锚点 `; rm`→invalid_input）
- [ ] OpsDashboard 图卡点开清单跳转图谱页 preset 深链
- [ ] lite 总览簇气泡与代表节点下钻（依赖真 summary.clusters）

## 结论

分层验收全绿（单测/集成/生成物/构建四层，263 项断言）；真实栈全链路因环境（main 镜像无新端点）转部署后验证清单，风险面已由层 1-3 的 mock 边界用例覆盖（六键全态/容错组合/状态机）。
