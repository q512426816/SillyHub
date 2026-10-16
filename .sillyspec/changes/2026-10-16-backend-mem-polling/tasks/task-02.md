---
id: task-02
title: 'spec 包 gzip 缓存全局字节帽 LRU（128MB）+ 并发用例'
title_zh: 'spec 包 gzip 缓存全局字节帽 LRU（128MB）+ 并发用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/tests/test_bundle_sync.py
  - backend/app/core/config.py
target_files:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/tests/test_bundle_sync.py
  - backend/app/core/config.py
goal: >
  _bundle_gzip_cache 跨工作区无全局上限（~18MB/ws 永驻）→ 加 128MB 总字节帽 LRU 淘汰，消慢性内存爬升。
implementation:
  - 改 backend/app/modules/spec_workspace/service.py:186-221：全局字节帽 spec_bundle_cache_max_bytes（默认 128MB）——put 时超帽按最久未用淘汰至帽内；per-workspace 最新 2 版本保留策略不变
  - 改 backend/app/core/config.py 加键 spec_bundle_cache_max_bytes
  - 改 backend/app/modules/spec_workspace/tests/test_bundle_sync.py 补用例：多工作区填充超帽 LRU 淘汰 / 淘汰后未命中重打包正常 / 并发 put 幂等不写坏
acceptance:
  - 缓存总字节不超帽（测试注入小帽验证淘汰）
  - 淘汰后 pull 未命中走重打包路径正常返回
  - 既有 spec_workspace 测试全绿
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
constraints:
  - 缓存命中语义/响应头（Content-Encoding/Vary）不变
  - 不动 build_bundle 打包逻辑与 gzip 协商
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
