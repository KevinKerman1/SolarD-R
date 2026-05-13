const { Pool } = require('pg');

const connStr = process.env.DATABASE_URL_ANALYTICS;

let pool = null;
if (connStr) {
  const usesPrivateNet = /localhost|\.flycast|\.internal|sslmode=disable/.test(connStr);
  pool = new Pool({
    connectionString: connStr,
    ssl: usesPrivateNet ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (err) => {
    console.error(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'analytics-pool-error', err: String(err) }));
  });
}

module.exports = {
  pool,
  enabled: !!pool,
};
