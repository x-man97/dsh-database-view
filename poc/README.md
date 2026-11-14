# 可行性验证脚本（POC）

这些脚本是 [`docs/feasibility.md`](../docs/feasibility.md) 第 5 章「已完成实测」的可复现版本。它们只验证**数据链路**，不是插件实现。

## 环境

- macOS / Linux（Windows 需要把 `ELECTRON_RUN_AS_NODE=1 ...` 换成对应写法）
- DSH Desktop 已安装（脚本使用 DSH 自带的 Electron/Node 运行时）
- Docker（用于 MySQL/PostgreSQL/SSH 容器）
- Node.js 22+（仅用于 `node --check` 和 `npm install`；实际运行用 DSH 的 Electron）

## 安装依赖

```bash
cd poc
npm install --registry=https://registry.npmmirror.com
```

> 调研时中科大 npm 镜像（`https://mirrors.ustc.edu.cn/npm/`）返回 404，`npm.mirrors.ustc.edu.cn` 无法解析，因此示例使用 npmmirror。若你的网络能访问中科大源，替换 `--registry` 即可。

## 启动测试容器

```bash
docker network create dsh-db-net 2>/dev/null || true

# MySQL 8
docker run -d --name dsh-mysql --network dsh-db-net \
  -e MYSQL_ROOT_PASSWORD=testpass -e MYSQL_DATABASE=app \
  -p 13306:3306 mysql:8.0

# PostgreSQL 16
docker run -d --name dsh-pg --network dsh-db-net \
  -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=app \
  -p 15432:5432 postgres:16-alpine

# SSH 跳板机（linuxserver 镜像默认 AllowTcpForwarding no，需要改配置）
docker run -d --name dsh-ssh --network dsh-db-net \
  -e PUID=1000 -e PGID=1000 -e TZ=Asia/Shanghai \
  -e USER_NAME=probe -e USER_PASSWORD=probepass -e PASSWORD_ACCESS=true \
  -p 12222:2222 linuxserver/openssh-server

docker exec dsh-ssh sed -i 's/^AllowTcpForwarding no/AllowTcpForwarding yes/' /config/sshd/sshd_config
docker restart dsh-ssh
```

初始化示例数据（MySQL 先用 CLI 建表，再用 `seed-mysql.cjs` 写入中文，避免 CLI 字符集问题；PostgreSQL 用 `psql`）：

```bash
docker exec dsh-mysql mysql -uroot -ptestpass app -e "
CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  email VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  KEY idx_name (name)
);
INSERT INTO users (name,email,note) VALUES ('Alice','alice@example.com','hello'),('Bob','bob@example.com',NULL);
"

docker exec dsh-pg psql -U postgres -d app -c "
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name varchar(50) NOT NULL,
  email varchar(100),
  created_at timestamptz DEFAULT now(),
  note text
);
CREATE INDEX IF NOT EXISTS idx_name ON users(name);
INSERT INTO users (name,email,note) VALUES ('Alice','alice@example.com','hello'),('Bob','bob@example.com',NULL),('张三','zhang@example.com','中文测试');
"
```

取 MySQL/PG 容器在 Docker 网络里的 IPv4：

```bash
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' dsh-mysql
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' dsh-pg
```

> 不要直接用容器名：sshd 可能优先解析到 IPv6，而数据库只监听 IPv4，`forwardOut` 会报 `Channel open failure: open failed`。用上面的 IPv4 最稳。

## 运行

用 DSH 的 Electron 运行时执行（`DSH_NODE_EXECUTABLE` 由 DSH 注入；也可以写死为 Desktop 的 `Contents/MacOS/DeepSeek Harness`）：

```bash
export DSH_NODE_EXECUTABLE="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
export DB_HOST="172.18.0.2"   # 上一步得到的 MySQL IPv4

ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" seed-mysql.cjs
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" ssh-forward-poc.cjs
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" mysql-tunnel-poc.cjs
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" mysql-stream-poc.cjs
ELECTRON_RUN_AS_NODE=1 "$DSH_NODE_EXECUTABLE" pg-tunnel-poc.cjs
```

PostgreSQL 需要把 `DB_HOST` 换成 PG 的 IPv4，并设置 `DB_PORT=5432`、`DB_USER=postgres`。

## 预期结果

| 脚本 | 预期 |
|---|---|
| `ssh-forward-poc.cjs` | `tunnel roundtrip: "echo:hello"` |
| `mysql-tunnel-poc.cjs` | 打印 3 行（含中文）rows/tables/columns/indexes，`OK` |
| `mysql-stream-poc.cjs` | 打印 rows，`OK` |
| `pg-tunnel-poc.cjs` | 打印 rows/tables/columns/indexes，`OK` |

## 已知坑

- SSH 容器默认 `AllowTcpForwarding no`，必须改成 `yes` 并重启。
- `pg` 不能直接吃 `ssh2` 的 channel，会报 `setNoDelay is not a function`；用本地端口转发。
- `mysql2` 可以直接吃 channel，并且保留原始 `host` 有利于 TLS SNI。
- MySQL 的 `DATETIME` 被 `mysql2` 转成 JS `Date` 后会发生时区偏移；正式实现要设置 `dateStrings` 或自定义 type parser。
- 中文乱码先确认数据本身是不是正确 UTF-8（用 `HEX(name)` 看），再怀疑驱动字符集。
