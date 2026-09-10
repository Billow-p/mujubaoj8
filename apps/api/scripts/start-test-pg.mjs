// 启动嵌入式 PostgreSQL 用于本地端到端测试
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('C:/Users/Administrator/WorkBuddy/2026-09-06-15-54-15/.tmp-pgdata');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'postgres',
  port: 55432,
  persistent: true,
});

const initialised = fs.existsSync(path.join(dir, 'PG_VERSION'));
if (!initialised) {
  console.log('初始化数据库目录…');
  await pg.initialise();
}
await pg.start();
console.log('PostgreSQL 已启动 port=55432');

try {
  await pg.createDatabase('mqs_test');
  console.log('创建数据库 mqs_test');
} catch (e) {
  console.log('数据库已存在，跳过');
}

console.log('READY');
process.exit(0);
