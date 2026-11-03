---
author: flow-machine-draft
created_at: 2026-11-03T03:04:22.286Z
---
# 任务注册表（Tasks）— 2026-11-03-distill-prompt-fix

- [x] task-01: 测试先行——更新 test_distill.py 的 test_build_distill_prompt_spec_dir_propose_guidance（单引号 body/--from/核验回落/回流确认段/查重枚举断言 + 「自动上行」「无需你手动同步」反断言 + legacy 公共段）与 test_build_distill_prompt_resume_variant（摘要兜底句），跑该文件确认新断言按预期红
- [x] task-02: 改 distill.py build_distill_prompt 模板——resume 句补摘要兜底、propose_cmd 换单引号 body 加 --from、spec_note 改 ls 核验回落文样并删失实表述、提炼要求补查重/幂等/宁缺毋滥条、新增公共传参规则与回流确认段，跑 test_distill.py 全绿
- [x] task-03: 回归面——backend 知识蒸馏测试套件全量跑绿（test_distill.py 全部用例），确认 spec_dir=None 旧形零回归
