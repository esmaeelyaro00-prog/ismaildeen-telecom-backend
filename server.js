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
HEALTH
=====================================================
*/

app.get("/api/health", async (req, res) => {

    let firebaseStatus =
        "disconnected";

    if (db) {
        firebaseStatus =
            "connected";
    }

    res.json({

        success: true,

        status:
            "online",

        firebase:
            firebaseStatus,

        time:
            new Date().toISOString()

    });

});

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
                    "Firebase connection failed",

                error:
                    error.message

            });

        }

    }
);

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
GET WALLET
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
                String(req.params.uid || "")
                    .trim();

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            const userRef =
                db
                    .collection("users")
                    .doc(uid);

            const snapshot =
                await userRef.get();

            if (!snapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found",

                    uid:
                        uid

                });

            }

            const data =
                snapshot.data() || {};

            const walletBalance =
                Number(
                    data.walletBalance || 0
                );

            return res.json({

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

            return res.status(500).json({

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
=====================================================
VTpass DATA PLANS
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
                !process.env.VTPASS_SECRET_KEY
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "VTPASS_SECRET_KEY is not configured"

                });

            }

            console.log(
                "Loading VTpass plans:",
                serviceID
            );

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

                            "secret-key":
                                process.env.VTPASS_SECRET_KEY,

                            "Content-Type":
                                "application/json",

                            "Accept":
                                "application/json"

                        },

                        timeout:
                            30000

                    }

                );

            const content =
                response.data &&
                response.data.content
                    ? response.data.content
                    : {};

            const variations =
                content.variations ||
                content.varations ||
                [];

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
IMPORTANT:
ONLY ONE BUY-DATA ROUTE
=====================================================
*/

app.post(
    "/api/vtpass/buy-data",
    async (req, res) => {

        try {

            console.log(
                "===================================="
            );

            console.log(
                "BUY DATA REQUEST"
            );

            console.log(
                req.body
            );

            console.log(
                "===================================="
            );

            /*
            ========================================
            GET REQUEST DATA
            ========================================
            */

            const uid =
                String(
                    req.body.uid || ""
                ).trim();

            const network =
                String(
                    req.body.network || ""
                )
                    .toLowerCase()
                    .trim();

            const phone =
                String(
                    req.body.phone || ""
                ).trim();

            const variationCode =
                String(
                    req.body.variation_code || ""
                ).trim();

            const amount =
                Number(
                    req.body.amount
                );

            /*
            ========================================
            VALIDATION
            ========================================
            */

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            if (!network) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Network is required"

                });

            }

            if (!phone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number is required"

                });

            }

            if (!variationCode) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Variation code is required"

                });

            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid amount"

                });

            }

            /*
            ========================================
            PHONE VALIDATION
            ========================================
            */

            const cleanPhone =
                phone.replace(
                    /\D/g,
                    ""
                );

            if (
                cleanPhone.length !== 11
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number must be 11 digits"

                });

            }

            /*
            ========================================
            FIREBASE CHECK
            ========================================
            */

            if (!db) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Firebase is not initialized"

                });

            }

            /*
            ========================================
            VTpass KEYS
            ========================================
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
            ========================================
            SERVICE ID
            ========================================
            */

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

            /*
            ========================================
            USER
            ========================================
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
                        "User account not found. Please login again."

                });

            }

            const userData =
                userSnapshot.data() || {};

            const walletBalance =
                Number(
                    userData.walletBalance || 0
                );

            /*
            ========================================
            CHECK WALLET
            ========================================
            */

            if (
                walletBalance < amount
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        walletBalance,

                    required:
                        amount

                });

            }

            /*
            ========================================
            REQUEST ID
            ========================================
            */

            const requestId =
                "IDD-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() *
                    100000
                );

            /*
            ========================================
            VTpass REQUEST
            ========================================
            */

            const vtpassPayload = {

                request_id:
                    requestId,

                serviceID:
                    serviceID,

                billersCode:
                    cleanPhone,

                variation_code:
                    variationCode,

                amount:
                    amount,

                phone:
                    cleanPhone

            };

            console.log(
                "VTpass payload:",
                vtpassPayload
            );

            /*
            ========================================
            CALL VTpass
            ========================================
            */

            const vtpassResponse =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    vtpassPayload,

                    {

                        headers: {

                            "api-key":
                                process.env.VTPASS_API_KEY,

                            "secret-key":
                                process.env.VTPASS_SECRET_KEY,

                            "Content-Type":
                                "application/json",

                            "Accept":
                                "application/json"

                        },

                        timeout:
                            60000

                    }

                );

            const vtpassData =
                vtpassResponse.data || {};

            /*
            ========================================
            LOG VTpass RESPONSE
            ========================================
            */

            console.log(
                "VTpass response:"
            );

            console.log(
                JSON.stringify(
                    vtpassData,
                    null,
                    2
                )
            );

            /*
            ========================================
            VTpass CODE
            ========================================
            */

            const vtpassCode =
                String(
                    vtpassData.code || ""
                );

            const responseDescription =
                vtpassData
                    .response_description ||
                "";

            /*
            ========================================
            SUCCESS
            ========================================
            */

            if (
                vtpassCode !== "000"
            ) {

                console.error(
                    "VTpass transaction failed:",
                    responseDescription
                );

                return res.status(400).json({

                    success: false,

                    message:
                        responseDescription ||
                        "VTpass transaction failed",

                    code:
                        vtpassCode || null,

                    requestId:
                        requestId,

                    vtpass:
                        vtpassData

                });

            }

            /*
            ========================================
            TRANSACTION REFERENCE
            ========================================
            */

            const transactionRef =
                db
                    .collection(
                        "transactions"
                    )
                    .doc();

            /*
            ========================================
            DEDUCT WALLET + SAVE
            ========================================
            */

            let newBalance = 0;

            await db.runTransaction(
                async (transaction) => {

                    /*
                    --------------------------------
                    GET FRESH USER
                    --------------------------------
                    */

                    const freshUser =
                        await transaction.get(
                            userRef
                        );

                    if (
                        !freshUser.exists
                    ) {

                        throw new Error(
                            "User not found"
                        );

                    }

                    const freshData =
                        freshUser.data() || {};

                    const freshBalance =
                        Number(
                            freshData.walletBalance ||
                            0
                        );

                    /*
                    --------------------------------
                    CHECK AGAIN
                    --------------------------------
                    */

                    if (
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    /*
                    --------------------------------
                    NEW BALANCE
                    --------------------------------
                    */

                    newBalance =
                        freshBalance -
                        amount;

                    /*
                    --------------------------------
                    UPDATE USER
                    --------------------------------
                    */

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

                    /*
                    --------------------------------
                    SAVE TRANSACTION
                    --------------------------------
                    */

                    transaction.set(

                        transactionRef,

                        {

                            userId:
                                uid,

                            type:
                                "data_purchase",

                            network:
                                network,

                            phone:
                                cleanPhone,

                            variationCode:
                                variationCode,

                            amount:
                                amount,

                            serviceID:
                                serviceID,

                            requestId:
                                requestId,

                            vtpassCode:
                                vtpassCode,

                            responseDescription:
                                responseDescription,

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
            ========================================
            SUCCESS RESPONSE
            ========================================
            */

            console.log(
                "DATA PURCHASE SUCCESSFUL"
            );

            return res.json({

                success: true,

                message:
                    "Data purchase successful",

                transactionId:
                    transactionRef.id,

                requestId:
                    requestId,

                network:
                    network,

                phone:
                    cleanPhone,

                amount:
                    amount,

                walletBalance:
                    newBalance,

                vtpass:
                    vtpassData

            });

        } catch (error) {

            /*
            ========================================
            ERROR LOG
            ========================================
            */

            console.error(
                "BUY DATA ERROR:"
            );

            console.error(
                error.response?.data ||
                error.message
            );

            /*
            ========================================
            AXIOS / VTpass ERROR
            ========================================
            */

            if (
                error.response
            ) {

                return res.status(
                    error.response.status ||
                    500
                ).json({

                    success: false,

                    message:
                        error.response
                            .data
                            ?.response_description ||
                        error.response
                            .data
                            ?.message ||
                        "VTpass transaction failed",

                    code:
                        error.response
                            .data
                            ?.code ||
                        null,

                    vtpass:
                        error.response
                            .data ||
                        null

                });

            }

            /*
            ========================================
            GENERAL ERROR
            ========================================
            */

            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Unable to complete data purchase"

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

            const email =
                String(
                    req.body.email || ""
                ).trim();

            const uid =
                String(
                    req.body.uid || ""
                ).trim();

            const amount =
                Number(
                    req.body.amount
                );

            if (
                !email ||
                !uid ||
                !Number.isFinite(amount)
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

            if (amount < 100) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Minimum payment is ₦100"

                });

            }

            const amountInKobo =
                Math.round(
                    amount * 100
                );

            const transactionRef =
                db
                    .collection(
                        "walletTransactions"
                    )
                    .doc();

            const response =
                await axios.post(

                    `${PAYSTACK_BASE_URL}/transaction/initialize`,

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
                                transactionRef.id

                        }

                    },

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                            "Content-Type":
                                "application/json"

                        },

                        timeout:
                            30000

                    }

                );

            const paymentData =
                response.data.data;

            await transactionRef.set({

                userId:
                    uid,

                email:
                    email,

                amount:
                    amount,

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
                        transactionRef.id

                }

            });

        } catch (error) {

            console.error(
                "Paystack initialize error:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to initialize payment"

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

            const response =
                await axios.get(

                    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`

                        },

                        timeout:
                            30000

                    }

                );

            const payment =
                response.data.data;

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

            await db.runTransaction(
                async (firestoreTransaction) => {

                    const userRef =
                        db
                            .collection("users")
                            .doc(
                                transaction.userId
                            );

                    const userSnapshot =
                        await firestoreTransaction.get(
                            userRef
                        );

                    const transactionSnapshot =
                        await firestoreTransaction.get(
                            transactionDoc.ref
                        );

                    const currentTransaction =
                        transactionSnapshot.data() ||
                        {};

                    if (
                        currentTransaction.status ===
                        "completed"
                    ) {

                        return;

                    }

                    const currentBalance =
                        userSnapshot.exists
                            ? Number(
                                userSnapshot
                                    .data()
                                    .walletBalance ||
                                0
                            )
                            : 0;

                    const newBalance =
                        currentBalance +
                        Number(
                            transaction.amount
                        );

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

                    firestoreTransaction.update(

                        transactionDoc.ref,

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

            return res.json({

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

            return res.status(500).json({

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
=====================================================
START SERVER
=====================================================
*/

app.listen(
    PORT,
    () => {

        console.log(
            `ISMAIL DEEN DATA server running on port ${PORT}`
        );

        console.log(
            "VTpass URL:",
            VTPASS_BASE_URL
        );

    }
);
