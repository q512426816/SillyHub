---
author: flow-machine-draft
created_at: 2026-10-08T01:32:28.964Z
---
# 任务注册表（Tasks）— 2026-10-08-backend-dockerfile-apt-mirror-sjtu

- [x] task-01: sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化 ✅ Dockerfile runtime 3/17 已改（两条 -e 覆盖 http/https 源形态 + 注释补实测数据），install 行逐字未动
- [x] task-02: backend 镜像本地构建通过（apt 层完成即验证），部署链可继续——验证：改动前同命令两次失败，改动后构建产出 images.tar.gz ✅ 实测 apt 层 Fetched 10.2MB in 6s (1578 kB/s)，backend+frontend 双镜像构建成功，images.tar.gz 362M 落盘
- [x] task-03: Dockerfile 改动以显式 pathspec 提交并在本变更内收口——验证：git log 带 task-NN 的提交 + flow done 归档回执 ✅ 提交已落（backend/Dockerfile + 变更目录，task-01 task-02 证据）
