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

function getDataServiceId(network) {

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


function getAirtimeServiceId(network) {

    const serviceMap = {

        mtn: "mtn",
        airtel: "airtel",
        glo: "glo",
        "9mobile": "etisalat",
        etisalat: "etisalat"

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
ELECTRICITY SERVICE ID
=====================================================
*/

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

    if (!disco) {
        return null;
    }

    const normalized =
        String(disco)
            .toLowerCase()
            .trim();

    return serviceMap[normalized] || null;
}


/*
=====================================================
CABLE TV SERVICE ID
=====================================================
*/

function getCableServiceId(provider) {

    const serviceMap = {

        dstv:
            "dstv",

        "dStv":
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

    if (!provider) {
        return null;
    }

    const normalized =
        String(provider)
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

                    connected:
                        true,

                    updatedAt:
                        admin.firestore
                            .FieldValue
                            .serverTimestamp()

                });

            return res.json({

                success:
                    true,

                message:
                    "Firebase connected successfully"

            });

        } catch (error) {

            console.error(
                "Firebase test error:",
                error.message
            );

            return res.status(500).json({

                success:
                    false,

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

            success:
                true,

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

                    success:
                        false,

                    message:
                        "Firebase is not initialized"

                });

            }

            const uid =
                String(
                    req.params.uid || ""
                ).trim();

            if (!uid) {

                return res.status(400).json({

                    success:
                        false,

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

                    success:
                        false,

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

                success:
                    true,

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

                success:
                    false,

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
                getDataServiceId(network);

            if (!serviceID) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Unsupported network",

                    network:
                        network

                });

            }

            if (!process.env.VTPASS_API_KEY) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

            if (!process.env.VTPASS_SECRET_KEY) {

                return res.status(500).json({

                    success:
                        false,

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

                success:
                    true,

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

                success:
                    false,

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

            const cleanPhone =
                phone.replace(/\D/g, "");

            if (
                cleanPhone.length !== 11
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Phone number must be 11 digits"
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

            const serviceID =
                getDataServiceId(network);

            if (!serviceID) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Unsupported network",
                    network:
                        network
                });

            }

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

            const requestId =
                "IDD-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 100000
                );

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
                "VTpass DATA payload:",
                vtpassPayload
            );

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

            console.log(
                "VTpass DATA response:",
                JSON.stringify(
                    vtpassData,
                    null,
                    2
                )
            );

            const vtpassCode =
                String(
                    vtpassData.code || ""
                );

            const responseDescription =
                vtpassData
                    .response_description ||
                "";

            if (
                vtpassCode !== "000"
            ) {

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

            const transactionRef =
                db
                    .collection("transactions")
                    .doc();

            let newBalance =
                0;

            await db.runTransaction(
                async (transaction) => {

                    const freshUser =
                        await transaction.get(
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
                            freshData.walletBalance ||
                            0
                        );

                    if (
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

            console.error(
                "BUY DATA ERROR:",
                error.response?.data ||
                error.message
            );

            if (error.response) {

                return res.status(
                    error.response.status || 500
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
BUY AIRTIME
=====================================================
*/

app.post(
    "/api/vtpass/buy-airtime",
    async (req, res) => {

        try {

            console.log(
                "BUY AIRTIME REQUEST:",
                req.body
            );

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

            const amount =
                Number(
                    req.body.amount
                );

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

            const cleanPhone =
                phone.replace(/\D/g, "");

            if (
                cleanPhone.length !== 11
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Phone number must be 11 digits"
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

            const serviceID =
                getAirtimeServiceId(network);

            if (!serviceID) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Unsupported network",
                    network:
                        network
                });

            }

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

            const requestId =
                "IDD-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 100000
                );

            const vtpassPayload = {

                request_id:
                    requestId,

                serviceID:
                    serviceID,

                amount:
                    amount,

                phone:
                    cleanPhone

            };

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

            console.log(
                "VTpass AIRTIME response:",
                JSON.stringify(
                    vtpassData,
                    null,
                    2
                )
            );

            const vtpassCode =
                String(
                    vtpassData.code || ""
                );

            const responseDescription =
                vtpassData
                    .response_description ||
                "";

            if (
                vtpassCode !== "000"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        responseDescription ||
                        "Airtime purchase failed",

                    code:
                        vtpassCode || null,

                    requestId:
                        requestId,

                    vtpass:
                        vtpassData

                });

            }

            const transactionRef =
                db
                    .collection("transactions")
                    .doc();

            let newBalance =
                0;

            await db.runTransaction(
                async (transaction) => {

                    const freshUser =
                        await transaction.get(
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
                            freshData.walletBalance ||
                            0
                        );

                    if (
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

                            network:
                                network,

                            phone:
                                cleanPhone,

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

            return res.json({

                success: true,

                message:
                    "Airtime purchase successful",

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

            console.error(
                "BUY AIRTIME ERROR:",
                error.response?.data ||
                error.message
            );

            if (error.response) {

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
                        "VTpass airtime transaction failed",

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

            return res.status(500).json({

                success: false,

                message:
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

            console.log(
                "BUY ELECTRICITY REQUEST:",
                req.body
            );

            const uid =
                String(
                    req.body.uid || ""
                ).trim();

            const disco =
                String(
                    req.body.disco || ""
                ).trim();

            const meterNumber =
                String(
                    req.body.meter_number || ""
                ).trim();

            const meterType =
                String(
                    req.body.meter_type || ""
                ).trim();

            const amount =
                Number(
                    req.body.amount
                );

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

            if (!meterType) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Meter type is required"
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

            const normalizedMeterType =
                meterType
                    .toLowerCase()
                    .trim();

            let variationCode = null;

            if (
                normalizedMeterType ===
                "prepaid"
            ) {

                variationCode =
                    "prepaid";

            } else if (
                normalizedMeterType ===
                "postpaid"
            ) {

                variationCode =
                    "postpaid";

            } else {

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid meter type. Use Prepaid or Postpaid."
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

            const serviceID =
                getElectricityServiceId(
                    disco
                );

            if (!serviceID) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Unsupported electricity provider",
                    disco:
                        disco
                });

            }

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

            const requestId =
                "IDD-ELEC-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 100000
                );

            const vtpassPayload = {

                request_id:
                    requestId,

                serviceID:
                    serviceID,

                billersCode:
                    meterNumber,

                variation_code:
                    variationCode,

                amount:
                    amount,

                phone:
                    userData.phone ||
                    meterNumber

            };

            console.log(
                "VTpass ELECTRICITY payload:",
                vtpassPayload
            );

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

            console.log(
                "VTpass ELECTRICITY response:",
                JSON.stringify(
                    vtpassData,
                    null,
                    2
                )
            );

            const vtpassCode =
                String(
                    vtpassData.code || ""
                );

            const responseDescription =
                vtpassData
                    .response_description ||
                "";

            if (
                vtpassCode !== "000"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        responseDescription ||
                        "Electricity payment failed",

                    code:
                        vtpassCode || null,

                    requestId:
                        requestId,

                    vtpass:
                        vtpassData

                });

            }

            const transactionRef =
                db
                    .collection("transactions")
                    .doc();

            let newBalance =
                0;

            await db.runTransaction(
                async (transaction) => {

                    const freshUser =
                        await transaction.get(
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
                            freshData.walletBalance ||
                            0
                        );

                    if (
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

                            disco:
                                disco,

                            serviceID:
                                serviceID,

                            meterNumber:
                                meterNumber,

                            meterType:
                                normalizedMeterType,

                            variationCode:
                                variationCode,

                            amount:
                                amount,

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

            return res.json({

                success: true,

                message:
                    "Electricity payment successful",

                transactionId:
                    transactionRef.id,

                requestId:
                    requestId,

                disco:
                    disco,

                serviceID:
                    serviceID,

                meterNumber:
                    meterNumber,

                meterType:
                    normalizedMeterType,

                amount:
                    amount,

                walletBalance:
                    newBalance,

                vtpass:
                    vtpassData

            });

        } catch (error) {

            console.error(
                "BUY ELECTRICITY ERROR:",
                error.response?.data ||
                error.message
            );

            if (error.response) {

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
                        "VTpass electricity transaction failed",

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

            return res.status(500).json({

                success: false,

                message:
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

            const provider =
                String(
                    req.params.provider || ""
                )
                    .toLowerCase()
                    .trim();

            const serviceID =
                getCableServiceId(
                    provider
                );

            if (!serviceID) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Unsupported cable TV provider",

                    provider:
                        provider

                });

            }

            if (!process.env.VTPASS_API_KEY) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

            if (!process.env.VTPASS_SECRET_KEY) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "VTPASS_SECRET_KEY is not configured"

                });

            }

            console.log(
                "Loading cable TV plans:",
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
                                    plan.variation_amount ||
                                    plan.amount ||
                                    0
                                ),

                            variation_amount:
                                plan.variation_amount,

                            fixedPrice:
                                plan.fixedPrice

                        };

                    }
                );

            return res.json({

                success:
                    true,

                provider:
                    provider,

                serviceID:
                    serviceID,

                plans:
                    plans

            });

        } catch (error) {

            console.error(
                "CABLE PLANS ERROR:",
                error.response?.data ||
                error.message
            );

            return res.status(500).json({

                success:
                    false,

                message:
                    "Unable to load cable TV plans",

                error:
                    error.response?.data ||
                    error.message

            });

        }

    }
);


/*
=====================================================
VALIDATE CABLE TV SMARTCARD / IUC
=====================================================
*/

app.post(
    "/api/vtpass/validate-cable",
    async (req, res) => {

        try {

            const provider =
                String(
                    req.body.provider || ""
                )
                    .toLowerCase()
                    .trim();

            const smartcard =
                String(
                    req.body.smartcard ||
                    req.body.iuc ||
                    req.body.billersCode ||
                    ""
                ).trim();

            const serviceID =
                getCableServiceId(
                    provider
                );

            if (!serviceID) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Unsupported cable TV provider"

                });

            }

            if (!smartcard) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Smartcard / IUC number is required"

                });

            }

            if (!process.env.VTPASS_API_KEY) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

            if (!process.env.VTPASS_SECRET_KEY) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "VTPASS_SECRET_KEY is not configured"

                });

            }

            const payload = {

                serviceID:
                    serviceID,

                billersCode:
                    smartcard,

                type:
                    "customer"

            };

            console.log(
                "CABLE VALIDATION REQUEST:",
                payload
            );

            const response =
                await axios.post(

                    `${VTPASS_BASE_URL}/merchant-verify`,

                    payload,

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
                            30000

                    }

                );

            const data =
                response.data || {};

            console.log(
                "CABLE VALIDATION RESPONSE:",
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

            const code =
                String(
                    data.code || ""
                );

            if (
                code !== "000"
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        data.response_description ||
                        "Unable to validate Smartcard / IUC",

                    code:
                        code || null,

                    vtpass:
                        data

                });

            }

            return res.json({

                success:
                    true,

                message:
                    "Smartcard / IUC validated successfully",

                provider:
                    provider,

                serviceID:
                    serviceID,

                smartcard:
                    smartcard,

                customer:
                    data.content ||
                    null,

                vtpass:
                    data

            });

        } catch (error) {

            console.error(
                "CABLE VALIDATION ERROR:",
                error.response?.data ||
                error.message
            );

            if (error.response) {

                return res.status(
                    error.response.status ||
                    500
                ).json({

                    success:
                        false,

                    message:
                        error.response
                            .data
                            ?.response_description ||
                        error.response
                            .data
                            ?.message ||
                        "Cable TV validation failed",

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

            return res.status(500).json({

                success:
                    false,

                message:
                    error.message ||
                    "Unable to validate cable TV account"

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

            console.log(
                "===================================="
            );

            console.log(
                "BUY CABLE TV REQUEST"
            );

            console.log(
                req.body
            );

            console.log(
                "===================================="
            );

            const uid =
                String(
                    req.body.uid || ""
                ).trim();

            const provider =
                String(
                    req.body.provider || ""
                )
                    .toLowerCase()
                    .trim();

            const smartcard =
                String(
                    req.body.smartcard ||
                    req.body.iuc ||
                    ""
                ).trim();

            const variationCode =
                String(
                    req.body.variation_code ||
                    ""
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

                    success:
                        false,

                    message:
                        "UID is required"

                });

            }

            if (!provider) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Cable TV provider is required"

                });

            }

            if (!smartcard) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Smartcard / IUC number is required"

                });

            }

            if (!variationCode) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Cable TV plan is required"

                });

            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Invalid cable TV amount"

                });

            }

            /*
            ========================================
            FIREBASE
            ========================================
            */

            if (!db) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "Firebase is not initialized"

                });

            }

            /*
            ========================================
            VTPASS KEYS
            ========================================
            */

            if (
                !process.env.VTPASS_API_KEY
            ) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "VTPASS_API_KEY is not configured"

                });

            }

            if (
                !process.env.VTPASS_SECRET_KEY
            ) {

                return res.status(500).json({

                    success:
                        false,

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
                getCableServiceId(
                    provider
                );

            if (!serviceID) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        "Unsupported cable TV provider",

                    provider:
                        provider

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

                    success:
                        false,

                    message:
                        "User account not found. Please login again."

                });

            }

            const userData =
                userSnapshot.data() || {};

            /*
            ========================================
            WALLET
            ========================================
            */

            const walletBalance =
                Number(
                    userData.walletBalance || 0
                );

            if (
                walletBalance < amount
            ) {

                return res.status(400).json({

                    success:
                        false,

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
                "IDD-CABLE-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 100000
                );

            /*
            ========================================
            VTPASS PAYLOAD
            ========================================
            */

            const vtpassPayload = {

                request_id:
                    requestId,

                serviceID:
                    serviceID,

                billersCode:
                    smartcard,

                variation_code:
                    variationCode,

                amount:
                    amount,

                phone:
                    userData.phone ||
                    "08000000000"

            };

            console.log(
                "VTpass CABLE payload:",
                vtpassPayload
            );

            /*
            ========================================
            CALL VTPASS
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

            console.log(
                "VTpass CABLE RESPONSE:",
                JSON.stringify(
                    vtpassData,
                    null,
                    2
                )
            );

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
            TRANSACTION FAILED
            ========================================
            */

            if (
                vtpassCode !== "000"
            ) {

                return res.status(400).json({

                    success:
                        false,

                    message:
                        responseDescription ||
                        "Cable TV subscription failed",

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
            SAVE TRANSACTION
            ========================================
            */

            const transactionRef =
                db
                    .collection("transactions")
                    .doc();

            let newBalance =
                0;

            /*
            ========================================
            DEDUCT WALLET
            ========================================
            */

            await db.runTransaction(
                async (transaction) => {

                    const freshUser =
                        await transaction.get(
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
                            freshData.walletBalance ||
                            0
                        );

                    if (
                        freshBalance < amount
                    ) {

                        throw new Error(
                            "Insufficient wallet balance"
                        );

                    }

                    newBalance =
                        freshBalance -
                        amount;

                    /*
                    --------------------------------
                    UPDATE WALLET
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
                                "cable_tv_purchase",

                            service:
                                "cable_tv",

                            provider:
                                provider,

                            serviceID:
                                serviceID,

                            smartcard:
                                smartcard,

                            variationCode:
                                variationCode,

                            amount:
                                amount,

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
            SUCCESS
            ========================================
            */

            console.log(
                "CABLE TV PAYMENT SUCCESSFUL"
            );

            return res.json({

                success:
                    true,

                message:
                    "Cable TV subscription successful",

                transactionId:
                    transactionRef.id,

                requestId:
                    requestId,

                provider:
                    provider,

                serviceID:
                    serviceID,

                smartcard:
                    smartcard,

                variationCode:
                    variationCode,

                amount:
                    amount,

                walletBalance:
                    newBalance,

                vtpass:
                    vtpassData

            });

        } catch (error) {

            console.error(
                "BUY CABLE ERROR:",
                error.response?.data ||
                error.message
            );

            if (
                error.response
            ) {

                return res.status(

                    error.response.status ||
                    500

                ).json({

                    success:
                        false,

                    message:
                        error.response
                            .data
                            ?.response_description ||
                        error.response
                            .data
                            ?.message ||
                        "VTpass cable TV transaction failed",

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

            return res.status(500).json({

                success:
                    false,

                message:
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

                    success:
                        false,

                    message:
                        "Email, amount and uid are required"

                });

            }

            if (!db) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "Firebase is not initialized"

                });

            }

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "PAYSTACK_SECRET_KEY is not configured"

                });

            }

            if (amount < 100) {

                return res.status(400).json({

                    success:
                        false,

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

                success:
                    true,

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

                success:
                    false,

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

                    success:
                        false,

                    message:
                        "Transaction reference is required"

                });

            }

            if (!db) {

                return res.status(500).json({

                    success:
                        false,

                    message:
                        "Firebase is not initialized"

                });

            }

            if (
                !process.env.PAYSTACK_SECRET_KEY
            ) {

                return res.status(500).json({

                    success:
                        false,

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

                    success:
                        false,

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

                    success:
                        true,

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

                    success:
                        false,

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

                    success:
                        false,

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

                success:
                    true,

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

                success:
                    false,

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
