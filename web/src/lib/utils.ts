import { createCn } from "cn/config";

/**
 * Joins class names and resolves Tailwind conflicts: the last class wins.
 *
 * The `type-*` utilities in globals.css set several text properties at once, so the merger has to
 * know what each one replaces. Without that, a component's default `text-sm` would silently beat
 * a `type-kicker` passed in by a caller, because Tailwind's own utilities come later in the CSS.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      // Set size, line height, weight and tracking together.
      "type-sized": [{ type: ["display", "headline", "title", "kicker"] }],
      // Set weight and tracking, and leave size to the caller.
      "type-face": [{ type: ["numeral"] }],
      "type-wordmark": [{ type: ["wordmark"] }],
      // Background patterns (images), which must not be mistaken for background colours.
      "bg-pattern": [{ bg: ["hatch", "timegrid"] }],
    },
    conflictingClassGroups: {
      "type-sized": ["font-size", "leading", "font-weight", "tracking"],
      "type-face": ["font-weight", "tracking"],
      "type-wordmark": ["font-weight", "tracking", "leading"],
    },
  },
});
