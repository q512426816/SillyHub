---
id: task-05
title: create-session-platform-profile-branch
title_zh: 'create_session platform 档案分支——检测前置到二选一校验之前 + 强制 pinned/cwd/allowed_roots_overlay=[writable_dir] 下推 + allowed_tools 不含 Bash（D-009）+ spike-02 作用域实证（R-09/D-010，per-runtime 误伤则改 session 级 provider）+ 单测（只传共享档案/参数被覆写/停用回退/写限目录内外/Bash 拒绝/管理员普通会话不受限/不写借用审计）'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-03', 'task-04']
blocks: ['task-08']
expects_from:
  task-02:
    - contract: GrantAuthorization
      needs: [kind, platform_binding]
  task-04:
    - contract: SharedAgentView
      needs: [agent_profile_id, pinned_runtime_id, source_workspace_id, writable_dir]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002@v2, D-007@v1, D-009@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/agent/execution.py
  - backend/app/modules/daemon/tests/test_session_create_config.py
  - backend/app/modules/agent/tests/test_worker_tool_config.py
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_create_config.py
    reason: 既有档案解析用例（test_profile_injects_system_prompt_and_refs_only 与 test_profile_without_system_prompt_writes_refs_only）及钉定用例在检测前置改造后必须零回归，platform 分支新用例并入同文件
goal: >
  在 create_session 入口把生效 platform 共享档案检测前置到 runtime_id/provider 二选一校验之前，命中即服务端强制覆写 pinned runtime、cwd、allowed_roots_overlay=[writable_dir] 下推与无 Bash 工具集，让全体用户可安全使用平台共享智能体且强制项不可被请求参数放宽。
implementation:
  - spike-02 首步（R-09/D-010）——读 sillyhub-daemon 侧实证 overlay 收紧经 per-runtime PolicyCache（policy_update）下推是否 runtime 全局生效误伤管理员同 runtime 普通会话；若是则 backend 侧改走 session 级通道（claim payload effectiveAllowedRoots，daemon session-manager.ts:1632 _allowedRootsProvider 双通道已消费），不动 daemon 代码；单测断言管理员同 runtime 普通会话写路径不受 writable_dir 限制
  - 检测前置——create_session 在 runtime_id/provider 二选一校验（session/service.py:950-954）之前先查生效 platform grant（task-02 GrantAuthorization 的 kind=platform_grant 与 platform_binding），判断 agent_profile_id 是否为绑定共享档案；命中进强制分支，未命中（普通档案或停用 grant）零分支走原链路（Grill B-01/D-007）
  - 强制覆写——命中分支服务端施加 pinned_runtime_id=platform_binding.pinned_runtime_id（prepare_interactive_dispatch 传 pinned_skip_owner_check=True，placement.py:612-620 先例）与 cwd=source_workspace.root_path 与 allowed_roots_overlay=[writable_dir]（复用「只能收紧 ∩ daemon.allowed_roots」既有下推，lease/context.py:348-382 effective_allowed_roots 透传）与 lease metadata tool_config（execution.py worker_tool_config 旁新增第三种枚举构造，allowed_tools 为 Read/Glob/Grep/Edit/Write/mcp__sillyhub-file/mcp__sillyhub-worker 且 mode=acceptEdits，经 build_claim_payload 透传 context.py:431-443）
  - platform 会话不写 daemon_borrow_audit（D-007/Grill B-04）——platform 分支不进 task-03 借用审计路径，用量计量走 AgentSession 既有口径
  - 单测——test_session_create_config.py 补 platform 分支用例（只传共享档案无 runtime_id/provider 放行；同传 runtime_id+共享档案被服务端覆写；grant 停用后档案回普通语义且只传档案恢复二选一拒绝；lease metadata 写约束收敛为 writable_dir 且 tool_config 白名单无 Bash；管理员同 runtime 普通会话不受写限；platform 会话无审计行）；test_worker_tool_config.py 补新构造函数枚举断言（不含 Bash/NotebookEdit）
acceptance:
  - 只传共享档案（无 runtime_id/provider）创建成功，lease 定位 grant 的 pinned runtime 且 cwd 为源码工作区 root_path（Grill B-01 前置生效）
  - 同传 runtime_id/workspace_id 时请求参数被服务端覆写，全部强制项不可被请求参数放宽
  - platform 会话 lease metadata 写约束收敛为 writable_dir、tool_config.allowed_tools 明确枚举且不含 Bash/NotebookEdit（D-009）；grant 停用后同档案立即回普通档案语义
  - 管理员同 runtime 普通会话写路径不受共享会话收紧影响（spike-02 结论落地，D-010/R-09）；platform 会话 daemon_borrow_audit 零写入（D-007）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_create_config.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_tool_config.py -q --no-cov
constraints:
  - allowed_tools 明确枚举且不含 Bash/NotebookEdit（D-009）；产出走 Write/Edit，路径强制由 daemon 写守卫保证，不在 backend 复制路径校验
  - 全部强制项由服务端施加，请求参数（runtime_id/provider/workspace_id）不可放宽或绕过（防伪造）
  - grant 停用（enabled=false）后档案回普通语义，无残留覆写
  - 不修改 sillyhub-daemon 子项目代码（Non-Goal）；作用域问题经 backend 下推通道（session 级 provider 或 claim 下推）解决
  - 既有普通档案/钉定/provider 路径零回归（grants 空表时 platform 检测零命中）
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
