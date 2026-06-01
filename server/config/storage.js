import { Storage } from '@google-cloud/storage'

const storage = new Storage()

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME)

export default bucket