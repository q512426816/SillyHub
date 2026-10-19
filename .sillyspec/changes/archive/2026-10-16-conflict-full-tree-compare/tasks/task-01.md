---
id: task-01
title: '后端 full-tree 兜底：按记录名重取快照 + files[].path 归属裁剪 + 响应三字段 + 文案'
title_zh: '后端 full-tree 兜底：按记录名重取快照 + files[].path 归属裁剪 + 响应三字段 + 文案'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 17:26:11
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-05]
decision_ids: [D-001@v1, D-005@v1, D-006@v2, D-009@v1, D-012@v1]
provides:
  - contract: "SillySpecConflictCompareResponse"
    fields: [record_label, covered_changes, path_total]
related_tests:
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
allowed_paths:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
target_files:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
goal: >
  让跨变更 full-tree 冲突的「查看对比」在平台可用：_fetch_snapshot 抽内层按记录名取快照，
  仅在 kind=spec-tree 且主取失败为 conflict_record_missing 时以记录名 full-tree 重取一次，
  以快照 files[].path 做段边界归属校验与裁剪，响应补 record_label/covered_changes/path_total，
  并把 conflict_record_missing 用户文案改成「重新同步」口径。
implementation:
  - backend/app/modules/daemon/sillyspec_compare.py:410-454 抽内层 _request_snapshot(record_label)（params 仍 change/kind/workspace_id），主取失败捕获 DaemonRpcRemoteError.code=="conflict_record_missing"
  - 兜底：仅 kind=="spec-tree" 时以 record_label="full-tree" 重取一次（不递归）；异常族映射保持现状
  - 归属与裁剪：对兜底快照 files[].path 做段边界前缀匹配（changes/<change>/ 或 changes/archive/<change>/，名字后必须紧跟 "/"），命中则过滤 files[]（entry 完整保留）并计算 covered_changes（过滤前 files[].path 归因去重）与 path_total（过滤前 files 长度）；未命中抛原 conflict_record_missing
  - backend/app/modules/daemon/router/machines.py:536-553 SillySpecConflictCompareResponse 增加三个可选字段（record_label、covered_changes、path_total，类型分别 str|None=None、list[str]=[]、int|None=None）（端点 :576-610 透传）
  - backend/app/modules/daemon/sillyspec_compare.py:60-63 conflict_record_missing 文案改「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。」
  - tests：追加兜底命中（两次 RPC、字段齐、裁剪正确）/ 段边界 foo-foobar 不命中 / kind=progress 不触发 / 主取成功不重试；更新既有 conflict_record_missing 旧文案断言
acceptance:
  - 新用例：mock send_rpc 首次 conflict_record_missing、二次返回含 2 个变更名路径的 full-tree 快照 → 响应 200，文件清单仅含请求变更路径（archive 形态），record_label=full-tree，covered_changes 含两变更名，path_total=记录路径数；daemon RPC 恰 2 次
  - 新用例：full-tree 快照只含 changes/foobar/… 而请求 change=foo → 仍 502 conflict_record_missing（段边界生效）
  - 新用例：kind=progress 主取失败 conflict_record_missing → 不触发兜底（send_rpc 1 次）；kind=spec-tree 主取成功 → 不触发兜底（send_rpc 1 次）
  - 既有 test_sillyspec_compare.py 中旧文案断言更新为新文案后全绿（cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q --no-cov）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon/sillyspec_compare.py app/modules/daemon/router/machines.py && uv run ruff format --check app/modules/daemon/sillyspec_compare.py app/modules/daemon/router/machines.py && uv run mypy app
constraints:
  - 禁止改 daemon（sillyhub-daemon/src/**）与 CLI；兜底只以另一记录名调用既有 RPC（D-001/D-009）
  - 兜底只允许一次，禁止递归/多次；未命中时必须抛原 conflict_record_missing，错误路径与现状一致
  - 禁止对快照读 conflicting_paths（daemon 快照无该字段）；只许用 files[].path 与顶层键（D-006@v2）
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
