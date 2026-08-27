---
id: task-03
title: 'Backend context injection — PPM item context preamble + attachment materialize/degrade (W3, depends_on: task-02)'
title_zh: '后端上下文注入——build_ppm_item_context_preamble 前导 + PPM 附件物化/降级（_can_access + flush-only 事务拆分）（W3, depends_on: task-02）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1, D-006@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/session/context.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/ppm/common/session_binding.py
  - backend/app/modules/daemon/tests/test_page_context_preamble.py
  - backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py
  - backend/app/modules/daemon/tests/test_session_service.py
goal: >
  FR-03：会话绑定 PPM 任务/问题后，create_session 注入【PPM 任务上下文】/【问题上下文】
  全字段前导（标题/描述/状态/项目/模块/责任人/周期），并把 item.file_urls 真附件物化为
  SessionAttachment 并入既有组装链（D-003/D-006），无权/超限/非 claude/读取失败条目
  降级为前导文字清单（D-007），全程 sillyhub-daemon 仓零改动。
implementation:
  - 'context.py 新增 async build_ppm_item_context_preamble(db, kind, item_id, *, attachment_lines)（对齐既有 build_change_context_preamble 同构模式，context.py:51 起）：经 task-01 的 load_ppm_item 读 PlanTask/PpmProblemList；item 不存在返回 None（调用方跳过注入、不报错）；plan_task 拼【PPM 任务上下文】＝标题 content、描述 task_description、状态、项目 project_name、模块 module_name、责任人 user_name、周期 start_time~end_time；problem 拼【问题上下文】＝标题 pro_desc、状态、项目 project_name、模块 model_name、责任人 duty_user_name、周期 plan_start_time~plan_end_time；attachment_lines 逐行追加为前导尾部附件清单段'
  - 'service.py create_session 在 task-02 开出的 ppm_item_kind/ppm_item_id 形参接线点进入（缺省 None 零分支、既有行为逐字节不变）；执行序＝物化在前、前导消费 attachment_lines（对齐「前导组装提前到写事务外」不变量，service.py:1171-1205 段）'
  - 'service.py 新增私有 _materialize_ppm_attachments（File 元数据/uuid 解析过滤 helper 如需物化放 ppm/common/session_binding.py）：file_urls 先 uuid 解析过滤（R-03：非 uuid 条目直接进降级清单）→ task-01 的 load_item_files 取 File 存活行 → 逐条按 FileService._can_access 同口径校验（file/service.py:137-179，D-007）→ 有权且 provider=claude 且与手动 attachment_ids 合并后 图≤5/文≤5 的条目读 file storage bytes → session attachment storage store_bytes（内容寻址 sha256 去重）'
  - '事务拆分：storage 读 IO、_can_access、降级决策全部在写事务外（只读事务 commit 收口后完成）；SessionAttachment 行 insert 在写事务内（session.id 已知后）flush-only、共用 create_session 唯一 commit；session_id 直接回填（跳过 draft 语义）、user_id=创建者；不复用 FileService.upload()（其自带 commit 与 PIL/大小校验，源文件已在 file 中心过上传校验不重复）'
  - '物化行并入 validated_attachments → 复用既有 attachment_ids 组装链（标记行 attachment_marker_line、多模态块、落盘、assemble 的 8MB 内联/回拉/disk 决策），sillyhub-daemon 协议零改动'
  - '降级路径（均不阻塞会话创建）：无权条目仅列文件名并注明「无权访问」；超限、provider≠claude、读取失败、File 已删的有权条目列「文件名 + GET /api/file/{file_id} 链接」；降级行拼成 attachment_lines 传入前导'
  - '前导拼接：与 change/page 前导同点拼进 dispatch prompt（AgentRunLog user_input 与 SESSION_INJECT 的 prompt 仍写干净用户消息，零 daemon 改动）'
  - '测试：test_page_context_preamble.py 增 PPM 前导 GWT 用例；test_session_service.py 增物化/降级/事务口径用例；test_inject_first_turn_briefing.py 等既有前导/组装测试随改动适配断言（GAP-1）'
acceptance:
  - 'GWT-1 前导全字段（FR-03 块一）：绑定 plan_task/problem 创建会话，首条 user 消息前导含【PPM 任务上下文】/【问题上下文】及标题/描述/状态/项目/模块/责任人/周期全字段；item 不存在时无 PPM 前导且创建成功不报错'
  - 'GWT-2 物化并入组装链（FR-03 块二）：provider=claude 且逐条通过 _can_access 且与手动附件合并后图≤5/文≤5 → SessionAttachment 行存在（session_id 回填、user_id=创建者）、进入标记行/多模态块/SESSION_INJECT attachments，daemon 协议零改动'
  - 'GWT-3 四类降级各一断言（FR-03 块三）：无权（仅文件名+「无权访问」）、超限、provider≠claude、读取失败/已删（文件名+GET /api/file/{file_id} 链接）→ 均降级为前导文字清单且会话创建成功'
  - '事务口径断言：storage 读 IO 与降级决策不落写事务窗口（守卫对齐 test_session_optimize_round2.py 的 TestCreateSessionPreambleBeforeWrite）；SessionAttachment insert 为写事务内 flush-only'
  - '缺省不带 ppm 参数的 create_session 行为零回归（既有前导/组装测试全绿）'
verify:
  - 'cd backend && uv run pytest app/modules/daemon/tests -q -k "preamble or briefing or attach"（仅相关，禁全量）'
  - 'cd backend && uv run ruff check app/modules/daemon app/modules/ppm'
constraints:
  - 'sillyhub-daemon 仓零改动（附件走既有 SessionInjectAttachment 协议与 session-attachments 下载端点，D-006）'
  - '不修改 SessionAttachment 表结构（物化复用现有列）'
  - '不动既有 change/quicklog/page 前导与组装行为（缺省参数零分支进入）'
  - '物化不复用 FileService.upload()；无权条目不引入跨用户文件读取（D-007 口径与 PPM UI/batch_meta 现状一致）'
  - '禁全量测试（CLAUDE.md 规则 0），仅跑相关用例'
provides:
  - contract: ppm_context_injection
    fields: [build_ppm_item_context_preamble, ppm_item_context_preamble, materialized_session_attachments, degraded_attachment_lines]
expects_from:
  task-01:
    - contract: load_ppm_item
      needs: [db, kind, item_id, "return: PlanTask|PpmProblemList|None"]
    - contract: load_item_files
      needs: [db, kind, item_id, "return: list[File]（file_urls 存活行）"]
  task-02:
    - contract: create_session_ppm_wiring
      needs: [ppm_item_kind, ppm_item_id]
related_tests:
  - backend/app/modules/daemon/tests/test_page_context_preamble.py
  - backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py
  - backend/app/modules/daemon/tests/test_session_service.py
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
