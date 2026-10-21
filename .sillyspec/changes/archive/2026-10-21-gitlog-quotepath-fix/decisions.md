---
author: flow-machine-draft
created_at: 2026-10-21T01:07:25.930Z
---
# 决策记录（Decisions）— 2026-10-21-gitlog-quotepath-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：死路①（已试已弃）：改用 `git show --numstat -z` 按 NUL 切分原文路径——`-z` 在 `git show`（log 族）语境同时是「提交分隔符」语义，与 `--pretty=format:` 混用行为含混，且需重写 numstat 两段式分区解析，相对 `-c core.quotepath=false` + 解码兜底无额外收益，弃。风险①：路径含非法 UTF-8 字节序列时 `Buffer.from(bytes).toString('utf8')` 产生 U+FFFD 替换符——防御性行为可接受（git 真实输出不会出现：路径字节即提交时的合法编码）。风险②：既有命令构造断言用例按 args 位置逐 token 断言（GL25/GL29/GL37/GL42/GL43/GL45），插入 `-c` 对后需同步更新索引——漏更即测试红，已列入 task-01 验证面。风险③：porcelain/diff 加 `quotepath=false` 后含换行的文件名仍被 git 强制引号包裹（控制字符恒转义），单行解析假设不破——decodeGitCQuote 同款规则保证。
