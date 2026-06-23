"use client";

import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * ql-20260623-003-7c2e：退出登录二次确认弹窗。
 *
 * 受控渲染：open 由父级（app-shell）持有。两处退出入口（TopBar 用户菜单项 +
 * 侧边栏底部「退出」按钮）统一改为请求打开本弹窗，确认后才执行真正的登出，
 * 避免误触直接登出。基于项目 ui/dialog（radix）实现，不引入第二套弹窗。
 */
export interface LogoutConfirmDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

export function LogoutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: LogoutConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>确认退出登录？</DialogTitle>
          <DialogDescription>
            退出后需要重新登录才能继续使用当前账号。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()}>
            <LogOut className="h-4 w-4" />
            确认退出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
