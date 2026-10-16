---
author: flow-machine-draft
created_at: 2026-10-16T07:47:35.533Z
---
# 提案书（Proposal）— 2026-10-16-deploy-convergence-guard

## 动机

任务原话转写：动机：2026-10-16 生产互覆事故——另一会话从分叉分支打包部署，静默回退 main 上已修复的 /data/logs 目录预建（页面日志再次不可见）；多会话各自打包覆盖同一生产，无任何并流校验与部署登记。
成功标准：
- build-and-save.sh 打包前必须校验当前分支为 main（非 main 时告警并需 ALLOW_NON_MAIN_DEPLOY=1 显式放行），并打印将要打包的 commit hash 与分支供留痕
- deploy-to-server skill 必须新增「部署并流校验」节：打包前基于 main 校验、部署后 health commit_sha 与打包一致核对（不一致=被覆盖，附识别与恢复路径）
- skill 中过期的 PROD_API_URL 示例必须更新为当前生产值 https://crrcdt.ppdmq.top

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. build-and-save.sh 打包前必须校验当前分支为 main（非 main 时告警并需 ALLOW_NON_MAIN_DEPLOY=1 显式放行），并打印将要打包的 commit hash 与分支供留痕
2. deploy-to-server skill 必须新增「部署并流校验」节：打包前基于 main 校验、部署后 health commit_sha 与打包一致核对（不一致=被覆盖，附识别与恢复路径）
3. skill 中过期的 PROD_API_URL 示例必须更新为当前生产值 https://crrcdt.ppdmq.top

## 成功标准（可验证）

1. build-and-save.sh 打包前必须校验当前分支为 main（非 main 时告警并需 ALLOW_NON_MAIN_DEPLOY=1 显式放行），并打印将要打包的 commit hash 与分支供留痕
2. deploy-to-server skill 必须新增「部署并流校验」节：打包前基于 main 校验、部署后 health commit_sha 与打包一致核对（不一致=被覆盖，附识别与恢复路径）
3. skill 中过期的 PROD_API_URL 示例必须更新为当前生产值 https://crrcdt.ppdmq.top
