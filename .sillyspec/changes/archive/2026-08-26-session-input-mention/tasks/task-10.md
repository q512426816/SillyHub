---
id: task-10
title: Smoke hard acceptance in real session
title_zh: 真实会话冒烟硬验收
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: [task-05, task-07, task-09]
blocks: []
requirement_ids: [FR-03, FR-06]
decision_ids: [D-002, D-003]
allowed_paths:
  - .sillyspec/changes/2026-08-26-session-input-mention/smoke-result.md
goal: >
  真实会话冒烟收口 R-1 与 R-10 —— / 联想选中平台冒号名技能与用户技能
  各一条真实调起，@变更 / @快速修复 在空闲与 running 忙轮（page 与
  dialog 双路径）发送后详情会话卡出现该会话，/team 与不使用联想时行为不变。
implementation:
  - 启动 backend + frontend + daemon，进入 /sessions 以 Claude 引擎建真实会话
  - / 联想分别选中一条平台冒号名技能与一条用户自定义技能发送，确认技能被真实调起（R-1）
  - 空闲会话分别用 @变更 与 @快速修复 各发一条；再构造 running 忙轮在 page 与 dialog 两路径各发一条排队（R-10）
  - 核对变更与 quicklog 详情会话卡出现上述会话；/team 拦截剥离回填不变；不用联想直接手输时不弹层
  - 将冒烟证据（会话卡截图或端点响应摘要）与日期记入 smoke-result.md
acceptance:
  - 平台冒号名技能与用户技能各一条经 / 联想选中后真实调起，R-1 收口
  - 「@变更 / @快速修复」空闲与忙轮共四条发送绑定均落库，page 与 dialog 双路径全覆盖
  - GET /api/workspaces/{wid}/changes/{cid}/sessions 与 GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/sessions 响应含冒烟会话
  - /team 行为不变；默认不弹层，请求体不带 bind 字段时后端零行为差异
verify:
  - 人工 UI 冒烟（步骤同 implementation）结果记入 smoke-result.md
  - curl GET /api/workspaces/{wid}/changes/{cid}/sessions 确认冒烟会话在列
  - curl GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/sessions 确认冒烟会话在列
constraints:
  - 验收任务不改源码；发现缺陷回流对应实现 task 修复后重跑冒烟
  - 忙轮路径须真实构造 running 排队场景，不以单测结果替代
related_tests: []
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
