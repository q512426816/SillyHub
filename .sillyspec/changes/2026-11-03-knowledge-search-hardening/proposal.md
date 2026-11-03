---
author: flow-machine-draft
created_at: 2026-11-03T01:27:47.446Z
---
# 提案书（Proposal）— 2026-11-03-knowledge-search-hardening

## 动机

任务原话转写：知识搜索止血：内存扩容、同步时间戳与文案修正

生产实证（2026-11-03 服务器诊断）：backend 容器 2500m 限额下嵌入/翻译 worker 仍周期性被 cgroup OOM kill（10 月 40 次、11-02 还有 2 次），打断知识索引差量同步；KnowledgeSearchState.updated_at 缺 onupdate，同步成功也恒显示建行时间（本次排障被误导）；前端搜索等待文案「首次搜索需建立索引」在每次慢搜索都显示，属误导，降级徽标对 index_not_built 场景文案亦不准确。

成功标准：
- deploy/docker-compose.yml backend mem_limit 为 3500m，注释记录依据
- 差量同步成功后 knowledge_search_state.updated_at 刷新（新增测试断言，既有知识搜索测试全绿）
- 搜索等待文案不再出现「首次搜索需建立索引」误导表述；model_ready=false 且 reason=index_not_built 时徽标提示索引未预建
- 纯配置与前端文案不写测试（记不适用理由）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. deploy/docker-compose.yml backend mem_limit 为 3500m，注释记录依据
2. 差量同步成功后 knowledge_search_state.updated_at 刷新（新增测试断言，既有知识搜索测试全绿）
3. 搜索等待文案不再出现「首次搜索需建立索引」误导表述；model_ready=false 且 reason=index_not_built 时徽标提示索引未预建
4. 纯配置与前端文案不写测试（记不适用理由）

## 成功标准（可验证）

1. deploy/docker-compose.yml backend mem_limit 为 3500m，注释记录依据
2. 差量同步成功后 knowledge_search_state.updated_at 刷新（新增测试断言，既有知识搜索测试全绿）
3. 搜索等待文案不再出现「首次搜索需建立索引」误导表述；model_ready=false 且 reason=index_not_built 时徽标提示索引未预建
4. 纯配置与前端文案不写测试（记不适用理由）
