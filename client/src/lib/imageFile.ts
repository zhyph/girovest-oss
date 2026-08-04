/**
 * The longest edge a stored product photo is allowed to have, and the JPEG
 * quality it is written at. Both mirror the phone intake page
 * (server/src/productPhotoPage.ts) on purpose: a piece photographed at the
 * counter and the same piece photographed on a phone must end up the same
 * size on disk, or the catalogue grid would show two different weights of
 * image side by side.
 */
export const MAX_PHOTO_DIMENSION = 1600
export const PHOTO_JPEG_QUALITY = 0.82

/** What the picker will let through before any decoding is attempted. */
export const MAX_PHOTO_FILE_BYTES = 10 * 1024 * 1024

export class ImageReadError extends Error {}

/**
 * Reads a picked file and hands back a downscaled JPEG data URL.
 *
 * Always JPEG, whatever came in: the server stores `<uuid>.jpg` and serves it
 * as image/jpeg, and that one shape is what the serving route, the zoom panel
 * and the live-photo feed all read. Converting here rather than widening the
 * stored format keeps a PNG dropped into the picker from becoming a second
 * case everything downstream has to know about.
 */
export function fileToJpegDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new ImageReadError(file.name))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new ImageReadError(file.name))
      image.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new ImageReadError(file.name))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY))
      }
      image.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/** A photo the drawer is holding but has not sent to the server yet. */
export function isPendingPhoto(entry: string): boolean {
  return entry.startsWith('data:')
}
