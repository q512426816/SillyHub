---
author: flow-machine-draft
created_at: 2026-10-12T03:20:10.192Z
---
# 提案书（Proposal）— 2026-10-12-ws-ref-hover-tip-portal

## 动机

任务原话转写：悬停浮层翻转修复上线后实测仍不可见：终极根因是页面某祖先带 transform 创建 containing block，position:fixed 相对该祖先而非视口定位（实测 style.top=824 实渲染在 965，偏移 141px），视口坐标系 clamp 全部失效。修复：浮层经 createPortal 挂 document.body（无该祖先，fixed 恢复相对视口）

成功标准：
- 浮层经 portal 挂 document.body，fixed 相对视口定位，坐标零偏移
- 底部空间不足翻转逻辑（上一变更引入）在正确坐标系下生效
- 相关测试全绿（portal 断言同步）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 浮层经 portal 挂 document.body，fixed 相对视口定位，坐标零偏移
2. 底部空间不足翻转逻辑（上一变更引入）在正确坐标系下生效
3. 相关测试全绿（portal 断言同步）

## 成功标准（可验证）

1. 浮层经 portal 挂 document.body，fixed 相对视口定位，坐标零偏移
2. 底部空间不足翻转逻辑（上一变更引入）在正确坐标系下生效
3. 相关测试全绿（portal 断言同步）
