/**
 * Customer Model
 * Handles database operations for the customermaster table using parameterized SQL queries.
 */

const db = require('../config/db');

const Customer = {
    /**
     * Get all customers, optionally filtered by CustomerName
     * @param {string} searchName - Optional search keyword for customer name
     */
    getAll: async (searchName = '') => {
        let sql = `SELECT CustomerId, CustomerCode, CustomerName, Email, MobileNo, Address, City, State, Status, DATE_FORMAT(CreatedDate, '%Y-%m-%d') AS CreatedDate FROM customermaster`;
        const params = [];

        if (searchName && searchName.trim() !== '') {
            sql += ` WHERE CustomerName LIKE ?`;
            params.push(`%${searchName.trim()}%`);
        }

        sql += ` ORDER BY CustomerId DESC`;

        const [rows] = await db.query(sql, params);
        return rows;
    },

    /**
     * Get a customer by CustomerId
     * @param {number} id - Customer ID
     */
    getById: async (id) => {
        const sql = `SELECT CustomerId, CustomerCode, CustomerName, Email, MobileNo, Address, City, State, Status, DATE_FORMAT(CreatedDate, '%Y-%m-%d') AS CreatedDate FROM customermaster WHERE CustomerId = ?`;
        const [rows] = await db.query(sql, [id]);
        return rows[0] || null;
    },

    /**
     * Find customer by CustomerCode (for duplicate check)
     * @param {string} customerCode 
     */
    getByCode: async (customerCode) => {
        const sql = `SELECT CustomerId, CustomerCode FROM customermaster WHERE CustomerCode = ?`;
        const [rows] = await db.query(sql, [customerCode]);
        return rows[0] || null;
    },

    /**
     * Create a new customer record
     * @param {Object} data - Customer data object
     */
    create: async (data) => {
        const {
            CustomerCode,
            CustomerName,
            Email,
            MobileNo,
            Address,
            City,
            State,
            Status,
            CreatedDate
        } = data;

        const sql = `
            INSERT INTO customermaster 
            (CustomerCode, CustomerName, Email, MobileNo, Address, City, State, Status, CreatedDate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            CustomerCode,
            CustomerName,
            Email || null,
            MobileNo || null,
            Address || null,
            City || null,
            State || null,
            Status || 'Active',
            CreatedDate || new Date().toISOString().slice(0, 10)
        ];

        const [result] = await db.query(sql, values);
        return result.insertId;
    },

    /**
     * Update an existing customer record
     * @param {number} id - Customer ID
     * @param {Object} data - Customer data object
     */
    update: async (id, data) => {
        const {
            CustomerCode,
            CustomerName,
            Email,
            MobileNo,
            Address,
            City,
            State,
            Status,
            CreatedDate
        } = data;

        const sql = `
            UPDATE customermaster 
            SET CustomerCode = ?, 
                CustomerName = ?, 
                Email = ?, 
                MobileNo = ?, 
                Address = ?, 
                City = ?, 
                State = ?, 
                Status = ?, 
                CreatedDate = ?
            WHERE CustomerId = ?
        `;

        const values = [
            CustomerCode,
            CustomerName,
            Email || null,
            MobileNo || null,
            Address || null,
            City || null,
            State || null,
            Status || 'Active',
            CreatedDate || null,
            id
        ];

        const [result] = await db.query(sql, values);
        return result.affectedRows > 0;
    },

    /**
     * Delete a customer record by ID
     * @param {number} id - Customer ID
     */
    delete: async (id) => {
        const sql = `DELETE FROM customermaster WHERE CustomerId = ?`;
        const [result] = await db.query(sql, [id]);
        return result.affectedRows > 0;
    }
};

module.exports = Customer;
