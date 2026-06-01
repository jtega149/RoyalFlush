import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
])

export async function validateUploadedImageFiles(files = []) {
  for (const file of files) {
    if (!file?.buffer?.length) {
      return { ok: false, error: 'Uploaded image file is empty' }
    }

    let detected
    try {
      detected = await fileTypeFromBuffer(file.buffer)
    } catch {
      return { ok: false, error: 'Only image uploads are allowed' }
    }

    if (!detected || !ALLOWED_IMAGE_MIMES.has(detected.mime)) {
      return { ok: false, error: 'Only image uploads are allowed' }
    }
  }

  return { ok: true }
}
