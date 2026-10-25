const jwt = require("jsonwebtoken")
// Secret key
const SECRET_KEY = "mySecretKey";
// Payload
const user = {
id: 1,
name: "Dipak Maiti",
role: "Admin"
};

// Generate Token
const token = jwt.sign(user, SECRET_KEY, {
expiresIn: "1h"
});

console.log("Generated Token:\n");
console.log(token);

// Verify Token
try {
const decoded = jwt.verify(token, SECRET_KEY);

console.log("\nDecoded Token:");
console.log(decoded);
}
catch (error) {
console.log("Invalid Token");
}