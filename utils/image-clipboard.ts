/** Convert the original image to a clipboard-compatible PNG at its full resolution. */
export async function imageToPng(src: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(src, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
    });
    signal.throwIfAborted();
    return png;
  } finally {
    bitmap.close();
  }
}
