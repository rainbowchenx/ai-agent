import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-settings-section={id}
      className="overflow-hidden rounded-[19.2px] border border-[#3a3a3c] bg-[#1c1c1e] shadow-[0_1px_2px_rgba(0,0,0,0.36)]"
    >
      <header className="border-b border-[#3a3a3c] px-7 pb-[25px] pt-6">
        <h2 className="text-[20px] font-bold tracking-[-0.2px] text-[#f5f5f7]">
          {title}
        </h2>
        <p className="mt-1.5 text-sm text-[#8e8e93]">{description}</p>
      </header>
      <div className="space-y-5 px-7 py-6">{children}</div>
    </section>
  );
}

export function SettingsLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-[13px] font-medium text-[#f5f5f7]", className)}>
      {children}
    </div>
  );
}

export function SettingsField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-2", className)}>
      <SettingsLabel>{label}</SettingsLabel>
      {children}
      {hint ? <p className="text-xs text-[#8e8e93]">{hint}</p> : null}
    </label>
  );
}

export function settingsControlClassName(extra?: string) {
  return cn(
    "h-10 w-full rounded-[19.2px] border border-[#3a3a3c] bg-black px-[15px] text-sm text-[#f5f5f7] outline-none placeholder:text-[#8e8e93] focus-visible:ring-1 focus-visible:ring-[#2e8dff]",
    extra,
  );
}

export function SettingsPrimaryButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-full bg-[#2e8dff] px-5 text-sm font-medium text-black shadow disabled:opacity-50",
        className,
      )}
    />
  );
}

export function SettingsGhostButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex h-8 items-center justify-center rounded-full bg-[#1c1c1e] px-3.5 text-[13px] font-bold text-[#f5f5f7] shadow disabled:opacity-50",
        className,
      )}
    />
  );
}
