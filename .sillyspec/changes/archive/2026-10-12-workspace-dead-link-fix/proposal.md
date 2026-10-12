---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 提案书（Proposal）— 2026-10-12-workspace-dead-link-fix

## 动机

任务原话转写：动机：24h 风险审查 P2——8a928588f 下线「项目组组件」页删除了 workspaces/[id]/components 路由，但审批中心与审计日志两页的返回链接仍指向已删路由，点击即 Next.js 404（audit 页文案还是「← 组件列表」指向不存在页）。
成功标准：
- approvals 与 audit 两页返回链接改指 /workspaces/${workspaceId}（工作区详情首页），文案与指向一致
- 全仓不再存在指向 workspaces/[id]/components 的用户可见链接（grep 复核）
- 两页既有测试全绿；如两页无既有链接断言则补最小断言钉住返回链接指向
- 仅跑本改动相关测试（规则 0）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. approvals 与 audit 两页返回链接改指 /workspaces/${workspaceId}（工作区详情首页），文案与指向一致
2. 全仓不再存在指向 workspaces/[id]/components 的用户可见链接（grep 复核）
3. 两页既有测试全绿；如两页无既有链接断言则补最小断言钉住返回链接指向
4. 仅跑本改动相关测试（规则 0）

## 成功标准（可验证）

1. approvals 与 audit 两页返回链接改指 /workspaces/${workspaceId}（工作区详情首页），文案与指向一致
2. 全仓不再存在指向 workspaces/[id]/components 的用户可见链接（grep 复核）
3. 两页既有测试全绿；如两页无既有链接断言则补最小断言钉住返回链接指向
4. 仅跑本改动相关测试（规则 0）
