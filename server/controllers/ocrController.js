const Tesseract = require("tesseract.js");

const pool = require("../config/db");
const parseEmployeeText =
    require("../utils/parseEmployee");

const uploadAndProcessOCR = async (req, res) => {

    try {

        if (!req.file) {

            return res.status(400).json({
                success: false,
                message: "Image is required"
            });

        }

        const fileName = req.file.filename;

        const filePath = req.file.path;

        console.log("Processing:", filePath);

        // Insert initial record

        const [insertResult] = await pool.query(
            `
            INSERT INTO ocr_documents
            (
                FileName,
                FilePath,
                Status
            )
            VALUES (?, ?, ?)
            `,
            [
                fileName,
                filePath,
                "PROCESSING"
            ]
        );

        const OCRId = insertResult.insertId;

        // OCR

        const result = await Tesseract.recognize(
            filePath,
            "eng"
        );

        const extractedText =
            result.data.text;
            const employee =
    parseEmployeeText(extractedText);
    await pool.query(
    `
    INSERT INTO employees_ocr
    (
        EmployeeCode,
        EmployeeName,
        Department,
        Designation,
        Email,
        Phone,
        Salary,
        OCRId
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
        employee.employeeCode,
        employee.employeeName,
        employee.department,
        employee.designation,
        employee.email,
        employee.phone,
        employee.salary,
        OCRId
    ]
);

        console.log(
            "Extracted Text:",
            extractedText
        );

        // Update database

        await pool.query(
            `
            UPDATE ocr_documents
            SET
                ExtractedText = ?,
                Status = ?
            WHERE OCRId = ?
            `,
            [
                extractedText,
                "COMPLETED",
                OCRId
            ]
        );

        res.json({

            success: true,

            message: "OCR completed successfully",

            data: {

                OCRId,

                fileName,

                extractedText

            }

        });

    } catch (error) {

        console.error(error);

        res.status(500).json({

            success: false,

            message: "OCR processing failed",

            error: error.message

        });

    }

};

module.exports = {
    uploadAndProcessOCR
};