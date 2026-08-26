---
id: task-04
title: add-mention-sources-hook
title_zh: 联想数据 hooks 聚合技能、变更与快速修复
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P1
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01, FR-04, NFR-01]
decision_ids: []
allowed_paths:
  - frontend/src/lib/session-mention-sources.ts
  - frontend/src/lib/query-keys.ts
  - frontend/src/lib/__tests__/session-mention-sources.test.tsx
provides:
  - contract: useMentionSources
    fields: [skills, changes, quicklogs, atEnabled]
goal: >
  新增 useMentionSources 数据 hook，复用 usePlatformSkillsManifest 与
  listChanges 与 listQuicklogEntries 既有查询为联想浮层供数，挂载即拉取
  且 staleTime 5 分钟保证输入过程零网络请求。
implementation:
  - 新建 frontend/src/lib/session-mention-sources.ts，导出 useMentionSources(workspaceId)，内部三个 useQuery 挂载即拉取（等价 prefetch）
  - 技能源复用 custom-skills.ts 的 usePlatformSkillsManifest（staleTime 已 5 分钟），manifest skills 用空数组兜底
  - 变更源包装 changes.ts 的 listChanges 并带 location 参数 active，快速修复源包装 quicklog.ts 的 listQuicklogEntries，两者 staleTime 5 分钟
  - workspaceId 为空时变更与快速修复查询 enabled 为 false 且 atEnabled 返回 false（@ 联想禁用）
  - 输出过滤 placeholder 条目——default 伪 change_key 与 placeholder 快速修复条目不进列表（对齐会话列表关联筛选惯例），并在 query-keys.ts 追加对应缓存键
  - 新建 jsdom 单测覆盖 workspaceId 空禁用 @ 查询与 placeholder 过滤
acceptance:
  - 技能列表仅消费 name 与 description 等现有字段，不读取 invoke_name（类型 task-08 才加入）
  - workspaceId 为空时变更与快速修复零请求发起，atEnabled 为 false
  - 三个查询 staleTime 均为 5 分钟，挂载后输入过程零新增网络请求
  - default 伪变更与 placeholder 快速修复条目不出现在返回列表
verify:
  - cd frontend && pnpm exec vitest run src/lib/__tests__/session-mention-sources.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不消费 invoke_name 字段，避免与 task-08 并行期的类型冲突
  - 不改三个既有 fetch 函数与 usePlatformSkillsManifest 签名，不新建后端接口
  - workspaceId 为空时 @ 数据源禁用而非抛错
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
