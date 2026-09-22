---
id: task-13
title: 'write-module-docs-and-deploy-notes'
title_zh: '文档与部署说明（模块文档 auth/admin/frontend_lib 增量 + 权限缓存 TTL 部署注记）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-18 14:46:09
priority: P0
depends_on: ['task-12']
blocks: []
requirement_ids: [NFR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/modules/
  - README.md
target_files:
  - .sillyspec/docs/SillyHub/modules/auth.md
  - .sillyspec/docs/SillyHub/modules/admin.md
  - .sillyspec/docs/SillyHub/modules/frontend_lib.md
  - README.md
goal: >
  把本变更的增量事实收口进模块文档（auth 权限枚举扩张、admin 覆盖表与子路由、
  frontend_lib 合并层客户端），并在 README 部署节补权限缓存 TTL 注记（NFR-03），
  让架构知识与上线注意事项不随代码流失。
implementation:
  - auth.md 契约摘要权限模型段增量——Permission 枚举 67 到 72（新增 skill:read、mcp:read、agent_profile:read、agent_session:read、menu:admin）与 group 前缀映射补 skill/mcp/agent_profile/agent_session 归 AGENT、menu 走默认 PLATFORM 组；注意事项区「调整权限点需同步四处」条目核对仍成立不重写
  - admin.md 契约摘要增量——menu_overrides 表（menu_key 唯一、label_override 1-30 字符、sort_order 0-999、hidden 布尔，无 role 维度 D-002）+ menu_overrides_router 子路由三端点（GET /api/menu-overrides 仅需认证、PUT 与 DELETE 需 menu:admin 且写审计）+ 前端 /admin/menus 管理页条目（行级即时保存、menus 行隐藏开关锁死防自锁）
  - frontend_lib.md 领域客户端清单增量——menu-overrides.ts 条目（useMenuOverrides 拉 GET /api/menu-overrides 失败按空覆盖直通 + mergeMenus 纯函数含 menus 豁免与孤儿忽略），对齐清单内既有一客户端一行的写法
  - README.md「全栈容器化」节（grep 实测为仓库唯一部署文档位置，deploy/ 下仅 compose 与脚本无 md）追加权限缓存注记——种子迁移直插 role_permissions 绕过 invalidate_all_permissions，perm 前缀缓存 TTL 300 秒自愈为主，可选清 Redis perm 键加速收敛（外部 Redis 不随后端重启清空，重启后端仅为加速可选项）
  - 措辞全部中文（CLAUDE.md 规则 12），各模块卡只加增量段落对齐现有定位/契约摘要/注意事项结构，不重排不删既有内容
acceptance:
  - auth/admin/frontend_lib 三卡新增段落与实现一致（枚举计数、表字段与校验界、端点门控、合并层语义逐项可对）
  - README 部署节含 TTL 300 秒自愈为主、可选清键加速、外部 Redis 不随重启清空三点表述
  - 三张模块卡既有段落零删改（纯增量）
verify:
  - grep -n menu_overrides .sillyspec/docs/SillyHub/modules/admin.md
  - grep -n menu-overrides .sillyspec/docs/SillyHub/modules/frontend_lib.md
  - grep -n 72 .sillyspec/docs/SillyHub/modules/auth.md
  - grep -n 权限缓存 README.md
constraints:
  - 只改文档不改任何代码与测试
  - 模块文档是增量段落不是重写——对齐各 md 现有结构与粒度（auth.md 契约摘要权限模型条目、admin.md 契约摘要分域条目、frontend_lib.md 领域客户端清单行）
  - 部署注记如实表述（TTL 自愈为主、清键可选），不给强制清库指令；注记落在 README 全栈容器化节，不新建设计文档
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
