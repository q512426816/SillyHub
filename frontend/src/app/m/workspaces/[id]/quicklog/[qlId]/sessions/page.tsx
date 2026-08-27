"use client";

/**
 * task-10（X-02 深链兜底 / FR-10 / design §9.4）：
 * 桌面 quicklog 级会话门户 `/workspaces/[id]/quicklog/[qlId]/sessions`
 * 手机访问被 middleware rewrite 到本路径（/m/ 段）——移动端无 quicklog 级
 * 会话页，本页是 redirect 薄壳，兜底重定向到全工作区会话列表，不落 404。
 *
 * - 零数据请求、零 UI 渲染（渲染 null）；上层 task-02 layout 的预取属
 *   路由嵌套副作用，不在此处理。
 * - 不消费 qlId（scope 丢失可接受，design §9.4——手机端会话列表本身就是
 *   全工作区视图）。
 * - 形态对齐 m/ 段既有 client redirect（m/login / m/account 均
 *   useRouter().replace；本段无 server redirect 先例）。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  params: { id: string; qlId: string };
}

export default function QuicklogSessionsFallbackPage({ params }: Props) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/m/workspaces/${params.id}/sessions`);
  }, [router, params.id]);

  return null;
}
