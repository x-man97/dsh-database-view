// PostgreSQL through an SSH local port forward.
// pg does not accept a raw ssh2 channel (it calls setNoDelay/connect on the socket).
const net = require('node:net')
const { Client: SshClient } = require('ssh2')
const { Client } = require('pg')

const env = process.env
const SSH = {
  host: env.SSH_HOST || '127.0.0.1',
  port: Number(env.SSH_PORT || 12222),
  username: env.SSH_USER || 'probe',
  password: env.SSH_PASSWORD || 'probepass',
}
const DB = {
  host: env.DB_HOST || '172.18.0.4',
  port: Number(env.DB_PORT || 5432),
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD || 'testpass',
  database: env.DB_NAME || 'app',
}

async function main() {
  const ssh = new SshClient()
  await new Promise((resolve, reject) => {
    ssh.on('ready', resolve).on('error', reject)
    ssh.connect({ ...SSH, hostVerifier: () => true, readyTimeout: 10000 })
  })
  const tunnel = net.createServer((local) => {
    ssh.forwardOut(local.remoteAddress, local.remotePort, DB.host, DB.port, (err, remote) => {
      if (err) {
        console.error('forward error', err.message)
        local.destroy()
        return
      }
      local.pipe(remote).pipe(local)
      local.on('error', () => remote.destroy())
      remote.on('error', () => local.destroy())
    })
  })
  await new Promise((resolve) => tunnel.listen(0, '127.0.0.1', resolve))
  const port = tunnel.address().port

  const client = new Client({
    host: '127.0.0.1',
    port,
    user: DB.user,
    password: DB.password,
    database: DB.database,
  })
  await client.connect()
  console.log('pg connected')

  const rows = await client.query('SELECT id, name, email, created_at, note FROM users ORDER BY id')
  console.log('rows', JSON.stringify(rows.rows))
  console.log('fields', rows.fields.map((f) => `${f.name}:${f.dataTypeID}`).join(', '))

  const tables = await client.query(
    "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  )
  console.log('tables', JSON.stringify(tables.rows))
  const cols = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position",
  )
  console.log('columns', JSON.stringify(cols.rows))
  const idx = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='users'",
  )
  console.log('indexes', JSON.stringify(idx.rows))
  const explain = await client.query('EXPLAIN SELECT * FROM users WHERE name = $1', ['Alice'])
  console.log('explain rows:', explain.rows.length)

  await client.end()
  tunnel.close()
  ssh.end()
  console.log('OK')
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
