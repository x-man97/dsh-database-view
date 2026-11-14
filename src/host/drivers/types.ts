/** Driver artifacts are pinned by drivers.json; the file is downloaded on demand. */
export interface DriverArtifact {
  id: string
  engine: string
  kind: 'js'
  version: string
  delivery: 'download' | 'bundled' | 'user-provided'
  license: string
  file?: string
  urls?: string[]
  sha256: string
  bytes: number
}

export interface DriverManifest {
  version: 1
  packs: DriverArtifact[]
}
