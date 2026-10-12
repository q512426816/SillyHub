---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-workspace-dead-link-fix

## 功能需求

### FR-01: approvals 与 audit 两页返回链接改指 /workspaces/${workspaceId}（工作区详情首页），文案与指向一致

- 两页页头返回链接的 `href` 必须为 `/workspaces/${workspaceId}`，且链接文案必须与指向一致（「← 工作区」）；禁止再指向已下线的 `workspaces/[id]/components` 路由（点击 404）。

#### 场景：审批中心页返回链接

- Given 审批中心页以 workspaceId=ws-1 渲染
- When 点击页头「← 工作区」链接
- Then href 为 `/workspaces/ws-1`

#### 场景：审计日志页返回链接

- Given 审计日志页以 workspaceId=ws-1 渲染
- When 点击页头「← 工作区」链接（原「← 组件列表」）
- Then href 为 `/workspaces/ws-1`

### FR-02: 全仓不再存在指向 workspaces/[id]/components 的用户可见链接（grep 复核）

- frontend `src/` 内必须不存在指向 `workspaces/${workspaceId}/components` 的用户可见 `<Link>`/路由跳转（生成类型与注释除外）；复核以 grep 证据留痕。

#### 场景：残留清零

- When 对 src/ 执行链接指向 grep
- Then 零命中（不含测试 mock 与生成文件）

### FR-03: 两页既有测试全绿；如两页无既有链接断言则补最小断言钉住返回链接指向

- 两页均无既有页面级测试，必须各补一个最小渲染测试：断言返回链接文案与 href；渲染所需数据面取空列表、重子组件桩化（本测对象仅为链接）。

#### 场景：链接断言钉住

- When 运行两页新增测试
- Then 断言「← 工作区」链接 href=/workspaces/ws-1 且两文件全绿

### FR-04: 仅跑本改动相关测试（规则 0）

- 本变更只必须运行两页新增测试文件与 eslint（改动 4 文件），禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行相关测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/workspaces/[id]/approvals/__tests__/page.test.tsx「页头「← 工作区」链接指向工作区详情首页（components 页下线后不得 404）」
FR-01: frontend/src/app/(dashboard)/workspaces/[id]/audit/__tests__/page.test.tsx「页头「← 工作区」链接指向工作区详情首页（原「← 组件列表」指向已删路由）」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/approvals/__tests__/page.test.tsx「页头「← 工作区」链接指向工作区详情首页（components 页下线后不得 404）」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/approvals/__tests__/page.test.tsx「页头「← 工作区」链接指向工作区详情首页（components 页下线后不得 404）」
FR-04: frontend/src/app/(dashboard)/workspaces/[id]/audit/__tests__/page.test.tsx「页头「← 工作区」链接指向工作区详情首页（原「← 组件列表」指向已删路由）」
