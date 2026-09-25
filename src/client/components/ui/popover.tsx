import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-popover";
import { cn } from "../../lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export function PopoverContent({
  container,
  className,
  ...props
}: ComponentProps<typeof Primitive.Content> & {
  container?: HTMLElement | null;
}) {
  return (
    <Primitive.Portal container={container ?? undefined}>
      <Primitive.Content
        data-slot="choice-popup"
        align="start"
        sideOffset={5}
        collisionPadding={8}
        className={cn(
          "z-50 w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-card text-foreground shadow-lg outline-none",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
