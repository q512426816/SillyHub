---
id: task-09
title: 'top-bar-avatar-prop-wiring'
title_zh: 'TopBar avatar prop 接线（顶栏用户区头像展示）'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P1
depends_on: ['task-05']
blocks: ['task-11']
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/top-bar.tsx
  - frontend/src/components/app-shell.tsx
  - frontend/src/components/__tests__/top-bar-avatar.test.tsx
target_files:
  - frontend/src/components/top-bar.tsx
  - frontend/src/components/app-shell.tsx
  - NEW:frontend/src/components/__tests__/top-bar-avatar.test.tsx
expects_from:
  task-05:
    - contract: SessionUser.avatar 可选字段 + updateMyAvatar(avatar) 头像写入口（PATCH 后重跑 fetchMe 写回 store）
      needs: [SessionUser.avatar]
goal: >
  桌面顶栏用户区接入平台头像（FR-05 展示点之一）：TopBar 增加可选 avatar prop，
  app-shell 从 useSession user 取 avatar 传入；有图时 shadcn Avatar 内嵌头像图
  （useAvatarSrc：文件中心 URL 带 token 取 blob、外链直用），无图维持现状首字回退零回归。
implementation:
  - top-bar.tsx——TopBarProps 增加可选 avatar prop（类型 string | null，缺省不传则行为与现状一致）；import useAvatarSrc（@/components/chat/use-avatar-src）与 AvatarImage（@/components/ui/avatar）；组件内 const avatarSrc = useAvatarSrc(avatar)，Avatar 内渲染 <AvatarImage src={avatarSrc ?? undefined} alt={displayName} />，既有 AvatarFallback 首字分支不动（src 为 null 时 Radix 自动走 Fallback）
  - app-shell.tsx:473——TopBar 调用补 avatar={user?.avatar ?? null}（user 已在 :142 自 useSession() 解构，displayName useMemo 与其余布局零改动）
  - 新建 __tests__/top-bar-avatar.test.tsx（照 top-bar.test.tsx 惯例 mock next/navigation 与 workspace-switcher/notification-bell 子组件；mock @/lib/file/api 的 fetchFileBlob 返回 Blob）——三态用例：文件中心 URL 渲染 img（alt=displayName 断言）、http(s) 外链直接作 src 且 fetchFileBlob 未调、avatar 缺省/null 仅 AvatarFallback 首字
acceptance:
  - avatar 为文件中心 URL 时顶栏渲染头像图（blob objectURL）；外链头像直用原值作 img src；null/undefined 或拉取失败时仅渲染现状 AvatarFallback 首字（brownfield 零回归）
  - 既有 top-bar.test.tsx（不传 avatar）断言零改动仍绿；tsc --noEmit 零错
verify:
  - cd frontend && pnpm vitest run src/components/__tests__/top-bar-avatar.test.tsx src/components/__tests__/top-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - avatar prop 可选，既有调用方不传零改动零行为变化；不改 AvatarFallback 既有类名与首字逻辑
  - 不改 use-avatar-src.ts / ui/avatar.tsx / chat-message-avatar.tsx / app-shell 其余布局（复用既有管线）
  - 不改既有 top-bar.test.tsx（新增用例独立成 top-bar-avatar.test.tsx）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
