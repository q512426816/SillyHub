---
author: qinyi
created_at: 2026-07-23 05:50:00
---
# 模块影响分析（Module Impact）— 移动端 App UI

## 影响模块：frontend（唯一功能模块）

### 新增文件（移动端 App UI 主体）
- `frontend/src/middleware.ts` + `middleware.test.ts`（task-01，UA 检测 + rewrite 到 `/m/`，防 FOUC）
- `frontend/src/lib/auth/route-guard.ts` + `route-guard.test.ts`（task-03，移动路由守卫，镜像桌面不改桌面）
- `frontend/src/components/mobile/`（task-04 外壳 + 底部 5 Tab + 顶栏；task-07 通用组件库：MobileCardList 全功能 + FilterDrawer + DetailSheet + ActionMenu + BatchBar + ExportButton + 测试）
- `frontend/src/app/m/layout.tsx` + `layout.test.tsx`（task-05，移动外壳 + 守卫接线）
- `frontend/src/app/m/login/page.tsx`（task-06，移动登录页，复用桌面 auth）
- `frontend/src/app/m/ppm/{workbench,task-plans,problem-list}/page.tsx`（task-08/09/10，PPM 三页移动视图，全功能）
- `frontend/src/app/m/workspaces/page.tsx`（task-11，工作区选择移动视图）

### 修改文件
- `frontend/src/styles/tokens.ts`（task-02，新增 `breakpoint` token，mobile ≤768）
- `frontend/src/lib/__tests__/query-client.test.ts`（预存债修复：同步 react-query v2 staleTime 15000，D-002@v2，解锁 ci-check hook）
- `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（task-12，新增 §13「移动端 App UI」章节 + 更新原「非目标」条款）

### 预存债修复（backend，非 mobile 功能，随本变更 commit 解锁 hook）
- `backend/app/modules/change/dispatch.py`（ruff UP033 `lru_cache(maxsize=None)` → `functools.cache`）
- `backend/app/modules/admin/router.py`、`agent/service.py`、`runtime/service.py`、`ppm/problem/tests/test_problem_flow.py`（ruff format）

### 契约影响
- **无后端 API / 数据模型变更**：数据层 100% 复用 `lib/*` 函数 + Zustand stores + OpenAPI 类型（D-003）
- **桌面零回归**：`app/(dashboard)/**`、`components/app-shell.tsx`、`app/(auth)/login`、`components/layout/**` 全不动

### 文档同步建议（step 3）
- `modules/frontend.md` 模块卡片：补「移动端 App UI」子节（`/m/` 路由段 + `components/mobile/` + middleware 设备分流 + 底部 5 Tab + MobileCardList 替代表格 + 数据层复用 lib/*）
- `modules/_module-map.yaml`：frontend `entrypoints` 补 `app/m/*` 移动路由；`paths` 已含 `frontend/**`（无需改）

## unmapped 文件
无。所有变更文件归属 frontend 模块（移动端 + tokens + query-client + 文档）或显式标注的 backend 预存债修复。

## 三重交叉验证
- **声明范围**（design §6 文件清单 / proposal 变更范围）：17 文件 + 测试 + 预存债修复
- **真实修改**（execute 13 task 实现 + cp 落地主仓库工作区 + commit 162fd0dc）：一致
- **模块映射**（`_module-map.yaml` frontend `paths: frontend/**`）：全部命中 frontend 模块

## 已知 gap（verify 记录，非阻断）
- gap-1「我的」Tab → `/account` 无 `/m/account`（design §6/§3 设计张力）
- gap-2 深链回跳 route-guard replace 未带 redirect（FR-03 半接线）
- sillyspec worktree apply --merge bug（cp 兜底，待记 docs/sillyspec/）
