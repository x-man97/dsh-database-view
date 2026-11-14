// Seeds a UTF-8 row so the tunnel POC can prove charset handling too.
// Run after `docker run ... mysql:8.0` (host port 13306).
const mysql = require('mysql2/promise')

async function main() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 13306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'testpass',
    database: process.env.MYSQL_DB || 'app',
    charset: 'utf8mb4',
  })
  await conn.execute(
    `INSERT INTO users (id, name, email, note) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), note = VALUES(note)`,
    [3, '张三', 'zhang@example.com', '中文测试'],
  )
  const [rows] = await conn.query('SELECT id, name, note, HEX(name) AS hex FROM users ORDER BY id')
  console.log(rows)
  await conn.end()
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
