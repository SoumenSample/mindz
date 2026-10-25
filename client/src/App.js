import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./components/Login";
import ChangePassword from "./components/ChangePassword";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Content from "./components/Content";
import Footer from "./components/Footer";
import AccessControl from "./components/AccessControl";
import EmployeeMaster from "./components/EmployeeMaster";
import ClientMaster from "./components/ClientMaster";
import StoreMaster from "./components/StoreMaster";
import JobRequests from "./components/JobRequests";
import Jobs, { JobDetailPage } from "./components/Jobs";
import Verification from "./components/Verification";
import MyVisits from "./components/MyVisits";
import LiveTracking from "./components/LiveTracking";
import "./App.css";
import "./css/header.css";
import "./css/sidebar.css";
import "./css/content.css";
import "./css/footer.css";

// Tracks the desktop breakpoint (same 991px boundary as content.css).
// Desktop collapse -> icon-only rail; mobile collapse -> off-canvas hide.
function useIsDesktop() {
  const query = "(min-width: 992px)";
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : true
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function DashboardShell({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isDesktop = useIsDesktop();
  // Collapsed state: icon rail on desktop, hidden panel on mobile.
  const railMode = isDesktop && !sidebarOpen;
  return (
    <div className="admin-wrapper">
      <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
      <div className="admin-body">
        <Sidebar
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          railMode={railMode}
        />
        <main
          className={`main-content ${
            sidebarOpen ? "sidebar-expanded" : railMode ? "sidebar-railed" : "sidebar-collapsed"
          }`}
        >
          {children}
          <Footer />
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardShell>
                  <Content />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/access-control"
            element={
              <ProtectedRoute allowedRoles={["SUPER_ADMIN"]}>
                <DashboardShell>
                  <AccessControl />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/* Employee Master (sidebar path comes from menu_items) */}
          <Route
            path="/masters/employees"
            element={
              <ProtectedRoute permission="employees.view">
                <DashboardShell>
                  <EmployeeMaster />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/* Client Master (sidebar Clients entry points to /clients) */}
          <Route
            path="/clients"
            element={
              <ProtectedRoute permission="clients.view.all">
                <DashboardShell>
                  <ClientMaster />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/* Store Master (sidebar Stores entry points to /stores) */}
          <Route
            path="/stores"
            element={
              <ProtectedRoute permission="stores.view.all">
                <DashboardShell>
                  <StoreMaster />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/* CLIENT self-service (sidebar My Stores entry) */}
          <Route
            path="/stores/mine"
            element={
              <ProtectedRoute permission="stores.view.own">
                <DashboardShell>
                  <StoreMaster clientMode />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/* Job Requests (sidebar Job Requests entry for all roles;
              admin vs self-service mode derives from view.all permission) */}
          <Route
            path="/job-requests"
            element={
              <ProtectedRoute anyPermission={["requests.view.all", "requests.view.own"]}>
                <JobRequestsRoute />
              </ProtectedRoute>
            }
          />
          {/* Jobs: admin queue (/jobs, /jobs/all, /jobs/assignments),
              scoped My Jobs (/jobs/mine), verification (/jobs/verification),
              detail (/jobs/:id). */}
          <Route
            path="/jobs/verification"
            element={
              <ProtectedRoute permission="jobs.verify">
                <DashboardShell>
                  <Verification />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs"
            element={
              <ProtectedRoute permission="jobs.view.all">
                <JobsRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/all"
            element={
              <ProtectedRoute permission="jobs.view.all">
                <JobsRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/assignments"
            element={
              <ProtectedRoute permission="jobs.view.all">
                <JobsRoute />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/mine"
            element={
              <ProtectedRoute anyPermission={["jobs.view.all", "jobs.view.own"]}>
                <JobsRoute mine />
              </ProtectedRoute>
            }
          />
          {/* My Jobs status sub-filters (sidebar entries). In Progress
              covers every active field state incl. SIGNATURE_PENDING;
              Submitted covers every awaiting-review state incl. the
              submission-ready VISIT_CLOSED. */}
          <Route
            path="/jobs/mine/assigned"
            element={
              <ProtectedRoute anyPermission={["jobs.view.all", "jobs.view.own"]}>
                <JobsRoute mine statusFilter="ASSIGNED" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/mine/in-progress"
            element={
              <ProtectedRoute anyPermission={["jobs.view.all", "jobs.view.own"]}>
                <JobsRoute mine statusFilter="EN_ROUTE,REACHED,WORK_STARTED,WORK_IN_PROGRESS,IN_PROGRESS,SIGNATURE_PENDING" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/mine/submitted"
            element={
              <ProtectedRoute anyPermission={["jobs.view.all", "jobs.view.own"]}>
                <JobsRoute mine statusFilter="VISIT_CLOSED,SUBMITTED,UNDER_VERIFICATION" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/mine/completed"
            element={
              <ProtectedRoute anyPermission={["jobs.view.all", "jobs.view.own"]}>
                <JobsRoute mine statusFilter="COMPLETED,APPROVED" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jobs/:id"
            element={
              <ProtectedRoute anyPermission={["jobs.view.all", "jobs.view.own"]}>
                <DashboardShell>
                  <JobDetailPage />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/*  My Visits (sidebar My Visits entry, scoped per role) */}
          <Route
            path="/visits/mine"
            element={
              <ProtectedRoute anyPermission={["visits.view.all", "visits.view.own"]}>
                <DashboardShell>
                  <MyVisits />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/*  live tracking board (admin polling view, no sockets) */}
          <Route
            path="/tracking"
            element={
              <ProtectedRoute permission="tracking.view">
                <DashboardShell>
                  <LiveTracking />
                </DashboardShell>
              </ProtectedRoute>
            }
          />
          {/* Self-service password change (also the forced first-login screen) */}
          <Route
            path="/change-password"
            element={
              <ProtectedRoute allowStalePassword>
                <ChangePassword />
              </ProtectedRoute>
            }
          />
          {/* Always land on login first; authenticated users get bounced to dashboard */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Job Requests shell: admin queue vs client self-service derives from
// the view.all permission (no role literals). Backend stays authoritative.
function JobRequestsRoute() {
  const { hasPermission, authzLoading } = useAuth();
  if (authzLoading) {
    return (
      <DashboardShell>
        <div className="text-center py-5"><div className="spinner-border text-primary" role="status"></div></div>
      </DashboardShell>
    );
  }
  const adminView = hasPermission("requests.view.all");
  return (
    <DashboardShell>
      <JobRequests clientMode={!adminView} />
    </DashboardShell>
  );
}

// Jobs shell: admin queue vs scoped My Jobs derives from the view.all
// permission (no role literals). Backend stays authoritative.
// statusFilter presets the list (sidebar My Jobs sub-filters); the user
// can still change it via the status dropdown.
function JobsRoute({ mine, statusFilter }) {
  const { hasPermission, authzLoading } = useAuth();
  if (authzLoading) {
    return (
      <DashboardShell>
        <div className="text-center py-5"><div className="spinner-border text-primary" role="status"></div></div>
      </DashboardShell>
    );
  }
  const adminView = hasPermission("jobs.view.all");
  const key = `${mine || !adminView ? "mine" : "admin"}:${statusFilter || "all"}`;
  return (
    <DashboardShell>
      <Jobs key={key} mode={mine || !adminView ? "mine" : "admin"} statusFilter={statusFilter} />
    </DashboardShell>
  );
}

// Logged-in users visiting /login go straight to dashboard.
// Logged-out users always see the login page first.
function PublicRoute({ children }) {  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="d-flex vh-100 align-items-center justify-content-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

export default App;
