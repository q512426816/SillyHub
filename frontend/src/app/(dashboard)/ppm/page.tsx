import { redirect } from "next/navigation";

/**
 * ppm 模块首页。
 *
 * 设计依据：ppm 与主平台菜单完全隔离（app-shell.tsx 按 /ppm 前缀过滤 section），
 * /ppm 本身不渲染概览，直接重定向到 ppm 默认入口 /ppm/workbench（个人工作台），
 * 避免用户落到空页。
 */
export default function PpmIndexPage() {
  redirect("/ppm/workbench");
}
