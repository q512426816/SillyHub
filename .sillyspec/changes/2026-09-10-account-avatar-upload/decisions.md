---
author: qinyi
created_at: 2026-09-10 18:55:18
---

# 决策记录 — 2026-09-10-account-avatar-upload

## D-001：头像存储复用文件中心
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 头像图片的存储与服务方式？
- answer: 用户选定方案 A（对比过 B 独立公开头像服务 / C base64 存 DB，均否决——B 隐私面扩大且并行两套体系，C DB 膨胀接口放大）。`users.avatar` 存文件中心 URL（`/api/file/{id}`，String 512 nullable），上传走现有 `POST /api/file/upload`（owner_type=`user_avatar`），与 agent/群成员头像同构。
- normalized_requirement: users.avatar 列 String(512) nullable；头像文件经文件中心上传，owner_type="user_avatar"；前端渲染复用 useAvatarSrc（blob 拉取）。
- impacts: [FR-1, FR-2, task-后端迁移, task-前端上传]
- evidence: 方案选择轮次（AskUserQuestion 2026-09-10）；`app/modules/file/router.py`（上传端点）、`frontend/src/components/chat/use-avatar-src.ts`（渲染管线）、`app/modules/agent/model.py:1442`（agent avatar 同构先例）

## D-002：群聊用户成员头像后端回落解析
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 群聊中用户成员的头像如何取值（群内 avatar 列与平台 users.avatar 的关系）？
- answer: 后端读取群成员时解析 effective avatar：`member.avatar or (user 成员 ? user.avatar : null)`。群内自定义优先；member.avatar 为 NULL/空串（清除语义）时回落平台用户头像。
- normalized_requirement: GroupMemberRead.avatar 返回 `member.avatar or user.avatar`（仅 user 成员），agent 成员维持现状；前端零改动即生效。
- impacts: [FR-4, task-群聊回落]
- evidence: `app/modules/agent/model.py` AgentGroupMember.avatar 注释（NULL=未自定义回退首字）；quick 群头像 None=不改、空串=清除语义；Grill 复核构造点：`app/modules/daemon/group/service/helpers.py:701`（_to_read 主路径）、`members.py:512/673`、`router.py:379/407`（复用 service 构造）
- 锚点: backend/app/modules/daemon/group/service/helpers.py:701
- 模块域: backend, frontend

## D-003：PPM 个人工作台头像维持首字占位
- type: boundary
- priority: P2
- status: accepted
- source: user
- question: PPM 模块已上线，其个人工作台 WorkbenchProfile.avatar_text 是否也换成头像图？
- answer: 不动。PPM 已上线模块，超出本次「个人中心头像替换」范围，WorkbenchProfile 维持 avatar_text 首字占位。记为非目标，后续需要再单独立变更。
- normalized_requirement: PPM workbench 前后端零改动。
- impacts: [非目标清单]
- evidence: `frontend/src/lib/api-types.ts` WorkbenchProfile.avatar_text；用户确认展示范围为个人中心+顶栏+群聊
