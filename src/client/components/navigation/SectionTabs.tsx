import { useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

/** Shared line styling, retaining page navigation or pressed-choice semantics. */
export function SectionTabs<T extends string>({
  label,
  items,
  value,
  onValueChange,
  disabled = false,
  selection = "page",
  className,
}: {
  label: string;
  items: readonly (readonly [T, string])[];
  value: T;
  onValueChange: (value: T) => void;
  disabled?: boolean;
  selection?: "page" | "value";
  className?: string;
}) {
  const listRef = useRef<HTMLElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const selected = selectedRef.current;
    if (!list || !selected) return;
    // Reveal a routed/filtered selection after reload or resize without moving
    // the document, which scrollIntoView could do for tabs farther down a page.
    const revealSelected = () => {
      const track = list.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      if (tab.left < track.left + 4)
        list.scrollLeft += tab.left - track.left - 4;
      else if (tab.right > track.right - 4)
        list.scrollLeft += tab.right - track.right + 4;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    observer.observe(selected);
    return () => observer.disconnect();
  }, [value]);
  return (
    <nav
      ref={listRef}
      aria-label={label}
      className={cn(
        "flex min-w-0 max-w-full gap-5 overflow-x-auto border-b px-1 pt-1 sm:gap-7",
        className,
      )}
    >
      {items.map(([id, title]) => (
        <Button
          key={id}
          ref={value === id ? selectedRef : undefined}
          type="button"
          variant="tab-line"
          className="px-1"
          aria-current={
            selection === "page" && value === id ? "page" : undefined
          }
          aria-pressed={selection === "value" ? value === id : undefined}
          disabled={disabled}
          onClick={() => onValueChange(id)}
        >
          {title}
        </Button>
      ))}
    </nav>
  );
}
