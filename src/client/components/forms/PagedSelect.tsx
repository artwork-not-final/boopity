import { useId } from "react";

import { Choice } from "./Choice";

import { usePage } from "../../hooks/usePage";
import { PageControls } from "../navigation/PageControls";
export function PagedSelect<T extends { id: string }>({
  label,
  path,
  collection,
  selected,
  onSelect,
  describe,
  revision,
  compact = false,
  disabled = false,
}: {
  label: string;
  path: string;
  collection: string;
  selected: T | null;
  onSelect: (value: T | null) => void;
  describe: (value: T) => string;
  revision: number;
  compact?: boolean;
  disabled?: boolean;
}) {
  const page = usePage<Record<string, T[]>>(path, revision),
    id = useId();
  const rows = page.data?.[collection] ?? [];
  return (
    <div
      className={
        compact ? "min-w-0 space-y-3" : "space-y-3 rounded-xl border p-4"
      }
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Choice
        id={id}
        required
        disabled={disabled}
        searchable
        searchLabel={`Find ${label.toLowerCase()}`}
        searchValue={page.term}
        onSearchChange={page.search}
        loading={page.loading}
        placeholder={`Choose ${label.toLowerCase()}`}
        selectedLabel={selected ? describe(selected) : undefined}
        value={selected?.id ?? ""}
        onValueChange={(value) =>
          onSelect(rows.find((row) => row.id === value) ?? null)
        }
        options={rows.map((row) => ({ value: row.id, label: describe(row) }))}
        footer={
          page.error || page.offset > 0 || page.data?.pagination.hasMore ? (
            <PageControls
              label={label.toLowerCase()}
              {...page}
              pagination={page.data?.pagination}
            />
          ) : undefined
        }
      />
      {selected && !compact && (
        <p className="break-words text-xs text-muted-foreground">
          Selected: {describe(selected)}
        </p>
      )}
    </div>
  );
}
