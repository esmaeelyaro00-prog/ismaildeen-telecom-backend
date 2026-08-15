 require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/*
 * Firebase Admin
 * Render Secret File:
 * /etc/secrets/firebase-service-account.json
 */
try {
    const serviceAccount = require(
        "/etc/secrets/firebase-service-account.json"
    );

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log("Firebase Admin initialized successfully");

} catch (error) {
    console.error(
        "Firebase Admin initialization failed:",
        error.message
    );
}

const db = admin.firestore();

/*
 * HOME
 */
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "ISMAIL DEEN DATA Backend is running"
    });
});

/*
 * HEALTH
 */
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

/*
 * PAYMENT TEST
 */
app.get("/api/payment/test", (req, res) => {
    res.json({
        success: true,
        message: "Payment backend is connected"
    });
});

/*
 * FIREBASE TEST
 */
app.get("/api/firebase/test", async (req, res) => {
    try {

        await db
            .collection("system")
            .doc("connection")
            .set({
                connected: true,
                updatedAt: new Date().toISOString()
            });

        res.json({
            success: true,
            message: "Firebase connected successfully"
        });

    } catch (error) {

        console.error(
            "Firebase error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Firebase connection failed",
            error: error.message
        });
    }
});

/*
 * INITIALIZE PAYSTACK PAYMENT
 */
app.post("/api/payment/initialize", async (req, res) => {

    try {

        const { email, amount } = req.body;

        if (!email || !amount) {

            return res.status(400).json({
                success: false,
                message: "Email and amount are required"
            });
        }

        const amountInKobo =
            Math.round(Number(amount) * 100);

        if (
            !Number.isFinite(amountInKobo) ||
            amountInKobo < 10000
        ) {

            return res.status(400).json({
                success: false,
                message: "Minimum payment is ₦100"
            });
        }

        const response = await axios.post(
            "https://api.paystack.co/transaction/initialize",
            {
                email: email,
                amount: amountInKobo,
                currency: "NGN"
            },
            {
                headers: {
                    Authorization:
                        `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    "Content-Type":
                        "application/json"
                }
            }
        );

        res.json({
            success: true,
            data: response.data.data
        });

    } catch (error) {

        console.error(
            "Paystack initialization error:",
            error.response?.data ||
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Unable to initialize payment"
        });
    }
});

/*
 * VERIFY PAYSTACK PAYMENT
 */
app.get(
    "/api/payment/verify/:reference",
    async (req, res) => {

        try {

            const { reference } =
                req.params;

            if (!reference) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Transaction reference is required"
                });
            }

            const response = await axios.get(
                `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
                {
                    headers: {
                        Authorization:
                            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                    }
                }
            );

            const payment =
                response.data.data;

            res.json({
                success: true,
                status: payment.status,
                reference: payment.reference,
                amount: payment.amount,
                currency: payment.currency,
                paidAt:
                    payment.paid_at || null
            });

        } catch (error) {

            console.error(
                "Paystack verification error:",
                error.response?.data ||
                error.message
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to verify payment"
            });
        }
    }
);

/*
 * START SERVER
 */
const PORT =
    process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `ISMAIL DEEN DATA server running on port ${PORT}`
    );

});
