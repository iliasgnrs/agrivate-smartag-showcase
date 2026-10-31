import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"

// Radix Select locks page scroll (via react-remove-scroll) and focuses the
// selected item into view while opening. Because the menu is rendered in a
// portal appended to <body> — this app's page scroll container — that
// combination scrolls the WHOLE PAGE: it snaps back to the top when a select is
// opened while the page is scrolled down (e.g. the irrigation-control schedule
// form). We snapshot the page position as soon as the select starts opening
// (BEFORE the portal mounts) and, for a short window, restore it whenever the
// page moves. A polling interval catches the jump even though the browser
// performs it without firing a window `scroll` event. The menu's own internal
// viewport scrolling is unaffected.
const Select = (props: React.ComponentProps<typeof SelectPrimitive.Root>) => {
  const { onOpenChange, children, ...rest } = props;
  const savedScrollRef = React.useRef({ x: 0, y: 0 });
  const activeRef = React.useRef(false);
  const pointerCapturedRef = React.useRef(false);
  const guardTimerRef = React.useRef<number | undefined>(undefined);

  const stopGuard = React.useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    pointerCapturedRef.current = false;
    if (guardTimerRef.current) {
      window.clearInterval(guardTimerRef.current);
      guardTimerRef.current = undefined;
    }
    // Restore once more on close — react-remove-scroll releasing its lock can
    // also shift the page.
    const { x, y } = savedScrollRef.current;
    if (window.scrollX !== x || window.scrollY !== y) {
      window.scrollTo(x, y);
    }
  }, []);

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (open) {
        // Snapshot BEFORE the dropdown portal mounts (Radix may scroll the
        // page at that point). If the pointer-down already captured the true
        // pre-open position, keep that — the scroll jump can begin before this
        // callback runs.
        if (!pointerCapturedRef.current) {
          savedScrollRef.current = { x: window.scrollX, y: window.scrollY };
        }
        pointerCapturedRef.current = false;
        activeRef.current = true;
        // Poll briefly while the menu settles and restore the page scroll if
        // Radix's scroll-lock / focus-scroll moved it. An interval is used
        // because the browser can perform the jump without a scroll event.
        const start = performance.now();
        guardTimerRef.current = window.setInterval(() => {
          if (!activeRef.current) return;
          if (performance.now() - start > 600) {
            stopGuard();
            return;
          }
          const { x, y } = savedScrollRef.current;
          if (window.scrollX !== x || window.scrollY !== y) {
            window.scrollTo(x, y);
          }
        }, 30);
      } else {
        stopGuard();
      }
      onOpenChange?.(open);
    },
    [onOpenChange, stopGuard],
  );

  // Record the page scroll on every pointer-down, as early as possible. The
  // select-open scroll jump can begin during the click itself (before
  // onOpenChange fires), so this gives the guard the true pre-open position.
  React.useEffect(() => {
    const onPointerDown = () => {
      savedScrollRef.current = { x: window.scrollX, y: window.scrollY };
      pointerCapturedRef.current = true;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  React.useEffect(() => () => stopGuard(), [stopGuard]);

  return (
    <SelectPrimitive.Root {...rest} onOpenChange={handleOpenChange}>
      {children}
    </SelectPrimitive.Root>
  );
};

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
