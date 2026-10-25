/**
 * Customer Service Module
 * Handles API calls to the Express backend using Axios.
 */

import api from './api';

// Uses REACT_APP_API_URL via the shared axios instance (see api.js).
// Calls resolve to `${REACT_APP_API_URL}/customers`, e.g.
// http://localhost:5000/api/customers. Backend also mounts /api/customers.

const CustomerService = {
    /**
     * Fetch all customers or search by customer name
     * @param {string} searchKeyword 
     */
    getAllCustomers: async (searchKeyword = '') => {
        const url = searchKeyword ? `/customers?search=${encodeURIComponent(searchKeyword)}` : '/customers';
        const response = await api.get(url);
        return response.data;
    },

    /**
     * Fetch single customer by ID
     * @param {number} id 
     */
    getCustomerById: async (id) => {
        const response = await api.get(`/customers/${id}`);
        return response.data;
    },

    /**
     * Create a new customer
     * @param {Object} customerData 
     */
    createCustomer: async (customerData) => {
        const response = await api.post('/customers', customerData);
        return response.data;
    },

    /**
     * Update an existing customer by ID
     * @param {number} id 
     * @param {Object} customerData 
     */
    updateCustomer: async (id, customerData) => {
        const response = await api.put(`/customers/${id}`, customerData);
        return response.data;
    },

    /**
     * Delete customer by ID
     * @param {number} id 
     */
    deleteCustomer: async (id) => {
        const response = await api.delete(`/customers/${id}`);
        return response.data;
    }
};

export default CustomerService;
