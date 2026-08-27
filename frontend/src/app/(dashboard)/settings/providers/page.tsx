"use client";

import Link from "next/link";

import { PageContainer, PageHeader } from "@/components/layout";
import { LlmProviderSection } from "@/components/llm-providers/llm-provider-list";

/**
 * 「我的供应商」独立页面（2026-07-29-sidebar-menu-restructure task-03）。
 *
 * 依据：design.md §5.2 Phase 2、D-002——供应商管理从设置页 Tab 提为独立路由
 * `/settings/providers`，供侧边栏菜单直达（菜单项由 task-02 配置）。
 * 主体复用 LlmProviderSection（列表 + 新建/编辑 + 启动/停止 + 删除），不改该组件。
 */
export default function LlmProvidersPage() {
  return (
    <PageContainer size="full" className="gap-5">
      <PageHeader
        title="我的供应商"
        subtitle={
          <span>
            <Link href="/settings" className="hover:underline">
              设置
            </Link>
            <span className="px-1 text-muted-foreground/60">/</span>
            管理我的模型供应商，配置跟随账号、所有工作空间通用
          </span>
        }
      />

      <LlmProviderSection />
    </PageContainer>
  );
}
