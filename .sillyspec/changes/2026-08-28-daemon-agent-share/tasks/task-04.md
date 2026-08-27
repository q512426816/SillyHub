---
id: task-04
title: implement-shared-agents-crud-api
title_zh: '平台共享智能体 API——shared-agents CRUD（require_platform_admin，runtime 限管理员自己名下在线/档案 visibility 显式升级/writable_dir ⊆ allowed_roots 校验）+ active 公共端点（grants/router.py 定义，挂载归 task-07）+ 单测'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-01']
blocks: ['task-05', 'task-07', 'task-08']
requirement_ids: [FR-04]
decision_ids: [D-002@v2, D-003@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/daemon/grants/schema.py
  - backend/app/modules/daemon/grants/service.py
  - backend/app/modules/daemon/grants/router.py
  - backend/app/modules/daemon/grants/tests/test_shared_agents_api.py
provides:
  - contract: SharedAgentView
    fields: [id, agent_profile_id, pinned_runtime_id, source_workspace_id, writable_dir, enabled]
  - contract: SharedAgentActiveView
    fields: [id, agent_profile_id, display_name, provider, runtime_online]
goal: >
  实现平台共享智能体管理端点（shared-agents CRUD，require_platform_admin）与 active 公共端点，供全体用户会话选择器消费。
implementation:
  - schema.py——SharedAgentCreateRequest（agent_profile_id、pinned_runtime_id、source_workspace_id、writable_dir、可选 promote_visibility）与 SharedAgentView、SharedAgentActiveView DTO；service 层强制 platform 行绑定列 agent_profile_id 与 source_workspace_id 与 pinned_runtime_id 与 writable_dir 四项非空（grantee_id=None、enabled 默认 true），PATCH 仅改 enabled、DELETE 删行、GET 返回全部含停用
  - service.py 创建校验——pinned_runtime 属当前管理员 user_id 名下且在线（D-003）；agent_profile 存在且 visibility 非 platform 时仅显式 promote_visibility=true 才升级为 platform 并在响应提示（R-05）；source_workspace 存在；writable_dir 必填且 ⊆ 该 runtime 的 allowed_roots
  - router.py——POST 与 PATCH 与 DELETE 与 GET /api/daemon/shared-agents 依赖 require_platform_admin（app/core/auth_deps.py）；GET /api/daemon/shared-agents/active 任意登录用户仅返回生效摘要（含 runtime 在线状态）；本卡只定义 router，挂载进 daemon/router.py 归 task-07
  - grants/tests 单测——权限矩阵（非 admin 403）、创建校验各拒绝分支（他人 runtime、离线 runtime、非 platform 档案未带 promote、writable_dir 越界）、CRUD 与 active 输出字段、重复创建被唯一约束拒绝
acceptance:
  - 非 platform admin 调四个管理端点被拒（403），active 端点任意登录用户可访问且仅含生效行；platform grant 行四绑定列非空且 enabled 默认 true，PATCH 停用后 active 不再返回该行
  - 创建校验全部生效——runtime 非管理员名下或离线拒绝、档案非 platform 未显式 promote 拒绝（显式 promote 后升级且响应提示）、writable_dir 不在 runtime allowed_roots 内拒绝；grants/tests 新增单测全部通过
verify:
  - cd backend && uv run pytest app/modules/daemon/grants -q --no-cov -n auto
constraints:
  - 档案 visibility 非 platform 必须显式 promote_visibility 参数才升级，禁止静默把私有档案改为全员可见（R-05）
  - writable_dir 必须 ⊆ 管理员该 runtime 的 allowed_roots 防指定任意路径（D-002@v2）；不复用 D-002@v1 的 read_only 白名单旧方案（工具集收窄按 D-009 归 task-05 的 tool_config，本卡不碰）
  - router 只定义不挂载（include 归 task-07）；会话强制项（检测前置、cwd、overlay 下推、不写借用审计 D-007）归 task-05 本卡不实现
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
