---
author: flow-machine-draft
created_at: 2026-10-28T02:46:17.808Z
---
# 任务注册表（Tasks）— 2026-10-28-release-record-generator

- [x] task-01: 实现 gen-release-record.sh 生成模式——seq 复用取号器/NNN 当天序号/锚点推导/commits 引号转义/frontmatter+正文骨架/临时文件自检后 mv/--dry-run 不落盘；验证=dry-run 输出 seq=50、锚=ce842447d、成对 ---、8 字段齐且目录无新文件
- [x] task-02: 实现 --validate 模式与 --dir 覆盖；验证=沙箱放一份单 --- 坏件 fixture，validate 点名坏件退出码 1，好件全绿退出码 0
- [x] task-03: 沙箱真实生成全链验证——--dir 沙箱生成产物逐字段核对（8 字段/成对标记/commits 转义/三段防漏指引输出），并对真目录 docs/releases 跑 --validate 应全绿（62 件含本变更前修复件）
- [x] task-04: 双 skill 发布记录节挂接生成器推荐（deploy-to-server 写记录步骤改推荐生成器；sillyhub-docker-deploy 同步提及）；验证=grep 两 skill 含 gen-release-record.sh 引用
