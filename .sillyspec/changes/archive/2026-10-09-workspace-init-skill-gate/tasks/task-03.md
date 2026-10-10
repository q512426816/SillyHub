---
id: task-03
title: 'backend complete_lease init 回写段加成败门（失败不回写 init_synced_at）+ 失败/成功对照用例（daemon/lease/service.py / lease/tests/test_init_claim_tokens.py）'
title_zh: 'backend complete_lease init 回写段加成败门（失败不回写 init_synced_at）+ 失败/成功对照用例（daemon/lease/service.py / lease/tests/test_init_claim_tokens.py）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 10:21:23
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05, FR-04]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
target_files:
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
goal: >
  修复 Grill UB-1 实证的误报：init lease 以 status='failed' complete 时后端照写
  init_synced_at，失败被标"已初始化"。回写段加 result.get("status") != "failed"
  成败门，失败跳过回写并 warn 留痕——FR-04 前端"轮询非空=成功"语义的前置。
implementation:
  - backend/app/modules/daemon/lease/service.py:531 init 回写段入口条件从 `_init_meta.get("mode") == "init"` 收紧为 `mode=='init' and result.get("status") != "failed"`（result 为 complete_lease 第三参，daemon 上报 status='failed' 是既有合法值，见 sillyhub-daemon/src/task-runner.ts:1070-1080 _finish 路径）
  - 失败分支 warn 日志 init_lease_failed_no_synced（对齐段内既有 init_lease_complete_bad_meta 风格：lease_id + 不阻塞 lease 完成）
  - backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py 补两用例：①init lease 以 result.status='failed' complete → binding.init_synced_at 保持 None ②status='completed'（或缺省）→ 正常回写对照组（沿用该文件既有 fixture 造 lease+binding 的模式）
acceptance:
  - failed complete 后 init_synced_at/init_synced_spec_version 均为 NULL 且有 warn 日志
  - completed complete 后回写行为与现状一致（对照组零回归）
  - lease 本身仍正常完成（成败门只影响回写，不阻塞 complete 流程）
verify:
  - cd backend && uv run pytest app/modules/daemon/lease/tests/test_init_claim_tokens.py -q --no-cov
constraints:
  - 不改 complete_lease 签名与 lease.status='completed' 的既有赋值（backend/app/modules/daemon/lease/service.py:374）
  - 不清洗存量误标数据（未上线项目，重新初始化即覆盖）
  - 不动 init lease 创建/claim 链路
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
