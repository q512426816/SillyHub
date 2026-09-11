---
id: task-02
title: 'mcp_registry get_server_for_import helper and workspace import-from-registry endpoint'
title_zh: 'get_server_for_import helper+import-from-registry 端点（D-009 三态）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 21:39:17
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/mcp_registry/service.py
  - backend/app/modules/mcp_registry/tests/
  - backend/app/modules/workspace/
target_files:
  - backend/app/modules/mcp_registry/service.py
  - backend/app/modules/workspace/skills_view_service.py
  - NEW:backend/app/modules/workspace/tests/test_mcp_import_registry.py
provides:
  - POST /api/workspaces/{id}/mcp/import-from-registry 端点契约（body 为 server_id；响应含写入结果、warning 可选、同名改名后最终 server 名）
expects_from:
  - task-01 提供 user_skill_enables 增 workspace_id 列与双 partial unique 迁移已落（本卡不消费 skill 表，依赖仅为同窗迁移顺序收敛）
goal: >
  mcp_registry 增 get_server_for_import（可见性+解密 env），workspace 增 import-from-registry 端点把资产库 server 定义合并写入 specDir/.mcp.json（读-合并-原子写+审计），落实 D-004 写入语义与 D-009 三态契约（FR-02 桥③）。
implementation:
  - mcp_registry/service.py 新增 get_server_for_import(server_id, user)——复用 _get_server 读可见性（跨用户私有同 404 防枚举，service.py:533-551 锚点）；env 经 decrypt_server_env 解密（service.py:482-500 锚点）；CipherKeyMismatch 原样上抛由端点转 422（中文文案明确密文无法解密）
  - workspace/router.py 新增 POST /workspaces/{workspace_id}/mcp/import-from-registry（require_permission(WORKSPACE_WRITE) 对齐 mcp-config PUT 先例，router.py:498 锚点）；skills_view_service.py 增 import_from_registry——get_mcp_config 同源容错读现有 .mcp.json 后合并导入（同名冲突后缀 -registry 改名，D-004），复用既有原子写（临时文件+os.replace，skills_view_service.py:306-376 锚点），手工插 AuditLog（details 记 server_id 与改名结果，不含 env 值）
  - 三态契约（D-009）——解密失败 422；server 停用或无 binding 可导入但响应带 warning（.mcp.json 写入即生效与平台绑定态无关）；导入后 registry 侧 server/binding 状态零变化；响应 DTO 落 workspace/schema.py 对齐 get_mcp_config 脱敏口径
  - 测试——mcp_registry test_service.py 补可见性与解密失败上抛；NEW test_mcp_import_registry.py 覆盖三态/同名改名/审计行/既有 server 保留/权限 403
acceptance:
  - 三态各有测试（成功、解密失败 422、停用导入带 warning）
  - 同名导入后 .mcp.json 中为原名-registry，其余既有条目逐字不变；GET mcp-config 可见新 server（脱敏一致）
  - 导入后 registry 侧零变化（无 UPDATE/DELETE 断言）；审计行含 server_id 不含 env 明文；非成员 403
verify:
  - cd backend && uv run pytest app/modules/mcp_registry -q --no-cov
  - cd backend && uv run pytest app/modules/workspace/tests/test_mcp_import_registry.py app/modules/workspace/tests/test_mcp_config_write.py -q --no-cov
constraints:
  - 不改 update_mcp_config 既有 PUT 行为（只复用写路径）；解密仅发生在导入内容构造（D-004），密文绝不直接写盘
  - adoptable/adopt 归 task-03；不做 platform_default 绑定（非目标）
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
