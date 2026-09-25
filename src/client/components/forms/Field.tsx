import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";

export type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode | ((id: string) => ReactNode);
  appearance?: "default" | "emphasized" | "plain";
};

const styles = {
  default: {
    wrapper: "min-w-0 space-y-2 text-sm",
    label: "block font-medium",
    hint: "text-xs leading-5 text-muted-foreground",
  },
  emphasized: {
    wrapper: "space-y-2 text-sm font-medium",
    label: "block",
    hint: "text-xs font-normal leading-5 text-muted-foreground",
  },
  plain: {
    wrapper: "block space-y-2 text-sm",
    label: undefined,
    hint: "text-xs leading-5 text-muted-foreground",
  },
};

/** Connect a control to its visible label and help without losing descriptions. */
export function Field({
  label,
  hint,
  children,
  appearance = "default",
}: FieldProps) {
  const id = useId();
  const style = styles[appearance];
  const controls = Children.map(
    typeof children === "function" ? children(id) : children,
    (child) =>
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
    <div className={style.wrapper}>
      <label htmlFor={id} className={style.label}>
        {label}
      </label>
      {controls}
      {hint && (
        <p id={`${id}-hint`} className={style.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
