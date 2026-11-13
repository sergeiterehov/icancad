import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  delay?: number;
  className?: string;
  children: ReactNode;
}

interface Position {
  top: number;
  left: number;
}

export function Tooltip({ content, delay = 1500, className, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPosition(null);
  }, [clearTimer]);

  const show = useCallback(() => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [clearTimer, delay]);

  useEffect(() => hide, [hide]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchorRect = anchor.current?.getBoundingClientRect();
    const bubbleRect = bubble.current?.getBoundingClientRect();
    if (!anchorRect || !bubbleRect) return;

    const margin = 8;
    const gap = 8;
    const maxLeft = window.innerWidth - bubbleRect.width - margin;
    const maxTop = window.innerHeight - bubbleRect.height - margin;
    const centered = anchorRect.left + anchorRect.width / 2 - bubbleRect.width / 2;
    const left = Math.max(margin, Math.min(maxLeft, centered));
    let top = anchorRect.top - bubbleRect.height - gap;
    if (top < margin) top = anchorRect.bottom + gap;
    setPosition({ top: Math.max(margin, Math.min(maxTop, top)), left });
  }, [open, content]);

  if (content === null || content === undefined || content === '') {
    return <>{children}</>;
  }

  return (
    <>
      <span
        ref={anchor}
        className={clsx('tooltip-anchor', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
        onPointerDown={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            className="tooltip"
            style={position ?? { top: -9999, left: -9999 }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
