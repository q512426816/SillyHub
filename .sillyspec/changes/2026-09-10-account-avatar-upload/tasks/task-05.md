---
id: task-05
title: 'SessionUser.avatar + updateMyAvatar() + gen:types'
title_zh: 'SessionUser.avatar 字段 + updateMyAvatar() 封装 + gen:types 类型同步'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01, FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/stores/session.ts
  - frontend/src/lib/auth.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/stores/session.ts
  - frontend/src/lib/auth.ts
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides:
  - contract: SessionUser.avatar 可选字段 + updateMyAvatar(avatar) 头像写入口（PATCH 后重跑 fetchMe 写回 store）
    fields: [SessionUser.avatar, updateMyAvatar(avatar), api-types 的 UserRead.avatar 与 PATCH /api/auth/me/avatar 类型]
expects_from:
  task-02:
    - contract: UserRead
      needs: [UserRead.avatar]
  task-03:
    - contract: "PATCH /api/auth/me/avatar"
      needs: ["PATCH /api/auth/me/avatar", "UserRead 响应"]
goal: >
  前端会话基座接入用户头像（FR-01 前端侧 + FR-06 类型同步，D-001@v1）：跑
  pnpm gen:types 把后端 task-02/03 的 UserRead.avatar 与 PATCH /api/auth/me/avatar
  同步进 api-types.ts 与 openapi.json；SessionUser 增加可选 avatar 字段；lib/auth
  新增 updateMyAvatar()——PATCH 成功后重跑 fetchMe() 写回 store，为 task-07/08
  页面与 task-09/10 展示接线提供头像数据与统一写入口。
implementation:
  - 确认前端 node_modules 健康（pnpm exec tsc --version 可跑，CLAUDE.md 规则 21）后跑 pnpm gen:types——刷新 backend/openapi.json 并重新生成 frontend/src/lib/api-types.ts，产物含 UserRead.avatar 与 PATCH /api/auth/me/avatar 路径类型，禁止手写
  - frontend/src/stores/session.ts——SessionUser 增加可选字段 avatar（string | null 可选）；旧 localStorage 持久化 user 缺该字段按 undefined 兼容（storage 回放只回放存在的字段不误清），persist 与 storage 监听机制零改动
  - frontend/src/lib/auth.ts——新增 updateMyAvatar(avatar)，apiFetch 以 PATCH 方法调 /api/auth/me/avatar、请求体传 avatar（null 表清除），封装风格对齐 changePassword
  - PATCH 成功后禁止直接 setUser（响应为 snake_case 的 UserRead）——重跑 fetchMe() 复用既有 snake 到 camel 的降级合并写回 store（design 接口定义注记取此方案）；fetchMe 的 setUser 映射补 avatar 字段（否则重跑后头像不落 store）；多标签页同步走既有 storage 事件机制零新增
acceptance:
  - pnpm gen:types 后 api-types.ts 含 UserRead.avatar 字段与 PATCH /api/auth/me/avatar 路径类型，backend/openapi.json 同批刷新（类型不落后后端）
  - updateMyAvatar(url) 依次发出 PATCH /api/auth/me/avatar（请求体 avatar 为新 URL）与 GET /api/auth/me，store 的 user.avatar 更新为新值；updateMyAvatar(null) 发出 avatar 为 null 的清除请求
  - SessionUser.avatar 未设置时为 undefined 或 null；旧 localStorage user（缺 avatar 字段）hydrate 与 storage 回放不报错不误清
  - cd frontend && pnpm exec tsc --noEmit 通过；登录、登出、changePassword 既有行为零变化
verify:
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 禁止手写 api-types.ts（CLAUDE.md 规则 21，必须 pnpm gen:types 生成）；api-types.ts 与 backend/openapi.json 同批提交
  - PATCH 响应为 snake_case 的 UserRead，禁止直接 setUser——必须重跑 fetchMe() 取规范 user 写回（design 接口定义注记，防映射逻辑双份漂移）
  - 零 UI 接线——不动任何页面与组件（两 account 页归 task-07/08，TopBar 与会话气泡归 task-09/10）；不改 fetchMe 既有映射语义与登录登出流程
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
