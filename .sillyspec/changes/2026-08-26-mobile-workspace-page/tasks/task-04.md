---
id: task-04
title: 'mobile-workspace-header'
title_zh: 'MobileWorkspaceHeader 组件（返回+工作区名+段控双 Tab，真实路由切换）（FR-02）'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P0
depends_on: []
blocks: ['task-06', 'task-12']
requirement_ids: [FR-02]
decision_ids: [D-001@V1, D-004@V1]
allowed_paths:
  - frontend/src/components/mobile/mobile-workspace-header.tsx
  - frontend/src/components/mobile/mobile-workspace-header.test.tsx
provides:
  - contract: MobileWorkspaceHeader
    fields: [workspace, tab, onTabChange, onBack]
goal: >
  新建移动工作区头部组件（返回+工作区名+段控双 Tab），双 Tab 切换由宿主页走真实
  路由跳转，为变更/会话两个列表页提供统一导航壳（D-004 主页+双 Tab）。
implementation:
  - 对齐既有外壳风格：通读 mobile-top-bar.tsx / mobile-app-shell.tsx（sticky 顶栏、border-b bg-card、min-h-[44px] 返回热区、text-base 标题 truncate、语义 token），风格一致但不改这两个文件
  - '新建 frontend/src/components/mobile/mobile-workspace-header.tsx，props 按 design §7：workspace: Workspace、tab: "changes"|"sessions"、onTabChange(t)、onBack()'
  - 布局：返回按钮（≥44px 热区）+ 工作区名（truncate，可带在线状态点，字段存在时）+ 段控双 Tab（变更中心/会话，role=tablist/tab + aria-selected，高亮=props.tab）
  - 点击非当前 tab 调 onTabChange 恰一次（宿主页据此 router.push 到 /m/workspaces/[id]/changes|sessions——真实路由非 query 参数，D-004）；onBack 仅回调（宿主 → /m/workspaces）
  - 新增 colocate 测试 mobile-workspace-header.test.tsx：工作区名渲染、tab 高亮断言、onTabChange/onBack 回调、返回按钮 ≥44px 热区类
acceptance:
  - 组件导出 MobileWorkspaceHeader，props 签名与 design §7 完全一致（workspace/tab/onTabChange/onBack）
  - 双 Tab 为 role=tablist/tab + aria-selected；点击非当前 tab 触发 onTabChange 恰一次，当前 tab 不重复触发
  - 返回按钮触摸热区 ≥44px；样式全部语义 token（无写死色值）；正文 ≥14px
  - 组件不内嵌路由跳转与数据请求（只回调），纯新增文件对桌面与既有 /m 页零影响
verify:
  - cd frontend && pnpm test -- src/components/mobile/mobile-workspace-header.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯新增组件；禁止修改 mobile-top-bar.tsx / mobile-app-shell.tsx / 任何既有文件
  - 不自带路由跳转与数据请求（workspace 数据由宿主页从 task-02 的 layout Provider 取后传入；路由 push 归宿主页接线）
  - 遵循 FRONTEND_PAGE_STYLE.md §0.5 双主题：品牌色只用 brand-* 语义阶，阴影走主题 token
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
