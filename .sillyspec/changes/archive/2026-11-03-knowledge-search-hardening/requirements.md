---
author: flow-machine-draft
created_at: 2026-11-03T01:27:47.446Z
---
# 需求规格（Requirements）— 2026-11-03-knowledge-search-hardening

## 功能需求

### FR-01: deploy/docker-compose.yml backend mem_limit 为 3500m，注释记录依据

- backend 服务 `mem_limit` 必须从 2500m 提到 3500m，且该行上方注释必须记录升档依据（2026-11-03 生产诊断：10 月 40 次、11-02 2 次 worker cgroup OOM kill；2500m 对「服务本体 ~460M + 嵌入/翻译双 worker 并存 ~2.1G」峰值偏紧）。禁止改动其他服务限额与 oom_score_adj 保护。

#### 场景：主路径

- Given deploy/docker-compose.yml，When 查看 backend 服务资源配置，Then `mem_limit: 3500m` 且注释含 OOM 证据与日期；其余服务（frontend 300m / minio 128m / redis 64m / postgres 256m）不变。

#### 场景：生产生效

- Given 生产服务器更新后的 compose，When `docker inspect` backend 容器，Then `HostConfig.Memory` = 3670016000（3500m）且容器 healthy。

### FR-02: 差量同步成功后 knowledge_search_state.updated_at 刷新（新增测试断言，既有知识搜索测试全绿）

- 懒同步成功落库（全量或差量）后，`knowledge_search_state.updated_at` 必须刷新为该次同步时刻（ORM onupdate，客户端侧行为，schema 不变、无迁移）；指纹一致的快路径禁止产生 UPDATE（updated_at 保持不变）。`updated_at` 因此成为可观测的「索引最后同步时刻」。

#### 场景：差量同步刷新

- Given 工作区已建索引，When 语料文件内容变化后再次搜索（触发差量同步成功），Then state 行 `updated_at` 晚于首次建索引时刻。

#### 场景：快路径不写

- Given 指纹一致（语料未变），When 再次搜索，Then `updated_at` 不变（无谓写禁止，行为与现快路径一致）。

### FR-03: 搜索等待文案不再出现「首次搜索需建立索引」误导表述；model_ready=false 且 reason=index_not_built 时徽标提示索引未预建

- 知识搜索等待提示禁止再出现「首次搜索需建立索引」表述，必须改为与真实机制一致的「知识库有新变更时需先增量同步，可能较慢」类文案；`model_ready=false` 且 `reason=index_not_built` 时降级徽标必须提示「索引未预建」而非「语义模型暂不可用」（其余不可用原因保留原语义文案）。组件结构与 data-testid 不变。

#### 场景：等待文案

- Given 用户输入搜索词且结果未返回，When 等待提示渲染，Then 文案为增量同步口径、不含「首次搜索需建立索引」。

#### 场景：索引未建徽标

- Given 响应 `model_ready=false` 且 `reason=index_not_built`，When 徽标渲染，Then 文案提示知识索引未预建、当前为关键词匹配。

#### 场景：模型不可用徽标

- Given 响应 `model_ready=false` 且 reason 非 index_not_built（嵌入模型不可用/崩溃退避），When 徽标渲染，Then 保留「语义模型暂不可用」口径。

### FR-04: 纯配置与前端文案不写测试（记不适用理由）

- FR-01（部署配置）与 FR-03（前端展示文案）禁止新增自动化测试，其「不适用」裁决必须记录于本文件测试绑定节；FR-02（后端行为契约）必须由自动化测试覆盖。

#### 场景：裁决在案

- Given 本变更测试绑定节，When 审阅，Then FR-01/FR-03/FR-04 各有一行「不适用：理由」，FR-02 绑定真实测试路径。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯部署配置变更，验收=生产 `docker inspect` 限额复核（发布记录留证），自动化测试无意义
FR-02: backend/app/modules/knowledge/tests/test_knowledge_search.py「test_state_updated_at_refreshes_after_delta_sync_and_frozen_on_fast_path」
FR-03: 不适用：纯前端展示文案（AGENTS.md 规则 3 视觉样式与文案不写测试），验收=源码目检 + 前端 typecheck/lint 通过
FR-04: 不适用：本条即测试适用性裁决记录本身，裁决内容落在上面三行
