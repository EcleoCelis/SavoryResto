"use client";

import styles from "./staggered-menu-button.module.css";

interface StaggeredMenuButtonProps {
  /** Single source of truth lives in the parent (Header); this component is fully controlled. */
  isOpen: boolean;
  onToggle: () => void;
  /** id of the navigation panel this button opens/closes. */
  controlsId: string;
  /** Optional layout class from the parent (e.g. responsive visibility rules). */
  className?: string;
}

/**
 * Hamburger toggle with three unequal-length strokes that drift horizontally
 * in a continuous, staggered, back-and-forth loop while the menu is closed.
 *
 * - Motion is pure CSS (@keyframes on `transform`), so React never re-renders per frame.
 * - Open state cross-fades into an X; the drift is paused (not reset), so closing
 *   resumes from the same coherent position.
 * - Rendering is deterministic (no browser reads during render) to stay hydration-safe.
 */
export function StaggeredMenuButton({ isOpen, onToggle, controlsId, className }: StaggeredMenuButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.button} ${className ?? ""}`}
      onClick={onToggle}
      aria-label={isOpen ? "Close navigation" : "Open navigation"}
      aria-expanded={isOpen}
      aria-controls={controlsId}
    >
      <svg
        className={styles.icon}
        width="28"
        height="20"
        viewBox="0 0 28 20"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Closed state: staggered drifting strokes (lengths 18 / 12 / 6, right-aligned at rest) */}
        <g className={styles.stepped}>
          <line className={`${styles.line} ${styles.lineLong}`} x1="4" y1="4" x2="22" y2="4" />
          <line className={`${styles.line} ${styles.lineMedium}`} x1="10" y1="10" x2="22" y2="10" />
          <line className={`${styles.line} ${styles.lineShort}`} x1="16" y1="16" x2="22" y2="16" />
        </g>

        {/* Open state: X built from two strokes centred on (14, 10) */}
        <g className={styles.cross}>
          <line className={`${styles.crossLine} ${styles.crossA}`} x1="5" y1="10" x2="23" y2="10" />
          <line className={`${styles.crossLine} ${styles.crossB}`} x1="5" y1="10" x2="23" y2="10" />
        </g>
      </svg>
    </button>
  );
}
