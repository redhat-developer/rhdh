import { useCallback, useEffect, useRef, useState } from 'react';

export interface ScrollbarState {
  isScrollable: boolean;
  isVisible: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  thumbHeight: number;
  thumbTop: number;
  isDragging: boolean;
}

export interface UseScrollbarReturn {
  scrollbarState: ScrollbarState;
  containerRef: React.RefObject<HTMLDivElement>;
  trackRef: React.RefObject<HTMLDivElement>;
  thumbRef: React.RefObject<HTMLDivElement>;
  handleMouseEnter: () => void;
  handleMouseLeave: () => void;
  handleTrackClick: (event: React.MouseEvent) => void;
  handleThumbMouseDown: (event: React.MouseEvent) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
}

const SCROLLBAR_MIN_THUMB_HEIGHT = 20;
const SCROLL_STEP = 40;
const PAGE_SCROLL_FACTOR = 0.8;

export const useScrollbar = (): UseScrollbarReturn => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ y: number; scrollTop: number } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [scrollbarState, setScrollbarState] = useState<ScrollbarState>({
    isScrollable: false,
    isVisible: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    thumbHeight: 0,
    thumbTop: 0,
    isDragging: false,
  });

  const updateScrollbarState = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isScrollable = scrollHeight > clientHeight;

    if (!isScrollable) {
      setScrollbarState(prev => ({
        ...prev,
        isScrollable: false,
        scrollTop: 0,
        scrollHeight: clientHeight,
        clientHeight,
        thumbHeight: 0,
        thumbTop: 0,
      }));
      return;
    }

    const thumbHeight = Math.max(
      (clientHeight / scrollHeight) * clientHeight,
      SCROLLBAR_MIN_THUMB_HEIGHT,
    );

    const maxThumbTop = clientHeight - thumbHeight;
    const scrollRatio = scrollTop / (scrollHeight - clientHeight);
    const thumbTop = scrollRatio * maxThumbTop;

    setScrollbarState(prev => ({
      ...prev,
      isScrollable,
      scrollTop,
      scrollHeight,
      clientHeight,
      thumbHeight,
      thumbTop,
    }));
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    if (scrollbarState.isScrollable) {
      setScrollbarState(prev => ({ ...prev, isVisible: true }));
    }
  }, [scrollbarState.isScrollable]);

  const handleMouseLeave = useCallback(() => {
    if (scrollbarState.isDragging) return;

    hoverTimeoutRef.current = setTimeout(() => {
      setScrollbarState(prev => ({ ...prev, isVisible: false }));
    }, 300);
  }, [scrollbarState.isDragging]);

  const scrollToPosition = useCallback((scrollTop: number, smooth = false) => {
    const container = containerRef.current;
    if (!container) return;

    const maxScrollTop = container.scrollHeight - container.clientHeight;
    const clampedScrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));

    if (smooth) {
      container.scrollTo({
        top: clampedScrollTop,
        behavior: 'smooth',
      });
    } else {
      container.scrollTop = clampedScrollTop;
    }
  }, []);

  const handleTrackClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const container = containerRef.current;
      const track = trackRef.current;
      if (!container || !track) return;

      const trackRect = track.getBoundingClientRect();
      const clickY = event.clientY - trackRect.top;
      const { clientHeight, scrollHeight } = container;

      const scrollRatio = clickY / clientHeight;
      const targetScrollTop = scrollRatio * (scrollHeight - clientHeight);

      scrollToPosition(targetScrollTop, true);
    },
    [scrollToPosition],
  );

  const handleThumbMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const container = containerRef.current;
    if (!container) return;

    dragStartRef.current = {
      y: event.clientY,
      scrollTop: container.scrollTop,
    };

    setScrollbarState(prev => ({ ...prev, isDragging: true }));
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || !scrollbarState.isScrollable) return;

      let scrollDelta = 0;

      switch (event.key) {
        case 'ArrowUp':
          scrollDelta = -SCROLL_STEP;
          break;
        case 'ArrowDown':
          scrollDelta = SCROLL_STEP;
          break;
        case 'PageUp':
          scrollDelta = -container.clientHeight * PAGE_SCROLL_FACTOR;
          break;
        case 'PageDown':
          scrollDelta = container.clientHeight * PAGE_SCROLL_FACTOR;
          break;
        case 'Home':
          scrollToPosition(0, true);
          event.preventDefault();
          return;
        case 'End':
          scrollToPosition(container.scrollHeight, true);
          event.preventDefault();
          return;
        default:
          return;
      }

      if (scrollDelta !== 0) {
        event.preventDefault();
        scrollToPosition(container.scrollTop + scrollDelta, true);
      }
    },
    [scrollbarState.isScrollable, scrollToPosition],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!scrollbarState.isDragging || !dragStartRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      const deltaY = event.clientY - dragStartRef.current.y;
      const { clientHeight, scrollHeight } = container;

      const scrollRatio = deltaY / clientHeight;
      const scrollDelta = scrollRatio * (scrollHeight - clientHeight);
      const targetScrollTop = dragStartRef.current.scrollTop + scrollDelta;

      scrollToPosition(targetScrollTop);
    };

    const handleMouseUp = () => {
      if (scrollbarState.isDragging) {
        setScrollbarState(prev => ({ ...prev, isDragging: false }));
        dragStartRef.current = null;
      }
    };

    if (scrollbarState.isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }

    return undefined;
  }, [scrollbarState.isDragging, scrollToPosition]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let rafId: number | null = null;
    let isUpdateScheduled = false;

    const handleScroll = () => {
      if (!isUpdateScheduled) {
        isUpdateScheduled = true;
        rafId = requestAnimationFrame(() => {
          updateScrollbarState();
          isUpdateScheduled = false;
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateScrollbarState();
    });

    container.addEventListener('scroll', handleScroll, { passive: true });
    resizeObserver.observe(container);

    updateScrollbarState();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, [updateScrollbarState]);

  return {
    scrollbarState,
    containerRef,
    trackRef,
    thumbRef,
    handleMouseEnter,
    handleMouseLeave,
    handleTrackClick,
    handleThumbMouseDown,
    handleKeyDown,
  };
};
