// Starts an in-process SSH server and proves ssh2.forwardOut works end to end.
// Run with: ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" poc/ssh-forward-poc.cjs
const net = require('node:net')
const crypto = require('node:crypto')
const { Client, Server } = require('ssh2')

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
})

const echo = net.createServer((socket) => {
  socket.on('data', (chunk) => socket.write(Buffer.concat([Buffer.from('echo:'), chunk])))
})

const sshd = new Server({ hostKeys: [privateKey] }, (client) => {
  client.on('authentication', (ctx) => ctx.accept())
  client.on('tcpip', (accept, reject, info) => {
    const stream = accept()
    const target = net.connect(info.destPort, info.destIP)
    stream.pipe(target).pipe(stream)
    stream.on('error', () => target.destroy())
    target.on('error', () => stream.destroy())
  })
})

echo.listen(0, '127.0.0.1', () => {
  const echoPort = echo.address().port
  sshd.listen(0, '127.0.0.1', () => {
    const sshPort = sshd.address().port
    const conn = new Client()
    const timer = setTimeout(() => {
      console.error('TIMEOUT')
      process.exit(1)
    }, 10000)

    conn.on('ready', () => {
      conn.forwardOut('127.0.0.1', 0, '127.0.0.1', echoPort, (err, stream) => {
        if (err) {
          console.error('forwardOut error', err.message)
          process.exit(1)
        }
        let data = ''
        stream.on('data', (chunk) => {
          data += chunk.toString()
        })
        stream.on('close', () => {
          clearTimeout(timer)
          console.log('tunnel roundtrip:', JSON.stringify(data))
          conn.end()
          sshd.close()
          echo.close()
          process.exit(data === 'echo:hello' ? 0 : 2)
        })
        stream.end('hello')
      })
    })
    conn.on('error', (err) => {
      console.error('client error', err.message)
      process.exit(1)
    })
    conn.connect({
      host: '127.0.0.1',
      port: sshPort,
      username: 'probe',
      password: 'probe',
      hostVerifier: () => true,
    })
  })
})
