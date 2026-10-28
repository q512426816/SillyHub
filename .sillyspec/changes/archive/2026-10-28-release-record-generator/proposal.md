---
author: flow-machine-draft
created_at: 2026-10-28T02:46:17.808Z
---
# 提案书（Proposal）— 2026-10-28-release-record-generator

## 动机

任务原话转写：发布记录生成器脚本取号锚点与校验
动机：发布记录两起页面不可见事故同源——手拼 frontmatter 漏闭合标记（seq49 与 10-25 两份），且取号/锚点靠手工多源拼接易错；deploy-to-server skill 已有多处口径（取号器单一源、锚点取法、镜像同步命令）。把生成收口成一个脚本：产出即合规、锚点自动推导、校验可扫历史，输出附带同步指引防漏步。

成功标准：
- 脚本执行后产出 docs/releases/YYYY-MM-DD-<当天序号>-<HEAD短sha>.md，frontmatter 成对 --- 标记 + 8 字段齐备，seq 取自 deploy/scripts/next-release-seq.sh（全局序号），平台解析口径可判 valid
- commit_from 锚点自动取本地最大 seq 记录的 commit_to（无记录写 null），调用方无需手工提供
- 生成后自检失败即非零退出不落半成品；--validate 模式扫描既有记录报告坏文件（支持 --dir 指定目录便于沙箱验证）
- 输出末尾打印镜像目录同步 scp 命令与提交 pathspec 提醒（防漏同步步骤）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 脚本执行后产出 docs/releases/YYYY-MM-DD-<当天序号>-<HEAD短sha>.md，frontmatter 成对 --- 标记 + 8 字段齐备，seq 取自 deploy/scripts/next-release-seq.sh（全局序号），平台解析口径可判 valid
2. commit_from 锚点自动取本地最大 seq 记录的 commit_to（无记录写 null），调用方无需手工提供
3. 生成后自检失败即非零退出不落半成品；--validate 模式扫描既有记录报告坏文件（支持 --dir 指定目录便于沙箱验证）
4. 输出末尾打印镜像目录同步 scp 命令与提交 pathspec 提醒（防漏同步步骤）

## 成功标准（可验证）

1. 脚本执行后产出 docs/releases/YYYY-MM-DD-<当天序号>-<HEAD短sha>.md，frontmatter 成对 --- 标记 + 8 字段齐备，seq 取自 deploy/scripts/next-release-seq.sh（全局序号），平台解析口径可判 valid
2. commit_from 锚点自动取本地最大 seq 记录的 commit_to（无记录写 null），调用方无需手工提供
3. 生成后自检失败即非零退出不落半成品；--validate 模式扫描既有记录报告坏文件（支持 --dir 指定目录便于沙箱验证）
4. 输出末尾打印镜像目录同步 scp 命令与提交 pathspec 提醒（防漏同步步骤）
