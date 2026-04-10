const http = require("http");
const path = require("path");
const fs = require("fs/promises");
const { createReadStream } = require("fs");
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require("crypto");
const { URL } = require("url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const storeFile = path.join(dataDir, "store.json");
const submissionsFile = path.join(dataDir, "submissions.json");
const integrationsFile = path.join(dataDir, "integrations.json");
const customersFile = path.join(dataDir, "customers.json");
const port = Math.max(1, Number(process.env.PORT) || 3000);
const maxBodySize = 1024 * 1024;

const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webp": "image/webp"
};

const sendJson = (response, statusCode, payload) => {
    response.writeHead(statusCode, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8"
    });
    response.end(`${JSON.stringify(payload, null, 2)}\n`);
};

const readJsonFile = async (filePath, fallbackValue) => {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return raw.trim() ? JSON.parse(raw) : fallbackValue;
    } catch (error) {
        if (error.code === "ENOENT") {
            return fallbackValue;
        }

        throw error;
    }
};

const writeJsonFile = async (filePath, payload) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const normalizeLocation = (payload) => ({
    addressLine1: String(payload.addressLine1 || "").trim(),
    addressLine2: String(payload.addressLine2 || "").trim(),
    landmark: String(payload.landmark || "").trim(),
    city: String(payload.city || "").trim(),
    state: String(payload.state || "").trim(),
    pincode: String(payload.pincode || "").trim()
});

const sanitizeCustomer = (customer) => ({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    location: customer.location || normalizeLocation({}),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    lastLoginAt: customer.lastLoginAt || "",
    isAdmin: customer.isAdmin || false
});

const hashPassword = (password, salt = randomBytes(16).toString("hex")) => {
    const passwordHash = scryptSync(String(password || ""), salt, 64).toString("hex");

    return {
        passwordHash,
        passwordSalt: salt
    };
};

const verifyPassword = (password, customer) => {
    if (!customer || !customer.passwordHash || !customer.passwordSalt) {
        return false;
    }

    const nextHash = scryptSync(String(password || ""), customer.passwordSalt, 64);
    const storedHash = Buffer.from(customer.passwordHash, "hex");

    if (nextHash.length !== storedHash.length) {
        return false;
    }

    return timingSafeEqual(nextHash, storedHash);
};

const getCustomers = async () => readJsonFile(customersFile, []);

const validateCustomerPayload = (payload, options = {}) => {
    const requirePassword = Boolean(options.requirePassword);
    const customer = {
        name: String(payload.name || "").trim(),
        email: normalizeEmail(payload.email),
        phone: String(payload.phone || "").trim(),
        password: String(payload.password || "").trim(),
        location: normalizeLocation(payload.location || payload)
    };

    if (!customer.name || !customer.email || !customer.phone) {
        return {
            message: "Please provide name, email, and phone."
        };
    }

    if (requirePassword && customer.password.length < 4) {
        return {
            message: "Please provide a password with at least 4 characters."
        };
    }

    if (
        !customer.location.addressLine1 ||
        !customer.location.city ||
        !customer.location.state ||
        !customer.location.pincode
    ) {
        return {
            message: "Please provide address line 1, city, state, and pincode."
        };
    }

    return {
        customer
    };
};

const getIntegrationSettings = async () =>
    readJsonFile(integrationsFile, {
        googleAppsScriptUrl: ""
    });

const forwardSubmissionToGoogleSheet = async (submission) => {
    const integrationSettings = await getIntegrationSettings();
    const googleAppsScriptUrl = String(integrationSettings.googleAppsScriptUrl || "").trim();

    if (!googleAppsScriptUrl) {
        return {
            enabled: false,
            synced: false
        };
    }

    if (/docs\.google\.com\/spreadsheets\//i.test(googleAppsScriptUrl)) {
        throw new Error("Use the Google Apps Script Web App URL ending in /exec, not the normal Google Sheet link.");
    }

    if (!/script\.google\.com\//i.test(googleAppsScriptUrl)) {
        throw new Error("Google Sheets integration needs a Google Apps Script Web App URL.");
    }

    const response = await fetch(googleAppsScriptUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify({
            source: "medical-shop-demo",
            submission
        })
    });

    if (!response.ok) {
        throw new Error("Google Sheets sync failed.");
    }

    const payload = await response.json().catch(() => ({ ok: true }));

    if (payload && payload.ok === false) {
        throw new Error(payload.message || "Google Sheets sync failed.");
    }

    return {
        enabled: true,
        synced: true
    };
};

const parseJsonBody = async (request) =>
    new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];

        request.on("data", (chunk) => {
            size += chunk.length;

            if (size > maxBodySize) {
                const error = new Error("Request body is too large.");
                error.statusCode = 413;
                reject(error);
                request.destroy();
                return;
            }

            chunks.push(chunk);
        });

        request.on("end", () => {
            if (chunks.length === 0) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
                const parseError = new Error("Invalid JSON body.");
                parseError.statusCode = 400;
                reject(parseError);
            }
        });

        request.on("error", reject);
    });

const validateSubmission = (payload) => {
    const location = normalizeLocation(payload.location || payload);
    const submission = {
        customerId: String(payload.customerId || "").trim(),
        name: String(payload.name || "").trim(),
        email: normalizeEmail(payload.email),
        phone: String(payload.phone || "").trim(),
        topic: String(payload.topic || "").trim(),
        message: String(payload.message || "").trim(),
        location,
        createdAt: String(payload.createdAt || "").trim() || new Date().toISOString()
    };

    if (!submission.name || !submission.email || !submission.phone || !submission.topic || !submission.message) {
        return {
            message: "Please provide name, email, phone, topic, and message."
        };
    }

    if (submission.topic === "Order Request") {
        if (!location.addressLine1 || !location.city || !location.state || !location.pincode) {
            return {
                message: "Please provide address line 1, city, state, and pincode for order requests."
            };
        }
    }

    return {
        submission
    };
};

const getStaticFilePath = (pathname) => {
    const requestedPath = pathname === "/" ? "/index.html" : pathname;
    const relativePath = decodeURIComponent(requestedPath).replace(/^\/+/, "");
    const normalizedPath = path.normalize(relativePath);

    if (
        normalizedPath.startsWith("..") ||
        path.isAbsolute(normalizedPath) ||
        normalizedPath === "data" ||
        normalizedPath.startsWith(`data${path.sep}`)
    ) {
        return null;
    }

    return path.join(rootDir, normalizedPath);
};

const serveStaticFile = async (pathname, response) => {
    const filePath = getStaticFilePath(pathname);

    if (!filePath) {
        sendJson(response, 403, { message: "That path is not allowed." });
        return;
    }

    let stats;

    try {
        stats = await fs.stat(filePath);
    } catch (error) {
        if (error.code === "ENOENT") {
            sendJson(response, 404, { message: "Page not found." });
            return;
        }

        throw error;
    }

    if (stats.isDirectory()) {
        await serveStaticFile(`${pathname.replace(/\/$/, "")}/index.html`, response);
        return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";

    response.writeHead(200, {
        "Content-Type": contentType
    });

    createReadStream(filePath).pipe(response);
};

const handleApiRoute = async (request, response, url) => {
    if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok" });
        return true;
    }

    if (request.method === "GET" && url.pathname === "/api/store") {
        const store = await readJsonFile(storeFile, {
            store: {},
            products: [],
            offers: [],
            careBundles: []
        });

        sendJson(response, 200, store);
        return true;
    }

    if (request.method === "GET" && url.pathname === "/api/submissions/latest") {
        const submissions = await readJsonFile(submissionsFile, []);
        sendJson(response, 200, {
            submission: submissions[0] || null
        });
        return true;
    }

    if (request.method === "GET" && url.pathname === "/api/submissions") {
        const submissions = await readJsonFile(submissionsFile, []);
        sendJson(response, 200, {
            submissions
        });
        return true;
    }

    if (request.method === "GET" && url.pathname === "/api/customers") {
        const customers = await getCustomers();
        sendJson(response, 200, {
            customers: customers.map((customer) => sanitizeCustomer(customer))
        });
        return true;
    }

    if (request.method === "GET" && url.pathname === "/api/integrations") {
        const integrations = await getIntegrationSettings();
        sendJson(response, 200, integrations);
        return true;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
        const body = await parseJsonBody(request);
        const validation = validateCustomerPayload(body, { requirePassword: true });

        if (!validation.customer) {
            sendJson(response, 400, {
                message: validation.message || "Invalid customer details."
            });
            return true;
        }

        const customers = await getCustomers();
        const existingCustomer = customers.find((customer) => customer.email === validation.customer.email);

        if (existingCustomer) {
            sendJson(response, 409, {
                message: "An account with this email already exists."
            });
            return true;
        }

        const credentials = hashPassword(validation.customer.password);
        const timestamp = new Date().toISOString();
        const savedCustomer = {
            id: `cust_${randomUUID()}`,
            name: validation.customer.name,
            email: validation.customer.email,
            phone: validation.customer.phone,
            location: validation.customer.location,
            passwordHash: credentials.passwordHash,
            passwordSalt: credentials.passwordSalt,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastLoginAt: timestamp
        };

        customers.unshift(savedCustomer);
        await writeJsonFile(customersFile, customers);

        sendJson(response, 201, {
            message: "Account created successfully.",
            customer: sanitizeCustomer(savedCustomer)
        });
        return true;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await parseJsonBody(request);
        const email = normalizeEmail(body.email);
        const password = String(body.password || "").trim();
        const customers = await getCustomers();
        const customer = customers.find((entry) => entry.email === email);

        if (!customer || !verifyPassword(password, customer)) {
            sendJson(response, 401, {
                message: "Invalid email or password."
            });
            return true;
        }

        customer.lastLoginAt = new Date().toISOString();
        customer.updatedAt = customer.lastLoginAt;
        await writeJsonFile(customersFile, customers);

        sendJson(response, 200, {
            message: "Login successful.",
            customer: sanitizeCustomer(customer)
        });
        return true;
    }

    if (request.method === "PUT" && url.pathname.startsWith("/api/customers/")) {
        const customerId = url.pathname.replace("/api/customers/", "").trim();
        const body = await parseJsonBody(request);
        const validation = validateCustomerPayload(body, {
            requirePassword: false
        });

        if (!customerId || !validation.customer) {
            sendJson(response, 400, {
                message: validation.message || "Invalid customer update."
            });
            return true;
        }

        const customers = await getCustomers();
        const customerIndex = customers.findIndex((customer) => customer.id === customerId);

        if (customerIndex === -1) {
            sendJson(response, 404, {
                message: "Customer not found."
            });
            return true;
        }

        const emailConflict = customers.find((customer) => customer.email === validation.customer.email && customer.id !== customerId);

        if (emailConflict) {
            sendJson(response, 409, {
                message: "Another account already uses this email."
            });
            return true;
        }

        const existingCustomer = customers[customerIndex];
        existingCustomer.name = validation.customer.name;
        existingCustomer.email = validation.customer.email;
        existingCustomer.phone = validation.customer.phone;
        existingCustomer.location = validation.customer.location;
        existingCustomer.updatedAt = new Date().toISOString();

        if (validation.customer.password) {
            const credentials = hashPassword(validation.customer.password);
            existingCustomer.passwordHash = credentials.passwordHash;
            existingCustomer.passwordSalt = credentials.passwordSalt;
        }

        customers[customerIndex] = existingCustomer;
        await writeJsonFile(customersFile, customers);

        sendJson(response, 200, {
            message: "Customer profile updated successfully.",
            customer: sanitizeCustomer(existingCustomer)
        });
        return true;
    }

    if (request.method === "POST" && url.pathname === "/api/submissions") {
        const body = await parseJsonBody(request);
        const validation = validateSubmission(body);

        if (!validation.submission) {
            sendJson(response, 400, {
                message: validation.message || "Invalid submission."
            });
            return true;
        }

        const submissions = await readJsonFile(submissionsFile, []);
        const savedSubmission = {
            id: `sub_${Date.now()}`,
            ...validation.submission
        };

        submissions.unshift(savedSubmission);
        await writeJsonFile(submissionsFile, submissions);

        let googleSheets = {
            enabled: false,
            synced: false
        };

        try {
            googleSheets = await forwardSubmissionToGoogleSheet(savedSubmission);
        } catch (error) {
            googleSheets = {
                enabled: true,
                synced: false,
                message: error.message
            };
        }

        sendJson(response, 201, {
            message: "Submission saved successfully.",
            submission: savedSubmission,
            googleSheets
        });
        return true;
    }

    if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { message: "API route not found." });
        return true;
    }

    return false;
};

const server = http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `localhost:${port}`}`);

    try {
        const apiHandled = await handleApiRoute(request, response, requestUrl);

        if (apiHandled) {
            return;
        }

        await serveStaticFile(requestUrl.pathname, response);
    } catch (error) {
        const statusCode = error.statusCode || 500;
        sendJson(response, statusCode, {
            message: statusCode === 500 ? "Unexpected server error." : error.message
        });
    }
});

server.listen(port, () => {
    console.log(`Medical shop server is running at http://localhost:${port}`);
});
