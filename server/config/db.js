/**
 * Database Configuration File
 * Establishes a MySQL connection pool using mysql2/promise.
 */

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file inside backend directory
dotenv.config({ path: path.join(__dirname, '../.env') });

// Aiven / managed MySQL requires SSL, local MySQL does not.
// Enable SSL automatically for non-local hosts.
const isLocalHost = (process.env.DB_HOST || 'localhost').toLowerCase().includes('localhost')
    || (process.env.DB_HOST || '').startsWith('127.');

// Create connection pool for MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'inventory_db',
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Managed MySQL (Aiven) closes idle sockets behind the proxy. Without
    // TCP keep-alive the next query on a dead socket fails with
    // ECONNRESET and surfaces as a random 500 (seen in Module 14
    // acceptance runs). Keep the socket alive and probe it early.
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 20000,
    dateStrings: true, // Returns DATE and DATETIME fields as strings (YYYY-MM-DD)
    ...(isLocalHost ? {} : { ssl: { rejectUnauthorized: false } })
});

// Test database connection on server startup
pool.getConnection()
    .then((connection) => {
        console.log('✅ Successfully connected to MySQL Database.');
        connection.release();
    })
    .catch((err) => {
        console.warn('\n⚠️  MySQL Connection Note:');
        console.warn(`   Unable to connect to MySQL database '${process.env.DB_NAME || 'inventory_db'}' at ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}.`);
        console.warn(`   Details: ${err.message}`);
        console.warn('   👉 Please ensure MySQL server is running and check backend/.env credentials.\n');
    });

module.exports = pool;
