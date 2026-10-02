"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";

import type { Theme } from "./theme-config";
import { useTheme } from "./theme-provider";

const OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: "light", label: "Light", icon: <Sun aria-hidden="true" />, description: "Light theme" },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden="true" />, description: "Dark theme" },
  {
    value: "system",
    label: "System",
    icon: <Monitor aria-hidden="true" />,
    description: "Match your device setting",
  },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, ready, setTheme } = useTheme();
  return (
    <SegmentedControl
      label="Color theme"
      size="sm"
      compactOnMobile
      // Nothing is shown as selected until the stored choice has been read, rather than
      // showing "System" for a moment to someone who picked something else.
      value={ready ? theme : null}
      onValueChange={setTheme}
      options={OPTIONS}
      className={className}
    />
  );
}
