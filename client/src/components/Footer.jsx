import React from "react";

const Footer = () => {

  return (
    <footer className="admin-footer">

      <div>

        © {new Date().getFullYear()} Soumen.
        All rights reserved.

      </div>

      <div className="footer-links">

        <a href="/dashboard">
          Documentation
        </a>

        <a href="/dashboard">
          Support
        </a>

        <a href="/dashboard">
          Privacy
        </a>

      </div>

    </footer>
  );
};

export default Footer;