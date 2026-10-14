---
author: flow-machine-draft
created_at: 2026-10-14T04:08:12.184Z
---
# 提案书（Proposal）— 2026-10-14-litellm-retire

## 动机

任务原话转写：litellm 退役拍板（用户 2026-10-14 裁决：彻底退役）：v1.95.0 坏构建坑挂 12 天分叉未拍板，期间上游 tag 内容漂移致本机 plain v1.95.0 容器已 healthy 3 天但未经 docker 侧 gap-A 复测，且当前零供应商经 litellm 路由（GLM/Anthropic/opencode 全直连）——继续保留两个 compose 的僵尸服务定义与常驻容器只增攻击面与运维噪音。退役方式：删服务定义与卷定义（卷数据保留可回滚），本机容器下电，服务器侧清理并入下次部署窗口；坑记录移 finished/ 闭坑。

成功标准：
- deploy/docker-compose.yml 删 litellm、litellm-db 服务块与 litellm-db-data 卷定义，docker compose config 校验通过且 config --services 不再含 litellm 系
- deploy/docker-compose.dev.yml 同款三块删除，config 校验通过
- deploy/litellm-config.yaml 若确认仅 litellm 服务引用则一并删除
- 本机四容器（prod/dev 栈 litellm、litellm-db）stop+rm，命名卷数据保留（可回滚）
- docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 移 finished/ 并补退役闭坑记录（服务器侧清理留待下次部署窗口）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. deploy/docker-compose.yml 删 litellm、litellm-db 服务块与 litellm-db-data 卷定义，docker compose config 校验通过且 config --services 不再含 litellm 系
2. deploy/docker-compose.dev.yml 同款三块删除，config 校验通过
3. deploy/litellm-config.yaml 若确认仅 litellm 服务引用则一并删除
4. 本机四容器（prod/dev 栈 litellm、litellm-db）stop+rm，命名卷数据保留（可回滚）
5. docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 移 finished/ 并补退役闭坑记录（服务器侧清理留待下次部署窗口）

## 成功标准（可验证）

1. deploy/docker-compose.yml 删 litellm、litellm-db 服务块与 litellm-db-data 卷定义，docker compose config 校验通过且 config --services 不再含 litellm 系
2. deploy/docker-compose.dev.yml 同款三块删除，config 校验通过
3. deploy/litellm-config.yaml 若确认仅 litellm 服务引用则一并删除
4. 本机四容器（prod/dev 栈 litellm、litellm-db）stop+rm，命名卷数据保留（可回滚）
5. docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 移 finished/ 并补退役闭坑记录（服务器侧清理留待下次部署窗口）
