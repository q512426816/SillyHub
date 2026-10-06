---
id: task-05
title: '门控链——capability.py model_name 入参 + 三态×列表判定 + 未命中保守 false + attachments/shadow/attachment_pipeline 两调用链透传'
title_zh: '门控链——capability.py model_name 入参 + 三态×列表判定 + 未命中保守 false + attachments/shadow/attachment_pipeline 两调用链透传'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 21:36:44
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-02]
decision_ids: []  # (预填源未就绪：plan 阶段后跑 prefill-refresh)
allowed_paths:
  - backend/app/modules/session_attachment/
  - backend/app/modules/daemon/attachment_pipeline.py
  - backend/app/modules/daemon/group/service/shadow.py
  - backend/app/modules/daemon/session/service/attachments.py
target_files:
  - backend/app/modules/session_attachment/capability.py
  - backend/app/modules/daemon/attachment_pipeline.py
  - backend/app/modules/daemon/group/service/shadow.py
  - backend/app/modules/daemon/session/service/attachments.py
goal: >
  多模态门控从供应商级三态下沉到模型条目级（D-003/FR-02，Grill P1-3）：capability.py
  resolve_gate 新增 model_name 入参（缺省 None 向后兼容），按「生效模型 ∈ provider.models
  条目」三态判定；单聊链与群聊链两级调用方透传各会话生效模型；未命中保守 false。
implementation:
  - backend/app/modules/session_attachment/capability.py resolve_gate（:67-80）签名新增 keyword-only 入参 model_name（str 或 None，缺省 None，R-07 向后兼容）：provider 为 None → 保守 false 不变；model_name 在 provider.models 条目 name 集内命中 → 按该条目 multimodal 三态判定（true 直判支持 / false 直判不支持 / auto 走 supports_multimodal_by_model_name(model_name) 启发式）；未命中或 model_name 为 None → 保守 false（对齐本机凭证「模型未知保守不支持」语义，R-03 存量会话双防线之一）
  - 删除旧 provider.multimodal 供应商级读取（:71-74）；模块 docstring 判定链说明同步改写（门控粒度 = 条目标记）
  - resolve_session_gate（:83-122）签名同步加 model_name 入参（缺省 None）并透传给 resolve_gate
  - backend/app/modules/daemon/attachment_pipeline.py resolve_multimodal_gate（:95-101）签名加 model_name（缺省 None）透传 resolve_session_gate
  - 单聊链 backend/app/modules/daemon/session/service/attachments.py 两处调用（:106-108 与 :274-284）传会话生效模型：取该组装点已算的 effective_model 口径（会话快照所选 ?? 主模型派生），与注入链同源
  - 群聊链 backend/app/modules/daemon/group/service/shadow.py（:788-792）透传各成员会话模型（成员六要素基准，各成员各自判定）
  - attachments.py:440-446 provider_config 两键覆写段（会话所选同时覆写 model 与 default_fallback_model）行为零变化——本卡该文件只动门控调用的传参，不动覆写段
acceptance:
  - 三态×列表判定：条目 multimodal 为 true / false 直判；auto 走模型名启发式；生效模型不在列表（如会话选了后来删掉的模型）→ 保守 false；model_name 缺省 None → 保守 false（签名向后兼容）
  - 单聊链与群聊链均透传各自会话生效模型（grep resolve_multimodal_gate 调用点全部带 model_name 实参）
  - capability.py 无 provider.multimodal 旧列读残留；缺省 None 的旧式调用不报错（三层签名向后兼容）
  - 附件降级行为不变：不支持时图片/PDF 走文件落盘降级（turn 不失败），仅判定来源从供应商级切条目级
verify:
  - cd backend && uv run pytest app/modules/session_attachment/tests/test_capability.py -q --no-cov（存量用例红属预期，三态×列表新用例归 task-07）
  - grep -n "resolve_multimodal_gate\|resolve_session_gate\|resolve_gate" backend/app/modules/session_attachment/capability.py backend/app/modules/daemon/attachment_pipeline.py backend/app/modules/daemon/session/service/attachments.py backend/app/modules/daemon/group/service/shadow.py（人工核对调用点全带 model_name）
  - grep -n "\.multimodal" backend/app/modules/session_attachment/capability.py（期望零命中）
constraints:
  - MUST NOT 改 sillyhub-daemon 仓任何文件
  - 门控未命中模型名 MUST 保守 false（全局硬约束）；MUST NOT 删除或改写 supports_multimodal_by_model_name 启发式表（auto 态沿用同一函数，行为不变面）
  - model_name 入参 MUST 缺省 None 保持三层签名向后兼容（R-07：capability 两层 + attachment_pipeline 一层）
  - MUST NOT 动 attachments.py 的 provider_config 覆写段与快照同步逻辑（归 task-04/06 口径）；MUST NOT 动 context.py（task-04）
  - 本卡不修测试不新增测试（门控三态×命中×群聊链用例归 task-07）；禁止跑全量测试（规则 0）
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
