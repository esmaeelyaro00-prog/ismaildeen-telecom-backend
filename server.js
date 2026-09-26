// ============================================================
// ISMAIL DEEN DATA
// FULL SERVER.JS
// Firebase + Firestore + Paystack + CheapDataHub + AI Support
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 10000);

const APP_NAME = "ISMAIL DEEN DATA";

const REQUEST_TIMEOUT = Number(
  process.env.REQUEST_TIMEOUT || 60000
);

const MINIMUM_FUNDING_AMOUNT = Number(
  process.env.MINIMUM_FUNDING_AMOUNT || 100
);

const CHEAPDATAHUB_BASE_URL =
  process.env.CHEAPDATAHUB_BASE_URL ||
  "https://www.cheapdatahub.ng/api/v1/resellers";

const PAYSTACK_BASE_URL =
  process.env.PAYSTACK_BASE_URL ||
  "https://api.paystack.co";

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL ||
  "https://api.openai.com/v1";

const OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  "gpt-5.6-luna";

// ============================================================
// EXPRESS
// ============================================================

app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
  })
);

// ============================================================
// WEBHOOK RAW BODY + NORMAL JSON BODY
// IMPORTANT:
// Webhooks MUST receive raw body for signature checking.
// Normal API routes receive JSON.
// ============================================================

app.use((req, res, next) => {
  if (
    req.path === "/api/payment/webhook" ||
    req.path === "/api/cheapdatahub/webhook"
  ) {
    return express.raw({
      type: "application/json",
      limit: "1mb",
    })(req, res, next);
  }

  return express.json({
    limit: "1mb",
  })(req, res, next);
});

// ============================================================
// HELPERS
// ============================================================

function cleanString(value) {
  return String(value ?? "").trim();
}

function cleanPhone(value) {
  return cleanString(value).replace(/\s+/g, "");
}

function isValidPhone(value) {
  const phone = cleanPhone(value);

  return /^(0\d{10}|234\d{10})$/.test(
    phone
  );
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    cleanString(value)
  );
}

function toMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number * 100) / 100;
}

function generateRequestId(prefix = "IDD") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")}`;
}

function getErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.detail ||
    error?.message ||
    "Unknown error"
  );
}

function normalizeStatus(status) {
  const value =
    cleanString(status).toLowerCase();

  if (
    [
      "successful",
      "success",
      "completed",
      "delivered",
    ].includes(value)
  ) {
    return "completed";
  }

  if (
    [
      "initiated",
      "processing",
      "pending",
      "provider_pending",
      "unknown",
    ].includes(value)
  ) {
    return "pending";
  }

  if (
    [
      "failed",
      "failure",
      "cancelled",
      "canceled",
    ].includes(value)
  ) {
    return "failed";
  }

  if (value === "refunded") {
    return "refunded";
  }

  return value || "unknown";
}

function isProviderSuccess(data) {
  const status =
    cleanString(data?.status).toLowerCase();

  return [
    "true",
    "successful",
    "success",
    "completed",
  ].includes(status);
}

function isProviderFailed(data) {
  const status =
    cleanString(data?.status).toLowerCase();

  return [
    "false",
    "failed",
    "failure",
    "cancelled",
    "canceled",
  ].includes(status);
}

function formatFirestoreData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const result = { ...data };

  const fields = [
    "createdAt",
    "updatedAt",
    "paidAt",
    "verifiedAt",
    "completedAt",
    "failedAt",
    "refundedAt",
  ];

  for (const field of fields) {
    if (
      result[field] &&
      typeof result[field].toDate === "function"
    ) {
      result[field] =
        result[field].toDate().toISOString();
    }
  }

  return result;
}

// ============================================================
// FIREBASE
// ============================================================

let db = null;

function initializeFirebase() {
  if (admin.apps.length > 0) {
    db = admin.firestore();
    return;
  }

  let credential;

  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ) {
    try {
      const serviceAccount =
        JSON.parse(
          process.env
            .FIREBASE_SERVICE_ACCOUNT_JSON
        );

      credential =
        admin.credential.cert(
          serviceAccount
        );
    } catch (error) {
      console.error(
        "Invalid FIREBASE_SERVICE_ACCOUNT_JSON:",
        error.message
      );

      throw error;
    }
  } else if (
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  ) {
    credential =
      admin.credential.cert(
        require(
          process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        )
      );
  } else {
    const defaultPath =
      "/etc/secrets/firebase-service-account.json";

    credential =
      admin.credential.cert(
        require(defaultPath)
      );
  }

  admin.initializeApp({
    credential,
  });

  db = admin.firestore();

  console.log(
    "Firebase Admin initialized successfully"
  );
}

initializeFirebase();

function checkFirebase(res) {
  if (!db) {
    res.status(503).json({
      success: false,
      message:
        "Firebase is not initialized",
    });

    return false;
  }

  return true;
}

// ============================================================
// FIREBASE AUTH
// ============================================================

async function requireFirebaseAuth(
  req,
  res,
  next
) {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        message:
          "Firebase is not initialized",
      });
    }

    const authorization =
      req.headers.authorization || "";

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authorization token is required",
      });
    }

    const token =
      authorization
        .substring(7)
        .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid authorization token",
      });
    }

    const decoded =
      await admin
        .auth()
        .verifyIdToken(token);

    req.user = decoded;

    next();
  } catch (error) {
    console.error(
      "AUTH ERROR:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired Firebase token",
    });
  }
}

function requireOwnUid(
  req,
  res,
  next
) {
  const uid =
    req.params.uid ||
    req.body?.uid ||
    req.query?.uid;

  if (!uid) {
    return res.status(400).json({
      success: false,
      message:
        "User ID is required",
    });
  }

  if (
    !req.user ||
    req.user.uid !== uid
  ) {
    return res.status(403).json({
      success: false,
      message:
        "You are not authorized to access this account",
    });
  }

  next();
}

// ============================================================
// USER
// ============================================================

async function getUser(uid) {
  const ref =
    db.collection("users").doc(uid);

  const snapshot =
    await ref.get();

  return {
    userRef: ref,

    userData: snapshot.exists
      ? snapshot.data()
      : null,
  };
}

// ============================================================
// WALLET HISTORY
// ============================================================

async function writeWalletHistory({
  uid,
  transactionId,
  reference,
  type,
  amount,
  balanceAfter,
  method,
  reason,
}) {
  const ref =
    db.collection(
      "walletHistory"
    ).doc();

  await ref.set({
    uid,

    transactionId:
      transactionId || null,

    reference:
      reference || null,

    type,

    amount:
      toMoney(amount),

    balanceAfter:
      toMoney(balanceAfter),

    method:
      method || null,

    reason:
      reason || null,

    createdAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),
  });

  return ref.id;
}

// ============================================================
// CHEAPDATAHUB
// ============================================================

function cheapDataHubHeaders() {
  const key =
    process.env.CHEAPDATAHUB_API_KEY;

  return {
    Authorization:
      `Bearer ${key}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json",
  };
}

function checkCheapDataHub(
  req,
  res,
  next
) {
  if (
    !process.env.CHEAPDATAHUB_API_KEY
  ) {
    return res.status(503).json({
      success: false,
      message:
        "CheapDataHub API key is not configured",
    });
  }

  next();
}

const CDH = {
  airtime:
    `${CHEAPDATAHUB_BASE_URL}/airtime/purchase/`,

  data:
    `${CHEAPDATAHUB_BASE_URL}/data/purchase/`,

  electricity:
    `${CHEAPDATAHUB_BASE_URL}/electricity/purchase/`,

  cable:
    `${CHEAPDATAHUB_BASE_URL}/cable/purchase/`,

  balance:
    `${CHEAPDATAHUB_BASE_URL}/wallet/balance/`,

  transactions:
    `${CHEAPDATAHUB_BASE_URL}/transactions/`,
};

// ============================================================
// PROVIDER IDS
// ============================================================

const AIRTIME_PROVIDER_IDS = {
  mtn:
    process.env.CDH_MTN_PROVIDER_ID ||
    "",

  airtel:
    process.env.CDH_AIRTEL_PROVIDER_ID ||
    "",

  glo:
    process.env.CDH_GLO_PROVIDER_ID ||
    "",

  "9mobile":
    process.env.CDH_9MOBILE_PROVIDER_ID ||
    "",

  etisalat:
    process.env.CDH_9MOBILE_PROVIDER_ID ||
    "",
};

const ELECTRICITY_DISCO_IDS = {
  abuja:
    process.env.CDH_ABUJA_DISCO_ID ||
    "",

  benin:
    process.env.CDH_BENIN_DISCO_ID ||
    "",

  eko:
    process.env.CDH_EKO_DISCO_ID ||
    "",

  enugu:
    process.env.CDH_ENUGU_DISCO_ID ||
    "",

  ibadan:
    process.env.CDH_IBADAN_DISCO_ID ||
    "",

  ikeja:
    process.env.CDH_IKEJA_DISCO_ID ||
    "",

  jos:
    process.env.CDH_JOS_DISCO_ID ||
    "",

  kaduna:
    process.env.CDH_KADUNA_DISCO_ID ||
    "",

  kano:
    process.env.CDH_KANO_DISCO_ID ||
    "",

  yola:
    process.env.CDH_YOLA_DISCO_ID ||
    "",
};

// ============================================================
// CHEAPDATAHUB REQUEST
// ============================================================

async function cheapDataHubPost(
  url,
  payload
) {
  const response =
    await axios.post(
      url,
      payload,
      {
        headers:
          cheapDataHubHeaders(),

        timeout:
          REQUEST_TIMEOUT,
      }
    );

  return response.data;
}

async function cheapDataHubGet(
  url
) {
  const response =
    await axios.get(
      url,
      {
        headers:
          cheapDataHubHeaders(),

        timeout:
          30000,
      }
    );

  return response.data;
}

// ============================================================
// RESERVE WALLET PURCHASE
// ============================================================

async function reserveWalletPurchase({
  uid,
  requestId,
  amount,
  type,
  provider,
  metadata,
}) {
  const serviceRef =
    db.collection(
      "serviceTransactions"
    ).doc(requestId);

  const userRef =
    db.collection("users").doc(uid);

  return db.runTransaction(
    async (transaction) => {
      const existing =
        await transaction.get(
          serviceRef
        );

      if (existing.exists) {
        return {
          alreadyExists:
            true,

          data:
            existing.data(),
        };
      }

      const userSnapshot =
        await transaction.get(
          userRef
        );

      if (!userSnapshot.exists) {
        throw new Error(
          "User account not found"
        );
      }

      const user =
        userSnapshot.data() || {};

      const balance =
        Number(
          user.walletBalance || 0
        );

      const purchaseAmount =
        toMoney(amount);

      if (
        purchaseAmount <= 0
      ) {
        throw new Error(
          "Invalid purchase amount"
        );
      }

      if (
        balance < purchaseAmount
      ) {
        throw new Error(
          "Insufficient wallet balance"
        );
      }

      const newBalance =
        toMoney(
          balance -
            purchaseAmount
        );

      transaction.update(
        userRef,
        {
          walletBalance:
            newBalance,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      transaction.set(
        serviceRef,
        {
          uid,

          requestId,

          amount:
            purchaseAmount,

          type,

          provider:
            provider || null,

          status:
            "provider_pending",

          previousBalance:
            balance,

          balanceAfterDebit:
            newBalance,

          metadata:
            metadata || {},

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      return {
        alreadyExists:
          false,

        data: {
          uid,

          requestId,

          amount:
            purchaseAmount,

          type,

          provider:
            provider || null,

          status:
            "provider_pending",

          previousBalance:
            balance,

          balanceAfterDebit:
            newBalance,

          metadata:
            metadata || {},
        },
      };
    }
  );
}

// ============================================================
// MARK PROCESSING
// ============================================================

async function markProviderProcessing(
  requestId,
  providerResponse
) {
  const ref =
    db.collection(
      "serviceTransactions"
    ).doc(requestId);

  await ref.update({
    status:
      "processing",

    providerResponse:
      providerResponse || null,

    updatedAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),
  });
}

// ============================================================
// COMPLETE PURCHASE
// ============================================================

async function markPurchaseCompleted(
  requestId,
  providerResponse
) {
  const ref =
    db.collection(
      "serviceTransactions"
    ).doc(requestId);

  const snapshot =
    await ref.get();

  if (!snapshot.exists) {
    throw new Error(
      "Service transaction not found"
    );
  }

  const data =
    snapshot.data();

  if (
    data.status ===
    "completed"
  ) {
    return data;
  }

  if (
    data.status ===
    "refunded"
  ) {
    return data;
  }

  await ref.update({
    status:
      "completed",

    providerResponse:
      providerResponse || null,

    completedAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),

    updatedAt:
      admin.firestore
        .FieldValue
        .serverTimestamp(),
  });

  const updated =
    await ref.get();

  return updated.data();
}

// ============================================================
// REFUND FAILED PURCHASE
// ============================================================

async function refundFailedPurchase(
  requestId,
  reason,
  providerResponse
) {
  const ref =
    db.collection(
      "serviceTransactions"
    ).doc(requestId);

  return db.runTransaction(
    async (transaction) => {
      const serviceSnapshot =
        await transaction.get(ref);

      if (!serviceSnapshot.exists) {
        throw new Error(
          "Service transaction not found"
        );
      }

      const service =
        serviceSnapshot.data();

      if (
        service.status ===
          "refunded" ||
        service.status ===
          "completed"
      ) {
        return service;
      }

      const uid =
        service.uid;

      const amount =
        toMoney(
          service.amount
        );

      const userRef =
        db.collection(
          "users"
        ).doc(uid);

      const userSnapshot =
        await transaction.get(
          userRef
        );

      if (!userSnapshot.exists) {
        throw new Error(
          "User not found"
        );
      }

      const user =
        userSnapshot.data() || {};

      const currentBalance =
        Number(
          user.walletBalance || 0
        );

      const newBalance =
        toMoney(
          currentBalance +
            amount
        );

      transaction.update(
        userRef,
        {
          walletBalance:
            newBalance,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      transaction.update(
        ref,
        {
          status:
            "refunded",

          refundReason:
            reason || null,

          providerResponse:
            providerResponse || null,

          refundedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          balanceAfterRefund:
            newBalance,
        }
      );

      const historyRef =
        db.collection(
          "walletHistory"
        ).doc(
          `refund-${requestId}`
        );

      transaction.set(
        historyRef,
        {
          uid,

          transactionId:
            requestId,

          reference:
            requestId,

          type:
            "refund",

          amount,

          balanceAfter:
            newBalance,

          reason:
            reason || null,

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        ...service,

        status:
          "refunded",

        balanceAfterRefund:
          newBalance,
      };
    }
  );
}

// ============================================================
// DATA PURCHASE
// ============================================================

app.post(
  "/api/cheapdatahub/buy-data",
  requireFirebaseAuth,
  requireOwnUid,
  checkCheapDataHub,
  async (req, res) => {
    try {
      const {
        uid,
        phone,
        bundle_id,
        amount,
        request_id,
      } = req.body;

      const phoneNumber =
        cleanPhone(phone);

      if (
        !isValidPhone(
          phoneNumber
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid phone number",
        });
      }

      const bundleId =
        Number(bundle_id);

      if (
        !Number.isInteger(
          bundleId
        ) ||
        bundleId <= 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Valid bundle_id is required",
        });
      }

      const purchaseAmount =
        toMoney(amount);

      if (
        purchaseAmount <= 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Valid amount is required",
        });
      }

      const requestIdValue =
        cleanString(
          request_id
        ) ||
        generateRequestId(
          "DATA"
        );

      const reserved =
        await reserveWalletPurchase({
          uid,

          requestId:
            requestIdValue,

          amount:
            purchaseAmount,

          type:
            "data",

          provider:
            "cheapdatahub",

          metadata: {
            bundle_id:
              bundleId,

            phone:
              phoneNumber,
          },
        });

      if (
        reserved.alreadyExists
      ) {
        const status =
          normalizeStatus(
            reserved.data.status
          );

        return res.json({
          success:
            status ===
            "completed",

          message:
            "This request already exists",

          requestId:
            requestIdValue,

          status,

          transaction:
            formatFirestoreData(
              reserved.data
            ),
        });
      }

      const payload = {
        bundle_id:
          bundleId,

        phone_number:
          phoneNumber,
      };

      let providerResponse;

      try {
        providerResponse =
          await cheapDataHubPost(
            CDH.data,
            payload
          );
      } catch (providerError) {
        providerResponse =
          providerError?.response
            ?.data || {
            status:
              "failed",

            message:
              getErrorMessage(
                providerError
              ),
          };
      }

      if (
        isProviderSuccess(
          providerResponse
        )
      ) {
        await markProviderProcessing(
          requestIdValue,
          providerResponse
        );

        return res.json({
          success: true,

          message:
            providerResponse.message ||
            "Data purchase accepted",

          requestId:
            requestIdValue,

          status:
            "processing",

          transaction:
            providerResponse,
        });
      }

      if (
        isProviderFailed(
          providerResponse
        )
      ) {
        await refundFailedPurchase(
          requestIdValue,

          "CheapDataHub rejected the data transaction",

          providerResponse
        );

        return res.status(400).json({
          success: false,

          message:
            providerResponse.message ||
            "Data purchase failed. Wallet refunded.",

          requestId:
            requestIdValue,

          provider:
            providerResponse,
        });
      }

      await markProviderProcessing(
        requestIdValue,
        providerResponse
      );

      return res.json({
        success: true,

        message:
          "Data transaction is being processed",

        requestId:
          requestIdValue,

        status:
          "processing",

        provider:
          providerResponse,
      });
    } catch (error) {
      console.error(
        "DATA ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// AIRTIME PURCHASE
// ============================================================

app.post(
  "/api/cheapdatahub/buy-airtime",
  requireFirebaseAuth,
  requireOwnUid,
  checkCheapDataHub,
  async (req, res) => {
    try {
      const {
        uid,
        network,
        phone,
        amount,
        request_id,
      } = req.body;

      const cleanNetwork =
        cleanString(
          network
        ).toLowerCase();

      const phoneNumber =
        cleanPhone(phone);

      const providerId =
        AIRTIME_PROVIDER_IDS[
          cleanNetwork
        ];

      if (!providerId) {
        return res.status(400).json({
          success: false,

          message:
            "CheapDataHub provider ID for this network is not configured",
        });
      }

      if (
        !isValidPhone(
          phoneNumber
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid phone number",
        });
      }

      const purchaseAmount =
        toMoney(amount);

      if (
        purchaseAmount <= 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid airtime amount",
        });
      }

      const requestIdValue =
        cleanString(
          request_id
        ) ||
        generateRequestId(
          "AIRTIME"
        );

      const reserved =
        await reserveWalletPurchase({
          uid,

          requestId:
            requestIdValue,

          amount:
            purchaseAmount,

          type:
            "airtime",

          provider:
            "cheapdatahub",

          metadata: {
            network:
              cleanNetwork,

            provider_id:
              providerId,

            phone:
              phoneNumber,
          },
        });

      if (
        reserved.alreadyExists
      ) {
        const status =
          normalizeStatus(
            reserved.data.status
          );

        return res.json({
          success:
            status ===
            "completed",

          message:
            "This request already exists",

          requestId:
            requestIdValue,

          status,

          transaction:
            formatFirestoreData(
              reserved.data
            ),
        });
      }

      const payload = {
        provider_id:
          Number(providerId),

        phone_number:
          phoneNumber,

        amount:
          purchaseAmount,
      };

      let providerResponse;

      try {
        providerResponse =
          await cheapDataHubPost(
            CDH.airtime,
            payload
          );
      } catch (providerError) {
        providerResponse =
          providerError?.response
            ?.data || {
            status:
              "failed",

            message:
              getErrorMessage(
                providerError
              ),
          };
      }

      if (
        isProviderSuccess(
          providerResponse
        )
      ) {
        await markProviderProcessing(
          requestIdValue,
          providerResponse
        );

        return res.json({
          success: true,

          message:
            providerResponse.message ||
            "Airtime purchase accepted",

          requestId:
            requestIdValue,

          status:
            "processing",

          provider:
            providerResponse,
        });
      }

      if (
        isProviderFailed(
          providerResponse
        )
      ) {
        await refundFailedPurchase(
          requestIdValue,

          "CheapDataHub rejected the airtime transaction",

          providerResponse
        );

        return res.status(400).json({
          success: false,

          message:
            providerResponse.message ||
            "Airtime purchase failed. Wallet refunded.",

          requestId:
            requestIdValue,

          provider:
            providerResponse,
        });
      }

      await markProviderProcessing(
        requestIdValue,
        providerResponse
      );

      return res.json({
        success: true,

        message:
          "Airtime transaction is being processed",

        requestId:
          requestIdValue,

        status:
          "processing",

        provider:
          providerResponse,
      });
    } catch (error) {
      console.error(
        "AIRTIME ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// ELECTRICITY PURCHASE
// ============================================================

app.post(
  "/api/cheapdatahub/buy-electricity",
  requireFirebaseAuth,
  requireOwnUid,
  checkCheapDataHub,
  async (req, res) => {
    try {
      const {
        uid,
        disco,
        meter_number,
        meter_type,
        amount,
        phone,
        request_id,
      } = req.body;

      const cleanDisco =
        cleanString(
          disco
        ).toLowerCase();

      const discoId =
        ELECTRICITY_DISCO_IDS[
          cleanDisco
        ];

      if (!discoId) {
        return res.status(400).json({
          success: false,

          message:
            "CheapDataHub electricity provider ID is not configured",
        });
      }

      const meter =
        cleanString(
          meter_number
        );

      if (!meter) {
        return res.status(400).json({
          success: false,

          message:
            "Meter number is required",
        });
      }

      const cleanMeterType =
        cleanString(
          meter_type
        ).toLowerCase() ||
        "prepaid";

      if (
        ![
          "prepaid",
          "postpaid",
        ].includes(
          cleanMeterType
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Meter type must be prepaid or postpaid",
        });
      }

      const purchaseAmount =
        toMoney(amount);

      if (
        purchaseAmount <= 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid electricity amount",
        });
      }

      const phoneNumber =
        cleanPhone(phone);

      if (
        phoneNumber &&
        !isValidPhone(
          phoneNumber
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid phone number",
        });
      }

      const requestIdValue =
        cleanString(
          request_id
        ) ||
        generateRequestId(
          "ELECTRIC"
        );

      const reserved =
        await reserveWalletPurchase({
          uid,

          requestId:
            requestIdValue,

          amount:
            purchaseAmount,

          type:
            "electricity",

          provider:
            "cheapdatahub",

          metadata: {
            disco:
              cleanDisco,

            disco_id:
              discoId,

            meter_number:
              meter,

            meter_type:
              cleanMeterType,

            phone:
              phoneNumber,
          },
        });

      if (
        reserved.alreadyExists
      ) {
        const status =
          normalizeStatus(
            reserved.data.status
          );

        return res.json({
          success:
            status ===
            "completed",

          message:
            "This request already exists",

          requestId:
            requestIdValue,

          status,

          transaction:
            formatFirestoreData(
              reserved.data
            ),
        });
      }

      const payload = {
        disco_id:
          Number(discoId),

        meter_number:
          meter,

        amount:
          purchaseAmount,

        meter_type:
          cleanMeterType,

        phone:
          phoneNumber ||
          "08000000000",
      };

      let providerResponse;

      try {
        providerResponse =
          await cheapDataHubPost(
            CDH.electricity,
            payload
          );
      } catch (providerError) {
        providerResponse =
          providerError?.response
            ?.data || {
            status:
              "failed",

            message:
              getErrorMessage(
                providerError
              ),
          };
      }

      if (
        isProviderSuccess(
          providerResponse
        )
      ) {
        await markProviderProcessing(
          requestIdValue,
          providerResponse
        );

        return res.json({
          success: true,

          message:
            providerResponse.message ||
            "Electricity transaction accepted",

          requestId:
            requestIdValue,

          status:
            "processing",

          provider:
            providerResponse,
        });
      }

      if (
        isProviderFailed(
          providerResponse
        )
      ) {
        await refundFailedPurchase(
          requestIdValue,

          "CheapDataHub rejected the electricity transaction",

          providerResponse
        );

        return res.status(400).json({
          success: false,

          message:
            providerResponse.message ||
            "Electricity purchase failed. Wallet refunded.",

          requestId:
            requestIdValue,

          provider:
            providerResponse,
        });
      }

      await markProviderProcessing(
        requestIdValue,
        providerResponse
      );

      return res.json({
        success: true,

        message:
          "Electricity transaction is being processed",

        requestId:
          requestIdValue,

        status:
          "processing",

        provider:
          providerResponse,
      });
    } catch (error) {
      console.error(
        "ELECTRICITY ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// CABLE PURCHASE
// ============================================================

app.post(
  "/api/cheapdatahub/buy-cable",
  requireFirebaseAuth,
  requireOwnUid,
  checkCheapDataHub,
  async (req, res) => {
    try {
      const {
        uid,
        plan_id,
        cardnumber,
        phone,
        amount,
        request_id,
      } = req.body;

      const planId =
        Number(plan_id);

      if (
        !Number.isInteger(
          planId
        ) ||
        planId <= 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Valid plan_id is required",
        });
      }

      const card =
        cleanString(
          cardnumber
        );

      if (!card) {
        return res.status(400).json({
          success: false,

          message:
            "Smartcard number is required",
        });
      }

      const purchaseAmount =
        toMoney(amount);

      if (
        purchaseAmount <= 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Valid cable amount is required",
        });
      }

      const phoneNumber =
        cleanPhone(phone);

      if (
        phoneNumber &&
        !isValidPhone(
          phoneNumber
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid phone number",
        });
      }

      const requestIdValue =
        cleanString(
          request_id
        ) ||
        generateRequestId(
          "CABLE"
        );

      const reserved =
        await reserveWalletPurchase({
          uid,

          requestId:
            requestIdValue,

          amount:
            purchaseAmount,

          type:
            "cable",

          provider:
            "cheapdatahub",

          metadata: {
            plan_id:
              planId,

            cardnumber:
              card,

            phone:
              phoneNumber,
          },
        });

      if (
        reserved.alreadyExists
      ) {
        const status =
          normalizeStatus(
            reserved.data.status
          );

        return res.json({
          success:
            status ===
            "completed",

          message:
            "This request already exists",

          requestId:
            requestIdValue,

          status,

          transaction:
            formatFirestoreData(
              reserved.data
            ),
        });
      }

      const payload = {
        plan_id:
          planId,

        cardnumber:
          card,

        phone:
          phoneNumber ||
          "08000000000",
      };

      let providerResponse;

      try {
        providerResponse =
          await cheapDataHubPost(
            CDH.cable,
            payload
          );
      } catch (providerError) {
        providerResponse =
          providerError?.response
            ?.data || {
            status:
              "failed",

            message:
              getErrorMessage(
                providerError
              ),
          };
      }

      if (
        isProviderSuccess(
          providerResponse
        )
      ) {
        await markProviderProcessing(
          requestIdValue,
          providerResponse
        );

        return res.json({
          success: true,

          message:
            providerResponse.message ||
            "Cable transaction accepted",

          requestId:
            requestIdValue,

          status:
            "processing",

          provider:
            providerResponse,
        });
      }

      if (
        isProviderFailed(
          providerResponse
        )
      ) {
        await refundFailedPurchase(
          requestIdValue,

          "CheapDataHub rejected the cable transaction",

          providerResponse
        );

        return res.status(400).json({
          success: false,

          message:
            providerResponse.message ||
            "Cable purchase failed. Wallet refunded.",

          requestId:
            requestIdValue,

          provider:
            providerResponse,
        });
      }

      await markProviderProcessing(
        requestIdValue,
        providerResponse
      );

      return res.json({
        success: true,

        message:
          "Cable transaction is being processed",

        requestId:
          requestIdValue,

        status:
          "processing",

        provider:
          providerResponse,
      });
    } catch (error) {
      console.error(
        "CABLE ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB WALLET BALANCE
// ============================================================

app.get(
  "/api/cheapdatahub/balance",
  requireFirebaseAuth,
  checkCheapDataHub,
  async (req, res) => {
    try {
      const data =
        await cheapDataHubGet(
          CDH.balance
        );

      return res.json({
        success: true,

        provider:
          data,
      });
    } catch (error) {
      console.error(
        "CDH BALANCE ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB TRANSACTIONS
// ============================================================

app.get(
  "/api/cheapdatahub/transactions",
  requireFirebaseAuth,
  checkCheapDataHub,
  async (req, res) => {
    try {
      const data =
        await cheapDataHubGet(
          CDH.transactions
        );

      return res.json({
        success: true,

        provider:
          data,
      });
    } catch (error) {
      console.error(
        "CDH TRANSACTIONS ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB WEBHOOK
// ============================================================

app.post(
  "/api/cheapdatahub/webhook",
  async (req, res) => {
    try {
      const secret =
        process.env
          .CHEAPDATAHUB_WEBHOOK_SECRET;

      if (!secret) {
        console.error(
          "CheapDataHub webhook secret is missing"
        );

        return res
          .status(503)
          .send(
            "Webhook secret not configured"
          );
      }

      const signatureHeader =
        process.env
          .CHEAPDATAHUB_WEBHOOK_SIGNATURE_HEADER ||
        "x-cheapdatahub-signature";

      const received =
        req.headers[
          signatureHeader.toLowerCase()
        ];

      if (!received) {
        return res
          .status(401)
          .send(
            "Missing webhook signature"
          );
      }

      const algorithm =
        process.env
          .CHEAPDATAHUB_WEBHOOK_ALGORITHM ||
        "sha256";

      const expected =
        crypto
          .createHmac(
            algorithm,
            secret
          )
          .update(req.body)
          .digest("hex");

      const receivedBuffer =
        Buffer.from(
          String(received),
          "utf8"
        );

      const expectedBuffer =
        Buffer.from(
          expected,
          "utf8"
        );

      if (
        receivedBuffer.length !==
        expectedBuffer.length ||
        !crypto.timingSafeEqual(
          receivedBuffer,
          expectedBuffer
        )
      ) {
        return res
          .status(401)
          .send(
            "Invalid webhook signature"
          );
      }

      const event =
        JSON.parse(
          req.body.toString(
            "utf8"
          )
        );

      const reference =
        event?.reference ||
        event?.data?.reference ||
        event?.transaction_id ||
        event?.data?.transaction_id;

      const status =
        event?.status ||
        event?.data?.status;

      if (!reference) {
        return res.json({
          success: true,

          ignored: true,
        });
      }

      const query =
        await db
          .collection(
            "serviceTransactions"
          )
          .where(
            "requestId",
            "==",
            reference
          )
          .limit(1)
          .get();

      let transactionDoc =
        null;

      if (!query.empty) {
        transactionDoc =
          query.docs[0];
      } else {
        const byId =
          await db
            .collection(
              "serviceTransactions"
            )
            .doc(reference)
            .get();

        if (byId.exists) {
          transactionDoc =
            byId;
        }
      }

      if (!transactionDoc) {
        console.log(
          "Webhook transaction not found:",
          reference
        );

        return res.json({
          success: true,

          ignored: true,
        });
      }

      const transaction =
        transactionDoc.data();

      const normalized =
        normalizeStatus(
          status
        );

      if (
        normalized ===
        "completed"
      ) {
        await markPurchaseCompleted(
          transactionDoc.id,
          event
        );
      } else if (
        normalized ===
        "failed"
      ) {
        await refundFailedPurchase(
          transactionDoc.id,

          "CheapDataHub webhook reported failed transaction",

          event
        );
      } else if (
        normalized ===
        "refunded"
      ) {
        if (
          transaction.status !==
          "refunded"
        ) {
          await refundFailedPurchase(
            transactionDoc.id,

            "CheapDataHub webhook reported refunded transaction",

            event
          );
        }
      } else {
        await markProviderProcessing(
          transactionDoc.id,
          event
        );
      }

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "CDH WEBHOOK ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Webhook processing failed",
      });
    }
  }
);

// ============================================================
// WALLET BALANCE
// ============================================================

app.get(
  "/api/wallet/balance/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) {
        return;
      }

      const {
        userData,
      } = await getUser(
        req.params.uid
      );

      if (!userData) {
        return res.status(404).json({
          success: false,

          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        balance:
          toMoney(
            userData.walletBalance ||
              0
          ),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// WALLET DETAILS
// ============================================================

app.get(
  "/api/wallet/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const {
        userData,
      } = await getUser(
        req.params.uid
      );

      if (!userData) {
        return res.status(404).json({
          success: false,

          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        user: {
          uid:
            req.params.uid,

          name:
            userData.name ||
            userData.displayName ||
            "",

          email:
            userData.email ||
            "",

          phone:
            userData.phone ||
            "",

          walletBalance:
            toMoney(
              userData.walletBalance ||
                0
            ),
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// WALLET HISTORY
// ============================================================

app.get(
  "/api/wallet/:uid/history",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const snapshot =
        await db
          .collection(
            "walletHistory"
          )
          .where(
            "uid",
            "==",
            req.params.uid
          )
          .limit(100)
          .get();

      const history =
        snapshot.docs
          .map((doc) => ({
            id:
              doc.id,

            ...formatFirestoreData(
              doc.data()
            ),
          }))
          .sort(
            (a, b) => {
              const aTime =
                a.createdAt
                  ? new Date(
                      a.createdAt
                    ).getTime()
                  : 0;

              const bTime =
                b.createdAt
                  ? new Date(
                      b.createdAt
                    ).getTime()
                  : 0;

              return (
                bTime -
                aTime
              );
            }
          );

      return res.json({
        success: true,

        history,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// SERVICE TRANSACTION STATUS
// ============================================================

app.get(
  "/api/vtpass/transaction/:requestId",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const requestId =
        cleanString(
          req.params.requestId
        );

      if (!requestId) {
        return res.status(400).json({
          success: false,

          message:
            "Request ID is required",
        });
      }

      const doc =
        await db
          .collection(
            "serviceTransactions"
          )
          .doc(requestId)
          .get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,

          message:
            "Transaction not found",
        });
      }

      const data =
        doc.data();

      if (
        data.uid !==
        req.user.uid
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Unauthorized",
        });
      }

      return res.json({
        success: true,

        transaction:
          formatFirestoreData({
            id:
              doc.id,

            ...data,
          }),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// PAYSTACK
// ============================================================

function paystackHeaders() {
  return {
    Authorization:
      `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json",
  };
}

function checkPaystack(
  req,
  res,
  next
) {
  if (
    !process.env.PAYSTACK_SECRET_KEY
  ) {
    return res.status(503).json({
      success: false,

      message:
        "Paystack secret key is not configured",
    });
  }

  next();
}

// ============================================================
// PROCESS SUCCESSFUL PAYMENT
// ============================================================

async function processSuccessfulPayment(
  reference,
  payment
) {
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
      "Funding transaction not found"
    );
  }

  const transactionDoc =
    snapshot.docs[0];

  const transactionRef =
    transactionDoc.ref;

  const fundingTransaction =
    transactionDoc.data();

  const uid =
    fundingTransaction.uid ||
    fundingTransaction.userId;

  if (!uid) {
    throw new Error(
      "Funding transaction has no user ID"
    );
  }

  const paidAmount =
    Number(
      payment.amount || 0
    ) / 100;

  const expectedAmount =
    Number(
      fundingTransaction.amount ||
        0
    );

  if (
    Math.round(
      paidAmount * 100
    ) !==
    Math.round(
      expectedAmount * 100
    )
  ) {
    throw new Error(
      "Payment amount mismatch"
    );
  }

  return db.runTransaction(
    async (transactionDb) => {
      const fresh =
        await transactionDb.get(
          transactionRef
        );

      const freshData =
        fresh.data() || {};

      const userRef =
        db.collection(
          "users"
        ).doc(uid);

      const user =
        await transactionDb.get(
          userRef
        );

      if (!user.exists) {
        throw new Error(
          "User account not found"
        );
      }

      const currentBalance =
        Number(
          user.data()
            ?.walletBalance ||
            0
        );

      if (
        freshData.status ===
        "completed"
      ) {
        return {
          alreadyProcessed:
            true,

          newBalance:
            currentBalance,

          amount:
            expectedAmount,
        };
      }

      const newBalance =
        toMoney(
          currentBalance +
            expectedAmount
        );

      transactionDb.update(
        userRef,
        {
          walletBalance:
            newBalance,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      transactionDb.update(
        transactionRef,
        {
          status:
            "completed",

          paystackStatus:
            payment.status ||
            "success",

          paystackReference:
            reference,

          paidAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          verifiedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      const historyRef =
        db.collection(
          "walletHistory"
        ).doc(
          `credit-${reference}`
        );

      transactionDb.set(
        historyRef,
        {
          uid,

          transactionId:
            transactionRef.id,

          reference,

          type:
            "credit",

          amount:
            expectedAmount,

          balanceAfter:
            newBalance,

          method:
            "paystack",

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return {
        alreadyProcessed:
          false,

        newBalance,

        amount:
          expectedAmount,
      };
    }
  );
}

// ============================================================
// PAYSTACK WEBHOOK
// ============================================================

app.post(
  "/api/payment/webhook",
  async (req, res) => {
    try {
      const secret =
        process.env.PAYSTACK_SECRET_KEY;

      if (!secret) {
        return res
          .status(503)
          .send(
            "Paystack secret key not configured"
          );
      }

      const signature =
        req.headers[
          "x-paystack-signature"
        ];

      if (!signature) {
        return res
          .status(401)
          .send(
            "Missing signature"
          );
      }

      const hash =
        crypto
          .createHmac(
            "sha512",
            secret
          )
          .update(req.body)
          .digest("hex");

      const receivedBuffer =
        Buffer.from(
          String(signature),
          "utf8"
        );

      const expectedBuffer =
        Buffer.from(
          hash,
          "utf8"
        );

      if (
        receivedBuffer.length !==
          expectedBuffer.length ||
        !crypto.timingSafeEqual(
          receivedBuffer,
          expectedBuffer
        )
      ) {
        return res
          .status(401)
          .send(
            "Invalid signature"
          );
      }

      const event =
        JSON.parse(
          req.body.toString(
            "utf8"
          )
        );

      if (
        event.event !==
        "charge.success"
      ) {
        return res.json({
          success: true,

          ignored: true,
        });
      }

      const reference =
        event?.data?.reference;

      if (!reference) {
        return res.json({
          success: true,

          ignored: true,
        });
      }

      await processSuccessfulPayment(
        reference,
        event.data
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "PAYSTACK WEBHOOK ERROR:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Webhook processing failed",
      });
    }
  }
);

// ============================================================
// PAYSTACK INITIALIZE
// ============================================================

app.post(
  "/api/payment/initialize",
  requireFirebaseAuth,
  checkPaystack,
  async (req, res) => {
    try {
      const {
        uid,
        email,
        amount,
      } = req.body;

      if (
        !uid ||
        uid !==
          req.user.uid
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Unauthorized user",
        });
      }

      const cleanEmail =
        cleanString(
          email
        );

      const fundingAmount =
        toMoney(amount);

      if (
        !isValidEmail(
          cleanEmail
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Valid email is required",
        });
      }

      if (
        fundingAmount <
        MINIMUM_FUNDING_AMOUNT
      ) {
        return res.status(400).json({
          success: false,

          message:
            `Minimum funding amount is ₦${MINIMUM_FUNDING_AMOUNT}`,
        });
      }

      const reference =
        generateRequestId(
          "FUND"
        );

      const response =
        await axios.post(
          `${PAYSTACK_BASE_URL}/transaction/initialize`,
          {
            email:
              cleanEmail,

            amount:
              Math.round(
                fundingAmount *
                  100
              ),

            reference,

            metadata: {
              uid,

              purpose:
                "wallet_funding",
            },

            callback_url:
              process.env
                .PAYSTACK_CALLBACK_URL ||
              undefined,
          },
          {
            headers:
              paystackHeaders(),

            timeout:
              30000,
          }
        );

      await db
        .collection(
          "walletTransactions"
        )
        .doc(reference)
        .set({
          uid,

          userId:
            uid,

          reference,

          amount:
            fundingAmount,

          currency:
            "NGN",

          status:
            "pending",

          fundingMethod:
            "online",

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        });

      return res.json({
        success: true,

        reference,

        authorization_url:
          response.data
            ?.data
            ?.authorization_url,

        access_code:
          response.data
            ?.data
            ?.access_code,
      });
    } catch (error) {
      console.error(
        "PAYSTACK INITIALIZE ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// PAYSTACK VERIFY
// ============================================================

app.get(
  "/api/payment/verify/:reference",
  requireFirebaseAuth,
  checkPaystack,
  async (req, res) => {
    try {
      const reference =
        cleanString(
          req.params.reference
        );

      if (!reference) {
        return res.status(400).json({
          success: false,

          message:
            "Payment reference is required",
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
            "Funding transaction not found",
        });
      }

      const transaction =
        snapshot.docs[0]
          .data();

      const uid =
        transaction.uid ||
        transaction.userId;

      if (
        uid !==
        req.user.uid
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Unauthorized transaction",
        });
      }

      const response =
        await axios.get(
          `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(
            reference
          )}`,
          {
            headers:
              paystackHeaders(),

            timeout:
              30000,
          }
        );

      const payment =
        response.data?.data;

      if (
        payment?.status ===
        "success"
      ) {
        const result =
          await processSuccessfulPayment(
            reference,
            payment
          );

        return res.json({
          success: true,

          status:
            "success",

          result,
        });
      }

      return res.json({
        success: true,

        status:
          payment?.status ||
          "pending",

        payment,
      });
    } catch (error) {
      console.error(
        "PAYSTACK VERIFY ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// PAYMENT STATUS
// ============================================================

app.get(
  "/api/payment/status/:reference",
  requireFirebaseAuth,
  async (req, res) => {
    try {
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
            "Funding transaction not found",
        });
      }

      const transaction =
        snapshot.docs[0]
          .data();

      const uid =
        transaction.uid ||
        transaction.userId;

      if (
        uid !==
        req.user.uid
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Unauthorized transaction",
        });
      }

      return res.json({
        success: true,

        transaction:
          formatFirestoreData(
            transaction
          ),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// SUPPORT AGENTS
// ============================================================

const SUPPORT_AGENTS = {
  wale: {
    id:
      "wale",

    name:
      "Wale",

    role:
      "Customer Support Agent",

    style:
      "Friendly, calm, professional and helpful.",
  },

  "led/s": {
    id:
      "led/s",

    name:
      "LED/S",

    role:
      "Senior Customer Support Agent",

    style:
      "Professional, concise, technical and solution-focused.",
  },
};

async function supportBuildContext(
  uid
) {
  const {
    userData,
  } = await getUser(uid);

  if (!userData) {
    return {
      customer:
        null,

      wallet:
        null,

      recentTransactions:
        [],
    };
  }

  const transactions =
    await db
      .collection(
        "serviceTransactions"
      )
      .where(
        "uid",
        "==",
        uid
      )
      .limit(20)
      .get();

  return {
    customer: {
      uid,

      name:
        userData.name ||
        userData.displayName ||
        "",

      walletBalance:
        toMoney(
          userData.walletBalance ||
            0
        ),
    },

    wallet: {
      walletBalance:
        toMoney(
          userData.walletBalance ||
            0
        ),
    },

    recentTransactions:
      transactions.docs
        .map(
          (doc) => ({
            id:
              doc.id,

            ...formatFirestoreData(
              doc.data()
            ),
          })
        )
        .sort(
          (a, b) => {
            const aTime =
              a.createdAt
                ? new Date(
                    a.createdAt
                  ).getTime()
                : 0;

            const bTime =
              b.createdAt
                ? new Date(
                    b.createdAt
                  ).getTime()
                : 0;

            return (
              bTime -
              aTime
            );
          }
        ),
  };
}

app.get(
  "/api/support/agents",
  requireFirebaseAuth,
  async (req, res) => {
    return res.json({
      success: true,

      agents:
        Object.values(
          SUPPORT_AGENTS
        ),
    });
  }
);

// ============================================================
// AI SUPPORT
// ============================================================

function checkAI(
  req,
  res,
  next
) {
  if (
    !process.env.OPENAI_API_KEY
  ) {
    return res.status(503).json({
      success: false,

      message:
        "AI support is not configured",
    });
  }

  next();
}

const SUPPORT_SYSTEM_PROMPT = `
You are the official AI customer support assistant
for ISMAIL DEEN DATA.

You help customers with:

- Wallet balance
- Wallet funding
- Paystack
- Data
- Airtime
- Electricity
- Cable TV
- Transaction status
- Failed transactions
- Pending transactions

IMPORTANT:

1. Only use backend context.
2. Never invent transaction status.
3. Never invent payment confirmation.
4. Never change wallet balance.
5. Never debit wallet.
6. Never credit wallet.
7. Never issue refunds yourself.
8. Never expose API keys.
9. Never expose Firebase credentials.
10. Never expose internal secrets.
11. If transaction is pending, say pending.
12. If transaction failed and backend says refunded, explain that.
13. If backend information is insufficient, recommend human support.
14. Answer in Hausa when the customer uses Hausa.
15. Keep answers simple.
16. You are READ-ONLY.
`;

async function generateAIResponse({
  agent,
  message,
  context,
}) {
  const selected =
    SUPPORT_AGENTS[
      agent
    ] ||
    SUPPORT_AGENTS.wale;

  const input = `
Agent:
${selected.name}

Role:
${selected.role}

Style:
${selected.style}

Backend context:
${JSON.stringify(
  context,
  null,
  2
)}

Customer:
${message}
`;

  const response =
    await axios.post(
      `${OPENAI_BASE_URL}/responses`,
      {
        model:
          OPENAI_MODEL,

        instructions:
          SUPPORT_SYSTEM_PROMPT,

        input,

        max_output_tokens:
          700,
      },
      {
        headers: {
          Authorization:
            `Bearer ${process.env.OPENAI_API_KEY}`,

          "Content-Type":
            "application/json",
        },

        timeout:
          60000,
      }
    );

  let text =
    response.data
      ?.output_text ||
    "";

  if (!text) {
    const output =
      response.data
        ?.output || [];

    const parts = [];

    for (
      const item of
      output
    ) {
      if (
        item.type ===
        "message"
      ) {
        for (
          const content of
          item.content ||
          []
        ) {
          if (
            content.type ===
              "output_text" &&
            content.text
          ) {
            parts.push(
              content.text
            );
          }
        }
      }
    }

    text =
      parts.join(
        "\n"
      );
  }

  if (!text) {
    throw new Error(
      "AI returned empty response"
    );
  }

  return text.trim();
}

// ============================================================
// AI SUPPORT CHAT
// ============================================================

app.post(
  "/api/support/chat",
  requireFirebaseAuth,
  checkAI,
  async (req, res) => {
    try {
      const message =
        cleanString(
          req.body.message
        );

      const agent =
        SUPPORT_AGENTS[
          req.body.agent
        ]
          ? req.body.agent
          : "wale";

      if (!message) {
        return res.status(400).json({
          success: false,

          message:
            "Customer message is required",
        });
      }

      const context =
        await supportBuildContext(
          req.user.uid
        );

      const reply =
        await generateAIResponse({
          agent,

          message,

          context,
        });

      return res.json({
        success: true,

        agent:
          SUPPORT_AGENTS[
            agent
          ],

        reply,

        context: {
          walletBalance:
            context.wallet
              ?.walletBalance ||
            0,

          recentTransactions:
            context.recentTransactions,
        },
      });
    } catch (error) {
      console.error(
        "AI SUPPORT ERROR:",
        error?.response
          ?.data || error
      );

      return res.status(500).json({
        success: false,

        message:
          "AI support is temporarily unavailable",
      });
    }
  }
);

// ============================================================
// SUPPORT ESCALATION
// ============================================================

app.post(
  "/api/support/escalate",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const ref =
        db.collection(
          "supportEscalations"
        ).doc();

      await ref.set({
        uid:
          req.user.uid,

        agent:
          req.body.agent ||
          "wale",

        reason:
          cleanString(
            req.body.reason
          ) ||
          "Customer requested human support",

        customerMessage:
          cleanString(
            req.body.message
          ),

        status:
          "open",

        createdAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),

        updatedAt:
          admin.firestore
            .FieldValue
            .serverTimestamp(),
      });

      return res.json({
        success: true,

        message:
          "Support escalation created",

        escalationId:
          ref.id,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      success: true,

      status:
        "online",

      app:
        APP_NAME,

      firebase:
        Boolean(db),

      cheapDataHub:
        Boolean(
          process.env
            .CHEAPDATAHUB_API_KEY
        ),

      paystack:
        Boolean(
          process.env
            .PAYSTACK_SECRET_KEY
        ),

      ai:
        Boolean(
          process.env
            .OPENAI_API_KEY
        ),

      time:
        new Date().toISOString(),
    });
  }
);

// ============================================================
// HOME
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      success: true,

      app:
        APP_NAME,

      message:
        "ISMAIL DEEN DATA backend is running",

      provider:
        "CheapDataHub",

      version:
        "2.0.0",
    });
  }
);

// ============================================================
// FIREBASE TEST
// ============================================================

app.get(
  "/api/firebase/test",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const snapshot =
        await db
          .collection(
            "users"
          )
          .limit(1)
          .get();

      return res.json({
        success: true,

        firebase:
          "connected",

        usersCollectionAccessible:
          true,

        sampleCount:
          snapshot.size,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,

        firebase:
          "error",

        message:
          getErrorMessage(
            error
          ),
      });
    }
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {
    return res.status(404).json({
      success: false,

      message:
        "Route not found",

      path:
        req.originalUrl,
    });
  }
);

// ============================================================
// GLOBAL ERROR
// ============================================================

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

    if (
      res.headersSent
    ) {
      return next(
        error
      );
    }

    return res.status(500).json({
      success: false,

      message:
        "Internal server error",
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      `${APP_NAME} server running on port ${PORT}`
    );

    console.log(
      `Environment: ${
        process.env.NODE_ENV ||
        "development"
      }`
    );

    console.log(
      `CheapDataHub: ${CHEAPDATAHUB_BASE_URL}`
    );

    console.log(
      `AI Model: ${OPENAI_MODEL}`
    );
  }
);
