---
id: task-02
title: 'deploy_records 只读模块——service/schema/router + main.py 注册 + 单测（tmp_path 造假目录：正常/invalid/404/鉴权）'
title_zh: 'deploy_records 只读模块——service/schema/router + main.py 注册 + 单测（tmp_path 造假目录：正常/invalid/404/鉴权）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:04:08
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - NEW:backend/app/modules/deploy_records/__init__.py
  - NEW:backend/app/modules/deploy_records/router.py
  - NEW:backend/app/modules/deploy_records/service.py
  - NEW:backend/app/modules/deploy_records/schema.py
  - NEW:backend/app/modules/deploy_records/tests/test_service.py
  - NEW:backend/app/modules/deploy_records/tests/test_router.py
  - NEW:backend/app/modules/deploy_records/tests/__init__.py
  - backend/app/main.py
target_files:
  - backend/app/modules/deploy_records/tests/__init__.py
  - NEW:backend/app/modules/deploy_records/__init__.py
  - NEW:backend/app/modules/deploy_records/router.py
  - NEW:backend/app/modules/deploy_records/service.py
  - NEW:backend/app/modules/deploy_records/schema.py
  - NEW:backend/app/modules/deploy_records/tests/test_service.py
  - NEW:backend/app/modules/deploy_records/tests/test_router.py
  - backend/app/main.py
goal: >
  新建 deploy_records 只读模块：扫各 workspace root_path 下 docs/releases/*.md
  （_rewrite_path 容器路径改写），解析 frontmatter 聚合列表 + 单条详情，
  invalid 容错；零数据表零写端点（D-004@v1）。
provides:
  - contract: GET /api/deploy-records
    fields: [DeployRecordSummary]
  - contract: GET /api/deploy-records/{record_id}
    fields: [DeployRecordDetail, content]
expects_from:
  - contract: Permission.DEPLOY_RECORD_READ
    needs: [deploy_record:read]
implementation:
  - service.py：list_records()/get_record(record_id)；内部 _scan_workspace 用 backend/app/modules/workspace/service.py:58 的 _rewrite_path 改写 root_path 后读 <root>/docs/releases/*.md；frontmatter 解析用 yaml.safe_load（--- 分隔），必填字段 seq/deploy_at(字段名 deployed_at)/status/summary/agent/commits 校验，缺者或解析失败 → status=invalid 条目（file_name/workspace 保留，元数据 None）
  - 排序：deployed_at 字符串倒序，None 排最后按 file_name 倒序（design 接口定义写死规则）
  - schema.py：DeployRecordSummary/DeployRecordDetail pydantic 模型（字段见 design.md 接口定义）
  - router.py：两 GET 端点，require_permission(Permission.DEPLOY_RECORD_READ)；record_id 用 {record_id:path} 形态收含斜杠参数（R-06 实测定型）；404 中文文案 RecordNotFound（AppError 子类，按事件命名惯例）
  - main.py：import + include deploy_records_router（对齐 backend/app/main.py:908 scan_docs 同款）
  - 测试（tmp_path 造假 workspace 目录 + monkeypatch workspace 查询）：正常记录解析/多 workspace 聚合倒序/invalid 容错不炸列表/404/无权限 403/目录不存在静默
acceptance:
  - GET /api/deploy-records 返回聚合列表且按 deployed_at 倒序、invalid 排最后
  - frontmatter 坏文件 → status=invalid 条目而非 500
  - 无 deploy_record:read 权限 → 403
  - 单测全绿（只跑本模块 + 不牵连其它）
verify:
  - cd backend && uv run pytest app/modules/deploy_records/tests -q --no-cov
constraints:
  - 零数据库表、零写端点、零缓存（D-004@v1）
  - 不改 workspace 模块（_rewrite_path import 使用，不重构不搬移）
  - 报错文案中文（test_error_message_l10n.py AST 门禁）
  - Windows 路径兼容（复用 _rewrite_path 反斜杠归一化）
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
