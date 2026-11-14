// Self-contained driver pack for mysql2. The engine loads this ESM module at runtime.
import mysql from 'mysql2/promise'

export default mysql
export const createConnection = mysql.createConnection
export const createPool = mysql.createPool
export const escape = mysql.escape
export const escapeId = mysql.escapeId
export const Types = mysql.Types
