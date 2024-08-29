import pg from 'pg';

const { Client } = pg;
const client = new Client(
  'postgresql://postgres:postgres@localhost:5432/postgres',
);
await client.connect();

// const res = await client.query('SELECT 1+1');
const res = await client.query('SELECT $1::text as message', ['Hello world!']);
console.dir(res.rows, { depth: null });
await client.end();
