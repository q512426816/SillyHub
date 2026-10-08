---
author: flow-machine-draft
created_at: 2026-10-08T01:32:28.963Z
---
# 提案书（Proposal）— 2026-10-08-backend-dockerfile-apt-mirror-sjtu

## 动机

任务原话转写：backend Dockerfile 的 apt 层换源：tuna 当前对 trixie main Packages 大文件持续 500/502/EOF（连续两次构建重试失败），实测唯一稳定快路是 https://mirror.sjtu.edu.cn（8MB/5s 复测稳定；http 形态同样慢，须连协议一起换 https）
成功标准：
- sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化
- backend 镜像本地构建通过（apt 层完成即验证），部署链可继续
- Dockerfile 改动以显式 pathspec 提交并在本变更内收口

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化
2. backend 镜像本地构建通过（apt 层完成即验证），部署链可继续
3. Dockerfile 改动以显式 pathspec 提交并在本变更内收口

## 成功标准（可验证）

1. sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化
2. backend 镜像本地构建通过（apt 层完成即验证），部署链可继续
3. Dockerfile 改动以显式 pathspec 提交并在本变更内收口
