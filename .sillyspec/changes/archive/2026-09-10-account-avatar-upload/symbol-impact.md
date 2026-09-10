# 符号影响面报告

> tasks.md 内容指纹（生成时）: 0e4d8ec8d0615c89——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。

- task-01: ORM 模型加列（User.avatar 新增列字段，非方法签名变更）。User 表新增可空列，全部既有 User 构造点（fixture/factory/service）零影响（列有 default=None）；无调用点需改。
- task-02: DTO 还代（UserRead 追加可选字段 avatar——纯增量，from_attributes 透传；新增 UpdateMyAvatarRequest 类——全新类型无既有调用点）。UserRead 消费方（/me、admin users_service 若复用同 DTO）零破坏：可选字段缺省 None。
- task-03: 新增端点 + service 方法（AuthService.update_my_avatar 新方法——新签名无既有调用点；router 新增 PATCH 处理函数——新增路由无覆写）。无既有符号签名被修改。
- task-04: helpers._to_read 返回值内容变化（GroupMemberRead.avatar 字段对 user 成员改为回落值——返回类型不变，字段语义增强）。受影响调用点：_to_read 的全部调用方（群读路径）——均在 daemon/group/service 范围内，行为为纯增量回落（原 NULL 时才填平台头像）。members.py 加/改成员返回点同口径。
- task-05: 接口类型增量（SessionUser 追加可选 avatar——前端类型纯增量，旧对象兼容）；lib/auth.ts 新增导出函数 updateMyAvatar——新符号无既有调用点；fetchMe 内部映射补字段（私有实现细节，签名不变）。
- task-06: 组件 props 增量（GroupMemberAvatarUpload 新增可选 ownerType prop——默认值维持现状，既有两调用方 create-group-wizard/member-panel 零改动）；新增导出常量 USER_AVATAR_OWNER_TYPE——新符号。
- task-07: 无签名级变更（页面组件内部新增卡片 UI，AccountPage 默认导出签名不变）。
- task-08: 无签名级变更（MobileAccountPage 默认导出签名不变，页内头像块改交互）。
- task-09: props 增量（TopBarProps 追加可选 avatar——app-shell.tsx:473 唯一调用点在任务范围内同步接线；不传时行为不变）。
- task-10: 无签名级变更（turn-timeline 组件签名不变，用户气泡传既有 avatar prop）。
- task-11: 无签名级变更（verify 阶段验收，不写产品码）。
