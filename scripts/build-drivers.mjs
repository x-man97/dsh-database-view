import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const mysql2Version = require('mysql2/package.json').version
const outDir = 'drivers'
const assetName = `mysql2-${mysql2Version}.mjs`
const outFile = join(outDir, assetName)

await mkdir(outDir, { recursive: true })
await build({
  entryPoints: ['driver-packs/mysql2/entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  external: ['node:*'],
  outfile: outFile,
  legalComments: 'none',
  banner: { js: "import { createRequire as __dshCreateRequire } from 'node:module';\nconst require = __dshCreateRequire(import.meta.url);" },
  logLevel: 'warning',
})

const payload = await readFile(outFile)
const sha256 = createHash('sha256').update(payload).digest('hex')
const manifest = {
  version: 1,
  packs: [
    {
      id: 'mysql2',
      engine: 'mysql',
      kind: 'js',
      version: mysql2Version,
      delivery: 'bundled',
      license: 'MIT',
      file: `drivers/${assetName}`,
      sha256,
      bytes: payload.length,
    },
  ],
}
await writeFile('drivers.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`driver pack: ${outFile} (${payload.length} bytes, sha256 ${sha256})`)
