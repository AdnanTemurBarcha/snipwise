import type { Point } from './geometry';
import { clamp } from './geometry';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;

/** Maps page space <-> screen (CSS px inside the stage element). */
export class Viewport {
  zoom = 1;
  /** screen position of the page origin */
  panX = 0;
  panY = 0;

  toScreen(p: Point): Point {
    return { x: p.x * this.zoom + this.panX, y: p.y * this.zoom + this.panY };
  }

  toPage(p: Point): Point {
    return { x: (p.x - this.panX) / this.zoom, y: (p.y - this.panY) / this.zoom };
  }

  /** Zoom keeping the page point under screen point (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, newZoom: number): void {
    const z = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const px = (sx - this.panX) / this.zoom;
    const py = (sy - this.panY) / this.zoom;
    this.zoom = z;
    this.panX = sx - px * z;
    this.panY = sy - py * z;
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  fit(viewW: number, viewH: number, pageW: number, pageH: number, padding = 0, maxZoom = 1): void {
    if (!pageW || !pageH || viewW <= 0 || viewH <= 0) {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      return;
    }
    const z = clamp(
      Math.min((viewW - padding * 2) / pageW, (viewH - padding * 2) / pageH, maxZoom),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.zoom = z;
    this.panX = (viewW - pageW * z) / 2;
    this.panY = (viewH - pageH * z) / 2;
  }

  centerOn(viewW: number, viewH: number, pageW: number, pageH: number): void {
    this.panX = (viewW - pageW * this.zoom) / 2;
    this.panY = (viewH - pageH * this.zoom) / 2;
  }
}
