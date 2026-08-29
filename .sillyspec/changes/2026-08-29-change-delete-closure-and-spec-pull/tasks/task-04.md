---
id: task-04
title: '_ensure_change_row 双层拒收 + progress 409 change_deleted + CLI 墓碑写路径处理'
title_zh: '_ensure_change_row 双层拒收 + progress 409 change_deleted + CLI 墓碑写路径处理'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_router.py
  - backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
provides:
  - contract: CLI 墓碑写路径处理器
    fields: ['progress 上行 status=deleted 处理器已存在（仅置 location=deleted）；本任务在其后接线 soft_delete_change_dir（platform_sync/service.py 最小侵入一处调用）']
goal: >
  堵住复活通道 4（FR-04）——progress 上行遇已删 key 时按双层判据拒收（现存 Change 行 location='deleted' 主判据 + 行缺失时 manifest changes/{name}/ 前缀 platform_deleted 兜底锚点，LIKE 转义），router 返回 409 + 错误体 code='change_deleted'（与 base_ts 冲突区分、旧 CLI 重试无害）；同时实现 CLI 墓碑 status='deleted' 写路径处理——仅置 location='deleted'，镜像软删接线归 task-06。
implementation:
  - '拒收前置（service.py upsert_progress :167-206）——接受分支 _apply 写收件箱行之前先做已删探测，命中即整次上行拒收（不写 platform_change_progress、不建占位行、不对齐 owner），返回带 change_deleted 标记的 PlatformSyncResult（类定义 :115，本文件内扩展字段）'
  - '双层判据抽共享私有 helper（B-1）——① 主判据：现存 Change 行 location 为 deleted（(workspace_id, change_key) 精确查询）；② 兜底判据：行缺失时探测 spec_file_manifest 中 changes/{name}/ 前缀下是否存在 platform_deleted=True 行——前缀查询必须转义 LIKE 通配符 % 与 _（变更名含下划线常见），或取回 workspace manifest 行后 Python startswith 过滤（两法择一）；_ensure_change_row（:258-333）建占位前用同一 helper 加守卫，防 service 直调路径绕过'
  - 'router 409（router.py push_progress :104-152）——result 命中 change_deleted 时返回 409 + 错误体含 code 字段取值 change_deleted；既有 base_ts 冲突 409（:141-151）响应体逐字不动（旧 CLI sync.js 读 platform_progress 与 last_pushed_at 不破坏）；错误体在 router 内以 JSONResponse 直接构造，不改 schema.py 的 ConflictResponse（本卡文件集不含 schema.py）'
  - 'CLI 墓碑写路径（design §5.5）——接受分支检测 body changes[] 同名条目 status 为 deleted 时置 Change 行 location 为 deleted（写路径副作用，区别于 archived 的读时投影范式 change/service.py:1613-1616）；仅置 location，不实现 soft_delete_change_dir 也不预埋空调用（接线归 task-06，round 2 复审 P1 修正）；已删拒收 409 优先于墓碑处理——行已 deleted 时走拒收分支，墓碑处理只对未删行生效，天然幂等'
  - '新增 test_change_deleted_guard.py——① 现存 Change 行 location 为 deleted → POST progress 得 409 + body code 为 change_deleted + 收件箱行不重建；② 行缺失 + manifest changes/{name}/ 前缀 platform_deleted=True 行（fixture 造 manifest 行）→ 同样 409（兜底锚点）；③ LIKE 转义——变更名含 _（如 my_change 与 myXchange 相似名）互不误配；④ CLI 墓碑 status 为 deleted 上行 → 200 且 location 置 deleted；⑤ 未删 key 正常上行回归（占位行照建、owner 对齐）；⑥ base_ts 冲突 409 与 change_deleted 409 错误体可区分断言；test_router.py 既有 progress POST 用例回归'
acceptance:
  - '已删 key（Change 行 location 为 deleted）progress 上行 → 409 + 错误体 code 为 change_deleted，收件箱行不重建、owner 不漂移（FR-04 通道 4 拦截）'
  - '行缺失 + manifest changes/{name}/ 前缀 platform_deleted=True 兜底锚点命中 → 同样拒收；LIKE 通配符转义正确（含 _ 变更名不误配相似前缀）'
  - 'CLI 墓碑上行（changes[].status 为 deleted 且行未删）→ 接受并置 Change 行 location 为 deleted；不触发镜像软删（接线归 task-06）'
  - '未删除 key 上行行为与现状一致——占位行照建、owner 对齐、base_ts 冲突语义与响应体不变（旧 CLI 兼容，409 重试无害）'
  - 'base_ts 冲突 409 与 change_deleted 409 通过 code 字段可区分'
verify:
  - 'cd backend && python -m pytest app/modules/platform_sync/tests/test_change_deleted_guard.py app/modules/platform_sync/tests/test_router.py -q'
  - 'cd backend && python -m pytest app/modules/platform_sync/tests/test_owner_sync.py -q'
constraints:
  - '不实现 soft_delete_change_dir 与「触发镜像软删」接线（归 task-06）；不动 change 模块文件（三点豁免归 task-03）；不动 spec_workspace apply_ops（复活通道 1/2/3 归 task-02）'
  - 'base_ts 乐观锁语义与既有 ConflictResponse 响应体字段不动（旧 CLI 消费契约）；本卡不改 schema.py——错误体在 router 内构造'
  - '不动前端；遵守 CLAUDE.md 规则 0——只跑 platform_sync 模块相关测试，全量留 CI'
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
