---
author: flow-machine-draft
created_at: 2026-10-08T01:32:28.964Z
---
# 需求规格（Requirements）— 2026-10-08-backend-dockerfile-apt-mirror-sjtu

## 功能需求

### FR-01: sed 换源改为 https://mirror.sjtu.edu.cn（连协议一起换），安装的包集合与语义零变化

- backend Dockerfile runtime 层的 apt 源替换**必须**由 `s|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g`（保留 http）改为把 `http(s)://deb.debian.org` 整体替换为 `https://mirror.sjtu.edu.cn`（sjtu 仅 https 形态快，实测 http 同慢）；`apt-get install` 的包集合（curl ca-certificates git libstdc++6）与安装参数**禁止**任何变化。

#### 场景：换源不改语义

- Given：tuna 对 trixie main Packages（9.6MB）持续 500/502/EOF，连续两次构建失败；实测 https://mirror.sjtu.edu.cn 8MB/5s 稳定
- When：按本变更 sed 后重建 backend 镜像
- Then：apt 层完成，安装产物仍是且仅是 curl ca-certificates git libstdc++6

### FR-02: backend 镜像本地构建通过（apt 层完成即验证），部署链可继续

- 换源后 backend 镜像本地构建**必须**通过（`deploy/scripts/build-and-save.sh` 全流程产出 images.tar.gz）；本变更为部署阻塞清障，构建通过即交付验证。

#### 场景：构建即验证

- Given：改动前同命令构建两次均死于 backend runtime 3/17 apt 层
- When：仅改源后重跑同一构建命令
- Then：backend + frontend 两镜像构建成功并落 tar 包

### FR-03: Dockerfile 改动以显式 pathspec 提交并在本变更内收口

- Dockerfile 改动**必须**以显式 pathspec 提交（commit 消息带 task 编号）并 flow done 收口归档，不留未登记的工作区改动。

#### 场景：收口

- Given：构建通过
- When：git add -- backend/Dockerfile + 变更目录 → commit → flow done
- Then：变更归档注销，工作区无本变更遗留

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：Dockerfile sed 换源无可执行的 pytest/vitest 断言面；验证方式为构建期实测（apt 层完成）+ diff 语义对照（包集合与参数行逐字未动）
FR-02: deploy/scripts/build-and-save.sh「backend+frontend 镜像构建成功产出 images.tar.gz」（构建即验证：改动前同命令两次失败、改动后通过）
FR-03: git log「commit 含 backend/Dockerfile 与本变更目录（task-NN 证据）+ flow done 归档回执」
