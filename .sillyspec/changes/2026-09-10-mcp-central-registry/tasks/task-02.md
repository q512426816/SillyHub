---
id: task-02
title: add-mcp-registry-service-crud-and-crypto
title_zh: 服务层——CRUD、可见性、binding 约束与加密读写
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001, D-002]
allowed_paths:
  - backend/app/modules/mcp_registry/
target_files:
  - NEW:backend/app/modules/mcp_registry/service.py
  - NEW:backend/app/modules/mcp_registry/tests/test_service.py
expects_from:
  task-01:
    - contract: mcp_registry 数据模型
      needs: [McpServer, McpServerBinding, McpTemplate]
    - contract: McpServerCreate
      needs: [name, server_config, scope]
    - contract: McpServerDetail
      needs: [server_config, encrypted_env]
provides:
  - contract: McpRegistryService
    fields: [list_servers, create_server, update_server, delete_server, add_binding, remove_binding]
goal: 建 McpRegistryService——CRUD、双层可见性、binding 约束与 CredentialCipher 逐键加密读写，把权限矩阵与密文细节收敛在 service 层。
implementation:
  - 按 design 接口定义节实现 list_servers（scope 取 platform/mine/visible，visible 为平台共享全员可见加自己私有）与 create/update/delete（删除级联 binding 靠 FK CASCADE）
  - 权限矩阵——平台库写操作非 admin 抛 403；跨用户私有库读改删一律 404 防存在性枚举（对齐 skills 先例）；admin 判定与 require_permission_any(SETTINGS_ADMIN) 同权限点，service 抛 AppError 由 router 转 HTTP
  - 写路径校验 server_type 仅 stdio（D-005）与 name 字符集按 design 数据模型节正则（小写字母数字开头加小写字母数字连字符、总长 2-100），非法抛 422
  - binding 约束——platform binding 需 admin 且受 partial 唯一约束防重复；user binding 校验 scope_ref 为 server 归属者或 server 为平台共享（owner 为空）；remove_binding 按 scope_type 与 scope_ref 删
  - 加密读写——secret 键判定与脱敏同源（_SECRET_KEY_MARKERS），写时逐键调 CredentialCipher.encrypt 得密文 bytes 与 key_id 并以 base64 入 encrypted_env；读时逐键 decrypt 还原 env；key 轮换失配抛 CipherKeyMismatch 上抛由渲染诊断降级
  - 单测 test_service.py 覆盖权限三态、binding 归属与重复、加密回读与失配、stdio 与 name 校验
acceptance:
  - 非 admin 平台库写 403、跨用户私有库 404、归属者与 admin 正常通过
  - user binding 的 scope_ref 非归属被拒；platform binding 重复被拒
  - secret env 入库无明文且读回一致，key 失配抛 CipherKeyMismatch；非 stdio 与非法 name 写入被拒
verify:
  - cd backend && uv run pytest app/modules/mcp_registry/tests/test_service.py -q
  - cd backend && uv run ruff check app/modules/mcp_registry && uv run mypy app/modules/mcp_registry
constraints:
  - 测试只跑本 task 相关路径，禁止全量测试（CLAUDE.md 规则 0）
  - 行为契约来自 design 接口定义与数据模型节不发明端点或字段；router 端点与 HTTP 装配属 task-03
  - 加密只用 core/crypto.py 的 CredentialCipher 单值接口不另造实现；解密失配不在本层吞错（留给 task-04 诊断降级）
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
