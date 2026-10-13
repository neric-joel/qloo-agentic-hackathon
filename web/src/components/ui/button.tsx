import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/** The one primary action per view: the ink CTA fill. */
const CTA =
  "border-cta bg-cta text-cta-foreground hover:border-cta-hover hover:bg-cta-hover motion-safe:active:translate-y-px"

/** Secondary: a 1.5px ink outline with a trailing arrow that moves 2px in 150ms (motion-safe only). */
const OUTLINE =
  "border-[1.5px] border-foreground bg-transparent text-foreground hover:bg-accent aria-expanded:bg-accent motion-safe:active:translate-y-px [&>svg:last-child]:motion-safe:transition-transform [&>svg:last-child]:motion-safe:duration-150 hover:[&>svg:last-child]:motion-safe:translate-x-0.5"

/** Tertiary: a ruled line of type. */
const RULED =
  "min-h-11 rounded-sm text-foreground underline decoration-1 underline-offset-4 decoration-border-strong hover:decoration-foreground [&>svg:last-child]:motion-safe:transition-transform hover:[&>svg:last-child]:motion-safe:translate-x-0.5"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-sm font-semibold whitespace-nowrap transition-[color,background-color,border-color] select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The one primary action per view: an ink fill (a light fill with a dark label in dark). Never vermilion. */
        default: CTA,
        /** An alias of `default`, kept for the callers that name it (brief sheet, agent panel). */
        ink: CTA,
        /** The secondary action: a 1.5px ink outline, no fill; a trailing arrow (the last svg) moves 2px on hover. */
        outline: OUTLINE,
        /** Toolbar and text actions: ink text, the wash on hover. */
        ghost: "text-foreground hover:bg-accent aria-expanded:bg-accent",
        /**
         * The tertiary action set as a ruled line of type: ink with a 1px control-edge underline 4px
         * below that turns ink on hover, and a trailing arrow (pass an icon as the last child) that
         * nudges right on hover.
         */
        ruled: RULED,
      },
      size: {
        // Every size takes the 12px control corner (rounded-md). 44px minimum height keeps every
        // control comfortable to tap. Primary, outline and ghost share one height and one side
        // padding per size; the 36px sizes reach 44px with an invisible extension of the hit area
        // above and below (and at the sides for the square icon button).
        default: "h-11 px-5 text-[0.9375rem]",
        sm: "relative h-9 px-3 text-[0.8125rem] after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
        "icon-sm": "relative size-9 after:absolute after:-inset-1 after:content-['']",
      },
    },
    compoundVariants: [
      // The ruled text button sits on the type's baseline: no fixed height or side padding from the size.
      { variant: "ruled", class: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
