// ============================================================
// ISMAIL DEEN DATA - FULL SERVER.JS
// Node.js + Express + Firebase Firestore
// Paystack + VTpass + AI Customer Support
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const admin = require("firebase-admin");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 10000);

const VTPASS_BASE_URL =
  process.env.VTPASS_BASE_URL || "https://sandbox.vtpass.com/api";

const PAYSTACK_BASE_URL =
  process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";

const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

const OPENAI_MODEL =
  process.env.OPENAI_MODEL || "gpt-5.6-luna";

const MINIMUM_FUNDING_AMOUNT = Number(
  process.env.MINIMUM_FUNDING_AMOUNT || 100
);

// ============================================================
// BASIC MIDDLEWARE
// ============================================================

app.use(cors());

app.set("trust proxy", 1);

// ============================================================
// HELPERS
// ============================================================

function cleanString(value) {
  return String(value ?? "").trim();
}

function cleanPhone(value) {
  return cleanString(value).replace(/\s+/g, "");
}

function isValidPhone(phone) {
  return /^(0\d{10}|234\d{10})$/.test(phone);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    .randomBytes(5)
    .toString("hex")}`;
}

function getErrorMessage(error) {
  return (
    error?.response?.data?.response_description ||
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Unknown error"
  );
}

function getVTPassErrorStatus(error) {
  return (
    error?.response?.data?.code ||
    error?.response?.data?.response_code ||
    error?.response?.data?.content?.error ||
    null
  );
}

function normalizeSupportStatus(status) {
  const value = cleanString(status).toLowerCase();

  if (!value) return "unknown";

  if (
    ["completed", "successful", "success", "successful_payment"].includes(
      value
    )
  ) {
    return "completed";
  }

  if (
    ["pending", "processing", "provider_pending", "unknown"].includes(value)
  ) {
    return "pending";
  }

  if (["failed", "failure", "cancelled", "canceled"].includes(value)) {
    return "failed";
  }

  return value;
}

function explainSupportStatus(status) {
  const normalized = normalizeSupportStatus(status);

  const explanations = {
    completed: "The transaction was completed successfully.",
    pending:
      "The transaction is still pending or its final provider status has not yet been confirmed.",
    failed: "The transaction failed and should not be treated as completed.",
    unknown:
      "The current status could not be confirmed from the available records.",
  };

  return (
    explanations[normalized] ||
    `The current transaction status is ${normalized}.`
  );
}

function maskPhone(phone) {
  const value = cleanString(phone);

  if (value.length < 7) return value;

  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function maskEmail(email) {
  const value = cleanString(email);

  if (!value.includes("@")) return value;

  const [name, domain] = value.split("@");

  if (name.length <= 2) {
    return `**@${domain}`;
  }

  return `${name.slice(0, 2)}***@${domain}`;
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

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );

    credential = admin.credential.cert(serviceAccount);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    credential = admin.credential.cert(
      require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    );
  } else {
    const defaultPath =
      "/etc/secrets/firebase-service-account.json";

    credential = admin.credential.cert(require(defaultPath));
  }

  admin.initializeApp({
    credential,
  });

  db = admin.firestore();

  console.log("Firebase Admin initialized successfully");
}

initializeFirebase();

// ============================================================
// FIREBASE AUTHENTICATION
// ============================================================

async function requireFirebaseAuth(req, res, next) {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        message: "Firebase is not initialized",
      });
    }

    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token is required",
      });
    }

    const idToken = authHeader.substring(7).trim();

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization token",
      });
    }

    const decodedToken = await admin
      .auth()
      .verifyIdToken(idToken);

    req.user = decodedToken;

    next();
  } catch (error) {
    console.error("AUTH ERROR:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired Firebase authentication token",
    });
  }
}

function requireOwnUid(req, res, next) {
  const requestedUid =
    req.params.uid ||
    req.body?.uid ||
    req.query?.uid;

  if (!requestedUid) {
    return res.status(400).json({
      success: false,
      message: "User ID is required",
    });
  }

  if (!req.user || req.user.uid !== requestedUid) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to access this account",
    });
  }

  next();
}

// ============================================================
// FIREBASE CHECK
// ============================================================

function checkFirebase(res) {
  if (!db) {
    res.status(503).json({
      success: false,
      message: "Firebase is not initialized",
    });

    return false;
  }

  return true;
}

// ============================================================
// USER
// ============================================================

async function getUser(uid) {
  if (!db) {
    throw new Error("Firebase is not initialized");
  }

  const userRef = db.collection("users").doc(uid);
  const snapshot = await userRef.get();

  if (!snapshot.exists) {
    return {
      userRef,
      userData: null,
    };
  }

  return {
    userRef,
    userData: snapshot.data(),
  };
}

// ============================================================
// WALLET HISTORY
// ============================================================

async function saveWalletHistory(
  transaction,
  uid,
  balance,
  type,
  amount,
  extra = {}
) {
  const historyRef = db
    .collection("walletHistory")
    .doc();

  await historyRef.set({
    uid,
    transactionId: transaction.id || null,
    reference:
      transaction.reference ||
      transaction.requestId ||
      null,
    type,
    amount: toMoney(amount),
    balanceAfter: toMoney(balance),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...extra,
  });

  return historyRef.id;
}

// ============================================================
// FIRESTORE FORMATTER
// ============================================================

function formatFirestoreData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const result = { ...data };

  const dateFields = [
    "createdAt",
    "updatedAt",
    "verifiedAt",
    "paidAt",
    "completedAt",
    "failedAt",
    "refundedAt",
  ];

  for (const field of dateFields) {
    if (
      result[field] &&
      typeof result[field].toDate === "function"
    ) {
      result[field] = result[field].toDate().toISOString();
    }
  }

  return result;
}

// ============================================================
// API HEADERS
// ============================================================

function vtpassHeaders() {
  return {
    "Content-Type": "application/json",
    "api-key": process.env.VTPASS_API_KEY,
    "secret-key": process.env.VTPASS_SECRET_KEY,
    "Public-Key": process.env.VTPASS_PUBLIC_KEY || "",
  };
}

function paystackHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

// ============================================================
// API CHECKERS
// ============================================================

function checkVTPassKeys(req, res, next) {
  if (
    !process.env.VTPASS_API_KEY ||
    !process.env.VTPASS_SECRET_KEY
  ) {
    return res.status(503).json({
      success: false,
      message: "VTpass API keys are not configured",
    });
  }

  next();
}

function checkPaystackKey(req, res, next) {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(503).json({
      success: false,
      message: "Paystack secret key is not configured",
    });
  }

  next();
}

function checkAIKey(req, res, next) {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      success: false,
      message: "AI support is not configured",
    });
  }

  next();
}

// ============================================================
// SERVICE IDs
// ============================================================

const DATA_SERVICE_IDS = {
  mtn: "mtn-data",
  airtel: "airtel-data",
  glo: "glo-data",
  "9mobile": "etisalat-data",
  etisalat: "etisalat-data",
};

const AIRTIME_SERVICE_IDS = {
  mtn: "mtn",
  airtel: "airtel",
  glo: "glo",
  "9mobile": "etisalat",
  etisalat: "etisalat",
};

const ELECTRICITY_SERVICE_IDS = {
  abuja: "abuja-electric",
  benin: "benin-electric",
  eko: "eko-electric",
  enugu: "enugu-electric",
  ibadan: "ibadan-electric",
  ikeja: "ikeja-electric",
  jos: "jos-electric",
  kaduna: "kaduna-electric",
  kano: "kano-electric",
  yola: "yola-electric",
};

const CABLE_SERVICE_IDS = {
  dstv: "dstv",
  gotv: "gotv",
  startimes: "startimes",
};

// ============================================================
// PAYSTACK SUCCESS PROCESSOR
// ============================================================

async function processSuccessfulPaystackPayment(
  reference,
  payment
) {
  if (!db) {
    throw new Error("Firebase is not initialized");
  }

  const snapshot = await db
    .collection("walletTransactions")
    .where("reference", "==", reference)
    .limit(1)
    .get();

  if (snapshot.empty) {
    throw new Error(
      `Wallet funding transaction not found: ${reference}`
    );
  }

  const transactionDoc = snapshot.docs[0];
  const transactionRef = transactionDoc.ref;
  const transaction = transactionDoc.data();

  const uid = transaction.uid || transaction.userId;

  if (!uid) {
    throw new Error(
      "Wallet funding transaction has no user ID"
    );
  }

  const paidAmount = Number(payment.amount || 0) / 100;
  const expectedAmount = Number(transaction.amount || 0);

  if (Math.round(paidAmount * 100) !== Math.round(expectedAmount * 100)) {
    throw new Error(
      `Payment amount mismatch for ${reference}`
    );
  }

  const currency = cleanString(
    payment.currency || transaction.currency || "NGN"
  ).toUpperCase();

  if (currency !== "NGN") {
    throw new Error("Only NGN wallet funding is supported");
  }

  return await db.runTransaction(async (firestoreTransaction) => {
    const freshTransaction =
      await firestoreTransaction.get(transactionRef);

    const freshData = freshTransaction.data() || {};

    if (freshData.status === "completed") {
      const userRef = db.collection("users").doc(uid);
      const userSnapshot =
        await firestoreTransaction.get(userRef);

      const currentUser = userSnapshot.data() || {};

      return {
        alreadyProcessed: true,
        newBalance: Number(currentUser.walletBalance || 0),
        amount: expectedAmount,
        uid,
      };
    }

    const userRef = db.collection("users").doc(uid);

    const userSnapshot =
      await firestoreTransaction.get(userRef);

    if (!userSnapshot.exists) {
      throw new Error("User account not found");
    }

    const userData = userSnapshot.data() || {};

    const currentBalance = Number(
      userData.walletBalance || 0
    );

    const newBalance =
      currentBalance + expectedAmount;

    firestoreTransaction.update(userRef, {
      walletBalance: newBalance,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    firestoreTransaction.update(transactionRef, {
      status: "completed",
      fundingMethod: "online",
      paystackStatus: payment.status || "success",
      paystackReference: reference,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const historyRef = db
      .collection("walletHistory")
      .doc(reference);

    firestoreTransaction.set(
      historyRef,
      {
        uid,
        transactionId: transactionRef.id,
        reference,
        type: "credit",
        amount: expectedAmount,
        balanceAfter: newBalance,
        method: "paystack",
        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return {
      alreadyProcessed: false,
      newBalance,
      amount: expectedAmount,
      uid,
    };
  });
}

// ============================================================
// PAYSTACK WEBHOOK
// IMPORTANT: RAW BODY MUST COME BEFORE express.json()
// ============================================================

app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return res.sendStatus(200);
      }

      const signature =
        req.headers["x-paystack-signature"];

      if (!signature) {
        return res.status(401).send("Missing signature");
      }

      const hash = crypto
        .createHmac(
          "sha512",
          process.env.PAYSTACK_SECRET_KEY
        )
        .update(req.body)
        .digest("hex");

      if (hash !== signature) {
        return res.status(401).send("Invalid signature");
      }

      const event = JSON.parse(
        req.body.toString("utf8")
      );

      if (event.event !== "charge.success") {
        return res.status(200).json({
          success: true,
          ignored: true,
        });
      }

      const reference = event?.data?.reference;

      if (!reference) {
        return res.status(200).json({
          success: true,
          ignored: true,
        });
      }

      await processSuccessfulPaystackPayment(
        reference,
        event.data
      );

      return res.status(200).json({
        success: true,
      });
    } catch (error) {
      console.error("PAYSTACK WEBHOOK ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Webhook processing failed",
      });
    }
  }
);

// ============================================================
// JSON BODY PARSER
// ============================================================

app.use(
  express.json({
    limit: "1mb",
  })
);

// ============================================================
// WALLET ROUTES
// ============================================================

// Balance
app.get(
  "/api/wallet/balance/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) return;

      const { userData } = await getUser(req.params.uid);

      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.json({
        success: true,
        balance: toMoney(
          userData.walletBalance || 0
        ),
      });
    } catch (error) {
      console.error("BALANCE ERROR:", error);

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// Wallet details
app.get(
  "/api/wallet/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) return;

      const { userData } = await getUser(req.params.uid);

      if (!userData) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.json({
        success: true,
        user: {
          uid: req.params.uid,
          name:
            userData.name ||
            userData.displayName ||
            "",
          email: userData.email || "",
          phone: userData.phone || "",
          walletBalance: toMoney(
            userData.walletBalance || 0
          ),
        },
      });
    } catch (error) {
      console.error("WALLET DETAILS ERROR:", error);

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// Wallet history
app.get(
  "/api/wallet/:uid/history",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) return;

      const snapshot = await db
        .collection("walletHistory")
        .where("uid", "==", req.params.uid)
        .limit(100)
        .get();

      const history = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...formatFirestoreData(doc.data()),
        }))
        .sort((a, b) => {
          const aTime = a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;

          const bTime = b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;

          return bTime - aTime;
        });

      return res.json({
        success: true,
        history,
      });
    } catch (error) {
      console.error("WALLET HISTORY ERROR:", error);

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// Wallet chart
app.get(
  "/api/wallet/:uid/chart",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) return;

      const snapshot = await db
        .collection("walletHistory")
        .where("uid", "==", req.params.uid)
        .limit(100)
        .get();

      const chart = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...formatFirestoreData(doc.data()),
        }))
        .sort((a, b) => {
          const aTime = a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;

          const bTime = b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;

          return aTime - bTime;
        });

      return res.json({
        success: true,
        chart,
      });
    } catch (error) {
      console.error("WALLET CHART ERROR:", error);

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// Wallet transactions
app.get(
  "/api/wallet/:uid/transactions",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) return;

      const snapshot = await db
        .collection("walletTransactions")
        .where("uid", "==", req.params.uid)
        .limit(100)
        .get();

      const transactions = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...formatFirestoreData(doc.data()),
        }))
        .sort((a, b) => {
          const aTime = a.createdAt
            ? new Date(a.createdAt).getTime()
            : 0;

          const bTime = b.createdAt
            ? new Date(b.createdAt).getTime()
            : 0;

          return bTime - aTime;
        });

      return res.json({
        success: true,
        transactions,
      });
    } catch (error) {
      console.error(
        "WALLET TRANSACTIONS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// VTPASS PLAN HELPERS
// ============================================================

async function getDataPlanPrice(
  serviceID,
  variationCode
) {
  const response = await axios.get(
    `${VTPASS_BASE_URL}/service-variations`,
    {
      params: {
        serviceID,
      },
      headers: vtpassHeaders(),
      timeout: 20000,
    }
  );

  const variations =
    response.data?.content?.varations ||
    response.data?.content?.variations ||
    [];

  const variation = variations.find(
    (item) =>
      String(item.variation_code) ===
      String(variationCode)
  );

  return variation || null;
}

async function getCablePlanPrice(
  serviceID,
  variationCode
) {
  const response = await axios.get(
    `${VTPASS_BASE_URL}/service-variations`,
    {
      params: {
        serviceID,
      },
      headers: vtpassHeaders(),
      timeout: 20000,
    }
  );

  const variations =
    response.data?.content?.varations ||
    response.data?.content?.variations ||
    [];

  return (
    variations.find(
      (item) =>
        String(item.variation_code) ===
        String(variationCode)
    ) || null
  );
}

// ============================================================
// DATA PLANS
// ============================================================

app.get(
  "/api/vtpass/data-plans/:network",
  requireFirebaseAuth,
  checkVTPassKeys,
  async (req, res) => {
    try {
      const network =
        cleanString(req.params.network).toLowerCase();

      const serviceID =
        DATA_SERVICE_IDS[network];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported network",
        });
      }

      const response = await axios.get(
        `${VTPASS_BASE_URL}/service-variations`,
        {
          params: {
            serviceID,
          },
          headers: vtpassHeaders(),
          timeout: 20000,
        }
      );

      return res.json({
        success: true,
        serviceID,
        data:
          response.data?.content
            ?.varations ||
          response.data?.content
            ?.variations ||
          [],
      });
    } catch (error) {
      console.error(
        "DATA PLANS ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// CABLE PLANS
// ============================================================

app.get(
  "/api/vtpass/cable-plans/:provider",
  requireFirebaseAuth,
  checkVTPassKeys,
  async (req, res) => {
    try {
      const provider =
        cleanString(req.params.provider).toLowerCase();

      const serviceID =
        CABLE_SERVICE_IDS[provider];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported cable provider",
        });
      }

      const response = await axios.get(
        `${VTPASS_BASE_URL}/service-variations`,
        {
          params: {
            serviceID,
          },
          headers: vtpassHeaders(),
          timeout: 20000,
        }
      );

      return res.json({
        success: true,
        serviceID,
        data:
          response.data?.content
            ?.varations ||
          response.data?.content
            ?.variations ||
          [],
      });
    } catch (error) {
      console.error(
        "CABLE PLANS ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// WALLET PURCHASE ENGINE
// ============================================================

async function reserveWalletPurchase({
  uid,
  requestId,
  amount,
  type,
  serviceID,
  metadata = {},
}) {
  const transactionRef = db
    .collection("serviceTransactions")
    .doc(requestId);

  const userRef = db
    .collection("users")
    .doc(uid);

  const result = await db.runTransaction(
    async (transaction) => {
      const existing =
        await transaction.get(transactionRef);

      if (existing.exists) {
        return {
          alreadyExists: true,
          transactionRef,
          data: existing.data(),
        };
      }

      const userSnapshot =
        await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new Error("User account not found");
      }

      const userData = userSnapshot.data() || {};

      const balance = Number(
        userData.walletBalance || 0
      );

      const purchaseAmount = toMoney(amount);

      if (balance < purchaseAmount) {
        throw new Error("Insufficient wallet balance");
      }

      const newBalance =
        toMoney(balance - purchaseAmount);

      transaction.update(userRef, {
        walletBalance: newBalance,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.set(transactionRef, {
        uid,
        requestId,
        amount: purchaseAmount,
        type,
        serviceID,
        status: "provider_pending",
        previousBalance: balance,
        balanceAfterDebit: newBalance,
        metadata,
        createdAt:
          admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        alreadyExists: false,
        transactionRef,
        data: {
          uid,
          requestId,
          amount: purchaseAmount,
          type,
          serviceID,
          status: "provider_pending",
          previousBalance: balance,
          balanceAfterDebit: newBalance,
          metadata,
        },
      };
    }
  );

  return result;
}

// ============================================================
// COMPLETE PURCHASE
// ============================================================

async function markPurchaseCompleted(
  requestId,
  providerResponse
) {
  const transactionRef = db
    .collection("serviceTransactions")
    .doc(requestId);

  await transactionRef.update({
    status: "completed",
    providerResponse,
    completedAt:
      admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:
      admin.firestore.FieldValue.serverTimestamp(),
  });

  const snapshot =
    await transactionRef.get();

  return snapshot.data();
}

// ============================================================
// REFUND FAILED PURCHASE
// ============================================================

async function refundFailedPurchase(
  requestId,
  reason,
  providerResponse = null
) {
  const transactionRef = db
    .collection("serviceTransactions")
    .doc(requestId);

  return await db.runTransaction(
    async (transaction) => {
      const serviceSnapshot =
        await transaction.get(transactionRef);

      if (!serviceSnapshot.exists) {
        throw new Error(
          "Service transaction not found"
        );
      }

      const serviceTransaction =
        serviceSnapshot.data();

      if (
        serviceTransaction.status ===
          "refunded" ||
        serviceTransaction.status ===
          "completed"
      ) {
        return serviceTransaction;
      }

      const uid = serviceTransaction.uid;

      const amount = Number(
        serviceTransaction.amount || 0
      );

      const userRef = db
        .collection("users")
        .doc(uid);

      const userSnapshot =
        await transaction.get(userRef);

      if (!userSnapshot.exists) {
        throw new Error("User not found");
      }

      const userData =
        userSnapshot.data() || {};

      const currentBalance = Number(
        userData.walletBalance || 0
      );

      const newBalance =
        toMoney(currentBalance + amount);

      transaction.update(userRef, {
        walletBalance: newBalance,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(transactionRef, {
        status: "refunded",
        refundReason: reason,
        providerResponse,
        refundedAt:
          admin.firestore.FieldValue.serverTimestamp(),
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
        balanceAfterRefund: newBalance,
      });

      const historyRef = db
        .collection("walletHistory")
        .doc(`refund-${requestId}`);

      transaction.set(
        historyRef,
        {
          uid,
          transactionId: requestId,
          reference: requestId,
          type: "refund",
          amount,
          balanceAfter: newBalance,
          reason,
          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        ...serviceTransaction,
        status: "refunded",
        balanceAfterRefund: newBalance,
      };
    }
  );
}

// ============================================================
// BUY DATA
// ============================================================

app.post(
  "/api/vtpass/buy-data",
  requireFirebaseAuth,
  requireOwnUid,
  checkVTPassKeys,
  async (req, res) => {
    try {
      const {
        uid,
        network,
        phone,
        variation_code,
        amount,
        request_id,
      } = req.body;

      const cleanNetwork =
        cleanString(network).toLowerCase();

      const cleanPhoneNumber =
        cleanPhone(phone);

      const serviceID =
        DATA_SERVICE_IDS[cleanNetwork];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported network",
        });
      }

      if (!isValidPhone(cleanPhoneNumber)) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number",
        });
      }

      const purchaseAmount = toMoney(amount);

      if (purchaseAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid amount",
        });
      }

      const requestId =
        cleanString(request_id) ||
        generateRequestId("DATA");

      const reserved =
        await reserveWalletPurchase({
          uid,
          requestId,
          amount: purchaseAmount,
          type: "data",
          serviceID,
          metadata: {
            network: cleanNetwork,
            phone: cleanPhoneNumber,
            variation_code,
          },
        });

      if (reserved.alreadyExists) {
        return res.json({
          success:
            reserved.data.status === "completed",
          message:
            "This request has already been processed",
          transaction: formatFirestoreData(
            reserved.data
          ),
        });
      }

      const payload = {
        request_id: requestId,
        serviceID,
        billersCode: cleanPhoneNumber,
        variation_code,
        amount: purchaseAmount,
        phone: cleanPhoneNumber,
      };

      let providerResponse;

      try {
        const response = await axios.post(
          `${VTPASS_BASE_URL}/pay`,
          payload,
          {
            headers: vtpassHeaders(),
            timeout: 60000,
          }
        );

        providerResponse =
          response.data;
      } catch (providerError) {
        providerResponse =
          providerError?.response?.data || {
            error: getErrorMessage(providerError),
          };
      }

      const providerCode =
        String(
          providerResponse?.code ||
            providerResponse?.response_code ||
            ""
        );

      if (providerCode === "000") {
        const completed =
          await markPurchaseCompleted(
            requestId,
            providerResponse
          );

        return res.json({
          success: true,
          message: "Data purchase successful",
          requestId,
          transaction:
            formatFirestoreData(completed),
          provider: providerResponse,
        });
      }

      await refundFailedPurchase(
        requestId,
        "VTpass reported a failed transaction",
        providerResponse
      );

      return res.status(400).json({
        success: false,
        message:
          providerResponse?.response_description ||
          "Data purchase failed. Wallet has been refunded.",
        requestId,
        provider: providerResponse,
      });
    } catch (error) {
      console.error(
        "BUY DATA ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// BUY AIRTIME
// ============================================================

app.post(
  "/api/vtpass/buy-airtime",
  requireFirebaseAuth,
  requireOwnUid,
  checkVTPassKeys,
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
        cleanString(network).toLowerCase();

      const cleanPhoneNumber =
        cleanPhone(phone);

      const serviceID =
        AIRTIME_SERVICE_IDS[cleanNetwork];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported network",
        });
      }

      if (!isValidPhone(cleanPhoneNumber)) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number",
        });
      }

      const purchaseAmount = toMoney(amount);

      if (purchaseAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid amount",
        });
      }

      const requestId =
        cleanString(request_id) ||
        generateRequestId("AIRTIME");

      const reserved =
        await reserveWalletPurchase({
          uid,
          requestId,
          amount: purchaseAmount,
          type: "airtime",
          serviceID,
          metadata: {
            network: cleanNetwork,
            phone: cleanPhoneNumber,
          },
        });

      if (reserved.alreadyExists) {
        return res.json({
          success:
            reserved.data.status === "completed",
          message:
            "This request has already been processed",
          transaction: formatFirestoreData(
            reserved.data
          ),
        });
      }

      const payload = {
        request_id: requestId,
        serviceID,
        amount: purchaseAmount,
        phone: cleanPhoneNumber,
      };

      let providerResponse;

      try {
        const response = await axios.post(
          `${VTPASS_BASE_URL}/pay`,
          payload,
          {
            headers: vtpassHeaders(),
            timeout: 60000,
          }
        );

        providerResponse =
          response.data;
      } catch (providerError) {
        providerResponse =
          providerError?.response?.data || {
            error: getErrorMessage(providerError),
          };
      }

      const providerCode =
        String(
          providerResponse?.code ||
            providerResponse?.response_code ||
            ""
        );

      if (providerCode === "000") {
        const completed =
          await markPurchaseCompleted(
            requestId,
            providerResponse
          );

        return res.json({
          success: true,
          message: "Airtime purchase successful",
          requestId,
          transaction:
            formatFirestoreData(completed),
          provider: providerResponse,
        });
      }

      await refundFailedPurchase(
        requestId,
        "VTpass reported a failed transaction",
        providerResponse
      );

      return res.status(400).json({
        success: false,
        message:
          providerResponse?.response_description ||
          "Airtime purchase failed. Wallet has been refunded.",
        requestId,
        provider: providerResponse,
      });
    } catch (error) {
      console.error(
        "BUY AIRTIME ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// BUY ELECTRICITY
// ============================================================

app.post(
  "/api/vtpass/buy-electricity",
  requireFirebaseAuth,
  requireOwnUid,
  checkVTPassKeys,
  async (req, res) => {
    try {
      const {
        uid,
        disco,
        meter_number,
        variation_code,
        amount,
        phone,
        request_id,
      } = req.body;

      const cleanDisco =
        cleanString(disco).toLowerCase();

      const serviceID =
        ELECTRICITY_SERVICE_IDS[cleanDisco];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported electricity provider",
        });
      }

      if (!cleanString(meter_number)) {
        return res.status(400).json({
          success: false,
          message: "Meter number is required",
        });
      }

      const purchaseAmount = toMoney(amount);

      if (purchaseAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid amount",
        });
      }

      const requestId =
        cleanString(request_id) ||
        generateRequestId("ELECTRIC");

      const reserved =
        await reserveWalletPurchase({
          uid,
          requestId,
          amount: purchaseAmount,
          type: "electricity",
          serviceID,
          metadata: {
            disco: cleanDisco,
            meter_number: cleanString(
              meter_number
            ),
            variation_code,
            phone: cleanPhone(phone),
          },
        });

      if (reserved.alreadyExists) {
        return res.json({
          success:
            reserved.data.status === "completed",
          message:
            "This request has already been processed",
          transaction: formatFirestoreData(
            reserved.data
          ),
        });
      }

      const payload = {
        request_id: requestId,
        serviceID,
        billersCode: cleanString(
          meter_number
        ),
        variation_code,
        amount: purchaseAmount,
        phone:
          cleanPhone(phone) ||
          "08000000000",
      };

      let providerResponse;

      try {
        const response = await axios.post(
          `${VTPASS_BASE_URL}/pay`,
          payload,
          {
            headers: vtpassHeaders(),
            timeout: 60000,
          }
        );

        providerResponse =
          response.data;
      } catch (providerError) {
        providerResponse =
          providerError?.response?.data || {
            error: getErrorMessage(providerError),
          };
      }

      const providerCode =
        String(
          providerResponse?.code ||
            providerResponse?.response_code ||
            ""
        );

      if (providerCode === "000") {
        const completed =
          await markPurchaseCompleted(
            requestId,
            providerResponse
          );

        return res.json({
          success: true,
          message:
            "Electricity purchase successful",
          requestId,
          transaction:
            formatFirestoreData(completed),
          provider: providerResponse,
        });
      }

      await refundFailedPurchase(
        requestId,
        "VTpass reported a failed transaction",
        providerResponse
      );

      return res.status(400).json({
        success: false,
        message:
          providerResponse?.response_description ||
          "Electricity purchase failed. Wallet has been refunded.",
        requestId,
        provider: providerResponse,
      });
    } catch (error) {
      console.error(
        "BUY ELECTRICITY ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// VALIDATE CABLE
// ============================================================

app.post(
  "/api/vtpass/validate-cable",
  requireFirebaseAuth,
  checkVTPassKeys,
  async (req, res) => {
    try {
      const {
        provider,
        smartcard_number,
      } = req.body;

      const cleanProvider =
        cleanString(provider).toLowerCase();

      const serviceID =
        CABLE_SERVICE_IDS[cleanProvider];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported cable provider",
        });
      }

      if (!cleanString(smartcard_number)) {
        return res.status(400).json({
          success: false,
          message: "Smartcard number is required",
        });
      }

      const requestId =
        generateRequestId("CABLEVALIDATE");

      const response = await axios.post(
        `${VTPASS_BASE_URL}/merchant-verify`,
        {
          billersCode: cleanString(
            smartcard_number
          ),
          serviceID,
          type: "smartcard",
        },
        {
          headers: vtpassHeaders(),
          timeout: 30000,
        }
      );

      return res.json({
        success: true,
        requestId,
        provider: response.data,
      });
    } catch (error) {
      console.error(
        "VALIDATE CABLE ERROR:",
        error?.response?.data || error
      );

      return res.status(400).json({
        success: false,
        message: getErrorMessage(error),
        provider:
          error?.response?.data || null,
      });
    }
  }
);

// ============================================================
// BUY CABLE
// ============================================================

app.post(
  "/api/vtpass/buy-cable",
  requireFirebaseAuth,
  requireOwnUid,
  checkVTPassKeys,
  async (req, res) => {
    try {
      const {
        uid,
        provider,
        smartcard_number,
        variation_code,
        amount,
        phone,
        request_id,
      } = req.body;

      const cleanProvider =
        cleanString(provider).toLowerCase();

      const serviceID =
        CABLE_SERVICE_IDS[cleanProvider];

      if (!serviceID) {
        return res.status(400).json({
          success: false,
          message: "Unsupported cable provider",
        });
      }

      if (!cleanString(smartcard_number)) {
        return res.status(400).json({
          success: false,
          message: "Smartcard number is required",
        });
      }

      const purchaseAmount = toMoney(amount);

      if (purchaseAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid amount",
        });
      }

      const requestId =
        cleanString(request_id) ||
        generateRequestId("CABLE");

      const reserved =
        await reserveWalletPurchase({
          uid,
          requestId,
          amount: purchaseAmount,
          type: "cable",
          serviceID,
          metadata: {
            provider: cleanProvider,
            smartcard_number:
              cleanString(smartcard_number),
            variation_code,
            phone: cleanPhone(phone),
          },
        });

      if (reserved.alreadyExists) {
        return res.json({
          success:
            reserved.data.status === "completed",
          message:
            "This request has already been processed",
          transaction: formatFirestoreData(
            reserved.data
          ),
        });
      }

      const payload = {
        request_id: requestId,
        serviceID,
        billersCode: cleanString(
          smartcard_number
        ),
        variation_code,
        amount: purchaseAmount,
        phone:
          cleanPhone(phone) ||
          "08000000000",
      };

      let providerResponse;

      try {
        const response = await axios.post(
          `${VTPASS_BASE_URL}/pay`,
          payload,
          {
            headers: vtpassHeaders(),
            timeout: 60000,
          }
        );

        providerResponse =
          response.data;
      } catch (providerError) {
        providerResponse =
          providerError?.response?.data || {
            error: getErrorMessage(providerError),
          };
      }

      const providerCode =
        String(
          providerResponse?.code ||
            providerResponse?.response_code ||
            ""
        );

      if (providerCode === "000") {
        const completed =
          await markPurchaseCompleted(
            requestId,
            providerResponse
          );

        return res.json({
          success: true,
          message: "Cable purchase successful",
          requestId,
          transaction:
            formatFirestoreData(completed),
          provider: providerResponse,
        });
      }

      await refundFailedPurchase(
        requestId,
        "VTpass reported a failed transaction",
        providerResponse
      );

      return res.status(400).json({
        success: false,
        message:
          providerResponse?.response_description ||
          "Cable purchase failed. Wallet has been refunded.",
        requestId,
        provider: providerResponse,
      });
    } catch (error) {
      console.error(
        "BUY CABLE ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
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
  checkPaystackKey,
  async (req, res) => {
    try {
      const {
        email,
        uid,
        amount,
      } = req.body;

      if (!uid || req.user.uid !== uid) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized user",
        });
      }

      const cleanEmail =
        cleanString(email);

      const fundingAmount =
        toMoney(amount);

      if (!isValidEmail(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: "Valid email is required",
        });
      }

      if (
        fundingAmount <
        MINIMUM_FUNDING_AMOUNT
      ) {
        return res.status(400).json({
          success: false,
          message: `Minimum funding amount is ₦${MINIMUM_FUNDING_AMOUNT}`,
        });
      }

      const reference =
        generateRequestId("FUND");

      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          email: cleanEmail,
          amount: Math.round(
            fundingAmount * 100
          ),
          reference,
          metadata: {
            uid,
            purpose: "wallet_funding",
          },
          callback_url:
            process.env.PAYSTACK_CALLBACK_URL ||
            undefined,
        },
        {
          headers: paystackHeaders(),
          timeout: 30000,
        }
      );

      await db
        .collection("walletTransactions")
        .doc(reference)
        .set({
          uid,
          userId: uid,
          reference,
          amount: fundingAmount,
          currency: "NGN",
          status: "pending",
          fundingMethod: "online",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });

      return res.json({
        success: true,
        reference,
        authorization_url:
          response.data?.data?.authorization_url,
        access_code:
          response.data?.data?.access_code,
      });
    } catch (error) {
      console.error(
        "PAYSTACK INITIALIZE ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
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
  checkPaystackKey,
  async (req, res) => {
    try {
      const reference =
        cleanString(req.params.reference);

      const snapshot = await db
        .collection("walletTransactions")
        .where("reference", "==", reference)
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
        snapshot.docs[0].data();

      const uid =
        transaction.uid ||
        transaction.userId;

      if (uid !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized transaction",
        });
      }

      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(
          reference
        )}`,
        {
          headers: paystackHeaders(),
          timeout: 30000,
        }
      );

      const payment =
        response.data?.data;

      if (
        response.data?.status &&
        payment?.status === "success"
      ) {
        const result =
          await processSuccessfulPaystackPayment(
            reference,
            payment
          );

        return res.json({
          success: true,
          status: "success",
          result,
        });
      }

      return res.json({
        success: true,
        status:
          payment?.status || "pending",
        payment,
      });
    } catch (error) {
      console.error(
        "PAYSTACK VERIFY ERROR:",
        error?.response?.data || error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// PAYSTACK STATUS
// ============================================================

app.get(
  "/api/payment/status/:reference",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const reference =
        cleanString(req.params.reference);

      const snapshot = await db
        .collection("walletTransactions")
        .where("reference", "==", reference)
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
        snapshot.docs[0].data();

      const uid =
        transaction.uid ||
        transaction.userId;

      if (uid !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized transaction",
        });
      }

      return res.json({
        success: true,
        transaction: formatFirestoreData(
          transaction
        ),
      });
    } catch (error) {
      console.error(
        "PAYMENT STATUS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// SUPPORT SYSTEM
// ============================================================

const SUPPORT_AGENTS = {
  wale: {
    id: "wale",
    name: "Wale",
    role: "Customer Support Agent",
    style:
      "Friendly, calm, professional and helpful.",
  },

  "led/s": {
    id: "led/s",
    name: "LED/S",
    role: "Senior Customer Support Agent",
    style:
      "Professional, concise, technical and solution-focused.",
  },
};

// ============================================================
// SUPPORT CUSTOMER
// ============================================================

async function supportGetCustomer(uid) {
  const { userData } =
    await getUser(uid);

  if (!userData) {
    return null;
  }

  return {
    uid,
    name:
      userData.name ||
      userData.displayName ||
      "",
    email: maskEmail(
      userData.email || ""
    ),
    phone: maskPhone(
      userData.phone || ""
    ),
    walletBalance: toMoney(
      userData.walletBalance || 0
    ),
  };
}

// ============================================================
// SUPPORT WALLET
// ============================================================

async function supportGetWallet(uid) {
  const { userData } =
    await getUser(uid);

  if (!userData) {
    return null;
  }

  return {
    walletBalance: toMoney(
      userData.walletBalance || 0
    ),
    updatedAt:
      formatFirestoreData(userData)
        ?.updatedAt || null,
  };
}

// ============================================================
// SUPPORT FUNDING
// ============================================================

async function supportGetFunding(
  uid,
  reference
) {
  const snapshot = await db
    .collection("walletTransactions")
    .where("reference", "==", reference)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];

  const data = doc.data();

  if (
    (data.uid || data.userId) !== uid
  ) {
    return null;
  }

  return {
    id: doc.id,
    reference: data.reference,
    amount: data.amount,
    status: normalizeSupportStatus(
      data.status
    ),
    explanation:
      explainSupportStatus(
        data.status
      ),
    fundingMethod:
      data.fundingMethod || null,
    paystackStatus:
      data.paystackStatus || null,
    createdAt:
      formatFirestoreData(data)
        .createdAt || null,
  };
}

// ============================================================
// SUPPORT TRANSACTION
// ============================================================

async function supportGetTransaction(
  uid,
  transactionId
) {
  const doc = await db
    .collection("serviceTransactions")
    .doc(transactionId)
    .get();

  if (!doc.exists) {
    return null;
  }

  const data = doc.data();

  if (data.uid !== uid) {
    return null;
  }

  return {
    id: doc.id,
    ...formatFirestoreData(data),
    status: normalizeSupportStatus(
      data.status
    ),
    explanation:
      explainSupportStatus(
        data.status
      ),
  };
}

// ============================================================
// RECENT TRANSACTIONS
// ============================================================

async function supportGetRecentTransactions(
  uid
) {
  const snapshot = await db
    .collection("serviceTransactions")
    .where("uid", "==", uid)
    .limit(20)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        requestId:
          data.requestId || doc.id,
        type: data.type || null,
        amount: data.amount || 0,
        serviceID:
          data.serviceID || null,
        status:
          normalizeSupportStatus(
            data.status
          ),
        createdAt:
          formatFirestoreData(data)
            .createdAt || null,
      };
    })
    .sort((a, b) => {
      const aTime = a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0;

      const bTime = b.createdAt
        ? new Date(b.createdAt).getTime()
        : 0;

      return bTime - aTime;
    });
}

// ============================================================
// SUPPORT CONTEXT
// ============================================================

async function supportBuildContext(uid) {
  const [
    customer,
    wallet,
    recentTransactions,
  ] = await Promise.all([
    supportGetCustomer(uid),
    supportGetWallet(uid),
    supportGetRecentTransactions(uid),
  ]);

  return {
    customer,
    wallet,
    recentTransactions,
  };
}

// ============================================================
// SUPPORT AGENTS
// ============================================================

app.get(
  "/api/support/agents",
  requireFirebaseAuth,
  async (req, res) => {
    return res.json({
      success: true,
      agents: Object.values(
        SUPPORT_AGENTS
      ),
    });
  }
);

// ============================================================
// SUPPORT CONTEXT
// ============================================================

app.get(
  "/api/support/context/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const context =
        await supportBuildContext(
          req.params.uid
        );

      return res.json({
        success: true,
        context,
      });
    } catch (error) {
      console.error(
        "SUPPORT CONTEXT ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// SUPPORT SYSTEM PROMPT
// ============================================================

const SUPPORT_SYSTEM_PROMPT = `
You are the official AI customer support assistant for
ISMAIL DEEN DATA.

You help customers with:
- Wallet balance
- Wallet funding
- Paystack payments
- Data purchases
- Airtime purchases
- Electricity purchases
- Cable TV purchases
- Transaction status
- Failed transactions
- Pending transactions
- General account questions

IMPORTANT RULES:

1. Use only information supplied in the backend context.
2. Never invent transaction status.
3. Never invent payment confirmation.
4. Never claim a refund happened unless backend context says so.
5. Never change wallet balance.
6. Never debit wallet.
7. Never credit wallet.
8. Never issue refunds yourself.
9. Never delete transactions.
10. Never expose API keys, Firebase credentials, Paystack keys,
    VTpass keys or OpenAI keys.
11. If a transaction is pending or unclear, explain that clearly.
12. If the issue needs human intervention, recommend escalation.
13. Keep answers short and easy to understand.
14. You can answer in English or Hausa depending on the customer.
15. Do not expose internal database details unnecessarily.

The AI is READ-ONLY.
It can CHECK, EXPLAIN and ESCALATE.
It cannot perform financial mutations.
`;

// ============================================================
// OPENAI SUPPORT RESPONSE
// ============================================================

async function generateAISupportResponse({
  agent,
  customerMessage,
  context,
}) {
  const selectedAgent =
    SUPPORT_AGENTS[agent] ||
    SUPPORT_AGENTS.wale;

  const input = `
Agent:
${selectedAgent.name}

Agent role:
${selectedAgent.role}

Agent style:
${selectedAgent.style}

Backend customer context:
${JSON.stringify(context, null, 2)}

Customer message:
${customerMessage}
`;

  const response = await axios.post(
    `${OPENAI_BASE_URL}/responses`,
    {
      model: OPENAI_MODEL,
      instructions:
        SUPPORT_SYSTEM_PROMPT,
      input,
      max_output_tokens: 700,
    },
    {
      headers: {
        Authorization:
          `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  let text =
    response.data?.output_text ||
    "";

  if (!text) {
    const output =
      response.data?.output || [];

    const parts = [];

    for (const item of output) {
      if (item.type === "message") {
        for (
          const content of
          item.content || []
        ) {
          if (
            content.type ===
              "output_text" &&
            content.text
          ) {
            parts.push(content.text);
          }
        }
      }
    }

    text = parts.join("\n").trim();
  }

  if (!text) {
    throw new Error(
      "AI returned an empty response"
    );
  }

  return text.trim();
}

// ============================================================
// SAVE SUPPORT MESSAGE
// ============================================================

async function saveSupportMessage({
  uid,
  agent,
  role,
  message,
}) {
  const ref = db
    .collection("supportChats")
    .doc();

  await ref.set({
    uid,
    agent,
    role,
    message,
    createdAt:
      admin.firestore.FieldValue.serverTimestamp(),
  });

  return ref.id;
}

// ============================================================
// CREATE ESCALATION
// ============================================================

async function createSupportEscalation({
  uid,
  agent,
  reason,
  message,
}) {
  const ref = db
    .collection("supportEscalations")
    .doc();

  await ref.set({
    uid,
    agent,
    reason:
      cleanString(reason) ||
      "Customer requested human support",
    customerMessage: message,
    status: "open",
    createdAt:
      admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:
      admin.firestore.FieldValue.serverTimestamp(),
  });

  return ref.id;
}

// ============================================================
// AI SUPPORT CHAT
// ============================================================

app.post(
  "/api/support/chat",
  requireFirebaseAuth,
  checkAIKey,
  async (req, res) => {
    try {
      const uid =
        req.user.uid;

      const {
        message,
        agent = "wale",
      } = req.body;

      const customerMessage =
        cleanString(message);

      if (!customerMessage) {
        return res.status(400).json({
          success: false,
          message:
            "Customer message is required",
        });
      }

      const selectedAgent =
        SUPPORT_AGENTS[agent]
          ? agent
          : "wale";

      const context =
        await supportBuildContext(uid);

      await saveSupportMessage({
        uid,
        agent: selectedAgent,
        role: "user",
        message: customerMessage,
      });

      const aiResponse =
        await generateAISupportResponse({
          agent: selectedAgent,
          customerMessage,
          context,
        });

      await saveSupportMessage({
        uid,
        agent: selectedAgent,
        role: "assistant",
        message: aiResponse,
      });

      return res.json({
        success: true,
        agent:
          SUPPORT_AGENTS[selectedAgent],
        reply: aiResponse,
        context: {
          walletBalance:
            context.wallet
              ?.walletBalance ?? 0,
          recentTransactions:
            context.recentTransactions,
        },
      });
    } catch (error) {
      console.error(
        "AI SUPPORT ERROR:",
        error?.response?.data || error
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
// SUPPORT CHAT HISTORY
// ============================================================

app.get(
  "/api/support/chat/history",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const snapshot = await db
        .collection("supportChats")
        .where(
          "uid",
          "==",
          req.user.uid
        )
        .limit(100)
        .get();

      const messages = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...formatFirestoreData(
            doc.data()
          ),
        }))
        .sort((a, b) => {
          const aTime = a.createdAt
            ? new Date(
                a.createdAt
              ).getTime()
            : 0;

          const bTime = b.createdAt
            ? new Date(
                b.createdAt
              ).getTime()
            : 0;

          return aTime - bTime;
        });

      return res.json({
        success: true,
        messages,
      });
    } catch (error) {
      console.error(
        "SUPPORT HISTORY ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// SUPPORT ESCALATE
// ============================================================

app.post(
  "/api/support/escalate",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const {
        agent = "wale",
        reason,
        message,
      } = req.body;

      const selectedAgent =
        SUPPORT_AGENTS[agent]
          ? agent
          : "wale";

      const escalationId =
        await createSupportEscalation({
          uid: req.user.uid,
          agent: selectedAgent,
          reason,
          message,
        });

      return res.json({
        success: true,
        message:
          "Support escalation created",
        escalationId,
      });
    } catch (error) {
      console.error(
        "ESCALATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// GET ESCALATION
// ============================================================

app.get(
  "/api/support/escalation/:id",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const doc = await db
        .collection("supportEscalations")
        .doc(req.params.id)
        .get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          message:
            "Escalation not found",
        });
      }

      const data = doc.data();

      if (data.uid !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }

      return res.json({
        success: true,
        escalation: {
          id: doc.id,
          ...formatFirestoreData(data),
        },
      });
    } catch (error) {
      console.error(
        "GET ESCALATION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// SUPPORT FUNDING LOOKUP
// ============================================================

app.get(
  "/api/support/wallet-funding/:uid/:reference",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const result =
        await supportGetFunding(
          req.params.uid,
          req.params.reference
        );

      if (!result) {
        return res.status(404).json({
          success: false,
          message:
            "Funding transaction not found",
        });
      }

      return res.json({
        success: true,
        funding: result,
      });
    } catch (error) {
      console.error(
        "SUPPORT FUNDING ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// SUPPORT SERVICE TRANSACTION LOOKUP
// ============================================================

app.get(
  "/api/support/transaction/:uid/:transactionId",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const result =
        await supportGetTransaction(
          req.params.uid,
          req.params.transactionId
        );

      if (!result) {
        return res.status(404).json({
          success: false,
          message:
            "Service transaction not found",
        });
      }

      return res.json({
        success: true,
        transaction: result,
      });
    } catch (error) {
      console.error(
        "SUPPORT TRANSACTION ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
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

      const doc = await db
        .collection("serviceTransactions")
        .doc(requestId)
        .get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          message:
            "Transaction not found",
        });
      }

      const data = doc.data();

      if (data.uid !== req.user.uid) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }

      return res.json({
        success: true,
        transaction: {
          id: doc.id,
          ...formatFirestoreData(data),
        },
      });
    } catch (error) {
      console.error(
        "SERVICE STATUS ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "ISMAIL DEEN DATA",
    message:
      "ISMAIL DEEN DATA backend is running",
    version: "1.0.0",
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    app: "ISMAIL DEEN DATA",
    firebase: Boolean(db),
    vtpass:
      Boolean(
        process.env.VTPASS_API_KEY &&
        process.env.VTPASS_SECRET_KEY
      ),
    paystack:
      Boolean(
        process.env.PAYSTACK_SECRET_KEY
      ),
    ai:
      Boolean(
        process.env.OPENAI_API_KEY
      ),
    time: new Date().toISOString(),
  });
});

// ============================================================
// FIREBASE TEST
// ============================================================

app.get(
  "/api/firebase/test",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      if (!checkFirebase(res)) return;

      const snapshot = await db
        .collection("users")
        .limit(1)
        .get();

      return res.json({
        success: true,
        firebase: "connected",
        usersCollectionAccessible: true,
        sampleCount: snapshot.size,
      });
    } catch (error) {
      console.error(
        "FIREBASE TEST ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        firebase: "error",
        message: getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "GLOBAL ERROR:",
      error
    );

    if (res.headersSent) {
      return next(error);
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

app.listen(PORT, () => {
  console.log(
    `ISMAIL DEEN DATA server running on port ${PORT}`
  );

  console.log(
    `Environment: ${
      process.env.NODE_ENV || "development"
    }`
  );

  console.log(
    `VTpass: ${VTPASS_BASE_URL}`
  );

  console.log(
    `OpenAI model: ${OPENAI_MODEL}`
  );
});
