---
id: task-08
title: 'Mobile /m/account avatar upload'
title_zh: '移动 /m/account 头像上传'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: ['task-05', 'task-06']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/m/account/page.tsx
  - frontend/src/app/m/account/page.test.tsx
target_files:
  - frontend/src/app/m/account/page.tsx
  - NEW:frontend/src/app/m/account/page.test.tsx
expects_from:
  task-05:
    - contract: SessionUser.avatar 可选字段 + updateMyAvatar(avatar) 头像写入口（PATCH 后重跑 fetchMe 写回 store）
      needs: [SessionUser.avatar, updateMyAvatar(avatar)]
  task-06:
    - contract: GroupMemberAvatarUpload 可选 ownerType prop + USER_AVATAR_OWNER_TYPE 常量
      needs: [USER_AVATAR_OWNER_TYPE 常量]
goal: >
  移动 /m/account 头像区从首字占位升级为可上传（FR-04，D-001@v1）：头像整块
  可点触发选图上传（相机角标提示可换），上传走 uploadFile（owner_type 为
  user_avatar）+ updateMyAvatar 写回 store；有自定义头像时提供恢复默认小
  入口；上传中禁点、失败有提示；触控目标 ≥44px（页面既有移动规范）。
implementation:
  - page.tsx 头像块（现状 h-16 w-16 rounded-full bg-primary）改为可点按钮——内嵌 hidden file input（accept 为 image/*）整块点击触发，触控目标 ≥44px；有自定义头像时经 useAvatarSrc 渲染头像图（圆形裁切由 rounded-full 承担）、无图维持现状首字；角上叠加相机角标提示可换
  - 选图后 uploadFile 且 owner_type 传 USER_AVATAR_OWNER_TYPE，成功取 getFileDownloadUrl(resp.id) 调 updateMyAvatar(新 URL)；非图片文件与上传失败提示沿用移动页文案风格（参考 group-member-avatar.tsx 的 handleFile 口径）；上传中禁点
  - user.avatar 有值时提供「恢复默认」小入口（触控 ≥44px）调 updateMyAvatar(null)；头像刷新经 session store（updateMyAvatar 内部重跑 fetchMe），页面不自管副本
  - 新建 page.test.tsx（vitest + testing-library，风格对齐桌面 account 的 page.test.tsx）——mock @/lib/auth（logout、changePassword、updateMyAvatar）与 @/lib/file/api（uploadFile、getFileDownloadUrl）、useSession 注入 user：上传成功、恢复默认、失败提示、无头像首字回退用例
acceptance:
  - 头像整块可点且带相机角标（触控目标 ≥44px）；无自定义头像渲染首字回退、有则渲染头像图
  - 选图上传 owner_type 为 user_avatar，成功调 updateMyAvatar（/api/file/{id} 形态 URL）；恢复默认调 updateMyAvatar(null)；上传中禁点、非图片与失败有提示
  - cd frontend && pnpm test src/app/m/account/page.test.tsx 全绿；页面既有修改密码与退出登录行为不变
verify:
  - cd frontend && pnpm test src/app/m/account/page.test.tsx
constraints:
  - 触控目标 ≥44px（FR-04 页面既有移动规范）；交互手感沿用页面现状类（active:scale、shadow-[var(--shadow-sm)] 主题 token）
  - 多主题铁律（CLAUDE.md 规则 20）——brand-* 语义阶、禁硬编码色；整块可点为移动自绘交互（GroupMemberAvatarUpload 整态按钮排布不适配头像位），仅复用其上传管线与常量
  - 不动桌面页、TopBar、会话气泡（task-07/09/10 范围）；仅跑本页相关测试（规则 0）；UI 文案中文（规则 12）
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
