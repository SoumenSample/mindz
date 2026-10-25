function parseEmployeeText(text) {

    const employee = {

        employeeCode: null,

        employeeName: null,

        department: null,

        designation: null,

        email: null,

        phone: null,

        salary: null

    };

    const lines =
        text
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);

    lines.forEach(line => {

        if (
            line.toLowerCase()
                .startsWith("employee code")
        ) {

            employee.employeeCode =
                line.split(":")[1]?.trim();

        }

        else if (
            line.toLowerCase()
                .startsWith("employee name")
        ) {

            employee.employeeName =
                line.split(":")[1]?.trim();

        }

        else if (
            line.toLowerCase()
                .startsWith("department")
        ) {

            employee.department =
                line.split(":")[1]?.trim();

        }

        else if (
            line.toLowerCase()
                .startsWith("designation")
        ) {

            employee.designation =
                line.split(":")[1]?.trim();

        }

        else if (
            line.toLowerCase()
                .startsWith("email")
        ) {

            employee.email =
                line.split(":")[1]?.trim();

        }

        else if (
            line.toLowerCase()
                .startsWith("phone")
        ) {

            employee.phone =
                line.split(":")[1]?.trim();

        }

        else if (
            line.toLowerCase()
                .startsWith("salary")
        ) {

            employee.salary =
                parseFloat(
                    line.split(":")[1]?.trim()
                );

        }

    });

    return employee;
}

module.exports = parseEmployeeText;