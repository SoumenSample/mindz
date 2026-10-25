/**
 * Customer Controller
 * Business logic and HTTP response formatting for Customer Master endpoints.
 */

const Customer = require('../models/customerModel');

/**
 * Validate customer input parameters
 * @param {Object} body 
 * @returns {Array} List of validation error strings
 */
const validateCustomerData = (body) => {
    const errors = [];
    const { CustomerCode, CustomerName, Email, MobileNo, Status } = body;

    if (!CustomerCode || CustomerCode.trim() === '') {
        errors.push('Customer Code is required.');
    }

    if (!CustomerName || CustomerName.trim() === '') {
        errors.push('Customer Name is required.');
    }

    if (Email && Email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(Email.trim())) {
            errors.push('Invalid Email format.');
        }
    }

    // Mobile Number validation: accepts 10 digits or country code format (+91 9876543210)
    if (MobileNo && MobileNo.trim() !== '') {
        // Extract digits only
        const digitsOnly = MobileNo.replace(/\D/g, '');
        if (digitsOnly.length < 10 || digitsOnly.length > 13) {
            errors.push('Mobile Number must contain a valid 10-digit phone number.');
        }
    }

    if (Status && !['Active', 'Inactive'].includes(Status)) {
        errors.push('Status must be either Active or Inactive.');
    }

    return errors;
};

// GET /customers - Retrieve all customers or search by name
exports.getAllCustomers = async (req, res) => {
    try {
        const { search } = req.query;
        const customers = await Customer.getAll(search);
        return res.status(200).json({
            success: true,
            count: customers.length,
            data: customers
        });
    } catch (error) {
        console.error('Error fetching customers:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while fetching customers.',
            error: error.message
        });
    }
};

// GET /customers/:id - Retrieve a single customer by ID
exports.getCustomerById = async (req, res) => {
    try {
        const { id } = req.params;
        const customer = await Customer.getById(id);

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: `Customer with ID ${id} not found.`
            });
        }

        return res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        console.error('Error fetching customer by ID:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while fetching customer details.',
            error: error.message
        });
    }
};

// POST /customers - Create a new customer
exports.createCustomer = async (req, res) => {
    try {
        const validationErrors = validateCustomerData(req.body);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: validationErrors.join(' '),
                errors: validationErrors
            });
        }

        // Check if CustomerCode already exists
        const existingCustomer = await Customer.getByCode(req.body.CustomerCode.trim());
        if (existingCustomer) {
            return res.status(409).json({
                success: false,
                message: `Customer Code '${req.body.CustomerCode}' already exists.`
            });
        }

        const insertId = await Customer.create(req.body);
        const newCustomer = await Customer.getById(insertId);

        return res.status(201).json({
            success: true,
            message: 'Customer created successfully.',
            data: newCustomer
        });
    } catch (error) {
        console.error('Error creating customer:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while creating customer.',
            error: error.message
        });
    }
};

// PUT /customers/:id - Update an existing customer
exports.updateCustomer = async (req, res) => {
    try {
        const { id } = req.params;

        const customerExists = await Customer.getById(id);
        if (!customerExists) {
            return res.status(404).json({
                success: false,
                message: `Customer with ID ${id} not found.`
            });
        }

        const validationErrors = validateCustomerData(req.body);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: validationErrors.join(' '),
                errors: validationErrors
            });
        }

        // Check if CustomerCode belongs to another record
        const codeCheck = await Customer.getByCode(req.body.CustomerCode.trim());
        if (codeCheck && codeCheck.CustomerId !== parseInt(id, 10)) {
            return res.status(409).json({
                success: false,
                message: `Customer Code '${req.body.CustomerCode}' is already assigned to another customer.`
            });
        }

        const updated = await Customer.update(id, req.body);
        if (!updated) {
            return res.status(400).json({
                success: false,
                message: 'Failed to update customer.'
            });
        }

        const updatedCustomer = await Customer.getById(id);

        return res.status(200).json({
            success: true,
            message: 'Customer updated successfully.',
            data: updatedCustomer
        });
    } catch (error) {
        console.error('Error updating customer:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while updating customer.',
            error: error.message
        });
    }
};

// DELETE /customers/:id - Delete customer by ID
exports.deleteCustomer = async (req, res) => {
    try {
        const { id } = req.params;

        const customerExists = await Customer.getById(id);
        if (!customerExists) {
            return res.status(404).json({
                success: false,
                message: `Customer with ID ${id} not found.`
            });
        }

        const deleted = await Customer.delete(id);
        if (!deleted) {
            return res.status(400).json({
                success: false,
                message: 'Failed to delete customer.'
            });
        }

        return res.status(200).json({
            success: true,
            message: `Customer with ID ${id} deleted successfully.`
        });
    } catch (error) {
        console.error('Error deleting customer:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while deleting customer.',
            error: error.message
        });
    }
};
