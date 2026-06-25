---
id: task-06
title: 前端 lib/admin.ts — UserListParams +organization_id/include_children、OrganizationRead +subtree_member_count、listUsers 透传
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
estimated_hours: 0.5
depends_on: []
blocks:
  - task-07
  - task-09
requirement_ids:
  - FR-01
  - FR-02
decision_ids: []
allowed_paths:
  - frontend/src/lib/admin.ts
---

## 1. 目标

为 `/admin/users` 组织树筛选功能在前端 API 客户端层补齐类型与请求透传，使 task-07（组织树组件）、task-09（users page）能调用 `listUsers({ organization_id, include_children })` 并读取 `OrganizationRead.subtree_member_count`：

- `UserListParams` 增 `organization_id?: string` 与 `include_children?: boolean`。
- `OrganizationRead` 增 `subtree_member_count: number`。
- `listUsers` 把新增参数透传到 `/api/admin/users` query（无新端点，沿用现有 `apiFetch` 通道）。

本 task **只改 `lib/admin.ts` 的类型声明与一处 query 透传类型断言**，不动 service / 任何组件 / 任何调用方（调用方改造在 task-09）。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 4 | `UserListParams` 增 `organization_id?: string`、`include_children?: boolean`；`OrganizationRead` 增 `subtree_member_count: number`；`listUsers` 透传 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §7.1 / §7.5 | `/api/admin/users` query 增 `organization_id?`、`include_children?`；前端类型同步 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §9 兼容策略 | `organization_id` 默认 None 行为不变；`subtree_member_count` 旧前端忽略不报错 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 1 task-06 | 覆盖 FR-01, FR-02；dep — |
| 现状代码 | `frontend/src/lib/admin.ts:66-74` | `UserListParams` 现仅 q/status/role/sort/order/limit/offset |
| 现状代码 | `frontend/src/lib/admin.ts:219-231` | `OrganizationRead` 现有 member_count/children_count，无 subtree_member_count |
| 现状代码 | `frontend/src/lib/admin.ts:116-122` | `listUsers` 现用 `query: params as Record<string, string \| number \| undefined>`，**不含 boolean**，需扩类型断言否则 `include_children` boolean 被丢类型 |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| `frontend/src/lib/admin.ts` | `UserListParams` +两字段；`OrganizationRead` +`subtree_member_count`；`listUsers` query 断言类型扩 `boolean` | ✅ |

## 4. 实现要求

1. 仅改 TypeScript 接口字段声明与一处 `query` 的 `as` 类型断言，不改任何运行时逻辑、不加新函数、不动其他接口。
2. `UserListParams` 新增字段一律 Optional（前端不传 = 后端默认 None / True，行为不变）。
3. `listUsers` 当前 `query: params as Record<string, string | number | undefined>` 会把 `include_children` 的 boolean 类型丢掉（断言为联合类型后 boolean 不在联合内，TS 报错或被强转）。必须把断言联合类型扩为 `string | number | boolean | undefined`，使 `include_children: boolean` 能透传。
4. `apiFetch` 的 `ApiRequestOptions.query` 已支持 `boolean`（`frontend/src/lib/api.ts:92`），序列化层会把 `true`/`false` 转为 `"true"`/`"false"` 字符串，FastAPI `Query(bool)` 正确解析。本 task 不动 api.ts。
5. `OrganizationRead` 加 `subtree_member_count` 后，`OrganizationDetail extends OrganizationRead`（:233）自动继承，无需额外改动。
6. 不给 `subtree_member_count` 加 `?` 可选标记——后端 `_to_read` 注入后必定返回该字段（task-02 保证），前端按必填声明更准确；旧后端在 task-02 落地前若未返回该字段，使用方需 fallback（task-07 已做 fallback 到 `member_count`），不在本 task 处理。

## 5. 接口定义（精确到 TS 字段）

### 5.1 `UserListParams`（增两字段）

```ts
export interface UserListParams {
  q?: string;
  status?: string;
  role?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
  organization_id?: string;   // ← 新增：组织筛选，不传 = 全部
  include_children?: boolean;  // ← 新增：是否含下级组织，前端固定传 true（D-001@v1）
}
```

字段语义：
- `organization_id`：组织 UUID 字符串。`undefined`/不传 → 后端默认 None → 返回全部用户（行为不变）。
- `include_children`：`true` = 含所有下级组织成员（exists 子查询 IN `{org} ∪ descendants`）；`false` = 仅当前组织。前端调用方固定传 `true`（design D-001@v1），参数保留灵活性。

### 5.2 `OrganizationRead`（增一字段）

```ts
export interface OrganizationRead {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parent_id: string | null;
  status: OrganizationStatus;
  sort_order: number;
  member_count: number;
  children_count: number;
  subtree_member_count: number;  // ← 新增：当前+所有下级 distinct 成员数（D-003@v1）
  created_at: string;
  updated_at: string;
}
```

字段语义：
- `subtree_member_count`：当前组织 + 所有下级组织（含 disabled 下级，D-002@v1）的 distinct 用户数。后端 task-02 由 `_subtree_member_count` 注入。

### 5.3 `listUsers`（query 断言类型扩展）

```ts
export async function listUsers(
  params?: UserListParams,
): Promise<UserListResponse> {
  return apiFetch<UserListResponse>("/api/admin/users", {
    query: params as Record<string, string | number | boolean | undefined>,  // ← 联合类型 +boolean
  });
}
```

签名（params/返回值）不变，仅 `as` 断言联合类型补 `boolean`。

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | `listUsers()` 不传任何参数 | 行为完全不变（无 organization_id，后端返回全部） | lib（本 task）；后端（task-03/04） |
| B-02 | `listUsers({ organization_id: "uuid", include_children: true })` | query 透传 `organization_id=uuid&include_children=true` | lib（本 task） |
| B-03 | `listUsers({ include_children: true })` 不传 organization_id | `include_children` 透传但后端短路无效（organization_id 为空） | lib（本 task）；后端（task-03） |
| B-04 | 后端响应 `OrganizationRead` 多了 `subtree_member_count` 字段 | TS 类型已声明必填，使用方读取不报错；旧前端忽略该字段也无副作用 | lib（本 task）；使用方 fallback（task-07） |
| B-05 | `include_children: false` | query 透传 `include_children=false`，后端只查当前组织 | lib（本 task）；后端（task-03） |
| B-06 | `organization_id: ""`（空串） | apiFetch 序列化层跳过空串（`frontend/src/lib/api.ts:104`），等同不传 | lib（本 task，不变） |

## 7. 非目标

- 不改 `listUsers` 的 URL / 方法 / 返回类型（仍是 GET `/api/admin/users` → `UserListResponse`）。
- 不新增 `listUsersByOrg` 之类的封装函数（YAGNI，参数即可）。
- 不改 `UserRead` / `OrganizationBrief` / `OrganizationDetail` 等其他接口（`OrganizationDetail` 自动继承新字段）。
- 不动 apiFetch（`api.ts` 已支持 boolean query）。
- 不改任何调用方（admin/users page 改造在 task-09；admin-org-tree 组件在 task-07）。
- 不做 `subtree_member_count` 的前端缓存或聚合（design §3 非目标）。

## 8. 参考

- `frontend/src/lib/admin.ts:66-74`（现状：`UserListParams`）
- `frontend/src/lib/admin.ts:116-122`（现状：`listUsers` 断言类型缺 boolean）
- `frontend/src/lib/admin.ts:219-231`（现状：`OrganizationRead`）
- `frontend/src/lib/api.ts:92`（`ApiRequestOptions.query` 已支持 boolean）
- `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` §5 Phase 4 / §7.1 / §7.5 / §9

## 9. TDD 步骤

> 本 task 仅改类型声明与一处断言，无独立运行时逻辑；TDD 聚焦「类型编译通过 + query 透传完整性」。

1. **先写类型断言测试**（`frontend/src/lib/__tests__/admin.test.ts` 新增或复用既有测试文件追加）：
   - `test_listUsers_passes_organization_id_and_include_children`：spy/mock `apiFetch`，调用 `listUsers({ organization_id: "org-1", include_children: true })`，断言传入 `apiFetch` 的 `options.query` 含 `organization_id: "org-1"` 与 `include_children: true`。
   - `test_listUsers_omits_undefined_params`：调用 `listUsers()`，断言 `options.query` 不含 `organization_id` / `include_children`（或为 undefined）。
   - `test_OrganizationRead_has_subtree_member_count`：构造一个 `OrganizationRead` 字面量对象，TS 编译期要求提供 `subtree_member_count`（缺字段编译失败）——以类型层测试体现。
2. **跑测试**确认类型层红（字段未加时编译失败）。
3. **改 admin.ts**（按 §5 加 2 字段 + 扩断言类型）。
4. **跑测试**确认全绿。
5. `tsc --noEmit` + `eslint` 通过。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `listUsers({ organization_id: "org-1", include_children: true })` | 传入 `apiFetch` 的 query 含 `organization_id="org-1"`、`include_children=true` |
| AC-02 | `listUsers()` 不传参 | query 不含 `organization_id` / `include_children`（行为不变） |
| AC-03 | TS 编译 `const o: OrganizationRead = { ...缺 subtree_member_count }` | 编译失败（必填字段缺失）|
| AC-04 | `const p: UserListParams = { organization_id: "x", include_children: false }` | 编译通过（两新字段合法） |
| AC-05 | `tsc --noEmit` 全项目 | 无类型错误 |
| AC-06 | `eslint frontend/src/lib/admin.ts` | 无告警 |
| AC-07 | `git diff --stat` 仅含 `frontend/src/lib/admin.ts` | true |

## 11. 完成定义

- [ ] §5.1 `UserListParams` 两新字段落地
- [ ] §5.2 `OrganizationRead` 新增 `subtree_member_count`
- [ ] §5.3 `listUsers` query 断言类型扩 `boolean`
- [ ] §9 TDD 测试用例全绿
- [ ] §10 AC-01~AC-07 全部通过
- [ ] `git diff` 仅含 `frontend/src/lib/admin.ts`
