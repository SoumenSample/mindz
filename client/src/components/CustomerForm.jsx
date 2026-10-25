/**
 * CustomerForm Component
 * Merged Component handling both Customer Input Form and Customer Data Table List,
 * with search, validations, country codes, city/state dropdowns, status toggle switch, and CRUD operations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import CustomerService from '../services/CustomerService';
import LocationService from '../services/LocationService';
import { FALLBACK_STATES } from '../data/locationFallback';

// List of major Indian cities with their corresponding states
const CITY_STATE_MAPPING = [
    { city: 'Kolkata', state: 'West Bengal' },
    { city: 'Mumbai', state: 'Maharashtra' },
    { city: 'Delhi', state: 'Delhi' },
    { city: 'Bengaluru', state: 'Karnataka' },
    { city: 'Chennai', state: 'Tamil Nadu' },
    { city: 'Hyderabad', state: 'Telangana' },
    { city: 'Pune', state: 'Maharashtra' },
    { city: 'Ahmedabad', state: 'Gujarat' },
    { city: 'Jaipur', state: 'Rajasthan' },
    { city: 'Surat', state: 'Gujarat' },
    { city: 'Lucknow', state: 'Uttar Pradesh' },
    { city: 'Chandigarh', state: 'Chandigarh' },
    { city: 'Noida', state: 'Uttar Pradesh' },
    { city: 'Gurgaon', state: 'Haryana' },
    { city: 'Visakhapatnam', state: 'Andhra Pradesh' },
    { city: 'Indore', state: 'Madhya Pradesh' },
    { city: 'Vadodara', state: 'Gujarat' },
    { city: 'Bhopal', state: 'Madhya Pradesh' },
    { city: 'Coimbatore', state: 'Tamil Nadu' },
    { city: 'Patna', state: 'Bihar' },
    { city: 'Howrah', state: 'West Bengal' },
    { city: 'Siliguri', state: 'West Bengal' },
    { city: 'Durgapur', state: 'West Bengal' },
    { city: 'Asansol', state: 'West Bengal' },
    { city: 'Nagpur', state: 'Maharashtra' },
    { city: 'Thane', state: 'Maharashtra' },
    { city: 'Kochi', state: 'Kerala' },
    { city: 'Guwahati', state: 'Assam' }
];

// Country codes list
const COUNTRY_CODES = [
    { code: '+91', country: '🇮🇳 India (+91)' },
    { code: '+1', country: '🇺🇸 USA/Canada (+1)' },
    { code: '+44', country: '🇬🇧 UK (+44)' },
    { code: '+61', country: '🇦🇺 Australia (+61)' },
    { code: '+971', country: '🇦🇪 UAE (+971)' },
    { code: '+65', country: '🇸🇬 Singapore (+65)' },
    { code: '+49', country: '🇩🇪 Germany (+49)' }
];

const initialFormState = {
    CustomerId: '',
    CustomerCode: '',
    CustomerName: '',
    Email: '',
    CountryCode: '+91',
    MobileNoOnly: '',
    MobileNo: '',
    Address: '',
    City: '',
    State: '',
    Status: 'Active',
    CreatedDate: new Date().toISOString().slice(0, 10)
};

const CustomerForm = () => {
    // Form & Data State
    const [formData, setFormData] = useState(initialFormState);
    const [customers, setCustomers] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isCustomCity, setIsCustomCity] = useState(false);
    const [isCustomState, setIsCustomState] = useState(false);
    const [errors, setErrors] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [alert, setAlert] = useState({ show: false, type: '', message: '' });
    // Dynamic states from StateMaster (fallback = bundled list when offline).
    const [stateOptions, setStateOptions] = useState(FALLBACK_STATES.map(s => s.name));

    useEffect(() => {
        let alive = true;
        LocationService.getStates().then((list) => {
            if (alive && Array.isArray(list) && list.length > 0) {
                setStateOptions(list.map(s => s.name));
            }
        });
        return () => { alive = false; };
    }, []);

    // Toast Alert notification
    const showAlert = (type, message) => {
        setAlert({ show: true, type, message });
        setTimeout(() => setAlert({ show: false, type: '', message: '' }), 5000);
    };

    const dismissAlert = () => {
        setAlert({ show: false, type: '', message: '' });
    };

    // Load Customer List from Backend API
    const loadCustomers = useCallback(async (searchQuery = '') => {
        setIsLoading(true);
        try {
            const response = await CustomerService.getAllCustomers(searchQuery);
            if (response.success) {
                setCustomers(response.data);
            } else {
                showAlert('danger', response.message || 'Failed to fetch customer records.');
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
            const errorMsg = error.response?.data?.message || 'Unable to connect to backend server. Make sure Node.js server is running.';
            showAlert('danger', errorMsg);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Initial Data Fetch
    useEffect(() => {
        loadCustomers();
    }, [loadCustomers]);

    // Parse full mobile number into Country Code and 10-digit number
    const parseMobileNumber = useCallback((fullNumber) => {
        if (!fullNumber) return { countryCode: '+91', number: '' };
        const cleanNumber = fullNumber.replace(/\s+/g, '');
        const foundCode = COUNTRY_CODES.find(c => cleanNumber.startsWith(c.code));
        if (foundCode) {
            return {
                countryCode: foundCode.code,
                number: cleanNumber.replace(foundCode.code, '').trim()
            };
        }
        return { countryCode: '+91', number: cleanNumber.trim() };
    }, []);

    // Form Reset Handler
    const handleReset = useCallback(() => {
        setFormData(initialFormState);
        setSelectedCustomer(null);
        setIsCustomCity(false);
        setIsCustomState(false);
        setErrors({});
    }, []);

    // Populate form when editing an existing customer
    useEffect(() => {
        if (selectedCustomer) {
            const { countryCode, number } = parseMobileNumber(selectedCustomer.MobileNo || '');
            const existingCity = selectedCustomer.City || '';
            const existingState = selectedCustomer.State || '';

            const isCityInList = CITY_STATE_MAPPING.some(item => item.city.toLowerCase() === existingCity.toLowerCase());
            const isStateInList = stateOptions.some(st => st.toLowerCase() === existingState.toLowerCase());

            setFormData({
                CustomerId: selectedCustomer.CustomerId || '',
                CustomerCode: selectedCustomer.CustomerCode || '',
                CustomerName: selectedCustomer.CustomerName || '',
                Email: selectedCustomer.Email || '',
                CountryCode: countryCode,
                MobileNoOnly: number,
                MobileNo: selectedCustomer.MobileNo || '',
                Address: selectedCustomer.Address || '',
                City: existingCity,
                State: existingState,
                Status: selectedCustomer.Status || 'Active',
                CreatedDate: selectedCustomer.CreatedDate || new Date().toISOString().slice(0, 10)
            });
            setIsCustomCity(!isCityInList && existingCity !== '');
            setIsCustomState(!isStateInList && existingState !== '');
            setErrors({});
        } else {
            setFormData(initialFormState);
            setIsCustomCity(false);
            setIsCustomState(false);
            setErrors({});
        }
    }, [selectedCustomer, parseMobileNumber, stateOptions]);

    // Input Change Handler
    const handleChange = (e) => {
        const { name, value } = e.target;
        
        setFormData((prev) => {
            const updated = { ...prev, [name]: value };
            if (name === 'CountryCode' || name === 'MobileNoOnly') {
                const code = name === 'CountryCode' ? value : prev.CountryCode;
                const num = name === 'MobileNoOnly' ? value : prev.MobileNoOnly;
                updated.MobileNo = num ? `${code}${num}` : '';
            }
            return updated;
        });

        if (errors[name]) {
            setErrors((prev) => ({ ...prev, [name]: '' }));
        }
    };

    // City Selection Handler with Auto State Population
    const handleCitySelect = (e) => {
        const selectedValue = e.target.value;
        if (selectedValue === 'OTHER') {
            setIsCustomCity(true);
            setFormData(prev => ({ ...prev, City: '' }));
        } else {
            setIsCustomCity(false);
            const matched = CITY_STATE_MAPPING.find(item => item.city === selectedValue);
            setFormData(prev => ({
                ...prev,
                City: selectedValue,
                State: matched ? matched.state : prev.State
            }));
            if (matched) {
                setIsCustomState(!stateOptions.includes(matched.state));
            }
        }
        if (errors.City) setErrors(prev => ({ ...prev, City: '' }));
    };

    // State Selection Handler
    const handleStateSelect = (e) => {
        const selectedValue = e.target.value;
        if (selectedValue === 'OTHER') {
            setIsCustomState(true);
            setFormData(prev => ({ ...prev, State: '' }));
        } else {
            setIsCustomState(false);
            setFormData(prev => ({ ...prev, State: selectedValue }));
        }
        if (errors.State) setErrors(prev => ({ ...prev, State: '' }));
    };

    // Status Checkbox Toggle Handler
    const handleStatusToggle = (e) => {
        const isChecked = e.target.checked;
        setFormData(prev => ({
            ...prev,
            Status: isChecked ? 'Active' : 'Inactive'
        }));
    };

    // Search Handler
    const handleSearchChange = (e) => {
        const value = e.target.value;
        setSearchTerm(value);
        loadCustomers(value);
    };

    const handleClearSearch = () => {
        setSearchTerm('');
        loadCustomers('');
    };

    // Client-side Validation Logic
    const validateForm = () => {
        const newErrors = {};

        if (!formData.CustomerCode.trim()) {
            newErrors.CustomerCode = 'Customer Code is required.';
        }

        if (!formData.CustomerName.trim()) {
            newErrors.CustomerName = 'Customer Name is required.';
        }

        if (formData.Email && formData.Email.trim() !== '') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(formData.Email.trim())) {
                newErrors.Email = 'Please enter a valid email address.';
            }
        }

        if (formData.MobileNoOnly && formData.MobileNoOnly.trim() !== '') {
            const mobileRegex = /^[0-9]{10}$/;
            if (!mobileRegex.test(formData.MobileNoOnly.trim())) {
                newErrors.MobileNoOnly = 'Mobile number must be exactly 10 digits.';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Form Submit Handler (Create & Update API calls)
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        setIsSubmitting(true);
        try {
            const payload = {
                ...formData,
                MobileNo: formData.MobileNoOnly ? `${formData.CountryCode}${formData.MobileNoOnly}` : ''
            };

            if (formData.CustomerId) {
                // Update Customer
                const response = await CustomerService.updateCustomer(formData.CustomerId, payload);
                if (response.success) {
                    showAlert('success', 'Customer record updated successfully.');
                    handleReset();
                    loadCustomers(searchTerm);
                }
            } else {
                // Create New Customer
                const response = await CustomerService.createCustomer(payload);
                if (response.success) {
                    showAlert('success', 'New customer added successfully.');
                    handleReset();
                    loadCustomers(searchTerm);
                }
            }
        } catch (error) {
            console.error('Form submission failed:', error);
            const errorMsg = error.response?.data?.message || 'An error occurred while saving.';
            showAlert('danger', errorMsg);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Edit Row Click Handler
    const handleEditClick = (customer) => {
        setSelectedCustomer(customer);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Delete Row Click Handler with Confirmation
    const handleDeleteClick = async (customer) => {
        const confirmMessage = `Are you sure you want to delete customer "${customer.CustomerName}" (${customer.CustomerCode})?`;
        if (window.confirm(confirmMessage)) {
            try {
                const response = await CustomerService.deleteCustomer(customer.CustomerId);
                if (response.success) {
                    showAlert('success', 'Customer deleted successfully.');
                    if (selectedCustomer && selectedCustomer.CustomerId === customer.CustomerId) {
                        handleReset();
                    }
                    loadCustomers(searchTerm);
                } else {
                    showAlert('danger', response.message || 'Failed to delete customer.');
                }
            } catch (error) {
                console.error('Delete customer error:', error);
                const errorMsg = error.response?.data?.message || 'An error occurred while deleting customer.';
                showAlert('danger', errorMsg);
            }
        }
    };

    const isEditMode = Boolean(formData.CustomerId);

    return (
        <div>
            {/* Status Alert Notification Banner */}
            {alert.show && (
                <div className={`alert alert-${alert.type} alert-dismissible fade show shadow-sm mb-4`} role="alert">
                    <div className="d-flex align-items-center">
                        <i className={`bi ${alert.type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} me-2 fs-5`}></i>
                        <div>{alert.message}</div>
                    </div>
                    <button type="button" className="btn-close" onClick={dismissAlert} aria-label="Close"></button>
                </div>
            )}

            {/* CUSTOMER INPUT FORM SECTION */}
            <div className="card shadow-sm border-0 mb-4">
                <div className={`card-header text-white d-flex justify-content-between align-items-center ${isEditMode ? 'bg-warning text-dark' : 'bg-primary'}`}>
                    <h5 className="mb-0">
                        <i className={`bi ${isEditMode ? 'bi-pencil-square' : 'bi-person-plus-fill'} me-2`}></i>
                        {isEditMode ? 'Edit Customer Master' : 'Add New Customer'}
                    </h5>
                    {isEditMode && (
                        <span className="badge bg-dark">Editing ID: #{formData.CustomerId}</span>
                    )}
                </div>

                <div className="card-body p-4">
                    <form onSubmit={handleSubmit} noValidate>
                        <div className="row g-3">
                            {/* Customer Code */}
                            <div className="col-md-4">
                                <label className="form-label">
                                    Customer Code <span className="text-danger">*</span>
                                </label>
                                <input
                                    type="text"
                                    className={`form-control ${errors.CustomerCode ? 'is-invalid' : ''}`}
                                    name="CustomerCode"
                                    value={formData.CustomerCode}
                                    onChange={handleChange}
                                    placeholder="e.g., CUST001"
                                    disabled={isEditMode}
                                />
                                {errors.CustomerCode && (
                                    <div className="invalid-feedback">{errors.CustomerCode}</div>
                                )}
                            </div>

                            {/* Customer Name */}
                            <div className="col-md-4">
                                <label className="form-label">
                                    Customer Name <span className="text-danger">*</span>
                                </label>
                                <input
                                    type="text"
                                    className={`form-control ${errors.CustomerName ? 'is-invalid' : ''}`}
                                    name="CustomerName"
                                    value={formData.CustomerName}
                                    onChange={handleChange}
                                    placeholder="e.g., John Doe"
                                />
                                {errors.CustomerName && (
                                    <div className="invalid-feedback">{errors.CustomerName}</div>
                                )}
                            </div>

                            {/* Email */}
                            <div className="col-md-4">
                                <label className="form-label">Email Address</label>
                                <input
                                    type="email"
                                    className={`form-control ${errors.Email ? 'is-invalid' : ''}`}
                                    name="Email"
                                    value={formData.Email}
                                    onChange={handleChange}
                                    placeholder="e.g., john@example.com"
                                />
                                {errors.Email && (
                                    <div className="invalid-feedback">{errors.Email}</div>
                                )}
                            </div>

                            {/* Mobile Number with Country Code Dropdown */}
                            <div className="col-md-4">
                                <label className="form-label">Mobile Number</label>
                                <div className="input-group">
                                    <select
                                        className="form-select bg-light fw-medium"
                                        style={{ maxWidth: '140px' }}
                                        name="CountryCode"
                                        value={formData.CountryCode}
                                        onChange={handleChange}
                                    >
                                        {COUNTRY_CODES.map(c => (
                                            <option key={c.code} value={c.code}>
                                                {c.country}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        type="text"
                                        className={`form-control ${errors.MobileNoOnly ? 'is-invalid' : ''}`}
                                        name="MobileNoOnly"
                                        value={formData.MobileNoOnly}
                                        onChange={handleChange}
                                        placeholder="9876543210"
                                        maxLength={10}
                                    />
                                    {errors.MobileNoOnly && (
                                        <div className="invalid-feedback">{errors.MobileNoOnly}</div>
                                    )}
                                </div>
                            </div>

                            {/* Status Checkbox / Toggle Switch */}
                            <div className="col-md-4">
                                <label className="form-label d-block">Customer Status</label>
                                <div className="form-check form-switch mt-2 p-0 d-flex align-items-center">
                                    <input
                                        className="form-check-input ms-0 me-2"
                                        type="checkbox"
                                        role="switch"
                                        id="statusSwitch"
                                        checked={formData.Status === 'Active'}
                                        onChange={handleStatusToggle}
                                        style={{ width: '2.8em', height: '1.4em', cursor: 'pointer' }}
                                    />
                                    <label className="form-check-label fw-semibold" htmlFor="statusSwitch" style={{ cursor: 'pointer' }}>
                                        {formData.Status === 'Active' ? (
                                            <span className="badge bg-success-subtle text-success fs-6 border border-success-subtle px-3 py-2 rounded-pill">
                                                <i className="bi bi-check-circle-fill me-1"></i> Active
                                            </span>
                                        ) : (
                                            <span className="badge bg-secondary-subtle text-secondary fs-6 border border-secondary-subtle px-3 py-2 rounded-pill">
                                                <i className="bi bi-x-circle-fill me-1"></i> Inactive
                                            </span>
                                        )}
                                    </label>
                                </div>
                            </div>

                            {/* Created Date */}
                            <div className="col-md-4">
                                <label className="form-label">Created Date</label>
                                <input
                                    type="date"
                                    className="form-control"
                                    name="CreatedDate"
                                    value={formData.CreatedDate}
                                    onChange={handleChange}
                                />
                            </div>

                            {/* Address */}
                            <div className="col-md-6">
                                <label className="form-label">Street Address</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    name="Address"
                                    value={formData.Address}
                                    onChange={handleChange}
                                    placeholder="e.g., 123 Main Street, Suite 4B"
                                />
                            </div>

                            {/* City Dropdown Select */}
                            <div className="col-md-3">
                                <label className="form-label">City</label>
                                {!isCustomCity ? (
                                    <select
                                        className="form-select"
                                        name="City"
                                        value={formData.City}
                                        onChange={handleCitySelect}
                                    >
                                        <option value="">-- Select City --</option>
                                        {CITY_STATE_MAPPING.map(item => (
                                            <option key={item.city} value={item.city}>
                                                {item.city} ({item.state})
                                            </option>
                                        ))}
                                        <option value="OTHER">➕ Other (Type manually)...</option>
                                    </select>
                                ) : (
                                    <div className="input-group">
                                        <input
                                            type="text"
                                            className="form-control"
                                            name="City"
                                            value={formData.City}
                                            onChange={handleChange}
                                            placeholder="Type city name..."
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-outline-secondary"
                                            onClick={() => setIsCustomCity(false)}
                                            title="Back to Dropdown"
                                        >
                                            <i className="bi bi-list"></i>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* State Dropdown Select */}
                            <div className="col-md-3">
                                <label className="form-label">State</label>
                                {!isCustomState ? (
                                    <select
                                        className="form-select"
                                        name="State"
                                        value={formData.State}
                                        onChange={handleStateSelect}
                                    >
                                        <option value="">-- Select State --</option>
                                        {stateOptions.map(st => (
                                            <option key={st} value={st}>
                                                {st}
                                            </option>
                                        ))}
                                        <option value="OTHER">➕ Other (Type manually)...</option>
                                    </select>
                                ) : (
                                    <div className="input-group">
                                        <input
                                            type="text"
                                            className="form-control"
                                            name="State"
                                            value={formData.State}
                                            onChange={handleChange}
                                            placeholder="Type state name..."
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-outline-secondary"
                                            onClick={() => setIsCustomState(false)}
                                            title="Back to Dropdown"
                                        >
                                            <i className="bi bi-list"></i>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="d-flex justify-content-end gap-2 mt-4 pt-2 border-top">
                            <button
                                type="button"
                                className="btn btn-outline-secondary px-4"
                                onClick={handleReset}
                                disabled={isSubmitting}
                            >
                                <i className="bi bi-arrow-counterclockwise me-1"></i> Reset
                            </button>
                            <button
                                type="submit"
                                className={`btn ${isEditMode ? 'btn-warning' : 'btn-primary'} px-4`}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <i className={`bi ${isEditMode ? 'bi-check-circle' : 'bi-save'} me-1`}></i>
                                        {isEditMode ? 'Update Customer' : 'Save Customer'}
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* CUSTOMER TABLE LIST SECTION */}
            <div className="card shadow-sm border-0">
                <div className="card-header bg-white py-3 d-flex flex-wrap justify-content-between align-items-center gap-2">
                    <h5 className="mb-0 text-dark fw-bold">
                        <i className="bi bi-people-fill text-primary me-2"></i>
                        Customer Master Records
                        <span className="badge bg-primary-subtle text-primary rounded-pill ms-2 fs-6">
                            {customers ? customers.length : 0} Total
                        </span>
                    </h5>

                    {/* Search Bar */}
                    <div className="d-flex align-items-center" style={{ minWidth: '280px' }}>
                        <div className="input-group">
                            <span className="input-group-text bg-light border-end-0">
                                <i className="bi bi-search text-muted"></i>
                            </span>
                            <input
                                type="text"
                                className="form-control bg-light border-start-0 ps-0"
                                placeholder="Search by Customer Name..."
                                value={searchTerm}
                                onChange={handleSearchChange}
                            />
                            {searchTerm && (
                                <button
                                    className="btn btn-outline-secondary border-start-0"
                                    type="button"
                                    onClick={handleClearSearch}
                                    title="Clear Search"
                                >
                                    <i className="bi bi-x-lg"></i>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="card-body p-0">
                    <div className="table-responsive">
                        <table className="table table-hover align-middle mb-0">
                            <thead className="table-light">
                                <tr>
                                    <th scope="col" className="ps-3" style={{ width: '60px' }}># S.No</th>
                                    <th scope="col">Code</th>
                                    <th scope="col">Customer Name</th>
                                    <th scope="col">Email</th>
                                    <th scope="col" style={{ whiteSpace: 'nowrap' }}>Mobile No</th>
                                    <th scope="col">City / State</th>
                                    <th scope="col">Status</th>
                                    <th scope="col">Created Date</th>
                                    <th scope="col" className="text-end pe-4" style={{ width: '160px' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isLoading ? (
                                    <tr>
                                        <td colSpan="9" className="text-center py-5">
                                            <div className="spinner-border text-primary" role="status">
                                                <span className="visually-hidden">Loading customers...</span>
                                            </div>
                                            <p className="mt-2 text-muted mb-0">Fetching customer master data...</p>
                                        </td>
                                    </tr>
                                ) : customers && customers.length > 0 ? (
                                    customers.map((customer, index) => (
                                        <tr key={customer.CustomerId}>
                                            {/* Serial Number */}
                                            <td className="ps-3 fw-medium text-secondary">{index + 1}</td>
                                            
                                            {/* Customer Code */}
                                            <td>
                                                <span className="badge bg-light text-dark border font-monospace">
                                                    {customer.CustomerCode}
                                                </span>
                                            </td>

                                            {/* Customer Name */}
                                            <td className="fw-semibold text-dark">
                                                {customer.CustomerName}
                                            </td>

                                            {/* Email */}
                                            <td>
                                                {customer.Email ? (
                                                    <a href={`mailto:${customer.Email}`} className="text-decoration-none text-body">
                                                        <i className="bi bi-envelope me-1 text-muted"></i>
                                                        {customer.Email}
                                                    </a>
                                                ) : (
                                                    <span className="text-muted fst-italic">N/A</span>
                                                )}
                                            </td>

                                            {/* Mobile Number */}
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                {customer.MobileNo ? (
                                                    <span>
                                                        <i className="bi bi-telephone me-1 text-muted"></i>
                                                        {customer.MobileNo.replace(/\s+/g, '')}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted fst-italic">N/A</span>
                                                )}
                                            </td>

                                            {/* Location */}
                                            <td>
                                                {customer.City || customer.State ? (
                                                    <span>
                                                        {customer.City}{customer.City && customer.State ? ', ' : ''}{customer.State}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted fst-italic">N/A</span>
                                                )}
                                            </td>

                                            {/* Status */}
                                            <td>
                                                {customer.Status === 'Active' ? (
                                                    <span className="badge-status-active">
                                                        <i className="bi bi-check-circle-fill me-1"></i> Active
                                                    </span>
                                                ) : (
                                                    <span className="badge-status-inactive">
                                                        <i className="bi bi-x-circle-fill me-1"></i> Inactive
                                                    </span>
                                                )}
                                            </td>

                                            {/* Created Date */}
                                            <td>
                                                <small className="text-muted">
                                                    {customer.CreatedDate || 'N/A'}
                                                </small>
                                            </td>

                                            {/* Action Buttons */}
                                            <td className="text-end pe-4">
                                                <div className="btn-group btn-group-sm" role="group">
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-primary btn-action"
                                                        onClick={() => handleEditClick(customer)}
                                                        title="Edit Customer"
                                                    >
                                                        <i className="bi bi-pencil-fill"></i> Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn btn-outline-danger btn-action"
                                                        onClick={() => handleDeleteClick(customer)}
                                                        title="Delete Customer"
                                                    >
                                                        <i className="bi bi-trash-fill"></i> Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan="9" className="text-center py-5 text-muted">
                                            <i className="bi bi-inbox fs-1 d-block mb-2 text-secondary"></i>
                                            {searchTerm ? (
                                                <span>No customers found matching "<strong>{searchTerm}</strong>".</span>
                                            ) : (
                                                <span>No customer records available. Add a new customer above to get started.</span>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CustomerForm;
