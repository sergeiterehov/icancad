/**
 * Where a menu goes on the screen.
 *
 * A menu opens at the pointer, or beside the row that opened it, and both have
 * to stay inside the window: a row near the right edge has no room for a nested
 * menu on that side, and a list of operations can be taller than a tablet in
 * landscape. The rules are a pure function of the boxes involved, so the menu
 * host stays about drawing and the placement can be checked without a browser.
 */

/** Room a menu keeps between itself and the edge of the window. */
export const MENU_EDGE_MARGIN = 8;

/** Gap between a nested menu and the row it belongs to. */
const ROW_GAP = 4;
/** A nested menu lines up with the top of its row, less the row's padding. */
const ROW_TOP_OFFSET = 5;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  left: number;
  top: number;
}

/** The row a nested menu hangs from, in window coordinates. */
export interface RowBox {
  left: number;
  right: number;
  top: number;
}

/** A menu opened at the pointer, kept inside the window. */
export function menuPosition(
  at: Point,
  size: Size,
  viewport: Size,
  margin = MENU_EDGE_MARGIN,
): Point {
  return {
    left: Math.max(margin, Math.min(at.left, viewport.width - margin - size.width)),
    top: Math.max(margin, Math.min(at.top, viewport.height - margin - size.height)),
  };
}

/**
 * A menu nested in a row: beside the row while there is room, on the roomier
 * side when there is not, and inside the window either way.
 */
export function submenuPosition(
  row: RowBox,
  size: Size,
  viewport: Size,
  margin = MENU_EDGE_MARGIN,
): Point {
  const roomRight = viewport.width - row.right - margin;
  const roomLeft = row.left - margin;
  const beside =
    size.width > roomRight && roomLeft > roomRight
      ? row.left - ROW_GAP - size.width
      : row.right + ROW_GAP;
  return {
    left: Math.max(margin, Math.min(beside, viewport.width - margin - size.width)),
    top: Math.max(
      margin,
      Math.min(row.top - ROW_TOP_OFFSET, viewport.height - margin - size.height),
    ),
  };
}
