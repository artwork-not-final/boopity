import { Input } from "../ui/input";

import { Field } from "./Field";
export const controlClass =
  "min-h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-sm";
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
