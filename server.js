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
app.use(express.json({ limit: "1mb" }));

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

    const serviceAccount =
        require("/etc/secrets/firebase-service-account.json");

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
COMMON HELPERS
=====================================================
*/

function cleanString(value) {

    return String(value || "").trim();

}


function cleanPhone(value) {

    return cleanString(value).replace(/\D/g, "");

}


function isValidPhone(phone) {

    return /^\d{11}$/.test(phone);

}


function generateRequestId(prefix = "IDD") {

    return (
        prefix +
        "-" +
        Date.now() +
        "-" +
        Math.floor(Math.random() * 1000000)
    );

}


function getDataServiceId(network) {

    const serviceMap = {

        mtn: "mtn-data",

        airtel: "airtel-data",

        glo: "glo-data",

        "9mobile": "etisalat-data",

        etisalat: "etisalat-data"

    };

    const normalized =
        cleanString(network).toLowerCase();

    return serviceMap[normalized] || null;

}


function getAirtimeServiceId(network) {

    const serviceMap = {

        mtn: "mtn",

        airtel: "airtel",

        glo: "glo",

        "9mobile": "etisalat",

        etisalat: "etisalat"

    };

    const normalized =
        cleanString(network).toLowerCase();

    return serviceMap[normalized] || null;

}


function getElectricityServiceId(disco) {

    const serviceMap = {

        "abuja electricity distribution company":
            "abuja-electric",

        "benin electricity distribution company":
            "benin-electric",

        "eko electricity distribution company":
            "eko-electric",

        "enugu electricity distribution company":
            "enugu-electric",

        "ibadan electricity distribution company":
            "ibadan-electric",

        "ikeja electricity distribution company":
            "ikeja-electric",

        "jos electricity distribution company":
            "jos-electric",

        "kaduna electricity distribution company":
            "kaduna-electric",

        "kano electricity distribution company":
            "kano-electric",

        "yola electricity distribution company":
            "yola-electric"

    };

    const normalized =
        cleanString(disco).toLowerCase();

    return serviceMap[normalized] || null;

}


function getCableServiceId(provider) {

    const normalized =
        cleanString(provider).toLowerCase();

    const serviceMap = {

        dstv: "dstv",

        gotv: "gotv",

        "go tv": "gotv",

        "go-tv": "gotv",

        startimes: "startimes",

        "star times": "startimes",

        "star-times": "startimes"

    };

    return serviceMap[normalized] || null;

}


function vtpassHeaders() {

    return {

        "api-key":
            process.env.VTPASS_API_KEY,

        "secret-key":
            process.env.VTPASS_SECRET_KEY,

        "Content-Type":
            "application/json",

        "Accept":
            "application/json"

    };

}


function checkFirebase(res) {

    if (!db) {

        res.status(500).json({

            success: false,

            message:
                "Firebase is not initialized"

        });

        return false;

    }

    return true;

}


function checkVTPassKeys(res) {

    if (!process.env.VTPASS_API_KEY) {

        res.status(500).json({

            success: false,

            message:
                "VTPASS_API_KEY is not configured"

        });

        return false;

    }

    if (!process.env.VTPASS_SECRET_KEY) {

        res.status(500).json({

            success: false,

            message:
                "VTPASS_SECRET_KEY is not configured"

        });

        return false;

    }

    return true;

}


function checkPaystackKey(res) {

    if (!process.env.PAYSTACK_SECRET_KEY) {

        res.status(500).json({

            success: false,

            message:
                "PAYSTACK_SECRET_KEY is not configured"

        });

        return false;

    }

    return true;

}


/*
=====================================================
WALLET HISTORY
=====================================================

Every wallet change is saved here.

This is what the frontend chart can use
instead of keeping chart data only in memory.
=====================================================
*/

async function saveWalletHistory(
    transaction,
    uid,
    balance,
    type,
    amount,
    extra = {}
) {

    const historyRef =
        db
            .collection("walletHistory")
            .doc();

    transaction.set(
        historyRef,
        {

            userId: uid,

            balance: Number(balance),

            amount: Number(amount || 0),

            type: type,

            ...extra,

            createdAt:
                admin.firestore
                    .FieldValue
                    .serverTimestamp()

        }
    );

    return historyRef;

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

    res.json({

        success: true,

        status:
            "online",

        firebase:
            db ? "connected" : "disconnected",

        vtpass:
            process.env.VTPASS_API_KEY
                ? "configured"
                : "not configured",

        paystack:
            process.env.PAYSTACK_SECRET_KEY
                ? "configured"
                : "not configured",

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

            if (!checkFirebase(res)) {
                return;
            }

            await db
                .collection("system")
                .doc("connection")
                .set({

                    connected:
                        true,

                    updatedAt:
                        admin.firestore
                            .FieldValue
                            .serverTimestamp()

                });

            res.json({

                success: true,

                message:
                    "Firebase connected successfully"

            });

        } catch (error) {

            console.error(
                "Firebase test error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Firebase connection failed"

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

            if (!checkFirebase(res)) {
                return;
            }

            const uid =
                cleanString(req.params.uid);

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            const userRef =
                db.collection("users").doc(uid);

            const snapshot =
                await userRef.get();

            if (!snapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User not found",

                    uid: uid

                });

            }

            const data =
                snapshot.data() || {};

            const walletBalance =
                Number(
                    data.walletBalance || 0
                );

            res.json({

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

            res.status(500).json({

                success: false,

                message:
                    "Unable to read wallet"

            });

        }

    }
);


/*
=====================================================
WALLET HISTORY
=====================================================
*/

app.get(
    "/api/wallet/:uid/history",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            const uid =
                cleanString(req.params.uid);

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            const limit =
                Math.min(
                    Math.max(
                        Number(req.query.limit) || 100,
                        1
                    ),
                    500
                );

            const snapshot =
                await db
                    .collection("walletHistory")
                    .where(
                        "userId",
                        "==",
                        uid
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(limit)
                    .get();

            const history =
                snapshot.docs.map(doc => {

                    const data =
                        doc.data() || {};

                    return {

                        id: doc.id,

                        userId:
                            data.userId,

                        balance:
                            Number(
                                data.balance || 0
                            ),

                        amount:
                            Number(
                                data.amount || 0
                            ),

                        type:
                            data.type || null,

                        service:
                            data.service || null,

                        createdAt:
                            data.createdAt
                                ?.toDate
                                ? data.createdAt
                                    .toDate()
                                    .toISOString()
                                : null

                    };

                });

            res.json({

                success: true,

                uid: uid,

                history: history

            });

        } catch (error) {

            console.error(
                "Wallet history error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to load wallet history",

                error:
                    error.message

            });

        }

    }
);


/*
=====================================================
WALLET CHART
=====================================================

Returns persistent wallet balance points.

Frontend should use this endpoint for chart.
=====================================================
*/

app.get(
    "/api/wallet/:uid/chart",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            const uid =
                cleanString(req.params.uid);

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            const snapshot =
                await db
                    .collection("walletHistory")
                    .where(
                        "userId",
                        "==",
                        uid
                    )
                    .orderBy(
                        "createdAt",
                        "asc"
                    )
                    .limit(500)
                    .get();

            const chart =
                snapshot.docs.map(doc => {

                    const data =
                        doc.data() || {};

                    return {

                        id: doc.id,

                        balance:
                            Number(
                                data.balance || 0
                            ),

                        amount:
                            Number(
                                data.amount || 0
                            ),

                        type:
                            data.type || null,

                        createdAt:
                            data.createdAt
                                ?.toDate
                                ? data.createdAt
                                    .toDate()
                                    .toISOString()
                                : null

                    };

                });

            res.json({

                success: true,

                uid: uid,

                chart: chart

            });

        } catch (error) {

            console.error(
                "Wallet chart error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to load wallet chart",

                error:
                    error.message

            });

        }

    }
);


/*
=====================================================
WALLET TRANSACTIONS
=====================================================
*/

app.get(
    "/api/wallet/:uid/transactions",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            const uid =
                cleanString(req.params.uid);

            if (!uid) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID is required"

                });

            }

            const limit =
                Math.min(
                    Math.max(
                        Number(req.query.limit) || 100,
                        1
                    ),
                    500
                );

            const snapshot =
                await db
                    .collection("transactions")
                    .where(
                        "userId",
                        "==",
                        uid
                    )
                    .orderBy(
                        "createdAt",
                        "desc"
                    )
                    .limit(limit)
                    .get();

            const transactions =
                snapshot.docs.map(doc => {

                    const data =
                        doc.data() || {};

                    return {

                        id: doc.id,

                        ...data,

                        createdAt:
                            data.createdAt
                                ?.toDate
                                ? data.createdAt
                                    .toDate()
                                    .toISOString()
                                : null

                    };

                });

            res.json({

                success: true,

                uid: uid,

                transactions:
                    transactions

            });

        } catch (error) {

            console.error(
                "Transactions error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to load transactions",

                error:
                    error.message

            });

        }

    }
);


/*
=====================================================
VTPASS DATA PLANS
=====================================================
*/

app.get(
    "/api/vtpass/data-plans/:network",
    async (req, res) => {

        try {

            if (!checkVTPassKeys(res)) {
                return;
            }

            const network =
                cleanString(
                    req.params.network
                ).toLowerCase();

            const serviceID =
                getDataServiceId(network);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network",

                    network

                });

            }

            const response =
                await axios.get(

                    `${VTPASS_BASE_URL}/service-variations`,

                    {

                        params: {
                            serviceID
                        },

                        headers:
                            vtpassHeaders(),

                        timeout: 30000

                    }

                );

            const content =
                response.data?.content || {};

            const variations =
                content.variations ||
                content.varations ||
                [];

            const plans =
                variations.map(plan => ({

                    variation_code:
                        plan.variation_code,

                    name:
                        plan.name,

                    amount:
                        Number(
                            plan.variation_amount ||
                            plan.amount ||
                            0
                        ),

                    variation_amount:
                        plan.variation_amount,

                    fixedPrice:
                        plan.fixedPrice

                }));

            res.json({

                success: true,

                network,

                serviceID,

                plans

            });

        } catch (error) {

            console.error(
                "VTpass plans error:",
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
=====================================================
BUY DATA
=====================================================
*/

app.post(
    "/api/vtpass/buy-data",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            if (!checkVTPassKeys(res)) {
                return;
            }

            const uid =
                cleanString(req.body.uid);

            const network =
                cleanString(
                    req.body.network
                ).toLowerCase();

            const phone =
                cleanPhone(req.body.phone);

            const variationCode =
                cleanString(
                    req.body.variation_code
                );

            const amount =
                Number(req.body.amount);

            if (!uid) {

                return res.status(400).json({

                    success: false,
                    message: "UID is required"

                });

            }

            if (!network) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Network is required"

                });

            }

            if (!isValidPhone(phone)) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number must be 11 digits"

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

            const serviceID =
                getDataServiceId(network);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network"

                });

            }

            const userRef =
                db.collection("users").doc(uid);

            const userSnapshot =
                await userRef.get();

            if (!userSnapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found"

                });

            }

            const userData =
                userSnapshot.data() || {};

            const currentBalance =
                Number(
                    userData.walletBalance || 0
                );

            if (currentBalance < amount) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        currentBalance,

                    required:
                        amount

                });

            }

            const requestId =
                generateRequestId("IDD-DATA");

            const payload = {

                request_id:
                    requestId,

                serviceID,

                billersCode:
                    phone,

                variation_code:
                    variationCode,

                amount,

                phone

            };

            const response =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    payload,

                    {

                        headers:
                            vtpassHeaders(),

                        timeout: 60000

                    }

                );

            const vtpassData =
                response.data || {};

            const vtpassCode =
                String(
                    vtpassData.code || ""
                );

            if (vtpassCode !== "000") {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData.response_description ||
                        "Data purchase failed",

                    code:
                        vtpassCode,

                    requestId

                });

            }

            const transactionRef =
                db.collection("transactions").doc();

            let newBalance = 0;

            await db.runTransaction(
                async transaction => {

                    const fresh =
                        await transaction.get(
                            userRef
                        );

                    if (!fresh.exists) {

                        throw new Error(
                            "User not found"
                        );

                    }

                    const freshData =
                        fresh.data() || {};

                    const balance =
                        Number(
                            freshData.walletBalance || 0
                        );

                    if (balance < amount) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        balance - amount;

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

                            service:
                                "data",

                            network,

                            phone,

                            variationCode,

                            serviceID,

                            amount,

                            requestId,

                            vtpassCode,

                            status:
                                "successful",

                            createdAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }
                    );

                    saveWalletHistory(
                        transaction,
                        uid,
                        newBalance,
                        "data_purchase",
                        -amount,
                        {
                            service: "data",
                            network,
                            phone,
                            transactionId:
                                transactionRef.id
                        }
                    );

                }
            );

            res.json({

                success: true,

                message:
                    "Data purchase successful",

                transactionId:
                    transactionRef.id,

                requestId,

                network,

                phone,

                amount,

                walletBalance:
                    newBalance

            });

        } catch (error) {

            console.error(
                "BUY DATA ERROR:",
                error.response?.data ||
                error.message
            );

            res.status(
                error.response?.status || 500
            ).json({

                success: false,

                message:
                    error.response?.data
                        ?.response_description ||
                    error.response?.data
                        ?.message ||
                    error.message ||
                    "Unable to complete data purchase"

            });

        }

    }
);


/*
=====================================================
BUY AIRTIME
=====================================================
*/

app.post(
    "/api/vtpass/buy-airtime",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            if (!checkVTPassKeys(res)) {
                return;
            }

            const uid =
                cleanString(req.body.uid);

            const network =
                cleanString(
                    req.body.network
                ).toLowerCase();

            const phone =
                cleanPhone(req.body.phone);

            const amount =
                Number(req.body.amount);

            if (!uid) {

                return res.status(400).json({

                    success: false,
                    message:
                        "UID is required"

                });

            }

            if (!isValidPhone(phone)) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number must be 11 digits"

                });

            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid airtime amount"

                });

            }

            const serviceID =
                getAirtimeServiceId(network);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported network"

                });

            }

            const userRef =
                db.collection("users").doc(uid);

            const userSnapshot =
                await userRef.get();

            if (!userSnapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found"

                });

            }

            const userData =
                userSnapshot.data() || {};

            const balance =
                Number(
                    userData.walletBalance || 0
                );

            if (balance < amount) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        balance,

                    required:
                        amount

                });

            }

            const requestId =
                generateRequestId("IDD-AIRTIME");

            const response =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    {

                        request_id:
                            requestId,

                        serviceID,

                        amount,

                        phone

                    },

                    {

                        headers:
                            vtpassHeaders(),

                        timeout: 60000

                    }

                );

            const vtpassData =
                response.data || {};

            const code =
                String(
                    vtpassData.code || ""
                );

            if (code !== "000") {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData.response_description ||
                        "Airtime purchase failed",

                    code

                });

            }

            const transactionRef =
                db.collection("transactions").doc();

            let newBalance = 0;

            await db.runTransaction(
                async transaction => {

                    const fresh =
                        await transaction.get(
                            userRef
                        );

                    const freshData =
                        fresh.data() || {};

                    const freshBalance =
                        Number(
                            freshData.walletBalance || 0
                        );

                    if (
                        !fresh.exists ||
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        freshBalance - amount;

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
                                "airtime_purchase",

                            service:
                                "airtime",

                            network,

                            phone,

                            amount,

                            serviceID,

                            requestId,

                            vtpassCode:
                                code,

                            status:
                                "successful",

                            createdAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }
                    );

                    saveWalletHistory(
                        transaction,
                        uid,
                        newBalance,
                        "airtime_purchase",
                        -amount,
                        {
                            service: "airtime",
                            network,
                            phone,
                            transactionId:
                                transactionRef.id
                        }
                    );

                }
            );

            res.json({

                success: true,

                message:
                    "Airtime purchase successful",

                transactionId:
                    transactionRef.id,

                requestId,

                amount,

                walletBalance:
                    newBalance

            });

        } catch (error) {

            console.error(
                "BUY AIRTIME ERROR:",
                error.response?.data ||
                error.message
            );

            res.status(
                error.response?.status || 500
            ).json({

                success: false,

                message:
                    error.response?.data
                        ?.response_description ||
                    error.response?.data
                        ?.message ||
                    error.message ||
                    "Unable to complete airtime purchase"

            });

        }

    }
);


/*
=====================================================
BUY ELECTRICITY
=====================================================
*/

app.post(
    "/api/vtpass/buy-electricity",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            if (!checkVTPassKeys(res)) {
                return;
            }

            const uid =
                cleanString(req.body.uid);

            const disco =
                cleanString(req.body.disco);

            const meterNumber =
                cleanString(
                    req.body.meter_number
                );

            const meterType =
                cleanString(
                    req.body.meter_type
                ).toLowerCase();

            const amount =
                Number(req.body.amount);

            if (!uid) {

                return res.status(400).json({

                    success: false,
                    message:
                        "UID is required"

                });

            }

            if (!disco) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Electricity provider is required"

                });

            }

            if (!meterNumber) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Meter number is required"

                });

            }

            if (
                meterType !== "prepaid" &&
                meterType !== "postpaid"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Meter type must be prepaid or postpaid"

                });

            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid electricity amount"

                });

            }

            const serviceID =
                getElectricityServiceId(disco);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported electricity provider",

                    disco

                });

            }

            const userRef =
                db.collection("users").doc(uid);

            const userSnapshot =
                await userRef.get();

            if (!userSnapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found"

                });

            }

            const userData =
                userSnapshot.data() || {};

            const balance =
                Number(
                    userData.walletBalance || 0
                );

            if (balance < amount) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        balance,

                    required:
                        amount

                });

            }

            const requestId =
                generateRequestId("IDD-ELEC");

            const response =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    {

                        request_id:
                            requestId,

                        serviceID,

                        billersCode:
                            meterNumber,

                        variation_code:
                            meterType,

                        amount,

                        phone:
                            cleanPhone(
                                userData.phone
                            ) ||
                            "08000000000"

                    },

                    {

                        headers:
                            vtpassHeaders(),

                        timeout: 60000

                    }

                );

            const vtpassData =
                response.data || {};

            const code =
                String(
                    vtpassData.code || ""
                );

            if (code !== "000") {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData.response_description ||
                        "Electricity payment failed",

                    code

                });

            }

            const transactionRef =
                db.collection("transactions").doc();

            let newBalance = 0;

            await db.runTransaction(
                async transaction => {

                    const fresh =
                        await transaction.get(
                            userRef
                        );

                    const freshData =
                        fresh.data() || {};

                    const freshBalance =
                        Number(
                            freshData.walletBalance || 0
                        );

                    if (
                        !fresh.exists ||
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        freshBalance - amount;

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
                                "electricity_purchase",

                            service:
                                "electricity",

                            disco,

                            serviceID,

                            meterNumber,

                            meterType,

                            amount,

                            requestId,

                            vtpassCode:
                                code,

                            status:
                                "successful",

                            createdAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }
                    );

                    saveWalletHistory(
                        transaction,
                        uid,
                        newBalance,
                        "electricity_purchase",
                        -amount,
                        {
                            service:
                                "electricity",
                            transactionId:
                                transactionRef.id
                        }
                    );

                }
            );

            res.json({

                success: true,

                message:
                    "Electricity payment successful",

                transactionId:
                    transactionRef.id,

                requestId,

                amount,

                walletBalance:
                    newBalance

            });

        } catch (error) {

            console.error(
                "BUY ELECTRICITY ERROR:",
                error.response?.data ||
                error.message
            );

            res.status(
                error.response?.status || 500
            ).json({

                success: false,

                message:
                    error.response?.data
                        ?.response_description ||
                    error.response?.data
                        ?.message ||
                    error.message ||
                    "Unable to complete electricity payment"

            });

        }

    }
);


/*
=====================================================
CABLE TV PLANS
=====================================================
*/

app.get(
    "/api/vtpass/cable-plans/:provider",
    async (req, res) => {

        try {

            if (!checkVTPassKeys(res)) {
                return;
            }

            const provider =
                cleanString(
                    req.params.provider
                ).toLowerCase();

            const serviceID =
                getCableServiceId(provider);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported cable TV provider"

                });

            }

            const response =
                await axios.get(

                    `${VTPASS_BASE_URL}/service-variations`,

                    {

                        params: {
                            serviceID
                        },

                        headers:
                            vtpassHeaders(),

                        timeout: 30000

                    }

                );

            const variations =
                response.data?.content
                    ?.variations ||
                response.data?.content
                    ?.varations ||
                [];

            const plans =
                variations.map(plan => ({

                    variation_code:
                        plan.variation_code,

                    name:
                        plan.name,

                    amount:
                        Number(
                            plan.variation_amount ||
                            plan.amount ||
                            0
                        ),

                    variation_amount:
                        plan.variation_amount,

                    fixedPrice:
                        plan.fixedPrice

                }));

            res.json({

                success: true,

                provider,

                serviceID,

                plans

            });

        } catch (error) {

            console.error(
                "CABLE PLANS ERROR:",
                error.response?.data ||
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to load cable TV plans"

            });

        }

    }
);


/*
=====================================================
VALIDATE CABLE
=====================================================
*/

app.post(
    "/api/vtpass/validate-cable",
    async (req, res) => {

        try {

            if (!checkVTPassKeys(res)) {
                return;
            }

            const provider =
                cleanString(
                    req.body.provider
                ).toLowerCase();

            const smartcard =
                cleanString(
                    req.body.smartcard ||
                    req.body.iuc ||
                    req.body.billersCode
                );

            const serviceID =
                getCableServiceId(provider);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported cable TV provider"

                });

            }

            if (!smartcard) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Smartcard / IUC number is required"

                });

            }

            const response =
                await axios.post(

                    `${VTPASS_BASE_URL}/merchant-verify`,

                    {

                        serviceID,

                        billersCode:
                            smartcard,

                        type:
                            "customer"

                    },

                    {

                        headers:
                            vtpassHeaders(),

                        timeout: 30000

                    }

                );

            const data =
                response.data || {};

            const code =
                String(
                    data.code || ""
                );

            if (code !== "000") {

                return res.status(400).json({

                    success: false,

                    message:
                        data.response_description ||
                        "Unable to validate Smartcard / IUC",

                    code

                });

            }

            res.json({

                success: true,

                message:
                    "Smartcard / IUC validated successfully",

                provider,

                serviceID,

                smartcard,

                customer:
                    data.content || null

            });

        } catch (error) {

            console.error(
                "CABLE VALIDATION ERROR:",
                error.response?.data ||
                error.message
            );

            res.status(
                error.response?.status || 500
            ).json({

                success: false,

                message:
                    error.response?.data
                        ?.response_description ||
                    error.response?.data
                        ?.message ||
                    error.message ||
                    "Cable TV validation failed"

            });

        }

    }
);


/*
=====================================================
BUY CABLE TV
=====================================================
*/

app.post(
    "/api/vtpass/buy-cable",
    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            if (!checkVTPassKeys(res)) {
                return;
            }

            const uid =
                cleanString(req.body.uid);

            const provider =
                cleanString(
                    req.body.provider
                ).toLowerCase();

            const smartcard =
                cleanString(
                    req.body.smartcard ||
                    req.body.iuc
                );

            const variationCode =
                cleanString(
                    req.body.variation_code
                );

            const amount =
                Number(req.body.amount);

            if (!uid) {

                return res.status(400).json({

                    success: false,
                    message:
                        "UID is required"

                });

            }

            if (!provider) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Cable TV provider is required"

                });

            }

            if (!smartcard) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Smartcard / IUC number is required"

                });

            }

            if (!variationCode) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Cable TV plan is required"

                });

            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,
                    message:
                        "Invalid cable TV amount"

                });

            }

            const serviceID =
                getCableServiceId(provider);

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported cable TV provider"

                });

            }

            const userRef =
                db.collection("users").doc(uid);

            const userSnapshot =
                await userRef.get();

            if (!userSnapshot.exists) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found"

                });

            }

            const userData =
                userSnapshot.data() || {};

            const balance =
                Number(
                    userData.walletBalance || 0
                );

            if (balance < amount) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        balance,

                    required:
                        amount

                });

            }

            const requestId =
                generateRequestId("IDD-CABLE");

            const response =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    {

                        request_id:
                            requestId,

                        serviceID,

                        billersCode:
                            smartcard,

                        variation_code:
                            variationCode,

                        amount,

                        phone:
                            cleanPhone(
                                userData.phone
                            ) ||
                            "08000000000"

                    },

                    {

                        headers:
                            vtpassHeaders(),

                        timeout: 60000

                    }

                );

            const vtpassData =
                response.data || {};

            const code =
                String(
                    vtpassData.code || ""
                );

            if (code !== "000") {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData.response_description ||
                        "Cable TV subscription failed",

                    code

                });

            }

            const transactionRef =
                db.collection("transactions").doc();

            let newBalance = 0;

            await db.runTransaction(
                async transaction => {

                    const fresh =
                        await transaction.get(
                            userRef
                        );

                    const freshData =
                        fresh.data() || {};

                    const freshBalance =
                        Number(
                            freshData.walletBalance || 0
                        );

                    if (
                        !fresh.exists ||
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        freshBalance - amount;

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
                                "cable_tv_purchase",

                            service:
                                "cable_tv",

                            provider,

                            serviceID,

                            smartcard,

                            variationCode,

                            amount,

                            requestId,

                            vtpassCode:
                                code,

                            status:
                                "successful",

                            createdAt:
                                admin.firestore
                                    .FieldValue
                                    .serverTimestamp()

                        }
                    );

                    saveWalletHistory(
                        transaction,
                        uid,
                        newBalance,
                        "cable_tv_purchase",
                        -amount,
                        {
                            service:
                                "cable_tv",
                            provider,
                            transactionId:
                                transactionRef.id
                        }
                    );

                }
            );

            res.json({

                success: true,

                message:
                    "Cable TV subscription successful",

                transactionId:
                    transactionRef.id,

                requestId,

                provider,

                smartcard,

                amount,

                walletBalance:
                    newBalance

            });

        } catch (error) {

            console.error(
                "BUY CABLE ERROR:",
                error.response?.data ||
                error.message
            );

            res.status(
                error.response?.status || 500
            ).json({

                success: false,

                message:
                    error.response?.data
                        ?.response_description ||
                    error.response?.data
                        ?.message ||
                    error.message ||
                    "Unable to complete cable TV subscription"

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

            if (!checkFirebase(res)) {
                return;
            }

            if (!checkPaystackKey(res)) {
                return;
            }

            const email =
                cleanString(req.body.email);

            const uid =
                cleanString(req.body.uid);

            const amount =
                Number(req.body.amount);

            if (
                !email ||
                !uid ||
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Email, UID and valid amount are required"

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
                Math.round(amount * 100);

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

                        timeout: 30000

                    }

                );

            const paymentData =
                response.data?.data;

            if (!paymentData) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Paystack did not return payment data"

                });

            }

            await transactionRef.set({

                userId:
                    uid,

                email,

                amount,

                amountKobo:
                    amountInKobo,

                type:
                    "wallet_funding",

                fundingMethod:
                    "online",

                status:
                    "pending",

                reference:
                    paymentData.reference,

                createdAt:
                    admin.firestore
                        .FieldValue
                        .serverTimestamp()

            });

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
                        transactionRef.id

                }

            });

        } catch (error) {

            console.error(
                "Paystack initialize error:",
                error.response?.data ||
                error.message
            );

            res.status(500).json({

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

            if (!checkFirebase(res)) {
                return;
            }

            if (!checkPaystackKey(res)) {
                return;
            }

            const reference =
                cleanString(
                    req.params.reference
                );

            if (!reference) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Transaction reference is required"

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
                transactionDoc.data() || {};

            /*
            -----------------------------------------
            IMPORTANT:
            PREVENT DOUBLE FUNDING
            -----------------------------------------
            */

            if (
                transaction.status ===
                "completed"
            ) {

                return res.json({

                    success: true,

                    alreadyProcessed:
                        true,

                    message:
                        "Payment already processed",

                    status:
                        "success",

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
            AMOUNT CHECK
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

            const uid =
                transaction.userId;

            const amount =
                Number(
                    transaction.amount
                );

            const userRef =
                db
                    .collection("users")
                    .doc(uid);

            let newBalance = 0;

            await db.runTransaction(
                async firestoreTransaction => {

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

                    /*
                    ---------------------------------
                    SECOND DOUBLE-PAYMENT CHECK
                    ---------------------------------
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
                                userSnapshot
                                    .data()
                                    .walletBalance ||
                                0
                            )
                            : 0;

                    newBalance =
                        currentBalance + amount;

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

                    firestoreTransaction.update(
                        transactionDoc.ref,
                        {

                            status:
                                "completed",

                            fundingMethod:
                                "online",

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

                    saveWalletHistory(
                        firestoreTransaction,
                        uid,
                        newBalance,
                        "wallet_funding",
                        amount,
                        {

                            service:
                                "wallet",

                            fundingMethod:
                                "online",

                            reference,

                            transactionId:
                                transactionDoc.id

                        }
                    );

                }
            );

            res.json({

                success: true,

                alreadyProcessed:
                    false,

                message:
                    "Payment verified and wallet funded successfully",

                status:
                    "success",

                reference,

                amount,

                currency:
                    payment.currency,

                walletBalance:
                    newBalance,

                paidAt:
                    payment.paid_at || null

            });

        } catch (error) {

            console.error(
                "Paystack verification error:",
                error.response?.data ||
                error.message
            );

            res.status(
                error.response?.status || 500
            ).json({

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
404
=====================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API endpoint not found",

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
    (error, req, res, next) => {

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
            `ISMAIL DEEN DATA server running on port ${PORT}`
        );

        console.log(
            "VTpass URL:",
            VTPASS_BASE_URL
        );

        console.log(
            "Paystack URL:",
            PAYSTACK_BASE_URL
        );

    }
);
