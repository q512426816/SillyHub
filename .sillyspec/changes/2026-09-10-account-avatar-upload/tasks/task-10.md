---
id: task-10
title: 'chat-bubble-sender-me-avatar-wiring'
title_zh: '会话气泡 sender.me 头像接线（1:1 时间线自己气泡）'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P2
depends_on: ['task-05']
blocks: ['task-11']
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
expects_from:
  task-05:
    - contract: SessionUser.avatar 可选字段 + updateMyAvatar(avatar) 头像写入口（PATCH 后重跑 fetchMe 写回 store）
      needs: [SessionUser.avatar]
goal: >
  1:1 会话时间线用户气泡接入平台头像（FR-05 展示点之一）：turn-timeline.tsx 用户气泡在
  sender.me 时把 useSession 的 user.avatar 传给 ChatMessageAvatar 既有 avatar prop
  （内部已走 useAvatarSrc），非 me 发送者维持首字回退现状。
implementation:
  - turn-timeline.tsx 顶部 import useSession（@/stores/session，当前未引入），组件内以选择器订阅取 const myAvatar = useSession((s) => s.user?.avatar ?? null)——仅订阅 avatar 切片，避免整 store 订阅引发无关重渲
  - 用户气泡调用点（:437-448）ChatMessageAvatar 补 avatar prop——sender.me 为真时传 myAvatar，否则不传（undefined）；kind/name/size/title 既有参数零改动，渲染分支（图片/首字回退）由 ChatMessageAvatar 与 useAvatarSrc 既有管线承担，本卡不改 chat-message-avatar.tsx
  - 不新增自动化用例（plan 口径：接线极薄一行 prop）；blob 拉取与回退行为由既有管线及 task-09 测试兜底，双主题目检留 task-11 verify 阶段
acceptance:
  - sender.me 为真且 user.avatar 有值——自己的用户气泡渲染头像图片（文件中心 URL 经 blob objectURL、外链直用）
  - user.avatar 为 null/undefined，或 sender.me 为假/缺省（非 me 发送者）——气泡维持现状首字回退，渲染零差异
  - agent 气泡与时间线其余渲染零改动，既有 turn-timeline 测试零回归；tsc --noEmit 零错
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run turn-timeline
constraints:
  - 只改 turn-timeline.tsx 单文件单调用点；不改 ChatMessageAvatar（avatar prop 已支持）与 use-avatar-src.ts，不新建测试文件（verify 阶段目检兜底）
  - useSession 用选择器订阅（s.user?.avatar ?? null），不做整 store 订阅
  - 非 me 用户气泡不接头像（他人首字回退等既有语义不动）
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
