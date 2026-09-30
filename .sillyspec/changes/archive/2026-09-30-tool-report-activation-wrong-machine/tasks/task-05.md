---
id: task-05
title: 'handoff tier with context bridge doc and engine reselect'
title_zh: 'handoff 档：交接文档 + RPC 读 + 引擎/档案重选 + 降级'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P0
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-04]
decision_ids: [D-004@v1, D-005@v2]
allowed_paths:
  - backend/app/modules/daemon/session/service/takeover.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/daemon/tests/
target_files:
  - NEW:backend/app/modules/daemon/session/service/takeover.py
  - NEW:backend/app/modules/daemon/tests/test_takeover_handoff.py
provides:
  - contract: handoff tier takeover behavior
    fields: [handoff_doc, provider_reselect, agent_profile_reselect]
expects_from:
  task-04:
    - contract: TakeoverResponse
      needs: [tier, handoff_doc, session_id]
goal: >
  填充 takeover handoff 档：交接文档模板（RPC 读原机日志归一化消息→build_handoff_prompt 帽内组装→首 prompt）、引擎/档案重选校验（provider ∈ 原机支持集合）、读取失败降级普通新会话（FR-04，D-004@v1/D-005@v2）。
implementation:
  - 前置核验（design 自审存疑 2）：用真实 zcode 日志样本验证 read_agent_log_messages 归一化消息的 tool 事件字段覆盖度（复用 platform_sync/router.py 既有 _resolve_agent_log_read_target + _send_agent_log_rpc 链）；缺字段时模板降级省略该节
  - takeover.py 加 build_handoff_prompt 纯函数（会话元信息/目标/最近对话摘要（用户轮全文+助手轮截断）/涉及文件/最近操作；HANDOFF_MAX_CHARS 帽+截断声明行，量级对齐 fork SEED_MAX_CHARS）
  - handoff 分支接线：经 daemon RPC 读归一化消息 → 首 prompt=交接文档+用户消息；RPC 失败降级普通新会话（handoff_doc=false + warning 日志，MUST NOT 阻塞接手）
  - 引擎/档案重选：TakeoverRequest.provider 非空时校验 ∈ 匹配 runtime 所属 daemon_instance 的在线 provider 集合（不符 422 中文），更新新会话 provider；agent_profile_id/llm_provider_id 照 create 校验口径透传
  - 新测试 test_takeover_handoff.py（独立文件避免与 task-06 同 Wave 相交）：handoff 分档判定、模板帽与截断声明、重选 422、降级 handoff_doc=false、native 引擎不进 handoff 档
acceptance:
  - zcode harness 会话 takeover 走 handoff 档且首 prompt 含交接文档；claude-code 不进 handoff 档
  - provider 重选非法值 422 中文；合法值落新会话 provider
  - RPC 读取失败路径返回 handoff_doc=false 且会话正常创建
  - test_takeover_handoff.py 全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_takeover_handoff.py -q --no-cov
constraints:
  - 不调 LLM（确定性模板）；模板字段缺失降级省略不报错
  - 交接文档体积帽硬上限（超帽截尾保留较早内容+显式截断声明行）
  - platform_sync/router.py 仅只读复用（_send_agent_log_rpc 等内部函数 import），不改其端点行为
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
