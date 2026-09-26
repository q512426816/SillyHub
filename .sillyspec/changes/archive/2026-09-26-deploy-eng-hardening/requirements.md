---
author: flow-machine-draft
created_at: 2026-09-25T23:44:30.315Z
---
# 需求规格（Requirements）— 2026-09-26-deploy-eng-hardening

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
### FR-01: health 回显真实提交

- Given：build-and-save.sh 构建镜像（COMMIT_SHA 兜底 git rev-parse）
- When：部署后 GET /api/health
- Then：commit_sha 回显构建提交（镜像 ENV 不再被运行时空串覆盖）

### FR-02: build 提示目录正确

- Given：build-and-save.sh 完成
- When：读尾部提示
- Then：scp/ssh 目标是双层活跃目录 /opt/sillyhub/deploy/deploy/

### FR-03: backup 自动保留窗

- Given：load-and-up.sh 执行
- When：backup tag 超过 4 个/镜像
- Then：更旧的被 rmi；失败容错不中断部署

### FR-04: gen 并行会话守卫

- Given：openapi.json 或 api-types.ts 有未提交改动
- When：pnpm gen:types
- Then：中止并提示处置（--force 跳过）；干净树照常生成

### FR-05: git 竞态重试

- Given：git 写操作撞 index.lock
- When：scripts/git-safe.sh 包装执行
- Then：2s 间隔重试至超时（默认 30s）；非锁错误原样透传

### FR-06: 语法与本地可验

- Given：三个 shell 脚本与一个 node 脚本
- When：bash -n / 实测
- Then：语法零错；gen 守卫脏树拦截/干净树通过双态实测；git-safe 锁模拟重试成功

## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
本地验证：构建链 COMMIT_SHA 兜底（build-and-save.sh:33）+ compose 删覆盖（docker-compose.yml diff）——部署后生产 /api/health 实证留后续


<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
bash -n deploy/scripts/build-and-save.sh + 提示区 diff 审读


<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
bash -n deploy/scripts/load-and-up.sh + 保留窗逻辑审读（while read 管道逐 tag rmi）


<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/scripts/gen-api-types.mjs 守卫：脏 backend/openapi.json 实测中止（exit 1 + 提示）+ 干净树实测通过（done 输出）


<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
scripts/git-safe.sh：touch .git/index.lock 模拟竞态重试 + 清锁后成功 + bash -n 语法


<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
全部脚本 bash -n 通过（build-and-save/load-and-up/git-safe）；gen 守卫双态实测回执见提交信息


<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
全部脚本 bash -n 通过（build-and-save/load-and-up/git-safe）；gen 守卫双态实测回执见提交信息


<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
全部脚本 bash -n 通过（build-and-save/load-and-up/git-safe）；gen 守卫双态实测回执见提交信息


<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
全部脚本 bash -n 通过（build-and-save/load-and-up/git-safe）；gen 守卫双态实测回执见提交信息

