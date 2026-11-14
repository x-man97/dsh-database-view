import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import type { TlsConfig } from '../shared/types.js'
import { DbError, errorMessage } from './errors.js'

export interface LoadedTls {
  ca?: Buffer
  cert?: Buffer
  key?: Buffer
  rejectUnauthorized: boolean
  verifyIdentity: boolean
  servername?: string
}

function readPath(path: string, label: string): Buffer {
  const expanded = path === '~' ? homedir() : path.startsWith('~/') ? resolve(homedir(), path.slice(2)) : resolve(path)
  try {
    return readFileSync(expanded)
  } catch (error) {
    throw new DbError('invalid', `${label}读取失败：${errorMessage(error)}`, expanded)
  }
}

/** Convert the stored TLS settings into driver-neutral options. */
export function loadTls(config: TlsConfig | undefined): LoadedTls | undefined {
  if (config === undefined || config.mode === 'disable') return undefined
  const verify = config.mode === 'verify-full' || config.mode === 'verify-ca'
  const allowInvalid = config.allowInvalidHostname === true
  return {
    ...(config.caPath === undefined || config.caPath === '' ? {} : { ca: readPath(config.caPath, 'CA 证书') }),
    ...(config.certPath === undefined || config.certPath === '' ? {} : { cert: readPath(config.certPath, '客户端证书') }),
    ...(config.keyPath === undefined || config.keyPath === '' ? {} : { key: readPath(config.keyPath, '客户端私钥') }),
    rejectUnauthorized: verify && !allowInvalid,
    verifyIdentity: config.mode === 'verify-full' && !allowInvalid,
    ...(config.servername === undefined || config.servername === '' ? {} : { servername: config.servername }),
  }
}
