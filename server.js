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
 *
 * Example:
 * /api/wallet/FIREBASE_UID
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
 * Example:
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
