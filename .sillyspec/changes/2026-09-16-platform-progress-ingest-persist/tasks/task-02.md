---
id: task-02
title: 'Persist CLI stage and status on progress ingest'
title_zh: 'P1 _sync_change_stage_status 落库 + upsert_progress 分支 1/3 接线（CLI_STATUS_TO_PLATFORM 映射表 + 未知值告警 + archived_at 首填）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-01, FR-02, FR-03, FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
related_tests:
  - backend/app/modules/platform_sync/tests/test_router.py（:831 assert row.status == draft——载荷 status=active 随 FR-01 映射为 in_progress 断言失效，由 task-08 更新，本 task 不改它）
target_files:
  - backend/app/modules/platform_sync/service.py
goal: >
  progress POST 接受后把 CLI 上行的 current_stage/status 权威落进 ux_changes 行
  （新增 _sync_change_stage_status 并接入 upsert_progress 分支 1/3），修复
  changes 表行全陈旧的根因——ingest 此前只写收件箱行与建占位行，行存在即永不更新。
implementation:
  - service.py 新增常量 CLI_STATUS_TO_PLATFORM（design 接口定义：active 与 in_progress 均映射 in_progress，archived 映射 archived；deleted 不入表——走既有 _apply_cli_tombstone 独立通道）
  - 新增私有方法 _sync_change_stage_status(workspace_id, name, body)——savepoint 内重查 Change 行（不依赖上游传行，行缺失直接 return，_ensure_change_row 已兜底）；current_stage 取 payload changes[] 同名条目（isinstance str 且非空才覆盖行值，缺失/非 str 不动）
  - status 按 CLI_STATUS_TO_PLATFORM 显式映射落库；archived 分支补 current_stage='archived' 与 archived_at 仅首填（现值 None 才写），不动 location——归档文件移动由 CLI run archive + 镜像同步 + reparse 收敛，抢先置位会被 _apply_parsed 回翻抖动
  - 未知 status 值（映射表 miss 且非字段缺失）→ log.warning 事件名 platform_sync.change_status_unknown，只写 current_stage 不写 status 列
  - savepoint（begin_nested）+ 独立 commit，best-effort 失败仅 log.warning 不阻断上行主流程（_ensure_change_row 与 _sync_change_owner 同范式）；workspace_id=None（service 直调防御）跳过
  - upsert_progress 分支 1（base_ts 空/缺失，service.py 约 277-290 行）与分支 3（stored ≤ base_ts，约 303-312 行）在 _ensure_change_row 之后、_sync_change_owner 之前各接一次调用；分支 2 乐观锁冲突与 change_deleted 拒收分支零改动
acceptance:
  - 接受上行后 ux_changes 行 current_stage 等于载荷 changes[] 同名条目值，status 按映射表落库（载荷 active → 行 in_progress）
  - 载荷 archived 落库为 status=archived + current_stage=archived + archived_at 仅首填且同载荷重放不漂移，location 保持不变
  - 未知 status 值产生 platform_sync.change_status_unknown 告警且 status 列不被写
  - 同载荷幂等重放无状态漂移；base_ts 409 冲突分支与 change_deleted 拒收分支不经过本方法（不落库、响应体不变）
  - 无 X-SillySpec-Base-Ts 的旧 CLI 首推（分支 1）同样落库；载荷缺 status/current_stage 字段时缺省不覆盖对应列
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_owner_sync.py app/modules/platform_sync/tests/test_change_deleted_guard.py app/modules/platform_sync/tests/test_pending_approval_broadcast.py -q --no-cov
  - cd backend && uv run ruff check app
  - cd backend && uv run mypy app
constraints:
  - 不改 test_router.py——:831 status 断言失效是 FR-01 预期行为变更（非测试腐化），由 task-08 统一更新；本 task 的 verify 不含 test_router.py（已知一条断言待 task-08 对齐）
  - 不自建测试——新测试 backend/app/modules/platform_sync/tests/test_stage_status_ingest.py 由 task-06 负责
  - 不动 _ensure_change_row/_sync_change_owner/_apply_cli_tombstone 既有语义，不触碰 base_ts 乐观锁与文档/审批通道写者语义（FR-03 零回归）
  - status 列无 CHECK 约束，未知值宁不写列只告警——脏值会直透 UI 筛选
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
