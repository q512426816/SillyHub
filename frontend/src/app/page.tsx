"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useSession } from "@/stores/session";

/**
 * 落地页：登录态自动跳工作区选择器，未登录跳登录页。
 *
 * token 在 localStorage，server 端读不到（design §3 已否决 middleware），
 * 因此用 client component + useEffect + router.replace，
 * 与 (dashboard)/layout.tsx 登录守卫同模式（R-01 一致化）。
 */
export default function HomePage() {
  const router = useRouter();
  const { hydrated, accessToken } = useSession();

  useEffect(() => {
    if (!hydrated) return;
    router.replace(accessToken ? "/workspaces" : "/login");
  }, [hydrated, accessToken, router]);

  // persist 未恢复前不渲染、不跳转，避免首帧误判闪烁（R-01）。
  return null;
}
