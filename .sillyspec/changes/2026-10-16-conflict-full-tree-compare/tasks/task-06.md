---
id: task-06
title: '部署真机复验（现网 fire-unitadd 行：对比/来源提示/文案分支/关闭入口）'
title_zh: '部署真机复验（现网 fire-unitadd 行：对比/来源提示/文案分支/关闭入口）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 17:26:11
priority: P0
depends_on: ['task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-008@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-16-conflict-full-tree-compare/verify-deploy-evidence.md
target_files: []  # 流程产物（verify-deploy-evidence.md）不进 target_files 声明；写面已在 allowed_paths
goal: >
  按 D-008 在生产真栈复验本次修复：部署腾讯云生产后用现网 2026-10-13-fire-unitadd-form-import 注册表行，
  验证跨变更冲突的对比可打开且只含该变更路径、来源提示在场、失败卡分支文案正确、「标记已处理」可用且行消失；
  证据（请求与响应摘要/时间戳）落 verify-deploy-evidence.md。
implementation:
  - 打包与部署：按 .claude/skills/deploy-to-server 流程（build-and-save.sh 打镜像 → scp → load-and-up.sh），生产栈在腾讯云 124.222.127.242（/opt/sillyhub/deploy/deploy）
  - 部署后核对 /api/health 的 commit_sha 与本地打包源一致（部署并流校验闸）
  - 复验 1（兜底对比）：以可操作账号 GET /api/daemon/machines/16fef8b5-28d9-43d0-870b-a9c966ef2d98/sillyspec-conflicts/2026-10-13-fire-unitadd-form-import/compare?kind=spec-tree&workspace_id=4e9eb05b-de2b-44fa-88e6-84098d164492 → 200 且 record_label=full-tree、文件仅含该变更 4 个路径、covered_changes 含两变更名
  - 复验 2（文案分支）：构造/命中 conflict_record_missing 场景核对失败卡文案与无「重试」（或核对代码路径 + 现状截图）
  - 复验 3（关闭入口）：在变更页对该注册表行点「标记已处理」确认 → 行从列表消失；刷新列表不再出现（除非冲突重新推送）
  - 证据落盘：请求/响应摘要（JSON 片段）、时间戳、commit_sha、操作前后列表状态写入 verify-deploy-evidence.md
acceptance:
  - verify-deploy-evidence.md 含 4 组证据（部署 commit_sha 核对 / 兜底对比 200 与字段 / 文案分支 / 关闭入口行消失），每组含时间戳与请求或响应摘要
  - 复验 1 的文件清单与现网记录的该变更路径集合一致（4 条 archive 路径，不含兄弟变更路径）
verify:
  - ssh 到生产（腾讯云 124.222.127.242）核对 /api/health commit_sha 与镜像 tag
  - curl 生产 compare 端点（带 Bearer token）核对 200 与 record_label/covered_changes/path_total
constraints:
  - 禁止在未获用户确认前执行生产写操作以外的破坏性动作；「标记已处理」仅按设计置 resolved（可复现、非破坏）
  - 部署遵循 deploy-to-server skill（并流校验闸：分支为 main/打包源 sha 留痕）；不擅自改 nginx/容器编排
  - 复验证据必须落盘变更目录，禁止只留在对话
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
