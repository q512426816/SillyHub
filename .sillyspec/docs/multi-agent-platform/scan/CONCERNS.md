---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# CONCERNS — multi-agent-platform (monorepo)

## 严重

- **前端测试覆盖极低**：42 个页面 + 21 个 API 模块，仅有 1 个测试文件（67 行 / 4 个用例）。页面组件、业务逻辑、状态管理均无测试覆盖。
- **@tanstack/react-query 未使用但存在于 dependencies**：增加了 bundle 体积，可能误导后续开发者。
- **无 compose 文件在根目录**：`docker-compose.yml` 在 `deploy/` 子目录，新开发者可能找不到。
- **OpenTelemetry 为 stub**：`app/core/telemetry.py` 仅打印配置状态，无实际导出器。

## 中等

- **spec_profile 模块有 5 个 TODO**：`policy.py` 和 `provider.py` 中的冲突检测和发现逻辑未实现。
- **@xyflow/react 仅在拓扑页使用**：大型依赖（~300KB gzip）仅用于单个页面，可考虑动态导入。
- **`app-shell.tsx:82` 直接使用原生 fetch** 而非 `apiFetch`，绕过了统一的认证/错误处理。
- **Docker 路径映射配置复杂**：`host_path_prefix` + `container_path_prefix` 需要手动配置，容易出错。
- **Windows/Linux 路径兼容性**：worktree_base_dir 需要按平台区分，测试中可能有平台依赖。

## 低

- **prototype/ 目录有 12 个 HTML 原型**：与实际前端实现可能已不同步，维护成本。
- **spikes/ 目录残留**：3 个技术验证目录，可在项目稳定后归档。
- **ESLint 仅配置 next/core-web-vitals + no-unused-vars**：缺少 TypeScript 特定规则和 import 排序。
