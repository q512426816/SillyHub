---
id: task-03
title: 'P2a upsert_documents title re-derivation (deepest-stage doc H1 + deleted-key guard + IntegrityError placeholder paradigm) [target:backend/app/modules/platform_sync/service.py]'
title_zh: 'P2a upsert_documents title 重派生（最深阶段文档 H1 + _change_key_deleted 防复活守卫 + 占位行 IntegrityError 范式） [target:backend/app/modules/platform_sync/service.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:05:25
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
expects_from:
  - 'task-01 title_norm 的 extract_h1(text)（从最深文档全文取首 H1）与 normalize_display_title(h1, change_key)（模板 H1 归一化回退 change_key 去日期前缀）'
allowed_paths:
  - backend/app/modules/platform_sync/service.py
target_files: [backend/app/modules/platform_sync/service.py]
goal: >
  documents 通道接受后 changes.title 按最深阶段文档 H1 重派生（FR-04 / D-003@v1 方案 a）：
  CLI 模板 H1 是无语义固定文案，title 停在「提案书（Proposal）」永不更新；在 upsert_documents
  两条接受路径收尾补 best-effort 派生，行缺失建占位行但不复活已删 key（GAP-1 / R-04 / R-06）。
implementation:
  - 'service.py 增模块级常量 _TITLE_STAGE_ORDER = ("proposal.md", "requirements.md", "design.md", "tasks.md")（design 接口定义；documents 键已由 schema.py DOCUMENT_FILES 白名单限四件套 :111-114）'
  - '新增私有 best-effort helper（如 _sync_change_title(workspace_id, name, documents)）：按 _TITLE_STAGE_ORDER 深度取推送 map 中最深文档全文 → extract_h1(text) 取首 H1 → normalize_display_title(h1, name) 得显示名（模板 H1 含「— <key>」后缀变体回退去日期前缀 key 名，自定义 H1 原样，H1 缺失 key 派生）'
  - '按 (workspace_id, change_key) 重查 Change 行：行存在 → 只覆盖 title；行缺失 → 建行前必须过 _change_key_deleted（service.py:509-582）防复活守卫（GAP-1：documents 端点无 change_deleted 拒收前置，迟到推送已删 key 不得重建行）——守卫命中只更新既有行、不建行，行不存在整体跳过 title 派生'
  - '守卫未命中且行缺失 → 建占位行 Change(id=uuid.uuid4(), workspace_id=..., change_key=name, title=派生名, status="draft", location="active", path=f"changes/{name}", updated_at=now(UTC))（binding.py:140-152 同款 defaults；documents 通道无 body.changes[] 可取，title 直接用派生名）'
  - 'INSERT 撞 ux_changes_workspace_key 唯一约束 → 复用 _ensure_change_row 的 IntegrityError 静默范式（service.py:654-665：begin_nested + flush，IntegrityError → rollback + log.info race_lost 不抛）'
  - 'upsert_documents UPDATE 分支（:916-920 收尾）与 INSERT 分支（含 IntegrityError 竞争恢复收尾 :936-938）两条接受路径各调一次 helper；整体 best-effort——DB 异常仅 log.warning（NFR-01 同范式），documents 收件箱行落库不因 title 派生失败回滚或阻断'
acceptance:
  - '推送含 tasks.md（或最深为 design/requirements/proposal）时 changes.title = normalize_display_title(最深文档首 H1, change_key)：模板 H1 与「— <key>」后缀变体 → change_key 去日期前缀；自定义 H1 → 原样；H1 缺失 → key 派生'
  - '已删 key（现存行 location=deleted 或 manifest platform_deleted 锚点）：不建占位行；行不存在时整体跳过 title 派生，documents 列收件箱写入不受影响'
  - '行缺失且 key 未删：占位行以派生 title + status=draft / location=active / path=changes/{name} 建立；并发双发撞 ux_changes_workspace_key 静默 race-lost（log.info），不抛不阻断'
  - '既有行为零回归：upsert_documents 返回值、收件箱占位行守卫、documents 列写语义不变；title 派生 DB 异常仅 log.warning，主流程照常提交'
verify:
  - cd backend && uv run pytest app/modules/platform_sync -q --no-cov
  - cd backend && uv run ruff check app
  - cd backend && uv run mypy app
constraints:
  - '本卡只改 service.py 的 P2a 段（upsert_documents 及新增 helper/常量），不碰 P1 段（task-02 范围）与 parser.py / title_norm.py（task-01/04/05 范围）；同文件多 task 共享，编辑前先拉最新文件'
  - '不新增测试：upsert_documents 重派生行为测试归 task-07（change/tests/test_title_normalization.py）'
  - '不改 DOCUMENT_FILES 白名单与 documents 端点契约；不做 schema 迁移；title 派生只单行 UPDATE/INSERT，不引入额外写放大'
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
