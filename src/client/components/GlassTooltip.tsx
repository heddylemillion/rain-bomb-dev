import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

export type TooltipPlacement = 'right' | 'left' | 'bottom' | 'top';

export function useAccessibleTooltip(revealOnTap = false): {
  tooltipId: string;
  open: boolean;
  triggerProps: {
    'aria-describedby': string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onPointerDown: (event: React.PointerEvent) => void;
  };
} {
  const rawId = useId();
  const tooltipId = `tip-${rawId.replace(/:/g, '')}`;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!tapped) return undefined;
    const timer = window.setTimeout(() => setTapped(false), 2200);
    return () => window.clearTimeout(timer);
  }, [tapped]);

  const onMouseEnter = useCallback(() => {
    setDismissed(false);
    setHovered(true);
  }, []);
  const onMouseLeave = useCallback(() => {
    setHovered(false);
  }, []);
  const onFocus = useCallback(() => {
    setDismissed(false);
    setFocused(true);
  }, []);
  const onBlur = useCallback(() => {
    setFocused(false);
    setTapped(false);
  }, []);
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setDismissed(true);
      setTapped(false);
    }
  }, []);
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (revealOnTap && event.pointerType !== 'mouse') {
        setDismissed(false);
        setTapped(true);
      }
    },
    [revealOnTap]
  );

  const open = !dismissed && (hovered || focused || tapped);

  return {
    tooltipId,
    open,
    triggerProps: {
      'aria-describedby': tooltipId,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown,
      onPointerDown,
    },
  };
}

const PLACEMENT_CLASSES: Record<TooltipPlacement, string> = {
  right: 'left-full top-1/2 -translate-y-1/2 ml-2.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
};

export function GlassTooltip({
  id,
  open,
  placement = 'right',
  children,
}: {
  id: string;
  open: boolean;
  placement?: TooltipPlacement;
  children: ReactNode;
}): ReactNode {
  return (
    <span
      id={id}
      role="tooltip"
      data-open={open ? 'true' : 'false'}
      className={`glass-tooltip ${PLACEMENT_CLASSES[placement]} ${
        open ? 'opacity-100 visible translate-x-0' : 'opacity-0 invisible pointer-events-none'
      }`}
    >
      {children}
    </span>
  );
}

