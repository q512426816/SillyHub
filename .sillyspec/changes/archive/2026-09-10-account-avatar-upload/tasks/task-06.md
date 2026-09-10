---
id: task-06
title: 'GroupMemberAvatarUpload ownerType prop'
title_zh: 'GroupMemberAvatarUpload 扩展 ownerType 属性'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/group-chat/group-member-avatar.tsx
target_files:
  - frontend/src/components/group-chat/group-member-avatar.tsx
provides:
  - contract: GroupMemberAvatarUpload 可选 ownerType prop + USER_AVATAR_OWNER_TYPE 常量
    fields: [ownerType prop（默认 GROUP_MEMBER_AVATAR_OWNER_TYPE）, USER_AVATAR_OWNER_TYPE 常量]
goal: >
  GroupMemberAvatarUpload 上传归属类型参数化（FR-03/FR-04 支撑，D-001@v1 复用
  文件中心管线）：增加可选 ownerType prop——默认维持 group_member_avatar，
  既有建群向导与成员面板两处调用零改动零行为变化；导出 USER_AVATAR_OWNER_TYPE
  常量（user_avatar），供 task-07/08 个人中心把头像文件归到用户头像维度。
implementation:
  - 常量区（GROUP_MEMBER_AVATAR_OWNER_TYPE 邻域）新增导出 USER_AVATAR_OWNER_TYPE——值为 user_avatar（文件中心 owner 维度新取值，字符串维度无枚举约束，后端文件中心零改动）
  - GroupMemberAvatarUploadProps 增加可选 ownerType prop，注释说明默认群成员头像维度、个人中心传 USER_AVATAR_OWNER_TYPE
  - 组件解构时给 ownerType 以 GROUP_MEMBER_AVATAR_OWNER_TYPE 兜底默认值；handleFile 内 uploadFile 的 owner_type 从固定常量改为该 prop（group-member-avatar.tsx 约 :145 调用点）
  - 渲染组件 GroupMemberAvatar 与既有调用方（create-group-wizard.tsx、member-panel.tsx）零改动——不传 prop 时上传归属与现状完全一致
acceptance:
  - USER_AVATAR_OWNER_TYPE 从模块导出且值为 user_avatar
  - 不传 ownerType 时 uploadFile 收到的 owner_type 仍为 group_member_avatar（默认值不变，既有两调用方零改动）；传入 ownerType 时 uploadFile 收到该值
  - cd frontend && pnpm exec tsc --noEmit 通过；既有 create-group-wizard 测试不回归（默认行为不变）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/sessions/__tests__/create-group-wizard.test.tsx
constraints:
  - 默认值必须维持 GROUP_MEMBER_AVATAR_OWNER_TYPE——既有调用方零改动是向后兼容铁律（design Wave 2 第 2 条）
  - 只动上传控件——不改渲染组件 GroupMemberAvatar、useAvatarSrc、lib/file/api 封装与文件中心端点
  - 不新增测试文件（归属切换断言由 task-07/08 页面用例覆盖）；仅跑相关测试（CLAUDE.md 规则 0）
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
