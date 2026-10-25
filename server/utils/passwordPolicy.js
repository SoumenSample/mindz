// Shared password policy (account hardening).
// New/temporary passwords: minimum 8 characters with at least one
// letter and one number. Provisioning-time minimums (6) stay where
// they are; this policy governs change-password + admin reset.
function validateNewPassword(password) {
  if (!password || typeof password !== "string") {
    return "New password is required.";
  }
  if (password.length < 8) {
    return "New password must be at least 8 characters.";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "New password must contain at least one letter and one number.";
  }
  return null;
}

module.exports = { validateNewPassword };
