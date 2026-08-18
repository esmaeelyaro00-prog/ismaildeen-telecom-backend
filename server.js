require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();

app.use(cors());
app.use(express.json());

/*
 * =====================================================
 * FIREBASE ADMIN
 * =====================================================
 */

let db = null;

try {

    const serviceAccount = require(
        "/etc/secrets/firebase-service-account.json"
    );

    admin.initializeApp({
        credential:
            admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();

    console.log(
        "Firebase Admin initialized successfully"
    );

} catch (error) {

    console.error(
        "Firebase Admin initialization failed:",
        error.message
    );

}


/*
 * =====================================================
 * HOME
 * =====================================================
 */

app.get("/", (req, res) => {

    res.json({

        success: true,

        message:
            "ISMAIL DEEN DATA Backend is running"

    });

});


/*
 * =====================================================
 * HEALTH
 * =====================================================
 */

app.get("/api/health", (req, res) => {

    res.json({

        success: true,

        status: "online"

    });

});


/*
 * =====================================================
 * PAYMENT TEST
 * =====================================================
 */

app.get("/api/payment/test", (req, res) => {

    res.json({

        success: true,

        message:
            "Payment backend is connected"

    });

});


/*
 * =====================================================
 * FIREBASE TEST
 * =====================================================
 */

app.get(
    "/api/firebase/test",
    async (req, res) => {

        try {

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }

            await db
                .collection("system")
                .doc("connection")
                .set({

                    connected: true,

                    updatedAt:
                        new Date().toISOString()

                });

            res.json({

                success: true,

                message:
                    "Firebase connected successfully"

            });

        } catch (error) {

            console.error(
                "Firebase error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Firebase connection failed",

                error:
                    error.message

            });

        }

    }
);


/*
 * =====================================================
 * WALLET
 * GET USER WALLET
 * =====================================================
 */

app.get(
    "/api/wallet/:uid",
    async (req, res) => {

        try {

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }

            const uid =
                req.params.uid;

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            const userDoc =
                await db
                    .collection("users")
                    .doc(uid)
                    .get();

            if (!userDoc.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found",

                    uid:
                        uid

                });

            }

            const data =
                userDoc.data();

            const walletBalance =
                Number(
                    data.walletBalance || 0
                );

            res.json({

                success: true,

                uid:
                    uid,

                email:
                    data.email || null,

                phone:
                    data.phone || null,

                walletBalance:
                    walletBalance

            });

        } catch (error) {

            console.error(
                "Wallet error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to read wallet",

                error:
                    error.message

            });

        }

    }
);


/*
 * =====================================================
 * VTpass DATA PLANS
 *
 * /api/vtpass/data-plans/mtn
 * /api/vtpass/data-plans/airtel
 * /api/vtpass/data-plans/glo
 * /api/vtpass/data-plans/9mobile
 * =====================================================
 */

app.get(
    "/api/vtpass/data-plans/:network",
    async (req, res) => {

        try {

            const network =
                req.params.network
                    .toLowerCase()
                    .trim();


            /*
             * Network → VTpass Service ID
             */

            const serviceMap = {

                mtn:
                    "mtn-data",

                airtel:
                    "airtel-data",

                glo:
                    "glo-data",

                "9mobile":
                    "etisalat-data",

                etisalat:
                    "etisalat-data"

            };


            const serviceID =
                serviceMap[network];


            /*
             * Check network
             */

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network",

                    network:
                        network

                });

            }


            /*
             * Check VTpass API Key
             */

            if (
                !process.env.VTPASS_API_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }


            /*
             * Check VTpass Secret Key
             */

            if (
                !process.env.VTPASS_SECRET_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_SECRET_KEY is not configured"

                });

            }


            /*
             * Request plans from VTpass
             */

            const response =
                await axios.get(

                    "https://sandbox.vtpass.com/api/service-variations",

                    {

                        params: {

                            serviceID:
                                serviceID

                        },

                        headers: {

                            "api-key":
                                process.env.VTPASS_API_KEY,

                            "secret-key":
                                process.env.VTPASS_SECRET_KEY,

                            "Content-Type":
                                "application/json"

                        }

                    }

                );


            /*
             * VTpass response
             */

            const content =
                response.data.content || {};


            /*
             * Some VTpass responses use
             * variations.
             */

            const variations =
                content.variations ||
                content.varations ||
                [];


            /*
             * Format plans
             */

            const plans =
                variations.map(
                    (plan) => {

                        return {

                            variation_code:
                                plan.variation_code,

                            name:
                                plan.name,

                            amount:
                                Number(
                                    plan.variation_amount
                                ),

                            variation_amount:
                                plan.variation_amount,

                            fixedPrice:
                                plan.fixedPrice

                        };

                    }
                );


            /*
             * Send response
             */

            res.json({

                success: true,

                network:
                    network,

                serviceID:
                    serviceID,

                plans:
                    plans

            });

        } catch (error) {

            console.error(
                "VTpass data plans error:",

                error.response?.data ||
                error.message
            );


            res.status(500).json({

                success: false,

                message:
                    "Unable to load VTpass data plans",

                error:
                    error.response?.data ||
                    error.message

            });

        }

    }
);


/*
 * =====================================================
 * VTpass BUY DATA
 * =====================================================
 */

app.post(
    "/api/vtpass/buy-data",
    async (req, res) => {

        try {

            /*
             * Get request data
             */

            const {
                uid,
                network,
                phone,
                variation_code,
                amount
            } = req.body;


            /*
             * Required fields
             */

            if (
                !uid ||
                !network ||
                !phone ||
                !variation_code ||
                amount === undefined
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "uid, network, phone, variation_code and amount are required"

                });

            }


            /*
             * Firebase check
             */

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }


            /*
             * VTpass API key
             */

            if (
                !process.env.VTPASS_API_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }


            /*
             * VTpass Secret Key
             */

            if (
                !process.env.VTPASS_SECRET_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_SECRET_KEY is not configured"

                });

            }


            /*
             * Network → Service ID
             */

            const serviceMap = {

                mtn:
                    "mtn-data",

                airtel:
                    "airtel-data",

                glo:
                    "glo-data",

                "9mobile":
                    "etisalat-data",

                etisalat:
                    "etisalat-data"

            };


            const networkName =
                network
                    .toLowerCase()
                    .trim();


            const serviceID =
                serviceMap[networkName];


            /*
             * Check network
             */

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network"

                });

            }


            /*
             * Validate phone
             */

            if (
                !/^[0-9]{11}$/.test(phone)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid phone number"

                });

            }


            /*
             * Validate amount
             */

            const purchaseAmount =
                Number(amount);


            if (
                !Number.isFinite(
                    purchaseAmount
                ) ||
                purchaseAmount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid amount"

                });

            }


            /*
             * Get user
             */

            const userRef =
                db
                    .collection("users")
                    .doc(uid);


            const userSnapshot =
                await userRef.get();


            if (!userSnapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"

                });

            }


            /*
             * Current wallet
             */

            const userData =
                userSnapshot.data();


            const walletBalance =
                Number(
                    userData.walletBalance || 0
                );


            /*
             * Check wallet balance
             */

            if (
                walletBalance <
                purchaseAmount
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        walletBalance,

                    required:
                        purchaseAmount

                });

            }


            /*
             * Generate unique request ID
             */

            const requestId =
                "IDD-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 100000
                );


            /*
             * Call VTpass
             */

            const response =
                await axios.post(

                    "https://sandbox.vtpass.com/api/pay",

                    {

                        request_id:
                            requestId,

                        serviceID:
                            serviceID,

                        billersCode:
                            phone,

                        variation_code:
                            variation_code,

                        amount:
                            purchaseAmount,

                        phone:
                            phone

                    },

                    {

                        headers: {

                            "api-key":
                                process.env.VTPASS_API_KEY,

                            "secret-key":
                                process.env.VTPASS_SECRET_KEY,

                            "Content-Type":
                                "application/json"

                        }

                    }

                );


            /*
             * VTpass response
             */

            const result =
                response.data;


            console.log(
                "VTpass BUY DATA response:",
                result
            );


            /*
             * Check VTpass result
             */

            if (
                result.code !== "000"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        result.response_description ||
                        "Data purchase failed",

                    code:
                        result.code || null,

                    vtpass:
                        result

                });

            }


            /*
             * =================================================
             * DEDUCT WALLET + SAVE TRANSACTION
             * =================================================
             */

            const transactionRef =
                db
                    .collection(
                        "walletTransactions"
                    )
                    .doc();


            await db.runTransaction(

                async (
                    firestoreTransaction
                ) => {

                    /*
                     * Get fresh user balance
                     */

                    const freshUser =
                        await firestoreTransaction.get(
                            userRef
                        );


                    if (
                        !freshUser.exists
                    ) {

                        throw new Error(
                            "User not found"
                        );

                    }


                    const freshBalance =
                        Number(
                            freshUser
                                .data()
                                .walletBalance || 0
                        );


                    /*
                     * Check balance again
                     */

                    if (
                        freshBalance <
                        purchaseAmount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }


                    /*
                     * New balance
                     */

                    const newBalance =
                        freshBalance -
                        purchaseAmount;


                    /*
                     * Update wallet
                     */

                    firestoreTransaction.update(

                        userRef,

                        {

                            walletBalance:
                                newBalance,

                            updatedAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }

                    );


                    /*
                     * Save transaction
                     */

                    firestoreTransaction.set(

                        transactionRef,

                        {

                            userId:
                                uid,

                            type:
                                "data_purchase",

                            network:
                                networkName,

                            phone:
                                phone,

                            variationCode:
                                variation_code,

                            amount:
                                purchaseAmount,

                            requestId:
                                requestId,

                            vtpassCode:
                                result.code,

                            status:
                                "completed",

                            createdAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }

                    );

                }

            );


            /*
             * Success response
             */

            return res.json({

                success: true,

                message:
                    "Data purchase successful",

                transactionId:
                    transactionRef.id,

                requestId:
                    requestId,

                network:
                    networkName,

                phone:
                    phone,

                amount:
                    purchaseAmount

            });


        } catch (error) {

            console.error(

                "BUY DATA ERROR:",

                error.response?.data ||
                error.message

            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to complete data purchase",

                error:
                    error.response?.data ||
                    error.message

            });

        }

    }
);


/*
 * =====================================================
 * PAYSTACK INITIALIZE PAYMENT
 * =====================================================
 */

app.post(
    "/api/payment/initialize",
    async (req, res) => {

        try {

            const {
                email,
                amount,
                uid
            } = req.body;


            /*
             * Required fields
             */

            if (
                !email ||
                !amount ||
                !uid
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Email, amount and uid are required"

                });

            }


            /*
             * Firebase
             */

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }


            /*
             * Paystack key
             */

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "PAYSTACK_SECRET_KEY is not configured"

                });

            }


            /*
             * Amount
             */

            const amountNumber =
                Number(amount);


            if (
                !Number.isFinite(
                    amountNumber
                ) ||
                amountNumber < 100
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Minimum payment is ₦100"

                });

            }


            /*
             * Naira → Kobo
             */

            const amountInKobo =
                Math.round(
                    amountNumber * 100
                );


            /*
             * Create transaction
             */

            const transactionRef =
                db
                    .collection(
                        "walletTransactions"
                    )
                    .doc();


            const transactionId =
                transactionRef.id;


            /*
             * Paystack
             */

            const response =
                await axios.post(

                    "https://api.paystack.co/transaction/initialize",

                    {

                        email:
                            email,

                        amount:
                            amountInKobo,

                        currency:
                            "NGN",

                        metadata: {

                            userId:
                                uid,

                            transactionId:
                                transactionId

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
             * Save transaction
             */

            await transactionRef.set({

                userId:
                    uid,

                email:
                    email,

                amount:
                    amountNumber,

                amountKobo:
                    amountInKobo,

                type:
                    "wallet_funding",

                status:
                    "pending",

                reference:
                    paymentData.reference,

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()

            });


            /*
             * Response
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

    }
);


/*
 * =====================================================
 * PAYSTACK VERIFY PAYMENT
 * =====================================================
 */

app.get(
    "/api/payment/verify/:reference",
    async (req, res) => {

        try {

            const reference =
                req.params.reference;


            /*
             * Reference
             */

            if (!reference) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction reference is required"

                });

            }


            /*
             * Firebase
             */

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }


            /*
             * Paystack key
             */

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "PAYSTACK_SECRET_KEY is not configured"

                });

            }


            /*
             * Find transaction
             */

            const snapshot =
                await db
                    .collection(
                        "walletTransactions"
                    )
                    .where(
                        "reference",
                        "==",
                        reference
                    )
                    .limit(1)
                    .get();


            /*
             * Not found
             */

            if (
                snapshot.empty
            ) {

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
             * Already completed
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
             * Verify Paystack
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
             * Payment failed
             */

            if (
                payment.status !==
                "success"
            ) {

                await transactionDoc.ref.update({

                    status:
                        payment.status ||
                        "failed",

                    verifiedAt:
                        admin.firestore
                            .FieldValue
                            .serverTimestamp()

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
             * Amount check
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
             * =================================================
             * CREDIT WALLET
             * =================================================
             */

            await db.runTransaction(

                async (
                    firestoreTransaction
                ) => {

                    /*
                     * User
                     */

                    const userRef =
                        db
                            .collection(
                                "users"
                            )
                            .doc(
                                transaction.userId
                            );


                    /*
                     * Transaction
                     */

                    const walletTransactionRef =
                        transactionDoc.ref;


                    /*
                     * Read user
                     */

                    const userSnapshot =
                        await firestoreTransaction.get(
                            userRef
                        );


                    /*
                     * Read transaction
                     */

                    const transactionSnapshot =
                        await firestoreTransaction.get(
                            walletTransactionRef
                        );


                    const currentTransaction =
                        transactionSnapshot.data();


                    /*
                     * Prevent double credit
                     */

                    if (
                        currentTransaction &&
                        currentTransaction.status ===
                        "completed"
                    ) {

                        return;

                    }


                    /*
                     * Current wallet
                     */

                    const currentBalance =
                        userSnapshot.exists
                            ? Number(
                                userSnapshot
                                    .data()
                                    .walletBalance || 0
                            )
                            : 0;


                    /*
                     * New balance
                     */

                    const newBalance =
                        currentBalance +
                        Number(
                            transaction.amount
                        );


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

                            merge:
                                true

                        }

                    );


                    /*
                     * Complete transaction
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
             * Success
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
                    payment.paid_at ||
                    null

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
                    "Unable to verify payment",

                error:
                    error.message

            });

        }

    }
);

/*
 * =====================================================
 * BUY DATA
 * =====================================================
 */

app.post(
    "/api/vtpass/buy-data",
    async (req, res) => {

        try {

            const {
                uid,
                network,
                phone,
                variation_code,
                amount
            } = req.body;

            // ==============================
            // VALIDATION
            // ==============================

            if (
                !uid ||
                !network ||
                !phone ||
                !variation_code ||
                !amount
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "uid, network, phone, variation_code and amount are required"

                });

            }

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }

            if (!process.env.VTPASS_API_KEY) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

            if (!process.env.VTPASS_SECRET_KEY) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_SECRET_KEY is not configured"

                });

            }

            // ==============================
            // NETWORK → SERVICE ID
            // ==============================

            const serviceMap = {

                mtn:
                    "mtn-data",

                airtel:
                    "airtel-data",

                glo:
                    "glo-data",

                "9mobile":
                    "etisalat-data",

                etisalat:
                    "etisalat-data"

            };

            const normalizedNetwork =
                network.toLowerCase().trim();

            const serviceID =
                serviceMap[normalizedNetwork];

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network"

                });

            }

            // ==============================
            // AMOUNT
            // ==============================

            const amountNumber =
                Number(amount);

            if (
                !Number.isFinite(amountNumber) ||
                amountNumber <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid amount"

                });

            }

            // ==============================
            // PHONE VALIDATION
            // ==============================

            const cleanPhone =
                String(phone).replace(/\D/g, "");

            if (cleanPhone.length !== 11) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number must be 11 digits"

                });

            }

            // ==============================
            // USER
            // ==============================

            const userRef =
                db.collection("users").doc(uid);

            const userSnapshot =
                await userRef.get();

            if (!userSnapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found"

                });

            }

            const userData =
                userSnapshot.data();

            const currentBalance =
                Number(
                    userData.walletBalance || 0
                );

            // ==============================
            // CHECK WALLET
            // ==============================

            if (currentBalance < amountNumber) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        currentBalance,

                    required:
                        amountNumber

                });

            }

            // ==============================
            // REQUEST ID
            // ==============================

            const requestId =
                "IDD" +
                Date.now() +
                Math.floor(
                    Math.random() * 1000
                );

            // ==============================
            // VTpass PURCHASE
            // ==============================

            const vtpassResponse =
                await axios.post(

                    "https://sandbox.vtpass.com/api/pay",

                    {

                        request_id:
                            requestId,

                        serviceID:
                            serviceID,

                        billersCode:
                            cleanPhone,

                        variation_code:
                            variation_code,

                        amount:
                            amountNumber,

                        phone:
                            cleanPhone

                    },

                    {

                        headers: {

                            "api-key":
                                process.env.VTPASS_API_KEY,

                            "secret-key":
                                process.env.VTPASS_SECRET_KEY,

                            "Content-Type":
                                "application/json"

                        }

                    }

                );

            const vtpassData =
                vtpassResponse.data;

            console.log(
                "VTpass purchase:",
                vtpassData
            );

            // ==============================
            // CHECK VTpass RESPONSE
            // ==============================

            const responseCode =
                String(
                    vtpassData.code || ""
                );

            const successful =
                responseCode === "000";

            if (!successful) {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData.response_description ||
                        "Data purchase failed",

                    vtpass:
                        vtpassData

                });

            }

            // ==============================
            // DEDUCT WALLET + SAVE TRANSACTION
            // ==============================

            const transactionRef =
                db
                    .collection("transactions")
                    .doc();

            await db.runTransaction(

                async (transaction) => {

                    const freshUser =
                        await transaction.get(
                            userRef
                        );

                    const freshData =
                        freshUser.data() || {};

                    const freshBalance =
                        Number(
                            freshData.walletBalance || 0
                        );

                    if (
                        freshBalance <
                        amountNumber
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    const newBalance =
                        freshBalance -
                        amountNumber;

                    transaction.update(

                        userRef,

                        {

                            walletBalance:
                                newBalance,

                            updatedAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }

                    );

                    transaction.set(

                        transactionRef,

                        {

                            userId:
                                uid,

                            type:
                                "data_purchase",

                            network:
                                normalizedNetwork,

                            phone:
                                cleanPhone,

                            variationCode:
                                variation_code,

                            amount:
                                amountNumber,

                            serviceID:
                                serviceID,

                            requestId:
                                requestId,

                            vtpassCode:
                                responseCode,

                            status:
                                "successful",

                            createdAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }

                    );

                }

            );

            // ==============================
            // SUCCESS
            // ==============================

            res.json({

                success: true,

                message:
                    "Data purchase successful",

                transactionId:
                    transactionRef.id,

                network:
                    normalizedNetwork,

                phone:
                    cleanPhone,

                amount:
                    amountNumber,

                walletBalance:
                    currentBalance -
                    amountNumber,

                vtpass:
                    vtpassData

            });

        } catch (error) {

            console.error(
                "Buy data error:",
                error.response?.data ||
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to complete data purchase",

                error:
                    error.response?.data ||
                    error.message

            });

        }

    }
);
/*
 * =====================================================
 * START SERVER
 * =====================================================
 */

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `ISMAIL DEEN DATA server running on port ${PORT}`
        );

    }
);
