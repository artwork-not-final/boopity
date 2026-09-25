import type { ComponentProps } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/utils";

export const Select = Primitive.Root;
// Choice owns its raw-value native field, so it must not render Root's second,
// unnamed field. Keep this documented unstable API isolated and covered by the
// choice form/keyboard tests when upgrading Radix.
// https://www.radix-ui.com/primitives/docs/components/select#decoupling-the-hidden-input
export const SelectProvider = Primitive.unstable_Provider;
export const SelectValue = Primitive.Value;
export const SelectGroup = Primitive.Group;
export const SelectLabel = Primitive.Label;
export function SelectTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-input bg-card px-3 py-2 text-left text-base font-normal text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    >
      {children}
      <Primitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}
export function SelectContent({
  children,
  className,
  container,
  ...props
}: ComponentProps<typeof Primitive.Content> & {
  container?: HTMLElement | null;
}) {
  return (
    <Primitive.Portal container={container ?? undefined}>
      <Primitive.Content
        position="popper"
        sideOffset={5}
        collisionPadding={8}
        data-slot="choice-popup"
        className={cn(
          "z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-card p-1 text-foreground shadow-lg",
          className,
        )}
        {...props}
      >
        <Primitive.ScrollUpButton className="flex justify-center py-1">
          <ChevronUp className="size-4" />
        </Primitive.ScrollUpButton>
        <Primitive.Viewport>{children}</Primitive.Viewport>
        <Primitive.ScrollDownButton className="flex justify-center py-1">
          <ChevronDown className="size-4" />
        </Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
export function SelectItem({
  children,
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex min-h-11 cursor-default select-none items-center rounded-md py-2 pr-8 pl-3 text-sm leading-5 break-words outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <Primitive.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="size-4" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
