interface CaptureCanvasOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

const DEFAULT_MAX_WIDTH = 960;
const DEFAULT_MAX_HEIGHT = 540;
const DEFAULT_QUALITY = 0.78;

export async function captureCanvasSnapshot(
  sourceCanvas: HTMLCanvasElement,
  options: CaptureCanvasOptions = {},
): Promise<Blob | null> {
  const { maxWidth, maxHeight, quality } = options;

  const safeMaxWidth = Math.max(1, maxWidth ?? DEFAULT_MAX_WIDTH);
  const safeMaxHeight = Math.max(1, maxHeight ?? DEFAULT_MAX_HEIGHT);
  const safeQuality = Math.max(0, Math.min(1, quality ?? DEFAULT_QUALITY));

  if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    return null;
  }

  const scale = Math.min(
    1,
    safeMaxWidth / sourceCanvas.width,
    safeMaxHeight / sourceCanvas.height,
  );

  const targetWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
  const targetHeight = Math.max(1, Math.round(sourceCanvas.height * scale));

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = targetWidth;
  outputCanvas.height = targetHeight;

  const context = outputCanvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);

  return new Promise((resolve) => {
    outputCanvas.toBlob(
      (blob) => {
        resolve(blob);
      },
      "image/jpeg",
      safeQuality,
    );
  });
}
