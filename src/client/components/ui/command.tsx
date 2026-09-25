import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Command as Primitive, useCommandState } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils";

export function Command({
  className,
  ...props
}: ComponentProps<typeof Primitive>) {
  return (
    <Primitive
      className={cn("flex min-w-0 flex-col bg-card text-foreground", className)}
      {...props}
    />
  );
}
export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof Primitive.Input>) {
  const container = useRef<HTMLDivElement>(null);
  const selected = useCommandState((state) => state.value);
  const search = useCommandState((state) => state.search);
  const count = useCommandState((state) => state.filtered.count);
  const primitiveActiveId = useCommandState((state) => state.selectedItemId);
  const [activeId, setActiveId] = useState<string>();
  useLayoutEffect(() => {
    // cmdk 1.1.1 can resolve its active ID before filtered items commit. Read
    // the committed selection so typing announces the same row Enter selects.
    setActiveId(
      container.current
        ?.closest("[cmdk-root]")
        ?.querySelector(
          '[cmdk-item][aria-selected="true"][aria-disabled="false"]',
        )?.id,
    );
  }, [selected, search, count, primitiveActiveId]);
  return (
    <div ref={container} className="flex items-center gap-2 border-b px-3">
      <Search
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <Primitive.Input
        className={cn(
          "h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm",
          className,
        )}
        {...props}
        asChild
      >
        <input aria-activedescendant={activeId} />
      </Primitive.Input>
    </div>
  );
}
export function CommandList({
  className,
  ...props
}: ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn(
        "max-h-[min(16rem,calc(var(--radix-popover-content-available-height)-7rem))] scroll-py-1 overflow-y-auto overscroll-contain p-1",
        className,
      )}
      {...props}
    />
  );
}
export function CommandEmpty(props: ComponentProps<typeof Primitive.Empty>) {
  return (
    <Primitive.Empty
      className="px-3 py-6 text-center text-sm text-muted-foreground"
      {...props}
    />
  );
}
export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "flex min-h-11 cursor-default items-center justify-between gap-3 rounded-md px-3 py-2 text-sm leading-5 break-words outline-none data-[selected=true]:bg-muted data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
