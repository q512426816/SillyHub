---
id: task-07
title: 'Desktop /account profile card'
title_zh: '桌面 /account 个人资料卡片'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: ['task-05', 'task-06']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/account/page.tsx
  - frontend/src/app/(dashboard)/account/page.test.tsx
target_files:
  - frontend/src/app/(dashboard)/account/page.tsx
  - frontend/src/app/(dashboard)/account/page.test.tsx
expects_from:
  task-05:
    - contract: SessionUser.avatar 可选字段 + updateMyAvatar(avatar) 头像写入口（PATCH 后重跑 fetchMe 写回 store）
      needs: [SessionUser.avatar, updateMyAvatar(avatar)]
  task-06:
    - contract: GroupMemberAvatarUpload 可选 ownerType prop + USER_AVATAR_OWNER_TYPE 常量
      needs: [ownerType prop（默认 GROUP_MEMBER_AVATAR_OWNER_TYPE）, USER_AVATAR_OWNER_TYPE 常量]
goal: >
  桌面 /account 在修改密码卡片上方新增「个人资料」卡片（FR-03，D-001@v1）：
  复用 GroupMemberAvatarUpload 整态（ownerType 传 user_avatar）做头像预览、
  更换与恢复默认，onChange 经 updateMyAvatar 写后端并经 session store 刷新；
  未设头像时维持首字回退现状，桌面用户可自助更换头像。
implementation:
  - page.tsx 修改密码卡片上方新增「个人资料」卡片——沿用页面既有容器类（max-w-lg rounded-md border bg-card）与「修改密码」小节标题风格，双主题下零新增视觉体系
  - 卡片内嵌 GroupMemberAvatarUpload 整态（非 compact）——value 取 user?.avatar、name 取 displayName（首字回退）、label 为「我的头像」、ownerType 传 USER_AVATAR_OWNER_TYPE
  - onChange——上传成功（新头像 URL）调 updateMyAvatar(url)、恢复默认（null）调 updateMyAvatar(null)；失败提示沿用页内错误文案风格；页面不自管 avatar 副本，真相源为 session store（updateMyAvatar 内部重跑 fetchMe 已刷新）
  - page.test.tsx 补用例——扩既有 vi.mock("@/lib/auth") 增加 updateMyAvatar、mock @/lib/file/api 的 uploadFile 与 getFileDownloadUrl、useSession 注入 user：上传成功断言 updateMyAvatar 收到 getFileDownloadUrl(id)、恢复默认断言 updateMyAvatar(null)、上传或接口失败提示可见；既有修改密码用例不回归
acceptance:
  - 「个人资料」卡片渲染于修改密码卡片上方；未设头像预览为首字回退、设置后渲染头像图（useAvatarSrc 管线）
  - 上传走 owner_type 为 user_avatar；成功与恢复默认分别调 updateMyAvatar(新 URL) 与 updateMyAvatar(null)；失败路径有提示
  - cd frontend && pnpm test "src/app/(dashboard)/account/page.test.tsx" 全绿（新用例与既有修改密码用例）
verify:
  - cd frontend && pnpm test "src/app/(dashboard)/account/page.test.tsx"
constraints:
  - 多主题铁律（CLAUDE.md 规则 20）——品牌色只用 brand-* 语义阶、blue-* 仅真信息蓝、阴影走主题 token、antd 组件色经 ConfigProvider 不手写；本卡片新代码禁硬编码色
  - 不改修改密码卡片既有行为与用例；不动移动页、TopBar、会话气泡（task-08~10 范围）
  - 仅跑本页相关测试（CLAUDE.md 规则 0 禁全量）；UI 文案中文（规则 12）
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
