---
id: task-09
title: 'run e2e knowledge precipitation verification with deployment-critical evidence'
title_zh: '端到端集成验证（deployment-critical 证据采集：录入→合并→CLI validate/search；派发回流；权限负例）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
task_type: verification
depends_on: ['task-06', 'task-08']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/knowledge/router.py
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - .sillyspec/changes/2026-09-17-knowledge-precipitation/
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  在真实 workspace（b97f8231 或测试专用 workspace）跑通知识沉淀全链并采集 deployment-critical 集成证据（verify --done 门）——录入合并后 CLI validate/search 同源命中、蒸馏派发回流、未授权零写入口、spec_version 递增与 repo-native 下行一致。
implementation:
  - 环境准备（FR-06）——本地起 backend + frontend，用已授 KNOWLEDGE_WRITE 的账号进入知识库页，确认 decisions/ 与 generated/ 全部条目按 zone 分组可见（对照本地 .sillyspec/knowledge/ 实际文件数）
  - 手工链路（FR-02/FR-05）——录入一条候选 → 待审核区置顶可见带徽标 → merge-dialog 合并到 known-issues.md（keywords 人工填写）→ 目标文件新增「##」小节且 INDEX.md 出现新路由行（截图 + git diff 留证）
  - CLI 同源验证（D-003 + R-03）——对该 workspace 本地仓执行 sillyspec knowledge validate 通过 + sillyspec knowledge search 用合并条目关键词命中（命令输出留证）
  - 蒸馏链路（FR-01/FR-03）——从记录提炼 tab 选已归档变更派发蒸馏 → AgentRun 创建成功 → daemon 在线时候选经上行同步回流待审核区；离线则任务立即 failed 且任务条透出失败态与日志入口
  - 权限负例（R-06）——未授 KNOWLEDGE_WRITE 的账号访问同一知识库页，确认无任何写入口（无按钮/操作区/弹层触发），行为与现状一致
  - 同步一致性（D-005）——平台直写后确认 spec_version 递增；repo-native 客户端下次 lease 拉取后本地 .sillyspec 出现同样改动（前后对照留证）；全部证据编号落盘变更目录 evidence/ 子目录，失败项如实记录现象与复现步骤
acceptance:
  - 录入→待审核可见→合并→known-issues.md 新增「##」小节 + INDEX.md 新路由行全程通过且证据落盘
  - sillyspec knowledge validate 通过且 knowledge search 命中新条目（输出留证）
  - 蒸馏派发 AgentRun 有终态记录——completed 且候选回流待审核，或 failed 附原因（daemon 离线场景）
  - 未授权用户页面零写入口；spec_version 递增与 repo-native lease 下行一致均有前后对照证据
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test knowledge
  - sillyspec knowledge validate
  - sillyspec knowledge search <合并条目关键词>
constraints:
  - 不改任何业务源码——发现缺陷如实登记待办并回流对应实现卡修复，不在本卡顺手修；证据文件只落变更目录，不落仓库其它位置
  - 手工写入优先用测试专用 workspace，验证后还原（本项目未上线允许重置数据）；只跑 knowledge 面与前端相关面，不跑全量测试（CLAUDE.md 规则 0）
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
