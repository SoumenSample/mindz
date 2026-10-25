/**
 * Customer Routes
 * Express router mapping RESTful endpoints to customer controller functions.
 */

const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');

// GET /customers - Fetch all customers or search by CustomerName
router.get('/', customerController.getAllCustomers);

// GET /customers/:id - Fetch single customer by ID
router.get('/:id', customerController.getCustomerById);

// POST /customers - Create a new customer record
router.post('/', customerController.createCustomer);

// PUT /customers/:id - Update existing customer record
router.put('/:id', customerController.updateCustomer);

// DELETE /customers/:id - Delete customer record
router.delete('/:id', customerController.deleteCustomer);

module.exports = router;
