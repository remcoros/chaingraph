import type { Locator } from '@playwright/test';

export interface SampledCanvas extends HTMLCanvasElement {
  testPixels: { width: number; height: number; pixels: Uint8ClampedArray };
}

/** Sample the composited image: an idle renderer's WebGL back buffer may be cleared. */
export async function captureGraphPixels(canvas: Locator, captions = false) {
  const image = await canvas.screenshot({
    style: `.graph-navigation-overlay, .graph-node-card${captions ? '' : ', .flow-renderer-labels'} { visibility: hidden !important; }`,
  });
  await canvas.evaluate(
    async (element, bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const frame = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = frame.getContext('2d')!;
      // Keep the bottom-up coordinates used by the existing WebGL pixel assertions.
      context.translate(0, bitmap.height);
      context.scale(1, -1);
      context.drawImage(bitmap, 0, 0);
      const { width, height, data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      (element as SampledCanvas).testPixels = { width, height, pixels: data };
    },
    [...image],
  );
}
