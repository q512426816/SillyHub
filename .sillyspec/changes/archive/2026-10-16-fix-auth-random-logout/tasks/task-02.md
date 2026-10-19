---
id: task-02
title: 'Family-scoped reuse revocation + grace 300s + backend tests'
title_zh: '族级复用吊销 + 宽限窗 300 秒 + 后端族语义测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 15:53:07
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/auth/service.py
  - backend/app/core/config.py
  - backend/app/core/tests/test_config_auth.py
  - backend/tests/modules/auth/
target_files:
  - backend/app/modules/auth/service.py
  - backend/app/core/config.py
  - backend/app/core/tests/test_config_auth.py
  - NEW:backend/tests/modules/auth/test_refresh_family_revocation.py
  - backend/tests/modules/auth/test_refresh_grace_window.py
goal: >
  AuthService 族传递链（login 开新族/refresh 继承族）+ 复用检测改族级吊销 + AuthRefreshReused 文案 + config 宽限窗默认 60 改 300；测试先行（FR-01/FR-02/FR-03，D-001/D-002/D-003@v1）。
implementation:
  - 先写 NEW backend/tests/modules/auth/test_refresh_family_revocation.py：族隔离（A 族超窗复用-A 族全灭/B 族存活）、grace 继承族（is_grace 路径新行 family 正确）、legacy NULL 行自成一族且其子代同族（family_id or id 两形态）、login 开新族、宽限窗默认 300 断言（读 Settings 默认值）
  - service.py：_issue_token_pair 加 family_id: uuid.UUID | None = None 参数（None 则 uuid4 开新族）；refresh rotate/grace 两路径传 session.family_id or session.id（锚 service.py:195-201）
  - service.py：新增 _revoke_session_family(user_id, family)——UPDATE sessions SET revoked_at=now WHERE user_id=? AND revoked_at IS NULL AND (family_id=? OR (family_id IS NULL AND id=?))；内部 commit（D-008@v1 执行期裁决：复用分支 UPDATE 后立即 raise，get_session 异常路径 rollback，不先提交则族吊销被回滚成空操作；对齐 revoke_all_user_sessions:220-236 内部 commit 先例）
  - service.py:424-429 复用分支改调 _revoke_session_family(user_id=revoked.user_id, family=revoked.family_id or revoked.id)；AuthRefreshReused 文案改「登录凭证已被使用过（可能存在安全风险），该设备的登录已注销，请重新登录。」
  - 改造 backend/tests/modules/auth/test_refresh_grace_window.py 用例 2：超窗复用断言从「全用户吊销」改族语义（T1 族灭、Sx 异族存活），docstring 同步
  - backend/app/core/config.py:160-168 auth_refresh_grace_seconds 默认 60 改 300，description 同步（le=600 不变）；同步 backend/app/core/tests/test_config_auth.py:26-28 test_default_is_60 断言 60 改 300（符号影响扫描发现，其余边界用例 0/-1/601/600/env 不受影响）
acceptance:
  - 新测试文件全绿：族隔离/继承/legacy 兜底/新族；改造后 test_refresh_grace_window.py 全绿
  - 超窗复用后同用户异族 session revoked_at 仍为 None、同族全部非空；grace 窗内复用仍换新对不吊销（窗显式 60s 既有用例不受默认值变更影响）
  - ruff check 与 mypy 零错
verify:
  - cd backend && uv run pytest tests/modules/auth/test_refresh_family_revocation.py tests/modules/auth/test_refresh_grace_window.py -q
  - cd backend && uv run ruff check app/modules/auth/service.py app/core/config.py tests/modules/auth/ && uv run mypy app/modules/auth/service.py app/core/config.py
constraints:
  - 不改 logout/change_password/admin 全吊销语义（revoke_all_user_sessions 方法保留，service.py:220-236）
  - 族谓词必须带 user_id 前导过滤；调用处 revoked.family_id or revoked.id 兜底不得省（design Grill B-001，防存量 NULL fail-open）
  - grace=0 退化语义保留；不引入新依赖；错误文案中文
related_tests:
  - path: backend/tests/modules/auth/test_refresh_grace_window.py
    reason: 用例 2 断言旧「超窗全用户吊销」语义，随 D-002@v1 改族语义（同 task allowed_paths 内改造）
  - path: backend/app/core/tests/test_config_auth.py
    reason: test_default_is_60 断言默认 60，随 D-003@v1 默认改 300 同步（符号影响扫描发现）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
