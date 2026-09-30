---
author: flow-machine-draft
created_at: 2026-09-30T06:59:16.539Z
---
# 提案书（Proposal）— 2026-09-30-takeover-tier3-ambiguous-msg

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:dc59b3c3afa35085d619d92351aacb8d1aeda74e79e4c696d87ec01eea568f96:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
任务原话转写：真机验收发现 takeover ③级（allowed_roots）多机命中时 409 文案只显示「（未知机器）」——存量上报无机器身份场景完全不可诊断，用户不知道哪台机器命中、该清哪台配置。修复：歧义/无命中时把命中机器名列表（daemon_runtimes.name 去重）拼进中文文案与 details（machine_candidates），并把指引改为「多台机器的工作目录白名单均覆盖该路径时，请清理非本机路径的 allowed_roots 配置后重试」。
成功标准：
- takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
- 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
- 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:f01b55169145919fb4c2f5528a0a64aa9ae7c434ffe69292c522a3f27d003425:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
按成功标准机械推导，共 3 条验收面：
1. takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
2. 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
3. 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:6eb2379a8dfc96d9f9ae296b9c2e5cf2f96ce5cb58aba423aaa2b45ceac507d5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-tier3-ambiguous-msg 留痕重锚 -->
1. takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
2. 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
3. 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
