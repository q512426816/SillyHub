---
author: flow-machine-draft
created_at: 2026-10-16T07:50:00.000Z
---
# 需求规格（Requirements）— 2026-10-16-deploy-convergence-guard

## 功能需求

### FR-01: build-and-save.sh 打包前必须校验当前分支为 main（非 main 时告警并需 ALLOW_NON_MAIN_DEPLOY=1 显式放行），并打印将要打包的 commit hash 与分支供留痕

- 必须：脚本在 [0/5] 步校验 `git rev-parse --abbrev-ref HEAD` 为 main；非 main 时必须打印事故背景指引并退出（仅 ALLOW_NON_MAIN_DEPLOY=1 时可放行）；应用目录（backend/frontend/sillyhub-daemon/deploy）有未提交改动时同样退出（ALLOW_DIRTY_DEPLOY=1 放行）；无论哪个分支都必须打印「打包源: 分支 <b> @ <short-sha>」。

#### 场景：主路径

Given 主仓处于 main 分支且应用目录干净
When 执行 build-and-save.sh
Then 必须打印打包源分支与 short-sha 后继续构建

#### 场景：非 main 分支

Given 当前分支不是 main
When 执行 build-and-save.sh 且未设 ALLOW_NON_MAIN_DEPLOY
Then 必须打印「非 main 覆盖部署会回退主线修复」告警并退出（exit 非 0）

### FR-02: deploy-to-server skill 必须新增「部署并流校验」节：打包前基于 main 校验、部署后 health commit_sha 与打包一致核对（不一致=被覆盖，附识别与恢复路径）

- 必须：SKILL.md 的「更新部署」章首必须含「§0 部署并流校验」节，写明：互覆事故背景（2026-10-16）、打包必须基于 main 的铁律与两道闸门、部署后必须核对 health commit_sha、被覆盖的识别与恢复三步（查 sha→main 重打包恢复→发布记录留痕，禁止分支版本就地回滚）。

#### 场景：主路径

Given 部署 agent 阅读 deploy-to-server skill
When 按 skill 执行更新部署
Then 必须能在 §0 看到并执行「打包前 main 校验 + 部署后 commit_sha 核对」两个动作

### FR-03: skill 中过期的 PROD_API_URL 示例必须更新为当前生产值 https://crrcdt.ppdmq.top

- 必须：SKILL.md 打包示例中的 PROD_API_URL 必须为 `https://crrcdt.ppdmq.top`（旧值 http://192.168.0.143:8001 已随服务器迁移失效）；验证节必须含「commit_sha 与打包短 sha 一致」验收条目。

#### 场景：主路径

Given agent 复制 skill 的打包命令
When 执行该命令
Then 前端 build-arg 必须指向 crrcdt.ppdmq.top（而非失效的 192.168.0.143）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：shell 脚本校验段无 pytest 面——实测替代（bash -n 语法通过 + 抽取 [0/5] 段在 main 干净态实跑输出「打包源: 分支 main @ c729e46af」并正确识别脏文件）
FR-02: 不适用：skill 文档（.zcode/skills/deploy-to-server/SKILL.md）无测试面——人工核验 §0 在场且含三要素（事故背景/双闸门/commit_sha 核对）
FR-03: 不适用：同 FR-02 文档面——人工核验 PROD_API_URL=https://crrcdt.ppdmq.top 与验证节 commit_sha 条目在场
