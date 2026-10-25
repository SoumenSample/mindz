import { useState } from "react";
import api from "../services/api";

function ImageOCR() {

    const [image, setImage] = useState(null);

    const [preview, setPreview] = useState(null);

    const [loading, setLoading] = useState(false);

    const [text, setText] = useState("");

    const [error, setError] = useState("");

    const handleImageChange = (e) => {

        const file = e.target.files[0];

        if (!file) return;

        setImage(file);

        setPreview(
            URL.createObjectURL(file)
        );

        setText("");

        setError("");
    };

    const handleUpload = async () => {

        if (!image) {

            setError("Please select an image");

            return;
        }

        try {

            setLoading(true);

            setError("");

            const formData =
                new FormData();

            formData.append(
                "image",
                image
            );

            const response =
                await api.post(
                    "/ocr/upload",
                    formData
                );

            setText(
                response.data.data.extractedText
            );

        } catch (error) {

            console.error(error);

            setError(
                error.response?.data?.message ||
                "OCR failed"
            );

        } finally {

            setLoading(false);

        }

    };

    return (

        <div className="container mt-5">

            <div className="card shadow">

                <div className="card-header">

                    <h4>
                        Image OCR
                    </h4>

                </div>

                <div className="card-body">

                    <div className="mb-3">

                        <label className="form-label">
                            Select Image
                        </label>

                        <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            onChange={handleImageChange}
                        />

                    </div>

                    {preview && (

                        <div className="mb-3">

                            <img
                                src={preview}
                                alt="Preview"
                                style={{
                                    maxWidth: "400px",
                                    maxHeight: "300px"
                                }}
                            />

                        </div>

                    )}

                    <button
                        className="btn btn-primary"
                        onClick={handleUpload}
                        disabled={loading}
                    >

                        {loading
                            ? "Processing..."
                            : "Upload & Read Image"
                        }

                    </button>

                    {error && (

                        <div className="alert alert-danger mt-3">

                            {error}

                        </div>

                    )}

                    {text && (

                        <div className="mt-4">

                            <h5>
                                Extracted Text
                            </h5>

                            <textarea
                                className="form-control"
                                rows="10"
                                value={text}
                                readOnly
                            />

                        </div>

                    )}

                </div>

            </div>

        </div>

    );
}

export default ImageOCR;