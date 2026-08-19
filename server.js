require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");

const app = express();

/*
=====================================================
BASIC CONFIG
=====================================================
*/

app.use(cors());
app.use(express.json());

/*
=====================================================
ENVIRONMENT
=====================================================
*/

const PORT = process.env.PORT || 3000;

const VTPASS_BASE_URL =
    process.env.VTPASS_BASE_URL ||
    "https://sandbox.vtpass.com/api";

const PAYSTACK_BASE_URL =
    "https://api.paystack.co";

/*
=====================================================
FIREBASE ADMIN
=====================================================
*/

let db = null;

try {

    const serviceAccount = require(
        "/etc/secrets/firebase-service-account.json"
    );

    if (!admin.apps.length) {

        admin.initializeApp({

            credential:
                admin.credential.cert(serviceAccount)

        });

    }

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
=====================================================
HELPERS
=====================================================
*/

function getServiceId(network) {

    const serviceMap = {

        mtn: "mtn-data",

        airtel: "airtel-data",

        glo: "glo-data",

        "9mobile": "etisalat-data",

        etisalat: "etisalat-data"

    };

    if (!network) {
        return null;
    }

    const normalized =
        String(network)
            .toLowerCase()
            .trim();

    return serviceMap[normalized] || null;
}


function generateRequestId() {

    return (
        "IDD-" +
        Date.now() +
        "-" +
        Math.floor(
            Math.random() * 1000000
        )
    );

}


function isValidPhone(phone) {

    return /^[0-9]{11}$/.test(
        String(phone)
    );

}


function isValidAmount(amount) {

    const number =
        Number(amount);

    return (
        Number.isFinite(number) &&
        number > 0
    );

}

/*
=====================================================
HOME
=====================================================
*/

app.get("/", (req, res) => {

    res.json({

        success: true,

        message:
            "ISMAIL DEEN DATA Backend is running",

        status:
            "online"

    });

});

/*
=====================================================
HEALTH CHECK
=====================================================
*/

app.get("/api/health", (req, res) => {

    res.json({

        success: true,

        status: "online",

        firebase:
            db ? "connected" : "not_connected",

        time:
            new Date().toISOString()

    });

});

/*
=====================================================
PAYMENT TEST
=====================================================
*/

app.get(
    "/api/payment/test",
    (req, res) => {

        res.json({

            success: true,

            message:
                "Payment backend is connected"

        });

    }
);

/*
=====================================================
FIREBASE TEST
=====================================================
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
                        admin.firestore
                            .FieldValue
                            .serverTimestamp()

                });

            return res.json({

                success: true,

                message:
                    "Firebase connected successfully"

            });

        } catch (error) {

            console.error(
                "Firebase test error:",
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Firebase connection failed"

            });

        }

    }
);

/*
=====================================================
GET USER WALLET
=====================================================
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
                String(req.params.uid || "").trim();

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
                        "User not found"

                });

            }

            const data =
                userDoc.data() || {};

            const walletBalance =
                Number(
                    data.walletBalance || 0
                );

            return res.json({

                success: true,

                uid: uid,

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

            return res.status(500).json({

                success: false,

                message:
                    "Unable to read wallet"

            });

        }

    }
);

/*
=====================================================
VTpass DATA PLANS
=====================================================

GET:
 /api/vtpass/data-plans/mtn
 /api/vtpass/data-plans/airtel
 /api/vtpass/data-plans/glo
 /api/vtpass/data-plans/9mobile

VTpass variation-code endpoint uses serviceID.
=====================================================
*/

app.get(
    "/api/vtpass/data-plans/:network",
    async (req, res) => {

        try {

            const network =
                String(
                    req.params.network || ""
                )
                .toLowerCase()
                .trim();

            const serviceID =
                getServiceId(network);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network",

                    network:
                        network

                });

            }

            if (
                !process.env.VTPASS_API_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

            if (
                !process.env.VTPASS_PUBLIC_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_PUBLIC_KEY is not configured"

                });

            }

            const response =
                await axios.get(

                    `${VTPASS_BASE_URL}/service-variations`,

                    {

                        params: {

                            serviceID:
                                serviceID

                        },

                        headers: {

                            "api-key":
                                process.env.VTPASS_API_KEY,

                            "public-key":
                                process.env.VTPASS_PUBLIC_KEY,

                            "Content-Type":
                                "application/json"

                        },

                        timeout: 30000

                    }

                );

            const data =
                response.data || {};

            const content =
                data.content || {};

            const variations =
                content.variations ||
                content.varations ||
                [];

            const plans =
                variations.map(
                    (plan) => ({

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

                    })
                );

            return res.json({

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
                "VTpass plans error:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

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
=====================================================
BUY DATA
=====================================================

IMPORTANT:
There is ONLY ONE buy-data route.
=====================================================
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

            /*
            -----------------------------------------
            VALIDATION
            -----------------------------------------
            */

            if (
                !uid ||
                !network ||
                !phone ||
                !variation_code ||
                amount === undefined ||
                amount === null
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

            if (
                !process.env.VTPASS_API_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

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
            -----------------------------------------
            NETWORK
            -----------------------------------------
            */

            const normalizedNetwork =
                String(network)
                    .toLowerCase()
                    .trim();

            const serviceID =
                getServiceId(
                    normalizedNetwork
                );

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network"

                });

            }

            /*
            -----------------------------------------
            PHONE
            -----------------------------------------
            */

            const cleanPhone =
                String(phone)
                    .replace(/\D/g, "");

            if (!isValidPhone(cleanPhone)) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number must be 11 digits"

                });

            }

            /*
            -----------------------------------------
            AMOUNT
            -----------------------------------------
            */

            const purchaseAmount =
                Number(amount);

            if (
                !isValidAmount(
                    purchaseAmount
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid amount"

                });

            }

            /*
            -----------------------------------------
            USER
            -----------------------------------------
            */

            const userRef =
                db
                    .collection("users")
                    .doc(
                        String(uid)
                    );

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
                userSnapshot.data() || {};

            const walletBalance =
                Number(
                    userData.walletBalance || 0
                );

            /*
            -----------------------------------------
            CHECK BALANCE
            -----------------------------------------
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
            -----------------------------------------
            REQUEST ID
            -----------------------------------------
            */

            const requestId =
                generateRequestId();

            /*
            -----------------------------------------
            VTpass PURCHASE
            -----------------------------------------
            */

            const vtpassResponse =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    {

                        request_id:
                            requestId,

                        serviceID:
                            serviceID,

                        billersCode:
                            cleanPhone,

                        variation_code:
                            String(
                                variation_code
                            ),

                        amount:
                            purchaseAmount,

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

                        },

                        timeout: 60000

                    }

                );

            const vtpassData =
                vtpassResponse.data || {};

            console.log(
                "VTpass purchase:",
                vtpassData
            );

            /*
            -----------------------------------------
            RESPONSE CODE
            -----------------------------------------
            */

            const responseCode =
                String(
                    vtpassData.code || ""
                );

            if (
                responseCode !== "000"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData.response_description ||
                        "Data purchase failed",

                    code:
                        responseCode || null

                });

            }

            /*
            -----------------------------------------
            TRANSACTION
            -----------------------------------------
            */

            const transactionRef =
                db
                    .collection("transactions")
                    .doc();

            /*
            -----------------------------------------
            DEDUCT WALLET
            -----------------------------------------
            */

            let newBalance = 0;

            await db.runTransaction(

                async (
                    firestoreTransaction
                ) => {

                    const freshUser =
                        await firestoreTransaction.get(
                            userRef
                        );

                    if (!freshUser.exists) {

                        throw new Error(
                            "User not found"
                        );

                    }

                    const freshData =
                        freshUser.data() || {};

                    const freshBalance =
                        Number(
                            freshData.walletBalance || 0
                        );

                    if (
                        freshBalance <
                        purchaseAmount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        freshBalance -
                        purchaseAmount;

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

                    firestoreTransaction.set(

                        transactionRef,

                        {

                            userId:
                                String(uid),

                            type:
                                "data_purchase",

                            network:
                                normalizedNetwork,

                            phone:
                                cleanPhone,

                            variationCode:
                                String(
                                    variation_code
                                ),

                            amount:
                                purchaseAmount,

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

            /*
            -----------------------------------------
            SUCCESS
            -----------------------------------------
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
                    normalizedNetwork,

                phone:
                    cleanPhone,

                amount:
                    purchaseAmount,

                walletBalance:
                    newBalance

            });

        } catch (error) {

            console.error(
                "BUY DATA ERROR:",
                error.response?.data ||
                error.message
            );

            if (
                error.message ===
                "Insufficient wallet balance"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance"

                });

            }

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
=====================================================
PAYSTACK INITIALIZE
=====================================================
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
            -----------------------------------------
            VALIDATION
            -----------------------------------------
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

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "PAYSTACK_SECRET_KEY is not configured"

                });

            }

            const amountNumber =
                Number(amount);

            /*
            -----------------------------------------
            MINIMUM
            -----------------------------------------
            */

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
            -----------------------------------------
            NAIRA → KOBO
            -----------------------------------------
            */

            const amountInKobo =
                Math.round(
                    amountNumber * 100
                );

            /*
            -----------------------------------------
            FIRESTORE TRANSACTION
            -----------------------------------------
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
            -----------------------------------------
            PAYSTACK
            -----------------------------------------
            */

            const response =
                await axios.post(

                    `${PAYSTACK_BASE_URL}/transaction/initialize`,

                    {

                        email:
                            String(email)
                                .trim(),

                        amount:
                            amountInKobo,

                        currency:
                            "NGN",

                        metadata: {

                            userId:
                                String(uid),

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

                        },

                        timeout: 30000

                    }

                );

            if (
                !response.data ||
                !response.data.status
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        response.data?.message ||
                        "Paystack initialization failed"

                });

            }

            const paymentData =
                response.data.data;

            /*
            -----------------------------------------
            SAVE PENDING PAYMENT
            -----------------------------------------
            */

            await transactionRef.set({

                userId:
                    String(uid),

                email:
                    String(email)
                        .trim(),

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
            -----------------------------------------
            RESPONSE
            -----------------------------------------
            */

            return res.json({

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

            return res.status(500).json({

                success: false,

                message:
                    "Unable to initialize payment",

                error:
                    error.response?.data ||
                    error.message

            });

        }

    }
);

/*
=====================================================
PAYSTACK VERIFY
=====================================================
*/

app.get(
    "/api/payment/verify/:reference",
    async (req, res) => {

        try {

            const reference =
                String(
                    req.params.reference || ""
                ).trim();

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
            -----------------------------------------
            FIND TRANSACTION
            -----------------------------------------
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
            -----------------------------------------
            ALREADY COMPLETED
            -----------------------------------------
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
            -----------------------------------------
            VERIFY PAYSTACK
            -----------------------------------------
            */

            const response =
                await axios.get(

                    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`

                        },

                        timeout: 30000

                    }

                );

            const payment =
                response.data?.data;

            if (!payment) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Invalid Paystack response"

                });

            }

            /*
            -----------------------------------------
            PAYMENT NOT SUCCESSFUL
            -----------------------------------------
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
            -----------------------------------------
            CHECK AMOUNT
            -----------------------------------------
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
            -----------------------------------------
            CREDIT WALLET
            -----------------------------------------
            */

            const userRef =
                db
                    .collection("users")
                    .doc(
                        transaction.userId
                    );

            await db.runTransaction(

                async (
                    firestoreTransaction
                ) => {

                    /*
                    Read transaction FIRST
                    */

                    const transactionSnapshot =
                        await firestoreTransaction.get(
                            transactionDoc.ref
                        );

                    const currentTransaction =
                        transactionSnapshot.data();

                    /*
                    Prevent double credit
                    */

                    if (
                        currentTransaction &&
                        currentTransaction.status ===
                        "completed"
                    ) {

                        return;

                    }

                    /*
                    Read user
                    */

                    const userSnapshot =
                        await firestoreTransaction.get(
                            userRef
                        );

                    const currentBalance =
                        userSnapshot.exists
                            ? Number(
                                userSnapshot
                                    .data()
                                    .walletBalance || 0
                            )
                            : 0;

                    const newBalance =
                        currentBalance +
                        Number(
                            transaction.amount
                        );

                    /*
                    Update wallet
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
                    Complete payment
                    */

                    firestoreTransaction.update(

                        transactionDoc.ref,

                        {

                            status:
                                "completed",

                            paystackStatus:
                                payment.status,

                            paystackReference:
                                payment.reference,

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
            -----------------------------------------
            SUCCESS
            -----------------------------------------
            */

            return res.json({

                success: true,

                message:
                    "Payment verified and wallet funded successfully",

                status:
                    "success",

                reference:
                    payment.reference,

                amount:
                    Number(payment.amount) / 100,

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

            return res.status(500).json({

                success: false,

                message:
                    "Unable to verify payment",

                error:
                    error.response?.data ||
                    error.message

            });

        }

    }
);

/*
=====================================================
404 ROUTE
=====================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API route not found",

            path:
                req.originalUrl

        });

    }
);

/*
=====================================================
GLOBAL ERROR HANDLER
=====================================================
*/

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Internal server error"

        });

    }
);

/*
=====================================================
START SERVER
=====================================================
*/

app.listen(
    PORT,
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "ISMAIL DEEN DATA BACKEND"
        );

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `VTpass: ${VTPASS_BASE_URL}`
        );

        console.log(
            `Firebase: ${
                db
                    ? "Connected"
                    : "Not Connected"
            }`
        );

        console.log(
            "======================================"
        );

    }
);
