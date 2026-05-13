const { Pool } = require('pg');

const connStr = process.env.DATABASE_URL_LEADS;

let pool = null;
if (connStr) {
  pool = new Pool({
    connectionString: connStr,
    ssl: connStr.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => {
    console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'leads-pool-error', err: String(err) }));
  });
}

module.exports = {
  pool,
  enabled: !!pool,
};
