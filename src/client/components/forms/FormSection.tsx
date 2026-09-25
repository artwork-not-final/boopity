import type { ReactNode } from "react";

import { Card, CardContent } from "../ui/card";

export function FormSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-xl py-0 shadow-none">
      <CardContent className="p-5 sm:p-6">
        <fieldset className="min-w-0">
          <legend className="mb-5 text-base font-semibold">{title}</legend>
          <div className="space-y-5">{children}</div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
