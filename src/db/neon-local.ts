import { neonConfig } from '@neondatabase/serverless'

/**
 * Route the Neon HTTP driver to a local proxy for local connection strings, and
 * leave everything else exactly as it was.
 *
 * Importing this module installs the routing. It takes no arguments and reads no
 * environment: the decision is made **per request, from the host the driver is
 * already connecting to**, which is what makes it safe to load unconditionally
 * from anything that opens a database connection.
 *
 * ## Why this exists
 *
 * `npm run dev` pointed at the production Neon database. That is expensive in a
 * way nobody notices until it stops working: `/api/state` polls every 400ms and
 * `getState()` runs five queries per poll, so one dev tab is ~1.08M queries a
 * day. Four days of it exhausted the project's data-transfer quota and took the
 * **live** database down — an outage on the one system the league cannot run a
 * draft without, caused by writing code. Local development should not be able to
 * do that.
 *
 * ## Why redirect the driver instead of replacing it
 *
 * `@neondatabase/serverless` speaks SQL-over-HTTP rather than the Postgres wire
 * protocol, so it cannot reach a local Postgres unaided. The alternative was a
 * `pg`-backed shim implementing the same tagged-template interface — but the
 * auction's correctness *is* its SQL (docs/PROJECT_PLAN.md §4: awarding a lot and
 * executing a trade are single data-modifying CTEs, precisely because neon-http
 * has no interactive transactions). A shim would sit between those statements and
 * the database in development and not in production, which is the one place a
 * difference must never exist.
 *
 * So the driver, the protocol, the tagged-template semantics and the query path
 * stay byte-for-byte identical. Only the URL the request goes to moves.
 *
 * ## How a query is routed
 *
 * `neonConfig.fetchEndpoint` is handed the host and port from the connection
 * string. A remote host gets Neon's own endpoint, unchanged. A local host gets a
 * proxy, chosen **by port**, because the proxy image targets one fixed database
 * per instance (see docker-compose.yml) and the callback is not told which
 * database the URL named.
 *
 *   postgres://…@localhost:5432/neondb       → http://localhost:4444/sql
 *   postgres://…@localhost:5433/neondb_test  → http://localhost:4445/sql
 *   postgres://…@ep-xyz.neon.tech/neondb     → https://ep-xyz.neon.tech/sql
 *
 * The test URL's `5433` is a routing label rather than a listening Postgres —
 * both databases live in the one container on 5432, and only the proxies listen
 * on 4444 and 4445.
 */

/** Postgres port in the URL → local proxy port serving that database. */
const PROXY_PORTS: Record<string, number> = {
  '5432': 4444,
  '5433': 4445,
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db.localtest.me'])

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host)
}

/** True when this connection string points at a developer's machine. */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    // `postgres://` is not a scheme `URL` parses hosts for on every runtime, so
    // normalise it to one that is.
    return isLocalHost(new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).hostname)
  } catch {
    return false
  }
}

/** The endpoint the driver would have used on its own. */
export function neonEndpoint(host: string, port: string | number): string {
  if (!isLocalHost(host)) return `https://${host}/sql`
  const proxyPort = PROXY_PORTS[String(port)] ?? PROXY_PORTS['5432']
  return `http://${host}:${proxyPort}/sql`
}

let installed = false

/** Idempotent. Called on import; exported so a caller can be explicit. */
export function configureNeonForLocal(): void {
  if (installed) return
  installed = true
  neonConfig.fetchEndpoint = (host, port) => neonEndpoint(host, port)
}

configureNeonForLocal()
