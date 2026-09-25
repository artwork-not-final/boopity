import { Input } from "../../components/ui/input";
import { Field } from "../../components/forms/Field";
export function Amount({
  value,
  setValue,
  label = "Amount",
}: {
  value: string;
  setValue: (v: string) => void;
  label?: string;
}) {
  return (
    <Field appearance="plain" label={label}>
      {(id) => (
        <Input
          id={id}
          inputMode="decimal"
          className="min-h-11"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          pattern="[0-9]+(\.[0-9]{1,2})?"
          maxLength={12}
        />
      )}
    </Field>
  );
}

export function Note({
  value,
  setValue,
  label = "Private accounting note",
  required = false,
}: {
  value: string;
  setValue: (v: string) => void;
  label?: string;
  required?: boolean;
}) {
  return (
    <Field appearance="plain" label={label}>
      {(id) => (
        <textarea
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required={required}
          maxLength={1000}
          rows={3}
          className="w-full min-w-0 resize-y rounded-md border bg-card px-3 py-2 text-base"
        />
      )}
    </Field>
  );
}
