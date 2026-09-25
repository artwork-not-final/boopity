import { cloneElement, isValidElement, useId, type ReactNode } from "react";
import { Input } from "./components/ui/input";
import { Card, CardContent } from "./components/ui/card";

export const controlClass =
  "min-h-10 w-full min-w-0 rounded-md border bg-card px-3 py-2 text-sm";
export function Area({
  label,
  value,
  onChange,
  maxLength = 2000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <textarea
          id={id}
          className={controlClass}
          rows={3}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = children(id);
  const describedControl =
    hint && isValidElement<{ "aria-describedby"?: string }>(control)
      ? cloneElement(control, {
          "aria-describedby": [control.props["aria-describedby"], `${id}-hint`]
            .filter(Boolean)
            .join(" "),
        })
      : control;
  return (
    <div className="min-w-0 space-y-2 text-sm">
      <label className="block font-medium" htmlFor={id}>
        {label}
      </label>
      {describedControl}
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-xs leading-5 text-muted-foreground"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
export function Text({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  maxLength = 1000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          maxLength={maxLength}
        />
      )}
    </Field>
  );
}
export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}
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
