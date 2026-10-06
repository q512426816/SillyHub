---
id: task-07
title: '后端测试——迁移折算四形态/折算器归并（one_m 冲突取 true 优先，plan 写死）/服务层/注入契约逐字/门控三态×命中×群聊链/选模型 422'
title_zh: '后端测试——迁移折算四形态/折算器归并（one_m 冲突取 true 优先，plan 写死）/服务层/注入契约逐字/门控三态×命中×群聊链/选模型 422'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-03', 'task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/llm_provider/tests/
  - backend/app/modules/daemon/tests/
  - backend/app/modules/session_attachment/tests/
  - backend/tests/modules/daemon/lease/
target_files:
  - NEW:backend/app/modules/llm_provider/tests/test_provider_models_migration.py
  - NEW:backend/app/modules/llm_provider/tests/test_provider_models_multi.py
  - backend/app/modules/session_attachment/tests/test_capability.py
  - backend/app/modules/daemon/tests/test_resolve_default_provider_config.py
  - backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py
  - backend/tests/modules/daemon/lease/test_provider_config_payload.py
goal: >
  后端测试五域收口（FR-01~FR-05 全覆盖）：迁移折算四形态、折算器归并与服务层列表 CRUD、
  注入契约逐字锁定（daemon 消费面）、门控三态×列表命中×群聊链、会话选模型 422；同时修复
  task-01~06 切换后失效的存量断言。只跑相关域，禁全量（规则 0）。
implementation:
  - 新建 NEW:backend/app/modules/llm_provider/tests/test_provider_models_migration.py（SQLite 直驱先例 test_agent_kinds_migration.py）：单模型 / 四槽去重保序 / one_m 透传（同模型多角色 one_m 冲突取 true 优先，tasks.md 写死口径）/ 空供应商四形态折算断言；downgrade 反折往返断言（四旧列重建值 = 主模型派生 + 反折四槽）
  - 新建 NEW:backend/app/modules/llm_provider/tests/test_provider_models_multi.py（先例 test_agent_kinds_multi.py）：ProviderModelEntry 校验（name 空白拒 / 三态外拒 / roles 值域外拒 / 缺省值）；create 落库与空列表；update None 不动与整体替换；derive_primary_model 三态口径（sonnet 首条 / 列表首条 / 空 None）；probe 与 quota 取主模型派生
  - 注入契约逐字（R-02 P1 核心）：更新 backend/app/modules/daemon/tests/test_resolve_default_provider_config.py 与 test_resolve_bound_provider_config.py——断言 provider_config 含 models 键、model 与 default_fallback_model 两键同值 = 主模型派生、model_role_mappings 由条目折算且键形态与 daemon injector 消费面逐字一致（对照 sillyhub-daemon/src/credential-injector.ts 规则3/4 断言子字典 model 与 one_m 两键）；更新 backend/tests/modules/daemon/lease/test_provider_config_payload.py claim payload 契约（两键同值 + models 键 + openai_chat 形态 model 键）
  - 门控扩展 backend/app/modules/session_attachment/tests/test_capability.py：三态×列表命中矩阵（true/false 直判、auto 启发式）、未命中保守 false、model_name 缺省 None 保守 false、resolve_session_gate/attachment_pipeline 透传、群聊链（shadow 成员模型）用例
  - 会话选模型 422：在 backend/app/modules/daemon/tests/ 既有会话配置用例文件内扩展（或相邻新文件）——选列表外模型 422 带可用模型提示、空列表供应商 422 引导、列表内模型生效写入快照与 claim payload
  - 修复 task-01~06 落地后失效的存量断言：llm_provider 域 test_llm_provider.py / test_probe.py / test_quota.py / test_litellm_client.py / test_api_format.py 等四旧字段断言改 models 口径；daemon 域 test_provider_switch*.py 等旧 model 派生断言同改（非测试逻辑有误，禁止反向改实现迁就旧断言——规则 9）
  - 断言消费契约来源标注 sillyhub-daemon/src/credential-injector.ts（R-02：daemon diff=0 硬约束的测试锁定面）
acceptance:
  - 五域用例齐全：迁移折算四形态 + downgrade 往返；条目校验与服务层 CRUD + 主模型派生三态；注入契约逐字（两键同值 + models 键 + 角色映射形态）；门控三态×命中×未命中×群聊链；选模型 422×2 + 生效透传
  - task-01~06 切换后失效的存量断言全部修复（无 skip/xfail 掩盖）
  - 相关域全绿：llm_provider / session_attachment / daemon 域与 lease 契约文件
  - 测试内不出现四旧列属性读（与实现口径一致）
verify:
  - cd backend && uv run pytest app/modules/llm_provider/tests -q --no-cov -n auto
  - cd backend && uv run pytest app/modules/session_attachment/tests -q --no-cov -n auto
  - cd backend && uv run pytest app/modules/daemon/tests -q --no-cov -n auto
  - cd backend && uv run pytest tests/modules/daemon/lease -q --no-cov -n auto
constraints:
  - MUST NOT 跑全量测试（规则 0，全量留给 CI）；仅跑上述相关域
  - MUST NOT 改 sillyhub-daemon 仓任何文件（含其测试）；断言只锁消费键形态，不复制 daemon 实现代码
  - MUST NOT 为绿而弱化断言（R-02 逐字契约是本变更 P1 防线，规则 9：实现有误改实现）
  - 仅动测试文件（四个 allowed_paths 目录）；实现代码发现缺陷时回写对应 task 卡记录并修复后重跑，不在测试里绕
  - fixture 沿用各域既有 conftest 惯例（SQLite 直驱 / create_all），不新引入外部依赖
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
