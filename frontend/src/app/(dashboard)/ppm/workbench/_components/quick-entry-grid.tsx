"use client";

/**
 * QuickEntryGrid — 个人工作台快捷入口 (task-11 / FR-11)。
 *
 * 5 按钮 grid(参照原型):
 *  - 问题清单 → /ppm/problem-list(已有路由,router.push 跳转)
 *  - 任务计划 → /ppm/task-plans(已有路由,router.push 跳转)
 *  - 绩效考评 → Toast 提示「绩效考评功能暂未开放」(不跳转 D-007@v1 占位)
 *  - 知识库   → Toast 提示「知识库入口未配置」(平台 knowledge 路由为工作空间级
 *              /workspaces/[id]/knowledge,个人工作台无对应入口,落实后再接)
 *  - 消息通知 → Toast 提示「消息功能开发中」(D-007@v1 占位)
 *
 * 绩效/消息只 Toast 不建后端(D-007@v1,design §3 非目标)。
 */
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/layout";
import { Toast, useToast } from "../../shared";

export function QuickEntryGrid() {
  const router = useRouter();
  const { toast, showToast } = useToast();

  return (
    <SectionCard title="快捷入口" bodyPadding="p-4">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={() => router.push("/ppm/problem-list")}
        >
          问题清单
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push("/ppm/task-plans")}
        >
          任务计划
        </Button>
        <Button
          variant="outline"
          onClick={() => showToast(false, "绩效考评功能暂未开放")}
        >
          绩效考评
        </Button>
        <Button
          variant="outline"
          onClick={() => showToast(false, "知识库入口未配置")}
        >
          知识库
        </Button>
        <Button
          variant="outline"
          onClick={() => showToast(false, "消息功能开发中")}
        >
          消息通知
        </Button>
      </div>
      <div className="mt-2">
        <Toast toast={toast} />
      </div>
    </SectionCard>
  );
}
