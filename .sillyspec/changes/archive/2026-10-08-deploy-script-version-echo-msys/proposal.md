---
author: flow-machine-draft
created_at: 2026-10-08T03:29:51.019Z
---
# 提案书（Proposal）— 2026-10-08-deploy-script-version-echo-msys

## 动机

任务原话转写：build-and-save.sh 版本回显在 Git Bash 下查询失败——docker run 裸 /app/... 路径参数被 MSYS 改写成 Windows 路径（C:/Program Files/Git/app/...），改经 sh -c 间接传路径并兼容 version 冒号后无空格形态
成功标准：
- 回显命令经 sh -c 传路径（MSYS 安全），grep 模式兼容 "version": 与 "version":两种形态
- 本地实跑 docker run 回显 3.32.1 成功

## 变更范围

按成功标准机械推导，共 2 条验收面：
1. 回显命令经 sh -c 传路径（MSYS 安全），grep 模式兼容 "version": 与 "version":两种形态
2. 本地实跑 docker run 回显 3.32.1 成功

## 成功标准（可验证）

1. 回显命令经 sh -c 传路径（MSYS 安全），grep 模式兼容 "version": 与 "version":两种形态
2. 本地实跑 docker run 回显 3.32.1 成功
