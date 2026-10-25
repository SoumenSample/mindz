const express = require("express");
const multer = require("multer");

const {
    uploadAndProcessOCR
} = require("../controllers/ocrController");

const router = express.Router();

const storage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, "uploads/");
    },

    filename: function (req, file, cb) {

        const uniqueName =
            Date.now() +
            "-" +
            file.originalname.replace(/\s+/g, "_");

        cb(null, uniqueName);
    }

});

const upload = multer({
    storage: storage,

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/jpg"
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG, JPEG and PNG images are allowed"));
        }
    }
});

router.post(
    "/upload",
    upload.single("image"),
    uploadAndProcessOCR
);

module.exports = router;