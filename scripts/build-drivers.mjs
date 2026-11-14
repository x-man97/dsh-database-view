import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const outDir = 'drivers'
const specs = [
  { id: 'mysql2', engine: 'mysql', package: 'mysql2', entry: 'driver-packs/mysql2/entry.ts' },
  { id: 'pg', engine: 'postgres', package: 'pg', entry: 'driver-packs/pg/entry.ts' },
  { id: 'tedious', engine: 'mssql', package: 'tedious', entry: 'driver-packs/tedious/entry.ts' },
  { id: 'oracledb-thin', engine: 'oracle', package: 'oracledb', entry: 'driver-packs/oracledb/entry.ts' },
]

await mkdir(outDir, { recursive: true })
const packs = []
for (const spec of specs) {
  const version = require(`${spec.package}/package.json`).version
  const assetName = `${spec.id === 'oracledb-thin' ? 'oracledb' : spec.id}-${version}.mjs`
  const outFile = join(outDir, assetName)
  await build({
    entryPoints: [spec.entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    external: ['node:*', '*.node'],
    outfile: outFile,
    legalComments: 'none',
    banner: { js: "import { createRequire as __dshCreateRequire } from 'node:module';\nconst require = __dshCreateRequire(import.meta.url);" },
    logLevel: 'warning',
  })
  const payload = await readFile(outFile)
  const sha256 = createHash('sha256').update(payload).digest('hex')
  packs.push({
    id: spec.id,
    engine: spec.engine,
    kind: 'js',
    version,
    delivery: 'bundled',
    license: spec.id === 'oracledb-thin' ? 'Apache-2.0 OR UPL-1.0' : 'MIT',
    file: `drivers/${assetName}`,
    sha256,
    bytes: payload.length,
  })
  console.log(`driver pack: ${outFile} (${payload.length} bytes, sha256 ${sha256})`)
}
await writeFile('drivers.json', `${JSON.stringify({ version: 1, packs }, null, 2)}\n`)
