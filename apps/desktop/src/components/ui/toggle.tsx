import { cn } from "@/lib/utils";

type ToggleProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  id?: string;
  disabled?: boolean;
  "data-testid"?: string;
};

export function Toggle({
  checked,
  onCheckedChange,
  id,
  disabled,
  "data-testid": testId,
}: ToggleProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors",
        checked ? "bg-[#2e8dff]" : "bg-[#3a3a3c]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "absolute top-[3px] size-[18px] rounded-[9px] bg-black shadow transition-transform",
          checked ? "left-[19px]" : "left-[3px]",
        )}
      />
    </button>
  );
}
