import { MysqlEngine, MYSQL_DESCRIPTOR } from './engines/mysql.js';
import { defineEngine } from './types.js';
export const mysqlEngine = defineEngine({
    apiVersion: 1,
    descriptor: MYSQL_DESCRIPTOR,
    create: () => new MysqlEngine(),
});
/** Engines compiled into the core package. External packages register later. */
export const coreEngines = [mysqlEngine];
//# sourceMappingURL=catalog.js.map