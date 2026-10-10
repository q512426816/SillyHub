---
id: task-03
title: '服务层默认互斥逐引擎清（create/update/set_default 含扩张清新增引擎兄弟、收缩空缺）'
title_zh: '服务层默认互斥逐引擎清（create/update/set_default 含扩张清新增引擎兄弟、收缩空缺）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/llm_provider/service.py
target_files:
  - backend/app/modules/llm_provider/service.py
goal: >
  服务层默认互斥从「单引擎清兄弟」改为「按 agent_kinds 集合逐引擎清兄弟默认行」：
  create/update/set_default 三入口全路径维持 (user_id, 引擎) 互斥不变量（R-05 粒度不变），
  扩张引擎集合时清新增引擎的兄弟默认行（D-006 互斥不变量恒成立），
  收缩致某引擎默认空缺时不自动转移（D-003/R-05，提示归前端 task-08）。
implementation:
  - backend/app/modules/llm_provider/service.py:497-516 _clear_sibling_defaults：签名 agent_kind: str 改 agent_kinds 集合参数；JSON 列无法 SQL 等值匹配，改「user_id + is_default=True 过滤拉行 → Python 判该行 agent_kinds 与目标集合有交集 → 逐行置 is_default=False」（事务内循环，对齐 design §总体方案 Wave1-3 与 R-01 行级 Python 判断口径；except_id 排除语义不变）
  - backend/app/modules/llm_provider/service.py:209-210 create：is_default=True 时 _clear_sibling_defaults(user_id, data.agent_kinds)——清集合内全部引擎的兄弟默认行（D-003 设默认对勾选的全部引擎生效）
  - backend/app/modules/llm_provider/service.py:272-280 update（引擎集合可编辑，按生效集合 updates.agent_kinds 或行现值判）：(a) want_default=True 时按生效集合清兄弟；(b) 扩张（D-006）：行已 is_default=True 且本次新增引擎（新集合-旧集合非空）时，即使不动 is_default 也 MUST 清「新增引擎」的兄弟默认行；(c) 收缩（D-003/R-05）：行是默认且集合收缩致某引擎默认空缺 → 不自动转移、不报错（表单 toast 提示归 task-08）
  - backend/app/modules/llm_provider/service.py:371-372 set_default：step-2 清兄弟改 _clear_sibling_defaults(row.user_id, row.agent_kinds)（全集合清），置位 + 原子 commit + probe 失败回滚语义（D-003）均不变
  - backend/app/modules/llm_provider/service.py:391、:436 set/unset_default 的 _dispatch_provider_switch 调用做最小适配（row.agent_kind 属性已不存在，避免 AttributeError）：set 场景按集合内引擎逐个 resolve 推送或暂取首引擎保可运行——正式的按目标会话引擎分组扇出语义归 task-05，本卡 MUST NOT 提前实现；unset 场景（config=None 广播）行为不变
  - probe/fetch_models/query_usage 零改动（与引擎无关，design §总体方案 Wave1-3 第 3 条）
acceptance:
  - create is_default=True 的多引擎行（如 ["claude","pi"]）落库后：该用户原有 claude 默认行与 pi 默认行均被清为 False，任意引擎无双默认（FR-03 互斥粒度仍 (user_id, 引擎)）
  - update 扩张：默认行 agent_kinds 从 ["claude"] 扩为 ["claude","pi"] 且该用户另有 pi 默认行 → 原 pi 默认行被清（D-006）
  - update 收缩：默认行从 ["claude","pi"] 缩为 ["claude"] → pi 引擎默认空缺，无任何其它行被自动置默认（D-003/R-05 不转移）
  - set_default 多引擎行：集合内每引擎互斥成立；DefaultSwitchResult 结构、probe 失败回滚（switched=False 不改 is_default 不推送）、LiteLLM 联动（litellm_registered）语义均不变
  - unset_default 语义不变（不探测、不清兄弟、幂等）
  - probe/fetch_models/query_usage 行为零改动
verify:
  - cd backend && python -m pytest app/modules/llm_provider/tests/test_llm_provider.py（存量模块测试核对无意外回归；多引擎互斥/扩张/收缩新用例归 task-07，agent_kinds 口径断言失效修复亦归 task-07）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何代码
  - MUST NOT 收缩引擎时自动转移默认（只空缺，R-05；「X 引擎默认已空缺」toast 归 task-08）
  - MUST NOT 改 probe/fetch_models/usage；MUST NOT 改 schema.py 组合校验（task-02 已完成）；allowed_paths 锁定单文件 backend/app/modules/llm_provider/service.py
  - 热切换分组扇出（按目标会话引擎分组、NULL provider 跳过告警）归 task-05，本卡仅做保可运行的最小适配
  - 与 task-02 共享 service.py 按 depends_on 串行；不新增测试（用例归 task-07）
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
