import pg from 'pg'

const host = process.env.PGHOST ?? ''
const useSocket = host.startsWith('/cloudsql')
// Cloud SQL Auth Proxy on localhost uses plain Postgres; SSL is handled to Cloud SQL.
const useSsl =
  !useSocket &&
  host !== '127.0.0.1' &&
  host !== 'localhost' &&
  process.env.PGSSLMODE !== 'disable'

const config = {
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: useSocket ? undefined : process.env.PGPORT,
  database: process.env.PGDATABASE,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
}

export const pool = new pg.Pool(config)