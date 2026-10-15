---
id: task-06
title: '群附件门控 caps 口径统一——messages.py:791-797 改 get_provider_caps 判定 + NEW test_group_attachment_gate.py（claude/pi/cursor/dsh 放行、codex/未知拒）（FR-07，R-03）'
title_zh: '群附件门控 caps 口径统一——messages.py:791-797 改 get_provider_caps 判定 + NEW test_group_attachment_gate.py（claude/pi/cursor/dsh 放行、codex/未知拒）（FR-07，R-03）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/group/service/messages.py
  - backend/app/modules/daemon/group/service/shadow.py
  - backend/app/modules/daemon/tests/test_group_attachment_gate.py
  - backend/app/modules/daemon/tests/test_group_p2.py
target_files:
  - backend/app/modules/daemon/group/service/messages.py
  - backend/app/modules/daemon/group/service/shadow.py
  - NEW:backend/app/modules/daemon/tests/test_group_attachment_gate.py
goal: >
  群附件门控口径统一（发送侧 + 触发侧两处同款债）：messages.py:791-797 与 shadow.py:266-273 的硬编码"仅 claude"都改为 caps.attachments 判定，与单聊 attachments.py:59 对齐（pi/cursor 群附件从拒变放为有意行为变化，R-03；只改一侧会造成"发送放行、触发被拒"的半兑现——plan 审查 gap 修正）。
implementation:
  - backend/app/modules/daemon/group/service/messages.py:791-797 附件门控分支改为 get_provider_caps(provider)["attachments"] 判定（导入与单聊 backend/app/modules/daemon/session/service/attachments.py:59 同源），错误文案随口径调整（不再写"仅 Claude"）
  - backend/app/modules/daemon/group/service/shadow.py:266-273 触发侧同款 claude-only 附件门控（非 Claude 成员带附件触发 → 400）同样改为 caps.attachments 判定——两处同口径统一，防半兑现
  - 新建 backend/app/modules/daemon/tests/test_group_attachment_gate.py：参数化逐引擎断言发送侧与触发侧——claude/pi/cursor/dsh 放行，codex 与未知引擎拒绝（未知引擎走 get_provider_caps 默认拒绝对象）
acceptance:
  - 发送侧与触发侧门控判定均与 caps.attachments 完全一致（六种 provider 形态 × 两侧参数化钉死）
  - 既有群消息测试零回归
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_attachment_gate.py app/modules/daemon/tests/test_group_p2.py --no-cov
constraints:
  - 不动单聊附件管线（attachments.py 已是 caps 口径）；dsh 放行依赖 task-04 的镜像刷新（本 task 用对齐测试守护）
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
