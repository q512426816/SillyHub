---
id: task-08
title: '三端集成验收——卡片数据与同刻 CLI 直连一致 + null 占位/数据过期标记实测（integration-critical 证据）'
title_zh: '三端集成验收——卡片数据与同刻 CLI 直连一致 + null 占位/数据过期标记实测（integration-critical 证据）'
author: 'qinyi'
created_at: 2026-09-03 08:46:38
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
allowed_paths:
  - .sillyspec/changes/2026-09-02-changes-overview-card/integration-evidence.md
goal: >
  三端真实联调集成验收（integration-critical 证据采集）——backend + daemon + frontend 本地起全，
  验证工作台卡片数据与同刻 CLI 直连 progress show --json 一致，null 占位态与数据过期标记实测可见，
  产出的证据文件供 verify 阶段 gate 消费。
implementation:
  - 起三端——backend（uvicorn）+ sillyhub-daemon（本机 node，心跳通路自然触发采集上报）+ frontend（dev server），登录进任一 workspace 工作台
  - 一致性比对——同刻执行 node "C:\Users\qinyi\IdeaProjects\sillyspec\bin\sillyspec.js" progress show --json（cwd=主仓根），envelope 计数（active_changes/ghost_count/conflict_count）与卡片健康条逐项比对一致（不断言具体动态数值）
  - 占位态实测——临时以无 --json 的本机 3.26.15 sillyspec 为采集源（或 mock spawn ENOENT）验证「总览不可用」占位；停 daemon 数个采集周期验证 generated_at 陈旧的「数据可能过期」标记
  - 心跳回归观察——机器卡/ws_hub 无异常日志；旧版心跳（无 sillyspec_status 字段）不报错
  - 证据落盘——一致性比对输出、占位/过期态截图或 DOM 摘要、时间戳，写入 integration-evidence.md（本卡唯一 allowed_path）
acceptance:
  - 卡片健康条计数与同刻 CLI 直连 envelope 一致（留比对记录）
  - null 占位态与数据过期标记实测可见（留证据）
  - plan.md 全局验收 5 条逐条核验记录在案（integration-evidence.md 内勾选）
verify:
  - 人工核验 integration-evidence.md 内容完备（比对记录 + 占位/过期证据 + 5 条全局验收勾选）
constraints:
  - 不断言动态计数（ghost/冲突为动态数据，只认同刻一致性口径）
  - 不跑全量测试（留 CI）；不改源码（本卡仅采集证据，发现缺陷回流对应 task 修复后重验）
  - 本仓 sillyspec 版本差期间，daemon 采集 spawn 路径用源码直连形态验证
expects_from:
  - task-07: 工作台挂载完成（卡片可见可交互）
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
