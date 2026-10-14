---
author: flow-machine-draft
created_at: 2026-10-14T07:11:17.875Z
---
# 需求规格（Requirements）— 2026-10-14-release-notes-server-sync

## 功能需求

### FR-01: 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）

服务器**必须**存在固定镜像目录 `/tmp/sillyhub-repos/multi-agent-platform/docs/releases/`——经既有 `/tmp`→`/host-projects` 挂载对后端容器可读，作为服务器侧发布记录唯一数据源。

#### 场景：主路径

- Given 镜像目录含合规发布记录 md
- When 后端容器内 DeployRecordService._iter_files 以 `/host-projects/sillyhub-repos/multi-agent-platform` 扫描
- Then 解析出记录（invalid=False、meta 字段齐）

#### 场景：目录被清（/tmp 重启清空）

- Given 服务器重启后 /tmp 目录被清
- When 部署流程再次执行同步步骤
- Then 目录重建并全量重传自愈（每次部署全量 scp，不依赖旧文件留存）

### FR-02: workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）

平台数据库**必须**存在 workspace 行「multi-agent-platform-镜像」且其 root_path **必须**指向 `/tmp/sillyhub-repos/multi-agent-platform`，使 GET /api/deploy-records 聚合到该目录下的发布记录并在 /deploy-records 页面完整展示（seq/状态徽标/提交数/md 正文渲染数据齐）。

#### 场景：主路径

- Given workspace 行指向镜像目录且目录含记录
- When 持权用户打开 /deploy-records
- Then 列表按 deployed_at 倒序展示记录（seq/状态/提交数），点开渲染 md 正文

### FR-03: deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令

部署 agent 执行 deploy-to-server 流程时**必须**在收尾前完成发布记录写入与服务器同步两步：记录 md **必须**遵守 sillyhub-docker-deploy「发布记录」节的 frontmatter 契约（seq/deployed_at/status/commit_from/commit_to/summary/agent/commits），且**必须**经 scp 全量同步到 `/tmp/sillyhub-repos/multi-agent-platform/docs/releases/`。

#### 场景：主路径

- Given 部署验证通过（或明确失败）
- When agent 走 deploy-to-server 收尾
- Then docs/releases/ 出现合规新 md，且服务器镜像目录同步后平台 /deploy-records 可列出该记录

#### 场景：跳过同步

- Given agent 未执行同步步骤
- When 服务器平台拉取发布记录
- Then 服务器页面看不到本次部署记录（漏同步不阻断部署本身，与 R-01 口径一致）

### FR-04: 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链

本变更交付**必须**包含 2dba363c8→a176393cb 热修部署的记录 #002，且服务器平台**必须**能列出 #001 与 #002 两条记录（seq/status/commits_count/正文齐全）。

#### 场景：主路径

- Given 服务器镜像目录同步了两条记录、workspace「multi-agent-platform-镜像」指向它
- When 后端 list_records / get_record 执行
- Then 返回 seq=2（2 commits，发布页可达性热修）与 seq=1（11 commits，功能上线）两行，正文 md 完整

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：服务器运维态目录（/tmp 挂载），无代码面；实测证据=容器 _iter_files 解析双记录成功
FR-02: 不适用：DB 行+服务器实测；解析面由 backend/app/modules/deploy_records/tests/test_service.py 既有 9 用例承载（本变零后端代码）
FR-03: 不适用：纯 skill 文档改动（deploy-to-server SKILL.md），无代码测试面
FR-04: 不适用：部署运营动作；实测证据=服务器 list_records 返回 seq1(11 commits)+seq2(2 commits) 双记录
