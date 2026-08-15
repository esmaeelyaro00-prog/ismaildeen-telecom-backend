require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/*
 * =========================
 * FIREBASE ADMIN
 * =========================
 */

let db = null;

try {
    const serviceAccount = require(
        "/etc/secrets/firebase-service-account.json"
    );

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();

    console.log("Firebase Admin initialized successfully");

} catch (error) {

    console.error(
        "Firebase Admin initialization failed:",
        error.message
    );
}

/*
 * =========================
 * HOME
 * =========================
 */

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "ISMAIL DEEN DATA Backend is running"
    });

});

/*
 * =========================
 * HEALTH
 * =========================
 */

app.get("/api/health", (req, res) => {

    res.json({
        success: true,
        status: "online"
    });

});

/*
 * =========================
 * PAYMENT TEST
 * =========================
 */

app.get("/api/payment/test", (req, res) => {

    res.json({
        success: true,
        message: "Payment backend is connected"
    });

});

/*
 * =========================
 * FIREBASE TEST
 * =========================
 */

app.get("/api/firebase/test", async (req, res) => {

    try {

        if (!db) {
            return res.status(500).json({
                success: false,
                message: "Firebase is not initialized"
            });
        }

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
 * =========================
 * INITIALIZE PAYSTACK PAYMENT
 * =========================
 */

app.post("/api/payment/initialize", async (req, res) => {

    try {

        const {
            email,
            amount,
            uid
        } = req.body;

        if (!email || !amount || !uid) {

            return res.status(400).json({
                success: false,
                message: "Email, amount and uid are required"
            });

        }

        if (!db) {

            return res.status(500).json({
                success: false,
                message: "Firebase is not initialized"
            });

        }

        const amountNumber = Number(amount);

        if (
            !Number.isFinite(amountNumber) ||
            amountNumber < 100
        ) {

            return res.status(400).json({
                success: false,
                message: "Minimum payment is ₦100"
            });

        }

        const amountInKobo =
            Math.round(amountNumber * 100);

        /*
         * Generate a unique transaction ID
         */

        const transactionRef =
            db.collection("walletTransactions").doc();

        const transactionId =
            transactionRef.id;

        /*
         * Initialize Paystack
         */

        const response = await axios.post(

            "https://api.paystack.co/transaction/initialize",

            {
                email: email,
                amount: amountInKobo,
                currency: "NGN",
                metadata: {
                    userId: uid,
                    transactionId: transactionId
                }
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

        const paymentData =
            response.data.data;

        /*
         * Save pending transaction
         */

        await transactionRef.set({

            userId: uid,

            email: email,

            amount: amountNumber,

            amountKobo: amountInKobo,

            type: "wallet_funding",

            status: "pending",

            reference:
                paymentData.reference,

            createdAt:
                admin.firestore.FieldValue.serverTimestamp()

        });

        /*
         * Send payment information to Android
         */

        res.json({

            success: true,

            data: {

                authorization_url:
                    paymentData.authorization_url,

                access_code:
                    paymentData.access_code,

                reference:
                    paymentData.reference,

                transactionId:
                    transactionId

            }

        });

    } catch (error) {

        console.error(
            "Paystack initialization error:",
            error.response?.data ||
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Unable to initialize payment"

        });

    }

});

/*
 * =========================
 * VERIFY PAYSTACK PAYMENT
 * =========================
 */

app.get(
    "/api/payment/verify/:reference",
    async (req, res) => {

        try {

            const {
                reference
            } = req.params;

            if (!reference) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction reference is required"

                });

            }

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }

            /*
             * Find transaction in Firebase
             */

            const snapshot = await db
                .collection("walletTransactions")
                .where(
                    "reference",
                    "==",
                    reference
                )
                .limit(1)
                .get();

            if (snapshot.empty) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Transaction not found"

                });

            }

            const transactionDoc =
                snapshot.docs[0];

            const transaction =
                transactionDoc.data();

            /*
             * Prevent double wallet credit
             */

            if (
                transaction.status ===
                "completed"
            ) {

                return res.json({

                    success: true,

                    message:
                        "Payment already processed",

                    status:
                        "success",

                    reference:
                        reference

                });

            }

            /*
             * Verify payment with Paystack
             */

            const response =
                await axios.get(

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

            /*
             * Check payment status
             */

            if (
                payment.status !==
                "success"
            ) {

                await transactionDoc.ref.update({

                    status:
                        payment.status || "failed",

                    verifiedAt:
                        admin.firestore.FieldValue.serverTimestamp()

                });

                return res.json({

                    success: false,

                    status:
                        payment.status,

                    message:
                        "Payment has not been completed"

                });

            }

            /*
             * Check amount
             */

            if (
                Number(payment.amount) !==
                Number(transaction.amountKobo)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Payment amount does not match"

                });

            }

            /*
             * Add money to wallet
             *
             * Firestore transaction prevents
             * duplicate wallet credit.
             */

            await db.runTransaction(
                async (firestoreTransaction) => {

                    const userRef =
                        db
                            .collection("users")
                            .doc(transaction.userId);

                    const walletTransactionRef =
                        transactionDoc.ref;

                    const userSnapshot =
                        await firestoreTransaction.get(
                            userRef
                        );

                    const transactionSnapshot =
                        await firestoreTransaction.get(
                            walletTransactionRef
                        );

                    const currentTransaction =
                        transactionSnapshot.data();

                    /*
                     * Double-check inside transaction
                     */

                    if (
                        currentTransaction.status ===
                        "completed"
                    ) {
                        return;
                    }

                    const currentBalance =
                        userSnapshot.exists
                            ? Number(
                                userSnapshot.data()
                                    .walletBalance || 0
                            )
                            : 0;

                    const newBalance =
                        currentBalance +
                        Number(transaction.amount);

                    /*
                     * Update wallet
                     */

                    firestoreTransaction.set(

                        userRef,

                        {
                            walletBalance:
                                newBalance,

                            updatedAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        },

                        {
                            merge: true
                        }

                    );

                    /*
                     * Mark transaction completed
                     */

                    firestoreTransaction.update(

                        walletTransactionRef,

                        {
                            status:
                                "completed",

                            paystackStatus:
                                payment.status,

                            paidAt:
                                payment.paid_at ||
                                null,

                            verifiedAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }

                    );

                }
            );

            /*
             * Successful response
             */

            res.json({

                success: true,

                message:
                    "Payment verified and wallet funded successfully",

                status:
                    "success",

                reference:
                    payment.reference,

                amount:
                    payment.amount,

                currency:
                    payment.currency,

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
 * =========================
 * START SERVER
 * =========================
 */

const PORT =
    process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log(
        `ISMAIL DEEN DATA server running on port ${PORT}`
    );

});
