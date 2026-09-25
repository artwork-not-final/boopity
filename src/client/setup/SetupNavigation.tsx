import { useId } from "react";
import { ChevronRight } from "lucide-react";
import { Choice } from "../Choice";
import type { SetupStep as Step } from "../setup-flow";

export function SetupNavigation({
  steps,
  current,
  busy,
  onSelect,
}: {
  steps: readonly { id: Step; label: string }[];
  current: Step;
  busy: boolean;
  onSelect: (step: Step) => void;
}) {
  const selectId = useId();
  const index = Math.max(
    0,
    steps.findIndex((item) => item.id === current),
  );
  const active = steps[index];
  if (!active) return null;
  return (
    <nav aria-label="Setup steps" className="min-w-0">
      <div className="lg:hidden">
        <label
          htmlFor={selectId}
          className="mb-2 block text-sm text-muted-foreground"
        >
          Step {index + 1} of {steps.length}
        </label>
        <Choice
          id={selectId}
          value={active.id}
          disabled={busy}
          onValueChange={(value) => {
            const selected = steps.find((item) => item.id === value);
            if (selected && !busy) onSelect(selected.id);
          }}
          options={steps.map((item) => ({ value: item.id, label: item.label }))}
        />
      </div>
      <div className="hidden flex-col gap-2 lg:flex">
        {steps.map((item, position) => (
          <button
            type="button"
            key={item.id}
            aria-current={active.id === item.id ? "step" : undefined}
            disabled={busy}
            onClick={() => onSelect(item.id)}
            className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${active.id === item.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
          >
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs"
              aria-hidden="true"
            >
              {position + 1}
            </span>
            {item.label}
            <ChevronRight
              className="ml-auto size-4 shrink-0"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </nav>
  );
}
