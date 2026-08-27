---
id: task-03
title: '会话钉定校验切换——session/service.py owner-only 扩展为授权判定 + placement 二次复查授权分支 + 交互式借用审计（含 grant_id）+ 单测（只传共享 runtime/未授权 404/停用失效/修改端点 owner-only 回归）'
title_zh: '会话钉定校验切换——session/service.py owner-only 扩展为授权判定 + placement 二次复查授权分支 + 交互式借用审计（含 grant_id）+ 单测（只传共享 runtime/未授权 404/停用失效/修改端点 owner-only 回归）'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-02']
blocks: []
expects_from:
  task-02:
    - contract: GrantAuthorization
      needs: [kind, grant_id, lender_user_id]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/tests/test_session_create_config.py
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_create_config.py
    reason: test_pinned_runtime_of_other_user_returns_404 与 test_unknown_runtime_id_returns_404 断言钉定 owner-only 404——授权切换后须保未授权仍 404，并在同文件补共享放行/停用失效用例
goal: >
  把交互式会话钉定 runtime 的 owner-only 校验扩展为 grants 授权判定（workspace grant 放行并按借用会话处理），placement 二次复查加授权分支，交互式借用审计写入 grant_id。
implementation:
  - session/service.py 钉定校验（:932-937 owner 短路处）替换为 task-02 的 authorize_pinned_runtime，owner 命中走原路径，workspace grant 命中按借用会话处理并把 grant_id/lender 传给 placement，未授权维持 404 不泄露存在性
  - placement.py _query_pinned_online_runtime 增加授权分支（复用 pinned_skip_owner_check 旗标先例，新参数默认值保零回归），prepare_interactive_dispatch 对共享钉定会话走既有 borrowed marker 与沙箱元数据链路
  - placement.py _insert_borrow_audit_row（:148-182）增加 grant_id 参数并写入 INSERT 列，交互式共享会话与批处理借用同样落审计
  - test_session_create_config.py 补用例（只传共享 runtime 放行/未授权 404/停用失效/修改端点 owner-only 回归）
acceptance:
  - 共享 runtime 钉定会话创建成功且 daemon_borrow_audit 落行含 grant_id 与 lender
  - 未授权/停用 grant/离线钉定仍按现状 404 或 4xx，绝不静默换机
  - grants 空表时现有钉定用例零失败（design §9 逐字节等价）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
constraints:
  - 修改类端点 owner-only 语义零变化（FR-03 回归，_get_owned_runtime/_get_owned_instance 不动）
  - platform 档案检测前置与 platform 会话不写借用审计归 task-05（D-007），本卡不实现
  - placement 既有代表钉定（pinned_skip_owner_check）与普通钉定默认行为零回归，新参数均带默认值
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
