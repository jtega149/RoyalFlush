export function handleUploadError(err, req, res, next) {
  if (!err) return next()

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' })
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: 'Image file is too large (max 5 MB)' })
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ message: 'Too many image files (max 2)' })
  }
  if (err.message === 'Only image uploads are allowed') {
    return res.status(400).json({ message: err.message })
  }

  return next(err)
}

export function handleJsonSyntaxError(err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Invalid JSON body' })
  }
  return next(err)
}
