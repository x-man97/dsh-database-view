// MySQL through an SSH local port forward.
// Env: SSH_HOST/SSH_PORT/SSH_USER/SSH_PASSWORD, DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME.
const net = require('node:net')
const { Client: SshClient } = require('ssh2')
const mysql = require('mysql2/promise')

const env = process.env
const SSH = {
  host: env.SSH_HOST || '127.0.0.1',
  port: Number(env.SSH_PORT || 12222),
  username: env.SSH_USER || 'probe',
  password: env.SSH_PASSWORD || 'probepass',
}
const DB = {
  host: env.DB_HOST || '172.18.0.2',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER || 'root',
  password: env.DB_PASSWORD || 'testpass',
  database: env.DB_NAME || 'app',
}

async function main() {
  const ssh = new SshClient()
  await new Promise((resolve, reject) => {
    ssh.on('ready', resolve).on('error', reject)
    ssh.connect({ ...SSH, hostVerifier: () => true, readyTimeout: 10000 })
  })
  console.log('ssh ready')

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
  console.log('local tunnel port', port)

  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port,
    user: DB.user,
    password: DB.password,
    database: DB.database,
    charset: 'utf8mb4',
  })
  const [rows, fields] = await conn.query('SELECT * FROM users ORDER BY id LIMIT 10')
  console.log('rows', JSON.stringify(rows))
  console.log('fields', fields.map((f) => `${f.name}:${f.type}`).join(', '))

  const [tables] = await conn.query(
    'SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
    [DB.database],
  )
  console.log('tables', JSON.stringify(tables))
  const [columns] = await conn.query(
    'SELECT column_name, column_type, is_nullable, column_default, column_key, extra FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [DB.database, 'users'],
  )
  console.log('columns', JSON.stringify(columns))
  const [indexes] = await conn.query(
    'SELECT index_name, non_unique, column_name FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index',
    [DB.database, 'users'],
  )
  console.log('indexes', JSON.stringify(indexes))
  const [ddl] = await conn.query('SHOW CREATE TABLE `users`')
  console.log('ddl has create:', ddl[0]['Create Table'].includes('CREATE TABLE'))
  const [explain] = await conn.query('EXPLAIN SELECT * FROM users WHERE name = ?', ['Alice'])
  console.log('explain rows:', explain.length)

  await conn.end()
  tunnel.close()
  ssh.end()
  console.log('OK')
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
