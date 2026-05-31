---
id: task-05
title: 前端新建变更页 — create/page.tsx 表单
priority: P0
estimated_hours: 1.5
depends_on:
  - task-03
  - task-04
blocks:
  - task-07
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/create/page.tsx
---

# task-05: 前端新建变更页

## 目标

创建 `/workspaces/[id]/changes/create` 页面，提供 Card 布局表单，包含标题输入、需求描述文本域、规模 Radio（大需求/小修改），提交后跳转到变更详情页。

## 操作步骤

### Step 1 — 创建页面文件

新建文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/create/page.tsx`

这是一个 `"use client"` 组件，使用 Next.js App Router 的动态参数。

### Step 2 — 页面结构

```
页面布局:
├── 面包屑: ← 变更列表（链接到 /workspaces/{id}/changes）
├── 标题: "新建变更"
└── Card (rounded-md border bg-card)
    ├── Card Header: "变更信息"
    ├── Card Body (表单)
    │   ├── 标题 Input (必填, min 1 char, max 500 chars)
    │   ├── 需求描述 Textarea (可选, max 5000 chars, 6 行高度)
    │   ├── 规模 Radio Group
    │   │   ├── 🔧 大需求 (scope="full") — 默认选中
    │   │   └── ⚡ 小修改 (scope="quick")
    │   ├── 影响组件 Input (逗号分隔, 可选)
    │   └── 变更类型 Input (可选, 如 feature/bugfix/refactor)
    └── Card Footer
        ├── 提交按钮 (disabled 当 title 为空或 submitting)
        └── 取消按钮 (链接回变更列表)
```

### Step 3 — 核心代码逻辑

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createChange, type CreateChangeInput } from "@/lib/changes";
import { ApiError } from "@/lib/api";

interface Props {
  params: { id: string };
}

export default function CreateChangePage({ params }: Props) {
  const workspaceId = params.id;
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"full" | "quick">("full");
  const [changeType, setChangeType] = useState("");
  const [components, setComponents] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const input: CreateChangeInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        scope,
        change_type: changeType.trim() || undefined,
        affected_components: components.trim()
          ? components.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      };
      const result = await createChange(workspaceId, input);
      // 跳转到变更详情页 (使用 result.id)
      router.push(`/workspaces/${workspaceId}/changes/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建变更失败");
    } finally {
      setSubmitting(false);
    }
  };

  // ... 渲染 JSX
}
```

### Step 4 — 样式规范

- 整体容器: `mx-auto max-w-2xl px-6 py-6`
- Card: `rounded-md border bg-card`
- Card Header: `border-b px-4 py-3`
- Card Body: `px-4 py-4 space-y-4`
- 表单 Label: `text-xs font-medium text-foreground`
- Input/Textarea: `w-full rounded-md border bg-background px-3 py-2 text-sm`
- Radio: 自定义按钮组，选中态 `bg-primary text-primary-foreground`
- 按钮: 使用 `@/components/ui/button` 的 Button 组件

### Step 5 — 验证构建

```bash
cd /Users/qinyi/SillyHub/frontend
npm run build 2>&1 | tail -20
```

确认页面编译成功，无类型错误。

## 完成标准

- [ ] 访问 `/workspaces/{id}/changes/create` 能正确渲染表单页面
- [ ] 标题为必填，其他字段可选
- [ ] 默认 scope 为 "full"，可切换为 "quick"
- [ ] 提交成功后自动跳转到变更详情页 `/workspaces/{id}/changes/{changeId}`
- [ ] 提交失败时显示错误信息
- [ ] 有返回变更列表的导航链接
- [ ] `npm run build` 无错误

## 文件清单

| 文件 | 操作 |
|------|------|
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/create/page.tsx` | 新增 — 变更创建表单页 |
