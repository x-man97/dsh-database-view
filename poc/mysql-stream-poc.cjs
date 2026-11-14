// MySQL over the raw ssh2 channel (no local port). This preserves the original
// hostname for TLS SNI, unlike connecting to 127.0.0.1.
const { Client: SshClient } = require('ssh2')
const mysql = require('mysql2/promise')

const env = process.env
const ssh = new SshClient()

async function main() {
  await new Promise((resolve, reject) => {
    ssh.on('ready', resolve).on('error', reject)
    ssh.connect({
      host: env.SSH_HOST || '127.0.0.1',
      port: Number(env.SSH_PORT || 12222),
      username: env.SSH_USER || 'probe',
      password: env.SSH_PASSWORD || 'probepass',
      hostVerifier: () => true,
    })
  })

  const stream = await new Promise((resolve, reject) => {
    ssh.forwardOut('127.0.0.1', 0, env.DB_HOST || '172.18.0.2', Number(env.DB_PORT || 3306), (err, channel) => {
      if (err) reject(err)
      else resolve(channel)
    })
  })

  const conn = await mysql.createConnection({
    stream,
    host: env.DB_TLS_SERVERNAME || 'dsh-mysql',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || 'testpass',
    database: env.DB_NAME || 'app',
    charset: 'utf8mb4',
  })
  const [rows] = await conn.query('SELECT id, name FROM users ORDER BY id LIMIT 10')
  console.log('stream rows', JSON.stringify(rows))
  await conn.end()
  ssh.end()
  console.log('OK')
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
