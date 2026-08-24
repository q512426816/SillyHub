---
author: qinyi
created_at: 2026-08-25 03:20:00
change: 2026-08-25-unified-floating-session
---

# 模块影响分析（Module Impact）— 统一智能悬浮会话 v1

> plan 阶段首版；execute/verify 阶段更新。

## 受影响模块

| 模块 | 影响 | 具体文件 | 风险 |
|---|---|---|---|
| backend: daemon/schema | SessionCreateRequest += page_context 可选块 | schema.py | 低——可选字段缺省零回归 |
| backend: daemon/session/context | 新增 build_page_context_preamble | session/context.py | 低——纯新增函数，既有 build_change_context_preamble 不动 |
| backend: daemon/session/service | create 路径前导链插入页面前导 | session/service.py | 低——_prefix_parts 追加一项，拼接语义不变 |
| backend: daemon/router | create 端点透传 1 参 | router.py | 低 |
| backend: ppm/project | 被前导构建器只读回查（不改代码） | project/model.py | 无 |
| frontend: stores（新） | 壳层 zustand store | floating-session.ts（新） | 低——纯新增，无会话内部状态 |
| frontend: components/floating（新） | 悬浮宿主（球/抽屉/胶囊/互斥） | floating-session-host.tsx（新） | 中——消费 SessionPanel page 模式，需互斥与挂载门控测试覆盖 |
| frontend: daemon/session-panel | 最小增量 2 处 pageContext 透传 | session-panel.tsx | 中——巨石文件并行编辑区，增量可选字段、缺省零回归 |
| frontend: lib/daemon | createSession body += page_context | daemon.ts | 低 |
| frontend: app/(dashboard)/layout | 挂载 FloatingSessionHost | layout.tsx | 低——AppShell 内追加一处渲染；layout.test 需适配 |
| frontend: ppm/projects | 发起团队按钮改唤起 | ppm/projects/page.tsx | 低——单按钮行为替换 |
| frontend: hooks（新） | URL 派生页面上下文 | use-page-session-context.ts（新） | 低 |

## 接口影响

- POST /api/daemon/sessions 请求体新增可选 page_context（PageContextCreateBlock：
  page_key 枚举 + project_id）——OpenAPI schema 变更，需 gen:types 同步（规则 21）。
- 无新端点、无 daemon 协议变更、无生命周期事件变更。
