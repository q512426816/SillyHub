---
author: qinyi
created_at: 2026-10-15 00:19:30
plan_level: full
execution_mode: main  # dispatch=子代理派发（判据见执行模式声明）；本变更任务量小、单会话直写最省（R7/R8 对撞实证），缺省 main
---

# 实现计划（Plan）— 2026-10-14-admin-server-status

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03

## Wave 3（依赖 Wave 2）
- task-04

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端权限与鉴权 | W1 | P0 | — | FR-01, FR-03 / D-001@v2, D-004@v1 | 枚举新增 SYSTEM_STATUS_READ + /system-status 挂 require_permission_any + 三态测试 |
| task-02 | 前端页面与数据层 | W1 | P0 | — | FR-02 / D-002@v2, D-005@v1 | getSystemStatus 恢复 + /admin/server-status 三卡页面 + 组件测试 |
| task-03 | 契约同步 | W2 | P0 | task-01 | FR-03 | 导出 openapi.json + pnpm gen:types（PermissionKey 收录新权限） |
| task-04 | 菜单注册与锚重算 | W3 | P0 | task-02, task-03 | FR-04 / D-003@v1, D-005@v1 | system 组第 6 条 + MENU_ICON_MAP + admin/menus 断言锚重算 + 聚焦回归 |

## 关键路径
task-01 → task-03 → task-04（3 跳最长路径；task-02 → task-04 为支线）

## 全局硬约束（绑定所有 task；前 3 条与后 4 条源自 design.md，其余 3 条为仓库级约束，真源 .claude/CLAUDE.md 规则 20/12/13）
- SystemStatusResponse 响应结构零变化（不改 backend/app/modules/health/schema.py）
- /api/health 保持公开不动（负载均衡健康检查语义）
- 存量角色与用户权限零变化（无种子迁移）
- 前端接口类型（frontend/src/lib/api-types.ts）必须从后端 OpenAPI 生成（pnpm gen:types），禁止手写
- menuKey 稳定标识规约（R-01）：menuKey=server-status 禁止重命名或复用
- 品牌色一律用 brand-* 语义阶（随 html data-theme 换肤），blue-* 阶仅限真信息蓝；颜色不硬编码 hex；阴影走主题 token〔仓库级，真源 .claude/CLAUDE.md 规则 20〕
- UI 和文档默认中文；代码兼容 Windows/Linux/macOS〔仓库级，真源 .claude/CLAUDE.md 规则 12/13〕

## 全局验收标准
1. 聚焦单元测试通过：backend/tests/test_health.py（含新三态用例）、前端新页面组件测试、admin/menus 测试
2. tsc --noEmit 与 eslint 零错（frontend）；ruff/mypy 零错（backend 改动文件）
3. （brownfield）未持新权限用户：菜单不可见 + 接口 403；管理员（platform:admin）：行为不变可见可访问
4. 匿名访问 /api/system-status 不再返回服务器数据（BS-6 关闭）

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01 | test_health.py 三态用例（401/403/200） |
| D-002@v2 | task-02 | 页面组件测试（三卡渲染+轮询+降级） |
| D-003@v1 | task-04 | admin/menus 测试 6 行断言+锚注释 |
| D-004@v1 | task-01, task-03 | 枚举无种子迁移；gen:types 收录 |
| D-005@v1 | task-02, task-04 | 独立页面+菜单入口 |
| D-006@v1（rejected） | 非目标 | 设置页不加 Tab |
| D-007@v1（rejected） | 非目标 | 首页不挂卡片 |
