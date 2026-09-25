import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
  type ReactElement,
} from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const controls = Children.map(children, (child) =>
    isValidElement(child) && child.type !== "datalist"
      ? cloneElement(child as ReactElement<Record<string, unknown>>, {
          id,
          "aria-describedby":
            [
              (child.props as { "aria-describedby"?: string })[
                "aria-describedby"
              ],
              hint ? `${id}-hint` : undefined,
            ]
              .filter(Boolean)
              .join(" ") || undefined,
        })
      : child,
  );
  return (
    <div className="space-y-2 text-sm font-medium">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {controls}
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-xs font-normal leading-5 text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-muted p-4 text-sm leading-6 text-muted-foreground">
      {children}
    </div>
  );
}
