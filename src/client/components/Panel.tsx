import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

export function Panel({
  title,
  description,
  children,
  pauseRefresh = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  pauseRefresh?: boolean;
}) {
  return (
    <Card
      data-refresh-paused={pauseRefresh ? "true" : undefined}
      className="min-w-0 gap-4 rounded-xl py-4 shadow-none"
    >
      <CardHeader className="px-4">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4 px-4">{children}</CardContent>
    </Card>
  );
}
