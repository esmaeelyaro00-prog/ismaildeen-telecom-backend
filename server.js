require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

const app = express();

/*
=====================================================
CONFIG
=====================================================
*/

const PORT = Number(process.env.PORT) || 3000;

const VTPASS_BASE_URL =
    (process.env.VTPASS_BASE_URL ||
        "https://sandbox.vtpass.com/api").replace(/\/$/, "");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const MINIMUM_FUNDING_AMOUNT = 100;

app.use(cors());

/*
=====================================================
PAYSTACK WEBHOOK

Raw body MUST come before express.json()
=====================================================
*/

app.post(
    "/api/payment/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        try {
            const signature =
                req.headers["x-paystack-signature"];

            const hash =
                crypto
                    .createHmac(
                        "sha512",
                        process.env.PAYSTACK_SECRET_KEY || ""
                    )
                    .update(req.body)
                    .digest("hex");

            if (!signature || signature !== hash) {
                return res.status(401).send("Invalid signature");
            }

            const event =
                JSON.parse(req.body.toString("utf8"));

            if (
                event.event !== "charge.success" ||
                !event.data?.reference
            ) {
                return res.sendStatus(200);
            }

            const reference =
                cleanString(event.data.reference);

            await processSuccessfulPaystackPayment(
                reference,
                event.data
            );

            return res.sendStatus(200);

        } catch (error) {
            console.error(
                "PAYSTACK WEBHOOK ERROR:",
                error.message
            );

            return res.sendStatus(500);
        }
    }
);


/*
=====================================================
BODY PARSER
=====================================================
*/

app.use(express.json({ limit: "1mb" }));


/*
=====================================================
FIREBASE ADMIN
=====================================================
*/

let db = null;

function initializeFirebase() {
    try {
        if (admin.apps.length) {
            db = admin.firestore();
            return;
        }

        /*
        Option 1:
        FIREBASE_SERVICE_ACCOUNT_JSON
        */

        if (
            process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ) {
            const serviceAccount =
                JSON.parse(
                    process.env
                        .FIREBASE_SERVICE_ACCOUNT_JSON
                );

            admin.initializeApp({
                credential:
                    admin.credential.cert(
                        serviceAccount
                    )
            });

            db = admin.firestore();

            console.log(
                "Firebase initialized from environment"
            );

            return;
        }

        /*
        Option 2:
        File path
        */

        const firebasePath =
            process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
            "/etc/secrets/firebase-service-account.json";

        const serviceAccount =
            require(firebasePath);

        admin.initializeApp({
            credential:
                admin.credential.cert(
                    serviceAccount
                )
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
}

initializeFirebase();


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


function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
    );
}


function toMoney(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
        return 0;
    }

    return Number(amount.toFixed(2));
}


function generateRequestId(prefix = "IDD") {
    return (
        prefix +
        "-" +
        Date.now() +
        "-" +
        crypto
            .randomBytes(4)
            .toString("hex")
    );
}


function getErrorMessage(error) {
    return (
        error?.response?.data
            ?.response_description ||
        error?.response?.data
            ?.message ||
        error?.message ||
        "An unexpected error occurred"
    );
}


function getVTPassErrorStatus(error) {
    const status =
        Number(error?.response?.status);

    if (
        Number.isFinite(status) &&
        status >= 400 &&
        status <= 599
    ) {
        return status;
    }

    return 500;
}


function getDataServiceId(network) {
    const serviceMap = {
        mtn: "mtn-data",
        airtel: "airtel-data",
        glo: "glo-data",
        "9mobile": "etisalat-data",
        etisalat: "etisalat-data"
    };

    return (
        serviceMap[
            cleanString(network).toLowerCase()
        ] || null
    );
}


function getAirtimeServiceId(network) {
    const serviceMap = {
        mtn: "mtn",
        airtel: "airtel",
        glo: "glo",
        "9mobile": "etisalat",
        etisalat: "etisalat"
    };

    return (
        serviceMap[
            cleanString(network).toLowerCase()
        ] || null
    );
}


function getElectricityServiceId(disco) {
    const normalized =
        cleanString(disco)
            .toLowerCase();

    const serviceMap = {

        abuja:
            "abuja-electric",

        "abuja electricity distribution company":
            "abuja-electric",

        benin:
            "benin-electric",

        "benin electricity distribution company":
            "benin-electric",

        eko:
            "eko-electric",

        "eko electricity distribution company":
            "eko-electric",

        enugu:
            "enugu-electric",

        "enugu electricity distribution company":
            "enugu-electric",

        ibadan:
            "ibadan-electric",

        "ibadan electricity distribution company":
            "ibadan-electric",

        ikeja:
            "ikeja-electric",

        "ikeja electricity distribution company":
            "ikeja-electric",

        jos:
            "jos-electric",

        "jos electricity distribution company":
            "jos-electric",

        kaduna:
            "kaduna-electric",

        "kaduna electricity distribution company":
            "kaduna-electric",

        kano:
            "kano-electric",

        "kano electricity distribution company":
            "kano-electric",

        yola:
            "yola-electric",

        "yola electricity distribution company":
            "yola-electric"
    };

    return serviceMap[normalized] || null;
}


function getCableServiceId(provider) {
    const normalized =
        cleanString(provider)
            .toLowerCase();

    const serviceMap = {

        dstv:
            "dstv",

        gotv:
            "gotv",

        "go tv":
            "gotv",

        "go-tv":
            "gotv",

        startimes:
            "startimes",

        "star times":
            "startimes",

        "star-times":
            "startimes"
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

        Accept:
            "application/json"

    };
}


function paystackHeaders() {
    return {

        Authorization:
            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

        "Content-Type":
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
    if (
        !process.env.VTPASS_API_KEY ||
        !process.env.VTPASS_SECRET_KEY
    ) {

        res.status(500).json({
            success: false,
            message:
                "VTpass credentials are not configured"
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
FIRESTORE TIMESTAMP FORMATTER
=====================================================
*/

function formatFirestoreData(data) {
    const result = {
        ...data
    };

    if (
        result.createdAt &&
        typeof result.createdAt.toDate ===
            "function"
    ) {

        result.createdAt =
            result.createdAt
                .toDate()
                .toISOString();
    }

    if (
        result.updatedAt &&
        typeof result.updatedAt.toDate ===
            "function"
    ) {

        result.updatedAt =
            result.updatedAt
                .toDate()
                .toISOString();
    }

    if (
        result.verifiedAt &&
        typeof result.verifiedAt.toDate ===
            "function"
    ) {

        result.verifiedAt =
            result.verifiedAt
                .toDate()
                .toISOString();
    }

    return result;
}

/* =====================================================
GET WALLET BALANCE
===================================================== */

app.get(
    "/api/wallet/balance/:uid",

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


            const {
                userData
            } =
                await getUser(uid);


            const balance =
                toMoney(
                    userData.walletBalance || 0
                );


            return res.json({

                success: true,

                uid,

                balance,

                walletBalance:
                    balance

            });


        } catch (error) {

            console.error(
                "WALLET BALANCE ERROR:",
                error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    error.message ||
                    "Unable to load wallet balance"

            });

        }

    }
);
/*
=====================================================
WALLET HISTORY
=====================================================
*/

function saveWalletHistory(
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

            balance:
                toMoney(balance),

            amount:
                toMoney(amount),

            type,

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
GET USER
=====================================================
*/

async function getUser(uid) {

    const userRef =
        db.collection("users").doc(uid);

    const snapshot =
        await userRef.get();

    if (!snapshot.exists) {

        throw new Error(
            "User account not found"
        );
    }

    return {
        userRef,
        userData:
            snapshot.data() || {}
    };
}


/*
=====================================================
VERIFY DATA PLAN PRICE

IMPORTANT:
Frontend amount is NOT trusted.
=====================================================
*/

async function getDataPlanPrice(
    serviceID,
    variationCode
) {

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

    const plan =
        variations.find(item =>
            String(
                item.variation_code
            ) ===
            String(variationCode)
        );

    if (!plan) {

        throw new Error(
            "Selected data plan was not found"
        );
    }

    const amount =
        Number(
            plan.variation_amount ||
            plan.amount ||
            0
        );

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "Invalid data plan amount"
        );
    }

    return {
        amount:
            toMoney(amount),

        name:
            plan.name || "",

        variationCode:
            plan.variation_code
    };
}


/*
=====================================================
VERIFY CABLE PLAN PRICE
=====================================================
*/

async function getCablePlanPrice(
    serviceID,
    variationCode
) {

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

    const plan =
        variations.find(item =>
            String(
                item.variation_code
            ) ===
            String(variationCode)
        );

    if (!plan) {

        throw new Error(
            "Selected cable TV plan was not found"
        );
    }

    const amount =
        Number(
            plan.variation_amount ||
            plan.amount ||
            0
        );

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {

        throw new Error(
            "Invalid cable TV plan amount"
        );
    }

    return {
        amount:
            toMoney(amount),

        name:
            plan.name || ""
    };
}


/*
=====================================================
PAYSTACK PAYMENT PROCESSOR
=====================================================
*/

async function processSuccessfulPaystackPayment(
    reference,
    payment
) {

    if (!db) {
        throw new Error(
            "Firebase is not initialized"
        );
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
        throw new Error(
            "Wallet transaction not found"
        );
    }

    const transactionDoc =
        snapshot.docs[0];

    const walletTransaction =
        transactionDoc.data() || {};

    const uid =
        walletTransaction.userId;

    const expectedAmountKobo =
        Number(
            walletTransaction.amountKobo
        );

    const paidAmountKobo =
        Number(payment.amount);

    if (
        !Number.isFinite(paidAmountKobo) ||
        paidAmountKobo !==
            expectedAmountKobo
    ) {

        throw new Error(
            "Payment amount does not match transaction"
        );
    }

    if (
        payment.currency &&
        payment.currency !== "NGN"
    ) {

        throw new Error(
            "Invalid payment currency"
        );
    }

    const amount =
        Number(
            walletTransaction.amount
        );

    const userRef =
        db.collection("users").doc(uid);

    let newBalance = 0;
    let alreadyProcessed = false;

    await db.runTransaction(
        async firestoreTransaction => {

            const transactionSnapshot =
                await firestoreTransaction.get(
                    transactionDoc.ref
                );

            if (
                !transactionSnapshot.exists
            ) {

                throw new Error(
                    "Wallet transaction disappeared"
                );
            }

            const currentTransaction =
                transactionSnapshot.data() || {};

            if (
                currentTransaction.status ===
                "completed"
            ) {

                alreadyProcessed = true;

                return;
            }

            const userSnapshot =
                await firestoreTransaction.get(
                    userRef
                );

            const userData =
                userSnapshot.exists
                    ? userSnapshot.data() || {}
                    : {};

            const currentBalance =
                Number(
                    userData.walletBalance || 0
                );

            newBalance =
                toMoney(
                    currentBalance + amount
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
                        payment.status ||
                        "success",

                    paystackReference:
                        reference,

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

    return {
        alreadyProcessed,
        newBalance,
        amount,
        uid
    };
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

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            success: true,

            status:
                "online",

            firebase:
                db
                    ? "connected"
                    : "disconnected",

            vtpass:
                process.env.VTPASS_API_KEY &&
                process.env.VTPASS_SECRET_KEY
                    ? "configured"
                    : "not configured",

            paystack:
                process.env.PAYSTACK_SECRET_KEY
                    ? "configured"
                    : "not configured",

            environment:
                process.env.NODE_ENV ||
                "development",

            time:
                new Date().toISOString()

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

            if (!checkFirebase(res)) {
                return;
            }

            await db
                .collection("system")
                .doc("connection")
                .set(
                    {

                        connected:
                            true,

                        updatedAt:
                            admin.firestore
                                .FieldValue
                                .serverTimestamp()

                    },

                    {
                        merge: true
                    }
                );

            return res.json({

                success: true,

                message:
                    "Firebase connected successfully"

            });

        } catch (error) {

            console.error(
                "FIREBASE TEST ERROR:",
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

            const {
                userData
            } =
                await getUser(uid);

            return res.json({

                success: true,

                uid,

                email:
                    userData.email ||
                    null,

                phone:
                    userData.phone ||
                    null,

                walletBalance:
                    toMoney(
                        userData.walletBalance
                    )

            });

        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message

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

            const limit =
                Math.min(
                    Math.max(
                        Number(req.query.limit) ||
                        100,
                        1
                    ),
                    500
                );

            const snapshot =
                await db
                    .collection(
                        "walletHistory"
                    )
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

                    return {

                        id:
                            doc.id,

                        ...formatFirestoreData(
                            doc.data() || {}
                        )

                    };

                });

            return res.json({

                success: true,

                uid,

                history

            });

        } catch (error) {

            console.error(
                "WALLET HISTORY ERROR:",
                error.message
            );

            return res.status(500).json({

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
                    .get();

            /*
            Sort records in the server.
            This avoids requiring a Firestore
            composite index for the chart.
            */

            const history =
                snapshot.docs.map(doc => {

                    const data =
                        doc.data() || {};

                    let createdAt = null;

                    if (
                        data.createdAt &&
                        typeof data.createdAt.toDate ===
                        "function"
                    ) {

                        createdAt =
                            data.createdAt
                                .toDate()
                                .toISOString();

                    }

                    return {

                        id:
                            doc.id,

                        userId:
                            data.userId || uid,

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

                        createdAt

                    };

                });

            /*
            Sort from oldest to newest
            for wallet balance chart.
            */

            history.sort((a, b) => {

                const dateA =
                    a.createdAt
                        ? new Date(
                            a.createdAt
                        ).getTime()
                        : 0;

                const dateB =
                    b.createdAt
                        ? new Date(
                            b.createdAt
                        ).getTime()
                        : 0;

                return dateA - dateB;

            });

            const chart =
                history.map(item => ({

                    id:
                        item.id,

                    balance:
                        item.balance,

                    amount:
                        item.amount,

                    type:
                        item.type,

                    service:
                        item.service,

                    createdAt:
                        item.createdAt

                }));

            res.json({

                success: true,

                uid,

                total:
                    chart.length,

                chart

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


app.get(
    "/api/wallet/:uid/chart",

    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            const uid =
                cleanString(req.params.uid);

            const snapshot =
                await db
                    .collection(
                        "walletHistory"
                    )
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
                        formatFirestoreData(
                            doc.data() || {}
                        );

                    return {

                        id:
                            doc.id,

                        balance:
                            toMoney(
                                data.balance
                            ),

                        amount:
                            toMoney(
                                data.amount
                            ),

                        type:
                            data.type ||
                            null,

                        createdAt:
                            data.createdAt ||
                            null

                    };

                });

            return res.json({

                success: true,

                uid,

                chart

            });

        } catch (error) {

            return res.status(500).json({

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
GET TRANSACTIONS
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

            const limit =
                Math.min(
                    Math.max(
                        Number(req.query.limit) ||
                        100,
                        1
                    ),
                    500
                );

            const snapshot =
                await db
                    .collection(
                        "transactions"
                    )
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
                snapshot.docs.map(doc => ({

                    id:
                        doc.id,

                    ...formatFirestoreData(
                        doc.data() || {}
                    )

                }));

            return res.json({

                success: true,

                uid,

                transactions

            });

        } catch (error) {

            return res.status(500).json({

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
                        "Unsupported network"

                });

            }

            const response =
                await axios.get(

                    `${VTPASS_BASE_URL}/service-variations`,

                    {

                        params:
                            { serviceID },

                        headers:
                            vtpassHeaders(),

                        timeout:
                            30000

                    }

                );

            const content =
                response.data?.content ||
                {};

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
                        toMoney(
                            plan.variation_amount ||
                            plan.amount
                        ),

                    fixedPrice:
                        plan.fixedPrice ||
                        null

                }));

            return res.json({

                success: true,

                network,

                serviceID,

                plans

            });

        } catch (error) {

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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
                cleanPhone(
                    req.body.phone
                );

            const variationCode =
                cleanString(
                    req.body.variation_code
                );

            if (!uid) {
                return res.status(400).json({
                    success: false,
                    message: "UID is required"
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

            const serviceID =
                getDataServiceId(network);

            if (!serviceID) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Unsupported network"
                });
            }

            /*
            VERIFY PRICE FROM VTPASS
            */

            const plan =
                await getDataPlanPrice(
                    serviceID,
                    variationCode
                );

            const amount =
                plan.amount;

            const {
                userRef
            } =
                await getUser(uid);

            /*
            CHECK BALANCE
            */

            const freshUser =
                await userRef.get();

            const balance =
                toMoney(
                    freshUser
                        .data()
                        ?.walletBalance
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
                generateRequestId(
                    "IDD-DATA"
                );

            /*
            SEND TO VTPASS
            */

            const vtpassResponse =
                await axios.post(

                    `${VTPASS_BASE_URL}/pay`,

                    {

                        request_id:
                            requestId,

                        serviceID,

                        billersCode:
                            phone,

                        variation_code:
                            variationCode,

                        amount,

                        phone

                    },

                    {

                        headers:
                            vtpassHeaders(),

                        timeout:
                            60000

                    }

                );

            const vtpassData =
                vtpassResponse.data ||
                {};

            const code =
                String(
                    vtpassData.code || ""
                );

            if (code !== "000") {

                return res.status(400).json({

                    success: false,

                    message:
                        vtpassData
                            .response_description ||
                        "Data purchase failed",

                    code,

                    requestId

                });

            }

            /*
            VTPASS SUCCESS
            NOW DEBIT WALLET
            */

            const transactionRef =
                db
                    .collection(
                        "transactions"
                    )
                    .doc();

            let newBalance = 0;

            await db.runTransaction(
                async transaction => {

                    const snapshot =
                        await transaction.get(
                            userRef
                        );

                    if (!snapshot.exists) {

                        throw new Error(
                            "User account not found"
                        );

                    }

                    const current =
                        toMoney(
                            snapshot
                                .data()
                                .walletBalance
                        );

                    if (current < amount) {

                        throw new Error(
                            "Wallet balance changed and is insufficient"
                        );

                    }

                    newBalance =
                        toMoney(
                            current - amount
                        );

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

                            planName:
                                plan.name,

                            serviceID,

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
                        "data_purchase",
                        -amount,
                        {

                            service:
                                "data",

                            network,

                            phone,

                            transactionId:
                                transactionRef.id

                        }
                    );

                }
            );

            return res.json({

                success: true,

                message:
                    "Data purchase successful",

                transactionId:
                    transactionRef.id,

                requestId,

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

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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
                cleanPhone(
                    req.body.phone
                );

            const amount =
                toMoney(
                    req.body.amount
                );

            if (!uid) {
                return res.status(400).json({
                    success: false,
                    message: "UID is required"
                });
            }

            if (!isValidPhone(phone)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Phone number must be 11 digits"
                });
            }

            if (amount <= 0) {
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

            const {
                userRef
            } =
                await getUser(uid);

            const userSnapshot =
                await userRef.get();

            const balance =
                toMoney(
                    userSnapshot
                        .data()
                        ?.walletBalance
                );

            if (balance < amount) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance",

                    walletBalance:
                        balance

                });

            }

            const requestId =
                generateRequestId(
                    "IDD-AIRTIME"
                );

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

                        timeout:
                            60000

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
                        vtpassData
                            .response_description ||
                        "Airtime purchase failed"

                });

            }

            const transactionRef =
                db.collection(
                    "transactions"
                ).doc();

            let newBalance = 0;

            await db.runTransaction(
                async transaction => {

                    const fresh =
                        await transaction.get(
                            userRef
                        );

                    if (!fresh.exists) {
                        throw new Error(
                            "User account not found"
                        );
                    }

                    const freshBalance =
                        toMoney(
                            fresh
                                .data()
                                .walletBalance
                        );

                    if (
                        freshBalance < amount
                    ) {
                        throw new Error(
                            "Insufficient wallet balance"
                        );
                    }

                    newBalance =
                        toMoney(
                            freshBalance - amount
                        );

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

                            service:
                                "airtime",

                            network,

                            phone,

                            transactionId:
                                transactionRef.id

                        }
                    );

                }
            );

            return res.json({

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

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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
                cleanString(
                    req.body.disco
                );

            const meterNumber =
                cleanString(
                    req.body.meter_number
                );

            const meterType =
                cleanString(
                    req.body.meter_type
                ).toLowerCase();

            const amount =
                toMoney(
                    req.body.amount
                );

            if (
                !uid ||
                !disco ||
                !meterNumber
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID, disco and meter number are required"

                });

            }

            if (
                !["prepaid", "postpaid"]
                    .includes(meterType)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Meter type must be prepaid or postpaid"

                });

            }

            if (amount <= 0) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid electricity amount"

                });

            }

            const serviceID =
                getElectricityServiceId(
                    disco
                );

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported electricity provider"

                });

            }

            const {
                userRef,
                userData
            } =
                await getUser(uid);

            const balance =
                toMoney(
                    userData.walletBalance
                );

            if (balance < amount) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Insufficient wallet balance"

                });

            }

            const requestId =
                generateRequestId(
                    "IDD-ELEC"
                );

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

                        timeout:
                            60000

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
                        vtpassData
                            .response_description ||
                        "Electricity payment failed"

                });

            }

            const transactionRef =
                db.collection(
                    "transactions"
                ).doc();

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

                    const freshBalance =
                        toMoney(
                            fresh
                                .data()
                                .walletBalance
                        );

                    if (
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        toMoney(
                            freshBalance - amount
                        );

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

            return res.json({

                success: true,

                message:
                    "Electricity payment successful",

                transactionId:
                    transactionRef.id,

                requestId,

                amount,

                walletBalance:
                    newBalance,

                vtpassResponse:
                    vtpassData.content ||
                    null

            });

        } catch (error) {

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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
                getCableServiceId(
                    provider
                );

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

                        params:
                            { serviceID },

                        headers:
                            vtpassHeaders(),

                        timeout:
                            30000

                    }

                );

            const variations =
                response.data
                    ?.content
                    ?.variations ||
                response.data
                    ?.content
                    ?.varations ||
                [];

            const plans =
                variations.map(plan => ({

                    variation_code:
                        plan.variation_code,

                    name:
                        plan.name,

                    amount:
                        toMoney(
                            plan.variation_amount ||
                            plan.amount
                        ),

                    fixedPrice:
                        plan.fixedPrice ||
                        null

                }));

            return res.json({

                success: true,

                provider,

                serviceID,

                plans

            });

        } catch (error) {

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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
                getCableServiceId(
                    provider
                );

            if (
                !serviceID ||
                !smartcard
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Valid provider and smartcard number are required"

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

                        timeout:
                            30000

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
                        data
                            .response_description ||
                        "Cable validation failed"

                });

            }

            return res.json({

                success: true,

                message:
                    "Smartcard validated successfully",

                provider,

                serviceID,

                smartcard,

                customer:
                    data.content ||
                    null

            });

        } catch (error) {

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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

            if (
                !uid ||
                !provider ||
                !smartcard ||
                !variationCode
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "UID, provider, smartcard and plan are required"

                });

            }

            const serviceID =
                getCableServiceId(
                    provider
                );

            if (!serviceID) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Unsupported cable TV provider"

                });

            }

            /*
            VERIFY PLAN PRICE
            */

            const plan =
                await getCablePlanPrice(
                    serviceID,
                    variationCode
                );

            const amount =
                plan.amount;

            const {
                userRef,
                userData
            } =
                await getUser(uid);

            const balance =
                toMoney(
                    userData.walletBalance
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
                generateRequestId(
                    "IDD-CABLE"
                );

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

                        timeout:
                            60000

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
                        vtpassData
                            .response_description ||
                        "Cable TV subscription failed"

                });

            }

            const transactionRef =
                db.collection(
                    "transactions"
                ).doc();

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

                    const freshBalance =
                        toMoney(
                            fresh
                                .data()
                                .walletBalance
                        );

                    if (
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        toMoney(
                            freshBalance - amount
                        );

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

                            planName:
                                plan.name,

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

            return res.json({

                success: true,

                message:
                    "Cable TV subscription successful",

                transactionId:
                    transactionRef.id,

                requestId,

                amount,

                walletBalance:
                    newBalance

            });

        } catch (error) {

            return res.status(
                getVTPassErrorStatus(error)
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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
                cleanString(
                    req.body.email
                ).toLowerCase();

            const uid =
                cleanString(
                    req.body.uid
                );

            const amount =
                toMoney(
                    req.body.amount
                );

            if (
                !uid ||
                !isValidEmail(email) ||
                amount <
                    MINIMUM_FUNDING_AMOUNT
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        `Valid email, UID and minimum ₦${MINIMUM_FUNDING_AMOUNT} are required`

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

                        headers:
                            paystackHeaders(),

                        timeout:
                            30000

                    }

                );

            const paymentData =
                response.data?.data;

            if (!paymentData?.reference) {

                throw new Error(
                    "Paystack did not return a transaction reference"
                );

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
                "PAYSTACK INITIALIZE ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

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

            /*
            GET TRANSACTION
            */

            const transactionSnapshot =
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
                transactionSnapshot.empty
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Transaction not found"

                });

            }

            /*
            VERIFY PAYSTACK
            */

            const response =
                await axios.get(

                    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,

                    {

                        headers:
                            paystackHeaders(),

                        timeout:
                            30000

                    }

                );

            const payment =
                response.data?.data;

            if (!payment) {

                throw new Error(
                    "Invalid Paystack response"
                );

            }

            if (
                payment.status !==
                "success"
            ) {

                return res.json({

                    success: false,

                    status:
                        payment.status,

                    message:
                        "Payment has not been completed"

                });

            }

            const result =
                await processSuccessfulPaystackPayment(
                    reference,
                    payment
                );

            return res.json({

                success: true,

                alreadyProcessed:
                    result.alreadyProcessed,

                message:
                    result.alreadyProcessed
                        ? "Payment was already processed"
                        : "Payment verified and wallet funded successfully",

                status:
                    "success",

                reference,

                amount:
                    result.amount,

                walletBalance:
                    result.newBalance,

                currency:
                    payment.currency,

                paidAt:
                    payment.paid_at ||
                    null

            });

        } catch (error) {

            console.error(
                "PAYSTACK VERIFY ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(
                error.response?.status ||
                500
            ).json({

                success: false,

                message:
                    getErrorMessage(error)

            });

        }

    }
);


/*
=====================================================
CHECK PAYMENT STATUS
=====================================================
*/

app.get(
    "/api/payment/status/:reference",

    async (req, res) => {

        try {

            if (!checkFirebase(res)) {
                return;
            }

            const reference =
                cleanString(
                    req.params.reference
                );

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
                        "Payment transaction not found"

                });

            }

            const doc =
                snapshot.docs[0];

            return res.json({

                success: true,

                transaction: {

                    id:
                        doc.id,

                    ...formatFirestoreData(
                        doc.data() || {}
                    )

                }

            });

        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
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

        return res.status(404).json({

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

        if (
            res.headersSent
        ) {
            return next(error);
        }

        return res.status(500).json({

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
            `============================================`
        );

        console.log(
            `ISMAIL DEEN DATA SERVER RUNNING`
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `VTpass: ${VTPASS_BASE_URL}`
        );

        console.log(
            `Firebase: ${
                db
                    ? "CONNECTED"
                    : "DISCONNECTED"
            }`
        );

        console.log(
            `============================================`
        );

    }
);
