const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const nodemailer = require("nodemailer");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const root = __dirname;
const dataDirectory = path.join(root, "backend-data");
const messagesFile = path.join(dataDirectory, "contact-messages.jsonl");
const maxBodyBytes = 16 * 1024;
const emailUser = process.env.EMAIL_USER?.trim();
const emailAppPassword = process.env.EMAIL_APP_PASSWORD?.trim();
const publicFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/Media.jpg", ["Media.jpg", "image/jpeg"]],
    ["/RESUME.PDF.pdf", ["RESUME.PDF.pdf", "application/pdf"]]
]);

if (!emailUser || !emailAppPassword) {
    console.error("Set EMAIL_USER and EMAIL_APP_PASSWORD in .env to enable contact email delivery.");
    process.exit(1);
}

const emailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: emailUser,
        pass: emailAppPassword
    }
});

function sendJson(response, statusCode, payload, headers = {}) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
    response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bodyBytes = 0;
        let tooLarge = false;

        request.on("data", chunk => {
            bodyBytes += chunk.length;
            if (bodyBytes > maxBodyBytes) {
                tooLarge = true;
            } else if (!tooLarge) {
                chunks.push(chunk);
            }
        });

        request.on("end", () => {
            if (tooLarge) {
                reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
                return;
            }

            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
                reject(Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }));
            }
        });

        request.on("error", reject);
    });
}

function validateSubmission(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return "Submit a JSON object with name, email, and message.";
    }

    const { name, email, message } = body;
    if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
        return "Name must be between 1 and 100 characters.";
    }
    if (typeof email !== "string" || email.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return "Enter a valid email address.";
    }
    if (typeof message !== "string" || message.trim().length < 1 || message.trim().length > 5000) {
        return "Message must be between 1 and 5000 characters.";
    }
    return null;
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");

    if (requestUrl.pathname === "/api/contact") {
        if (request.method !== "POST") {
            sendJson(response, 405, { success: false, message: "Use POST to submit a contact message." }, { Allow: "POST" });
            return;
        }

        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
            sendJson(response, 415, { success: false, message: "Content-Type must be application/json." });
            return;
        }

        try {
            const body = await readJsonBody(request);
            const validationError = validateSubmission(body);
            if (validationError) {
                sendJson(response, 400, { success: false, message: validationError });
                return;
            }

            const submission = {
                receivedAt: new Date().toISOString(),
                name: body.name.trim(),
                email: body.email.trim(),
                message: body.message.trim()
            };
            await fs.mkdir(dataDirectory, { recursive: true });
            await fs.appendFile(messagesFile, JSON.stringify(submission) + "\n", "utf8");
            try {
                await emailTransporter.sendMail({
                    from: emailUser,
                    to: emailUser,
                    replyTo: submission.email,
                    subject: "New portfolio contact message",
                    text: "Name: " + submission.name + "\nEmail: " + submission.email + "\n\n" + submission.message
                });
            } catch (error) {
                console.error("Failed to deliver contact email:", error.message);
                sendJson(response, 502, {
                    success: false,
                    message: "Your message could not be emailed right now. Please try again later."
                });
                return;
            }
            sendJson(response, 201, {
                success: true,
                message: "Thank you, " + submission.name + "! Your message has been sent."
            });
        } catch (error) {
            if (error.statusCode) {
                sendJson(response, error.statusCode, { success: false, message: error.message });
                return;
            }
            console.error("Failed to receive contact submission:", error);
            sendJson(response, 500, { success: false, message: "Unable to save your message. Please try again later." });
        }
        return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { success: false, message: "Method not allowed." });
        return;
    }

    const publicFile = publicFiles.get(requestUrl.pathname);
    if (!publicFile) {
        sendJson(response, 404, { success: false, message: "Not found." });
        return;
    }

    try {
        const content = await fs.readFile(path.join(root, publicFile[0]));
        response.writeHead(200, { "Content-Type": publicFile[1] });
        response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
        if (error.code === "ENOENT") {
            sendJson(response, 404, { success: false, message: "Not found." });
            return;
        }
        console.error("Failed to serve public file:", error);
        sendJson(response, 500, { success: false, message: "Unable to serve this page." });
    }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
    console.log("Portfolio available at http://" + host + ":" + port);
});
