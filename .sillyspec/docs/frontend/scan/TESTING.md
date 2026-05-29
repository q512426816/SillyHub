---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# TESTING — frontend

## 测试结构

- **框架**：Vitest 2+ + @testing-library/react + jsdom
- **测试文件**：1 个
- **测试代码**：67 行
- **覆盖率**：无覆盖率门槛配置

### 唯一测试文件

`src/lib/__tests__/api.test.ts` — `apiFetch` 工具函数测试（4 个用例）

### Vitest 配置

| 配置 | 值 |
|------|------|
| 环境 | jsdom |
| 全局 API | true |
| Setup | `./src/test/setup.ts`（注入 jest-dom 匹配器） |
| CSS | false（跳过） |
| 路径别名 | `@` → `./src` |

## 当前覆盖缺口

| 模块 | 覆盖状态 |
|------|----------|
| `apiFetch` | ✅ 4 个用例 |
| 页面组件（22 个） | ❌ 无测试 |
| 业务组件（5 个） | ❌ 无测试 |
| API 模块（21 个） | ❌ 无测试 |
| Zustand store | ❌ 无测试 |
| 工具函数 | ❌ 无测试 |

## 验证命令

```bash
make frontend-test          # pnpm test (vitest run)
make frontend-lint          # pnpm lint
make frontend-typecheck     # pnpm typecheck
```
