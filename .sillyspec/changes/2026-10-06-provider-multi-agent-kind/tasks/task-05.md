---
id: task-05
title: '热切换扇出 notify_provider_switch 按会话引擎分组（NULL provider 跳过告警；停止场景不变）'
title_zh: '热切换扇出 notify_provider_switch 按会话引擎分组（NULL provider 跳过告警；停止场景不变）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: [D-005, D-006]
allowed_paths:
  - backend/app/modules/daemon/lease/provider_switch.py
target_files:
  - backend/app/modules/daemon/lease/provider_switch.py
goal: >
  把 notify_provider_switch 从「单 config 无差别广播」改为按目标会话引擎（session.provider）分组扇出——多引擎默认行热切换时每个引擎会话收到 agent_kind=该引擎 的 provider_config（D-006），且停止场景（config=None）与单引擎场景行为零变化（R-07）。
implementation:
  - 保持对外签名 notify_provider_switch(session, user_id, provider_config) 与 step1 会话查询不变（backend/app/modules/daemon/lease/provider_switch.py:45-98——user_id + status IN active/reconnecting + interactive lease join），调用方 backend/app/modules/llm_provider/service.py:482 与既有 patch 点零改动。
  - 停止场景（provider_config 为 None）短路：不分组、不 resolve，逐会话推 None 的现状行为原样保留（daemon reloadWithProvider(null) 回退本机凭证）。
  - 启动场景按 sess.provider（AgentSession.provider，即会话引擎）分组；sess.provider 为 NULL 的会话 log.warning（如 provider_switch_session_no_engine）后跳过，best-effort 不阻塞其余（对齐既有 runtime_id/daemon 解析 None 跳过告警语义，provider_switch.py:112-129）。
  - 组内 config 构造——引擎组与传入 provider_config 的 agent_kind 相同则直接复用传入 config（不重复 resolve/解密，单引擎行为等价）；其余引擎组经 resolve_default_provider_config(session, user_id, 组引擎) 构造（backend/app/modules/daemon/lease/context.py:67，D-006 单一真相源，task-04 后返回 dict 的 agent_kind 恒盖为请求引擎），每组 resolve 一次组内复用；resolve 返回 None（该引擎当前无默认）则该组不推送并 best-effort 告警（D-007 不推送语义）。
  - 逐会话推送循环其余逻辑不动：runtime_id 到 _resolve_daemon_id_for_runtime 路由、ControlCommandService.enqueue_and_push(KIND_PROVIDER_CONFIG_CHANGED)（payload 为 session_id + 该组 config）、单点异常 try/except 告警、delivered 计数与返回值语义保持（provider_switch.py:109-171）。
  - 同步模块级与函数 docstring 的扇出语义（按引擎分组构造、NULL provider 跳过告警、停止场景不变、单引擎等价）。
acceptance:
  - 多引擎默认行（如 agent_kinds 含 claude 与 pi）设默认后——claude 会话收到 payload.provider_config.agent_kind 等于 claude、pi 会话等于 pi，两份 config 其余字段同源同一默认行。
  - 引擎不在新默认行 agent_kinds 内的会话组——经 resolve 取该引擎当前默认行 config 下发；该引擎无默认则该组不推送、仅 warning、不抛异常、不影响其它组投递计数。
  - sess.provider 为 NULL 的命中会话——跳过推送且记 warning 日志，其余会话正常推送。
  - provider_config 为 None——全部命中会话 payload.provider_config 均为 None，投递计数语义与改造前一致（停止场景零回归）。
  - 单引擎默认行（迁移后单元素数组）+ 同引擎会话——推送目标集合、payload 内容、返回计数与改造前等价（R-07 回归门）。
  - 对外签名与调用点零变化——backend/app/modules/llm_provider/service.py:482 调用与 patch 路径 app.modules.daemon.lease.provider_switch.notify_provider_switch 均无需改动。
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_provider_switch.py -q -k "not offline"
constraints:
  - 只改 backend/app/modules/daemon/lease/provider_switch.py；不改 notify_provider_switch 签名与返回值语义，不改调用方 service.py（属 task-03 口径）。
  - 不新增/不修改测试文件——既有 test_provider_switch.py::TestNotifyProviderSwitchBestEffort::test_offline_daemon_does_not_block_others 与 backend/app/modules/daemon/tests/test_control_command_dispatch.py:815 传无 agent_kind 的迷你 config（且无 LlmProvider 行），新语义下不再命中推送，断言修正统一归 task-07（daemon/tests 在其 allowed_paths）；verify 用 -k "not offline" 排除该用例，停止/空集/复用透传/路由跳过/异常路径须全绿。
  - R-02——新增告警只记 session_id/引擎/计数，不记 provider_config 内容（明文 api_key 不入日志）。
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
