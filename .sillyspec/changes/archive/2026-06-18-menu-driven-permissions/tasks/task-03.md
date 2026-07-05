---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-03：menu-permissions 数据完整性测试

> 变更：2026-06-18-menu-driven-permissions
> 类型：新增测试
> 责任：WhaleFall
> 状态：待执行
> 依赖：task-01（MENU_PERMISSION_GROUPS 已落地）

## 1. 背景

design.md §5.7 要求新增 `frontend/src/lib/__tests__/menu-permissions.test.ts`，对 `MENU_PERMISSION_GROUPS` 数据结构做完整性校验：

- `menuKey` 唯一（FR-02）
- `permissions[*].key` 全部命中后端 Permission 枚举（FR-03）
- 每个 menu 至少 1 个 permission
- 兜底菜单（component / topology / scan-docs / knowledge / incidents）必须包含 `workspace:read`
- 用户列明的 6 类菜单（users / organizations / roles / changes / agent / audit / releases）必须严格匹配需求清单

本测试是数据层的「护栏」——一旦 task-01 的数据被人误改，测试应立即失败。

## 2. 修改文件

- [ ] 新增 `frontend/src/lib/__tests__/menu-permissions.test.ts`（Vitest + React Testing Library runner，jest 兼容 API）

## 3. 后端 Permission 枚举 36 值清单

镜像常量 `BACKEND_PERMISSION_KEYS` 必须精确覆盖以下 36 项（来源：`backend/app/modules/auth/permissions.py`）：

```
// Platform (3)
platform:admin
platform:billing
platform:audit:read

// Workspace (4)
workspace:read
workspace:write
workspace:admin
workspace:member:manage

// Change (5)
change:create
change:read
change:update
change:approve
change:archive

// Task (6)
task:read
task:create
task:assign
task:run_agent
task:cancel
task:approve

// Code (4)
code:read
code:write
code:review
code:merge

// Deploy (3)
deploy:staging
deploy:production
deploy:rollback

// Tool (4)
tool:shell_exec
tool:network
tool:database
tool:secret:read

// Admin (7)
user:read
user:write
user:login:manage
organization:read
organization:write
role:read
role:write
```

合计 3 + 4 + 5 + 6 + 4 + 3 + 4 + 7 = **36 项**。镜像常量与本测试一起维护，注释提示「与 backend/app/modules/auth/permissions.py 保持同步」。

## 4. 实现要求（测试用例清单）

测试文件以 `describe("MENU_PERMISSION_GROUPS 数据完整性")` 为顶层，包含以下 `it` 用例（伪代码风格）：

### 用例 1：数组长度恒等于 19

```ts
it("MENU_PERMISSION_GROUPS 长度 === 19", () => {
  expect(MENU_PERMISSION_GROUPS).toHaveLength(19);
});
```

### 用例 2：所有 menuKey 互不重复

```ts
it("所有 menuKey 唯一", () => {
  const keys = MENU_PERMISSION_GROUPS.map(g => g.menuKey);
  expect(new Set(keys).size).toBe(keys.length);
  // 同时断言 19 个期望 menuKey 集合（FR-02 清单）严格匹配
  expect(new Set(keys)).toEqual(new Set([
    "workspaces","components","topology","changes","scan-docs","runtime",
    "knowledge","releases","git-identities","api-keys","agent","approvals",
    "audit","incidents","users","organizations","roles","runtimes","settings"
  ]));
});
```

### 用例 3：section 字段只能是 4 个合法值之一

```ts
it("section ∈ {overview, management, admin, system}", () => {
  const VALID = new Set(["overview","management","admin","system"]);
  MENU_PERMISSION_GROUPS.forEach(g => {
    expect(VALID.has(g.section)).toBe(true);
  });
});
```

### 用例 4：每个 menu 至少 1 个 permission

```ts
it("每个 menu 至少 1 个 permission", () => {
  MENU_PERMISSION_GROUPS.forEach(g => {
    expect(g.permissions.length).toBeGreaterThanOrEqual(1);
  });
});
```

### 用例 5：所有 permission.key 命中后端 36 枚举之一

```ts
it("所有 permission.key 命中 BACKEND_PERMISSION_KEYS", () => {
  const valid = new Set(BACKEND_PERMISSION_KEYS);
  MENU_PERMISSION_GROUPS.forEach(g => {
    g.permissions.forEach(p => {
      expect(valid.has(p.key)).toBe(true);
    });
  });
  // 额外断言：valid 集合自身长度 === 36（防止镜像常量被误删）
  expect(BACKEND_PERMISSION_KEYS.length).toBe(36);
});
```

### 用例 6：兜底菜单必须包含 `workspace:read`

```ts
it("兜底菜单 component/topology/scan-docs/knowledge/incidents 包含 workspace:read", () => {
  const FALLBACK = ["components","topology","scan-docs","knowledge","incidents"];
  FALLBACK.forEach(menuKey => {
    const g = MENU_PERMISSION_GROUPS.find(x => x.menuKey === menuKey);
    expect(g).toBeDefined();
    expect(g!.permissions.map(p => p.key)).toContain("workspace:read");
  });
});
```

### 用例 7：用户列明的 6 类菜单严格匹配需求清单

```ts
describe("用户列明菜单的 permissions 精确匹配", () => {
  function keysOf(menuKey: string): string[] {
    const g = MENU_PERMISSION_GROUPS.find(x => x.menuKey === menuKey);
    if (!g) throw new Error(`missing menu ${menuKey}`);
    return g.permissions.map(p => p.key).sort();
  }

  it("users", () => {
    expect(keysOf("users")).toEqual(["user:login:manage","user:read","user:write"].sort());
  });
  it("organizations", () => {
    expect(keysOf("organizations")).toEqual(["organization:read","organization:write"].sort());
  });
  it("roles", () => {
    expect(keysOf("roles")).toEqual(["role:read","role:write"].sort());
  });
  it("changes", () => {
    expect(keysOf("changes")).toEqual([
      "change:approve","change:archive","change:create","change:read","change:update"
    ].sort());
  });
  it("agent", () => {
    expect(keysOf("agent")).toEqual([
      "task:cancel","task:read","task:run_agent",
      "tool:database","tool:network","tool:secret:read","tool:shell_exec"
    ].sort());
  });
  it("audit", () => {
    expect(keysOf("audit")).toEqual(["platform:audit:read"]);
  });
  it("releases", () => {
    expect(keysOf("releases")).toEqual([
      "deploy:production","deploy:rollback","deploy:staging"
    ].sort());
  });
});
```

### 用例 8：每条记录 menuLabel / icon / href 非空字符串

```ts
it("menuLabel / icon / href 非空字符串", () => {
  MENU_PERMISSION_GROUPS.forEach(g => {
    expect(typeof g.menuLabel).toBe("string");
    expect(g.menuLabel.length).toBeGreaterThan(0);
    expect(typeof g.icon).toBe("string");
    expect(g.icon.length).toBeGreaterThan(0);
    expect(typeof g.href).toBe("string");
    expect(g.href.length).toBeGreaterThan(0);
  });
});
```

### 用例 9（可选）：permission.name 中文字段非空

```ts
it("permission.name 非空字符串", () => {
  MENU_PERMISSION_GROUPS.forEach(g => {
    g.permissions.forEach(p => {
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
    });
  });
});
```

## 5. 接口定义

本测试无对外接口。import 来源：

```ts
import { describe, it, expect } from "vitest";
import { MENU_PERMISSION_GROUPS } from "../menu-permissions"; // task-01 产出
```

`BACKEND_PERMISSION_KEYS` 作为本测试文件内私有镜像常量（注释指明与后端 `permissions.py` 同步），后续若后端扩枚举，更新此常量后用例 5 仍能通过；若删枚举，用例 5 失败提示前端需要同步清理。

## 6. 边界处理（≥5 条）

1. **兜底菜单缺 `workspace:read`**：用例 6 强校验，FALLBACK 数组逐项断言 `toContain`。
2. **用户列明菜单 permissions 多/少一项**：用例 7 用 `toEqual(sorted array)` 严格匹配，多一个或少一个都失败。
3. **permission.key 拼写错误**（如 `user:Login:manage`、`workspace：read` 中文冒号）：用例 5 `valid.has(p.key)` 立即返回 false。
4. **icon 字段为空字符串 `""`**：用例 8 `length > 0` 失败。
5. **section 越界**（如 `"super-admin"`）：用例 3 `VALID.has(g.section)` 失败。
6. **menuKey 重复**：用例 2 `Set.size === keys.length` 失败，同时第二断言 `toEqual(new Set([...]))` 校验清单完整性。
7. **数组被增删**：用例 1 `toHaveLength(19)` 失败；用例 2 第二断言同步失败定位到具体缺哪个 key。

## 7. 非目标

- ❌ 不测 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection` —— task-04 负责。
- ❌ 不测 `AdminRolePermissionPicker` 渲染 —— task-07 负责。
- ❌ 不 mock 后端 API、不 mock fetch。
- ❌ 不测 React 组件、不渲染 DOM。
- ❌ 不修改 `menu-permissions.ts` 本身（仅读校验，task-01 落地数据）。

## 8. TDD 步骤

1. **创建测试文件**：按本蓝图写出全部 9 个用例（含镜像常量 36 项）。
2. **跑 `pnpm test menu-permissions`**：因 task-01 已完成且数据正确，应全部通过（exit code 0）。
3. **负向演练**：临时删除 `MENU_PERMISSION_GROUPS` 中某条 menuKey（例如 `runtimes`），跑测试，确认用例 1（长度）、用例 2（Set 完整性）失败。
4. **恢复数据**：撤销临时改动，再跑一次 `pnpm test menu-permissions`，确认全部通过。
5. **覆盖率**：跑 `pnpm test menu-permissions -- --coverage`，确认 `menu-permissions.ts` 行覆盖率达 90%+（纯数据常量 + 类型，几乎必达 100%）。

## 9. 验收标准

| 验收项 | 通过标准 |
|---|---|
| 测试文件存在 | `frontend/src/lib/__tests__/menu-permissions.test.ts` |
| 用例数 ≥ 8 | 至少覆盖本蓝图 §4 列出的 8 个核心场景（用例 9 可选） |
| 全部通过 | `pnpm test menu-permissions` exit code 0 |
| 覆盖率 ≥ 90% | `menu-permissions.ts` 行覆盖率达 90%+ |
| 无 any | 测试文件严格类型，禁止 `as any` / `: any` |
| 镜像常量 36 项 | `BACKEND_PERMISSION_KEYS.length === 36`，逐项注释分类 |
| 负向演练通过 | 删除 menuKey 后测试能失败、恢复后能通过 |

## 10. 依赖与风险

- **依赖 task-01**：若 task-01 未完成或数据写错，用例 2 / 用例 7 会先失败，需回看 task-01 是否对齐 design §5.2。
- **R-01**（来自 design §10）：后端无 `component:*` / `incident:*`，本测试已用兜底 `workspace:read` 覆盖；如未来后端扩枚举，需同时更新本测试镜像常量。
- **R-04**：本测试为纯数据校验，CI 上不依赖网络与后端，几乎不可能破坏 CI；唯一例外是镜像常量与后端漂移，PR review 时需交叉检查 `permissions.py`。

## 11. 自审

| 检查项 | 结论 |
|---|---|
| 覆盖 design §5.7 测试要求 | ✅ menuKey 唯一性 / permission.key 命中枚举 / 每 menu ≥ 1 permission 全覆盖 |
| 覆盖需求 FR-02 / FR-03 | ✅ 用例 2 + 用例 5 严格对应 |
| 兜底菜单护栏 | ✅ 用例 6 |
| 用户列明菜单精确匹配 | ✅ 用例 7 覆盖 7 个菜单（users/orgs/roles/changes/agent/audit/releases） |
| 边界 ≥ 5 条 | ✅ §6 列 7 条 |
| TDD 流程闭环 | ✅ §8 含负向演练 |
| 非目标清晰 | ✅ §7 列 5 项不做 |
| 类型严格无 any | ✅ 全程 `Set<string>` / `string[]` |
