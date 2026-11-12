const nodemailer = require("nodemailer");

const maxBodyBytes = 16 * 1024;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(statusCode, payload, headers = {}) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...headers
        },
        body: JSON.stringify(payload)
    };
}

function validateSubmission(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return "Submit a JSON object with name, email, and message.";
    }

    const { name, email, message } = body;
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
        return "Name must be between 1 and 100 characters.";
    }
    if (typeof email !== "string" || email.trim().length > 254 || !emailPattern.test(email.trim())) {
        return "Enter a valid email address.";
    }
    if (typeof message !== "string" || message.trim().length < 1 || message.trim().length > 5000) {
        return "Message must be between 1 and 5000 characters.";
    }
    return null;
}

exports.handler = async function (event) {
    if (event.httpMethod !== "POST") {
        return jsonResponse(405, {
            success: false,
            message: "Use POST to submit a contact message."
        }, { Allow: "POST" });
    }

    const contentType = Object.entries(event.headers || {})
        .find(([name]) => name.toLowerCase() === "content-type");
    if (!contentType || !contentType[1].toLowerCase().startsWith("application/json")) {
        return jsonResponse(415, {
            success: false,
            message: "Content-Type must be application/json."
        });
    }

    const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64").toString("utf8")
        : event.body || "";
    if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
        return jsonResponse(413, { success: false, message: "Request body is too large." });
    }

    let body;
    try {
        body = JSON.parse(rawBody);
    } catch {
        return jsonResponse(400, { success: false, message: "Request body must be valid JSON." });
    }

    const validationError = validateSubmission(body);
    if (validationError) {
        return jsonResponse(400, { success: false, message: validationError });
    }

    const emailUser = process.env.EMAIL_USER?.trim();
    const emailAppPassword = process.env.EMAIL_APP_PASSWORD?.trim();
    if (!emailUser || !emailAppPassword) {
        console.error("Contact email environment variables are not configured.");
        return jsonResponse(500, {
            success: false,
            message: "The contact service is not configured. Please try again later."
        });
    }

    const submission = {
        name: body.name.trim(),
        email: body.email.trim(),
        message: body.message.trim()
    };
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: emailUser, pass: emailAppPassword }
    });

    try {
        await transporter.sendMail({
            from: emailUser,
            to: emailUser,
            replyTo: submission.email,
            subject: "New portfolio contact message",
            text: "Name: " + submission.name + "\nEmail: " + submission.email + "\n\n" + submission.message
        });
    } catch (error) {
        console.error("Failed to deliver contact email:", error.message);
        return jsonResponse(502, {
            success: false,
            message: "Your message could not be emailed right now. Please try again later."
        });
    }

    return jsonResponse(201, {
        success: true,
        message: "Thank you, " + submission.name + "! Your message has been sent."
    });
};
