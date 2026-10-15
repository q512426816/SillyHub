---
id: task-01
title: 'Persist backend logs to rotating file with dual-write'
title_zh: '后端日志落盘——FileWriter processor 双写+轮转+log_dir 派生+落盘测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:20:11
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-006@v1, D-008@v1]
allowed_paths:
  - backend/app/core/logging.py
  - backend/app/core/config.py
  - backend/app/core/paths.py
  - backend/tests/test_server_log_filer.py
target_files:
  - backend/app/core/logging.py
  - backend/app/core/config.py
  - backend/app/core/paths.py
  - .gitignore
  - NEW:backend/tests/test_server_log_filer.py
provides:
  - contract: LogFileConfig
    fields: [get_log_file_path, LOG_FILE_NAME, LOG_MAX_BYTES, LOG_BACKUP_COUNT]
goal: >
  日志双写落盘：structlog 输出同时写轮转文件（5MB×3）与 stderr，stderr 链路零扰动；
  导出文件路径/常量供端点消费（单一源）。
implementation:
  - backend/app/core/paths.py 增 resolve_log_dir(raw: str) -> str：空=默认 <repo_root()/data/logs 绝对路径；相对值对 repo_root 解析；绝对值原样（对齐 resolve_spec_data_root 模式，paths.py:41 邻位）
  - backend/app/core/config.py:101 log_level 邻位增 log_dir: str = Field("")
  - backend/app/core/logging.py 模块级常量 LOG_FILE_NAME="backend.log" / LOG_MAX_BYTES=5_000_000 / LOG_BACKUP_COUNT=3；get_log_file_path() -> Path（resolve_log_dir(settings.log_dir)/LOG_FILE_NAME）
  - FileWriter processor 类：__init__ 持 self._renderer = JSONRenderer()（复用同一实例渲染行文本，与 stderr 逐字一致）；__call__ 中 line = self._renderer(logger, method_name, event_dict)，per-write open(path,"a",encoding="utf-8") 写 line+"\n"（即开即关，Windows rename 可轮转），写前查 size+len > LOG_MAX_BYTES 则 rename 链（.2→.3、.1→.2、log→.1）；全链路 try/except 捕获不抛出（降级继续），返回 event_dict 透传
  - configure_logging 里插入 processor 链（JSONRenderer 之前）：建目录 mkdir(parents=True, exist_ok=True)（失败降级不挂 FileWriter，stderr-only）
  - backend/tests/test_server_log_filer.py：tmp_path 注入小 max_bytes 触发轮转（.1/.2/.3 链与最旧删除）；双写逐字一致（含中文 event：文件行 == 同一渲染链路输出）；写失败不抛（只读目录/非法路径）；configure 幂等（重复调用不重复挂）；轮转后文件句柄无残留（写后立即可 rename/再次打开）
acceptance:
  - uv run pytest tests/test_server_log_filer.py -q --no-cov 全绿
  - 小 max_bytes 轮转：3 次触发后 backend.log.1/.2/.3 存在、超 backup_count 最旧删除
  - 中文 event 双写逐字一致（文件行与渲染输出相等断言）
  - 只读目录/非法路径下无异常抛出、stderr 输出不受影响
  - 既有 test_health.py 不回归（stderr 链路零扰动）
verify:
  - cd backend && uv run pytest tests/test_server_log_filer.py tests/test_health.py -q --no-cov
constraints:
  - stderr 输出链路零变化（FileWriter 只写文件、返回 event_dict 透传）
  - 禁止引入第三方依赖（stdlib json/logging 即可）
  - 轮转参数为模块级常量（非 settings，D-008@v1）；log_dir 是唯一 settings 项
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
