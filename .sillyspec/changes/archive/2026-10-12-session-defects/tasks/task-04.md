---
id: task-04
title: 'F5a config_snapshot backfill — create.py pre-binding NULL window + inject.py bind/switch writeback of model/provider_name/profile_name + tests'
title_zh: 'F5a config_snapshot 补齐——create.py 绑定前窗口 + inject.py 切换后回写 model/provider_name/profile_name + 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/tests/test_session_switch_config.py
  - backend/app/modules/daemon/tests/test_inject_session_model.py
target_files:
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/tests/test_session_switch_config.py
goal: >
  修复 F5a 元数据残缺：绑定前创建的会话 config_snapshot 落 NULL
  （backend/app/modules/daemon/session/service/create.py:660 条件写入仅覆盖
  入口字段任一选中的场景），后续供应商绑定/切换若不触发 config_switch
  分支则快照永不回填——保证绑定/切换后 model/provider_name/profile_name
  非空，导出（backend/app/modules/daemon/session/service/export.py:466 读取）
  不再输出 NULL。
implementation:
  - 核查 create.py 窗口：backend/app/modules/daemon/session/service/create.py:657-676 既有 config_snapshot 落值先例（含 model 派生）仅在 pinned_runtime_id/profile/llm_provider_row 任一选中时写入（:660 条件），绑定前创建（三入口全空）落 NULL——实证该窗口行为，按结论决定是否需最小修补（未选入口 NULL 为既有钉子 test_session_create_config.py:902 的现状语义，不得破坏）。
  - inject.py 回写：供应商切换/绑定分支（backend/app/modules/daemon/session/service/inject.py:111 切换分支语义区；既有 config_switch 回写点 :663-686 仅覆盖「新值≠会话当前值」），对「绑定前创建（快照 NULL）→ 后经默认解析/绑定生效但不构成 config_switch」的路径补回写快照，键集与语义对齐既有六键先例（:671，profile_name/provider_name/model/engine/machine_name/agent_name，SESSION_SWITCH_CONFIG 同口径）。
  - 测试：test_session_create_config.py 核查/补绑定前创建 NULL 现状断言；test_session_switch_config.py 补「未绑定创建→后绑定→快照三键非空」与「切换供应商后快照更新」用例（:192 双维切换用例为形态先例）；未绑定会话行为不变回归。
  - 导出面验证：导出读 backend/app/modules/daemon/session/service/export.py:466 的 config_snapshot——用例断言绑定后导出输出 model/provider_name 非 null。
acceptance:
  - 绑定前创建→后绑定（含不触发 config_switch 的默认解析绑定路径）→查询/导出 config_snapshot.model 与 provider_name 非 null；显式切换供应商后快照随之更新。
  - 未绑定会话行为不变：config_snapshot 保持 NULL（既有 test_session_create_config.py:902 断言零回归），未触发绑定/切换的既有 inject 路径零变化。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_create_config.py app/modules/daemon/tests/test_session_switch_config.py app/modules/daemon/tests/test_inject_session_model.py -q --no-cov
constraints:
  - 不改 REST/WS 端点签名与 config_snapshot 键集（对齐 create.py:662 / inject.py:671 既有六键口径）；零 migration、无新配置项。
  - 未选入口的 NULL 现状语义不得破坏；回写只补快照字段，不得触碰 SESSION_SWITCH_CONFIG 下发行为；只跑相关测试（规则 0）。
<!-- 执行期对账修正（verify 收口，与该 task review 结论一致）：target_files 移除 backend/app/modules/daemon/session/service/create.py, backend/app/modules/daemon/tests/test_session_create_config.py —— create.py 核查后现状语义已满足（绑定前 NULL 为既有钉子语义，回填落 inject.py）；test_session_create_config.py 既有用例零回归未改动 -->

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
