---
id: task-10
title: '实机集成验收（3 条存量冲突链路证据，integration-critical）'
title_zh: '实机集成验收（3 条存量冲突链路证据，integration-critical）'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-07-conflict-diff-compare/acceptance/
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  本机 daemon 在线实机验收冲突对比链路：3 条存量冲突行、spec 树弹窗 diff、进度弹窗对比表、弹窗内裁决下发、权限负例，产出 integration-critical 证据写入验收记录。
implementation:
  - 确认本机 daemon 在线且 backend/frontend 运行，打开变更中心平台同步卡
  - 核验 3 条存量冲突行（2026-09-02-changes-overview-card、quick-62e1d5fb、quick-aac62562）只显示「查看对比」无行内裁决按钮
  - 打开 spec 树冲突弹窗，核验文件清单徽章与左右 diff 高亮渲染，截屏存证
  - 打开进度类冲突弹窗核验关键信息对比表；若执行期无真实进度冲突则用 mock 数据截屏或日志替代并在证据中说明
  - 弹窗内点「保本地/取平台」走二次确认，观察 WS 消息或日志确认下发链路通，不必真裁决
  - 权限负例：以非所有者非管理员身份 curl compare 端点核验返回 404
  - 证据（日志摘录、接口响应 JSON、截图路径）汇总写入 acceptance 目录验收记录
acceptance:
  - 五项核验点逐项有证据且结论通过，证据落 acceptance 目录
  - 3 条存量冲突行均只显示「查看对比」，quick 行标题按 ql 规则兜底显示原 ID（D-004 已知限制不算失败）
  - 弹窗打开即 loading、失败可重试；机器离线时入口禁用并有提示
  - 非所有者调 compare 端点返回 404，页面不渲染「查看对比」按钮
verify:
  - curl -s http://127.0.0.1:8001/api/health
constraints:
  - 真实机器在线实测，禁止仅以单测绿代替集成证据
  - 不真执行裁决（保留存量冲突现场），只验证二次确认与下发链路
  - 不改业务代码，仅在 acceptance 目录内写证据与验收记录
  - 进度冲突若无真实样本，必须 mock 替代并在证据中显式说明
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
