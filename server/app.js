const express = require("express");
const cors = require("cors");

const ocrRoutes = require("./routes/ocrRoutes");
const authRoutes = require("./routes/authRoutes");
const customerRoutes = require("./routes/customerRoutes");
const employeeRoutes = require("./routes/employeeRoutes");
const clientRoutes = require("./routes/clientRoutes");
const storeRoutes = require("./routes/storeRoutes");
const jobRequestRoutes = require("./routes/jobRequestRoutes");
const jobRoutes = require("./routes/jobRoutes");
const visitRoutes = require("./routes/visitRoutes");
const trackingRoutes = require("./routes/trackingRoutes");
const jobPhotoRoutes = require("./routes/jobPhotoRoutes");
const signatureRoutes = require("./routes/signatureRoutes");
const reportRoutes = require("./routes/reportRoutes");
const measurementRoutes = require("./routes/measurementRoutes");
const rbacAdminRoutes = require("./routes/rbacAdminRoutes");
const adminUserRoutes = require("./routes/adminUserRoutes");
const locationMasterRoutes = require("./routes/locationMasterRoutes");

const app = express();

// CORS origins from env (comma-separated for multiple frontends).
// e.g. FRONTEND_URL=http://localhost:3000 or
// FRONTEND_URL=https://app.example.com,https://admin.example.com
// Private-LAN http origins (10/8, 172.16/12, 192.168/16, localhost, any
// port) are additionally allowed so phones/laptops on the same Wi-Fi can
// use the app via the server's LAN IP with no extra config. Auth is
// Bearer-header based (no cookies), so this does not weaken security.
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const LAN_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // curl / native apps
      if (allowedOrigins.includes(origin) || LAN_ORIGIN.test(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

// Module 11: photo evidence must NEVER be reachable through the public
// static mount (that would bypass authorization). This wall is registered
// BEFORE express.static on purpose — Express matches in order, so
// /uploads/job_photos/* always 404s here. Reads go through the
// authenticated GET /api/job-photos/:id/view endpoint instead.
// (Legacy /uploads files such as OCR scans keep existing behavior.)
app.use(
    "/uploads/job_photos",
    (req, res) => res.status(404).json({ success: false, message: "Not found." })
);

// Module 12: same wall for signature evidence (authenticated
// GET /api/signatures/:id/view is the only read path).
app.use(
    "/uploads/signatures",
    (req, res) => res.status(404).json({ success: false, message: "Not found." })
);

app.use(
    "/uploads",
    express.static("uploads")
);

app.use(
    "/api/ocr",
    ocrRoutes
);

app.use("/api/auth", authRoutes);

// Customer Master (kept for existing module)
app.use("/customers", customerRoutes);
app.use("/api/customers", customerRoutes);

// Employee Master
app.use("/api/employees", employeeRoutes);

// Client Master 
app.use("/api/clients", clientRoutes);

// Store Master 
app.use("/api/stores", storeRoutes);

// Job Requests (requests only, no operational jobs)
app.use("/api/job-requests", jobRequestRoutes);

// Operational Jobs + Assignment ( — no visits/GPS/verification)
app.use("/api/jobs", jobRoutes);

// Visits  + live tracking view (polling, no sockets)
app.use("/api/visits", visitRoutes);
app.use("/api/tracking", trackingRoutes);

// Measurement sheets  — no photos/signatures/verification)
app.use("/api/measurement-sheets", measurementRoutes);

// Job photo evidence (Module 11 — authenticated view endpoint; the
// /uploads/job_photos static path above stays walled off)
app.use("/api/job-photos", jobPhotoRoutes);

// Shopkeeper signatures (Module 12 — same evidence pattern)
app.use("/api/signatures", signatureRoutes);

// Visit reports (Module 12.1 — read-only PDF downloads)
app.use("/api/reports", reportRoutes);

// RBAC administration (SUPER_ADMIN only)
app.use("/api/admin/rbac", rbacAdminRoutes);

// Admin user-password management (account hardening, permission-gated)
app.use("/api/admin", adminUserRoutes);

// Location masters (states + districts for dynamic dropdowns)
app.use("/api/locations", locationMasterRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "AllTest API is running (auth + customers + ocr)"
    });
});

// 404 + global error handler (must be last)
app.use((req, res) => {
    res.status(404).json({ success: false, message: "Requested endpoint not found." });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error("Unhandled Error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
});

module.exports = app;