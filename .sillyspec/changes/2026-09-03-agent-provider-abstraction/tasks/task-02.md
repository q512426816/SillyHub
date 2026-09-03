---
id: task-02
title: 'ProviderCaps 三端镜像表与守护测试（providers.ts caps + provider_caps.py + provider-caps.ts）'
title_zh: 'ProviderCaps 三端镜像表与守护测试（providers.ts caps + provider_caps.py + provider-caps.ts）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - frontend/src/lib/provider-caps.ts
goal: >
  建立 ProviderCaps 三端镜像表（daemon 单源 + backend/frontend 镜像）与源文件读取式守护测试，
  缺省 false 默认拒绝（FR-06 / D-002@v1 能力门控收敛的表基座）。
implementation:
  - providers.ts（本 task 先建 caps 部分，task-05 再扩注册表）：ProviderCaps 类型（resume/mcp/multimodal/thinking/subagent/permission_dialog/edit_patch/model_select，全 boolean）+ PROVIDER_CAPS 常量（claude/codex 两键；取值以现状硬编码门控逐一对照——session-panel.tsx 附件/派工/resume/vision 门控与 daemon/session/service.py 门控现值）
  - backend/app/modules/agent/provider_caps.py：PROVIDER_CAPS 镜像 dict + get_provider_caps(provider)（未知 provider 返回全 False 默认拒绝，不抛错）
  - frontend/src/lib/provider-caps.ts：镜像常量 + getProviderCaps
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py：源文件读取断言——解析 sillyhub-daemon/src/interactive/providers.ts 与 frontend/src/lib/provider-caps.ts 的表源，比对三端键集合与取值一致（参照 backend/tests/modules/agent/test_tool_kind.py 双端共享用例先例扩展为三端源读）
acceptance:
  - 三端键集合一致且 claude/codex 取值与现状硬编码门控逐一相等
  - 未知 provider 查询返回全 False（默认拒绝），不抛错
  - 守护测试在三端任一漂移时失败
verify:
  - cd backend && python -m pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
constraints:
  - 只建表与查询函数，不改任何门控调用点（收敛归 task-11）
  - daemon 侧表是唯一维护源；测试读源文件比对而非复制值断言
provides:
  - contract: ProviderCaps
    fields: [resume, mcp, multimodal, thinking, subagent, permission_dialog, edit_patch, model_select]
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
