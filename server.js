// ============================================================
// ISMAIL DEEN DATA
// FULL TELECOM BACKEND
// Firebase + Paystack + CheapDataHub
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();

// ============================================================
// CONFIG
// ============================================================

const PORT = process.env.PORT || 3000;

const APP_NAME = process.env.APP_NAME || "ISMAIL DEEN DATA";

const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY || "";

const CHEAPDATAHUB_API_KEY =
  process.env.CHEAPDATAHUB_API_KEY || "";

const PAYSTACK_BASE_URL =
  "https://api.paystack.co";

const CHEAPDATAHUB_BASE_URL =
  "https://www.cheapdatahub.ng/api/v1";

const MIN_DEPOSIT = Number(
  process.env.MIN_DEPOSIT || 100
);

// Fixed app deposit charge
const DEPOSIT_FEE = Number(
  process.env.DEPOSIT_FEE || 30
);

const PAYSTACK_CALLBACK_URL =
  process.env.PAYSTACK_CALLBACK_URL || "";

// ============================================================
// FIREBASE ADMIN
// ============================================================

try {
  if (!admin.apps.length) {

    const serviceAccountPath =
      "/etc/secrets/firebase-service-account.json";

    admin.initializeApp({
      credential: admin.credential.cert(
        require(serviceAccountPath)
      )
    });

    console.log("Firebase Admin initialized.");
  }
} catch (error) {

  console.error(
    "Firebase initialization error:",
    error.message
  );
}

const db = admin.firestore();

// ============================================================
// EXPRESS
// ============================================================

// IMPORTANT:
// Paystack webhook needs RAW BODY.
// Therefore webhook route comes BEFORE express.json().

app.use(
  cors({
    origin: "*",
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-paystack-signature"
    ]
  })
);

// ============================================================
// PAYSTACK WEBHOOK RAW BODY
// ============================================================

app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {

    try {

      if (!PAYSTACK_SECRET_KEY) {
        console.error(
          "PAYSTACK_SECRET_KEY is missing."
        );

        return res.sendStatus(500);
      }

      const signature =
        req.headers["x-paystack-signature"];

      if (!signature) {
        console.log(
          "Missing Paystack signature."
        );

        return res.sendStatus(400);
      }

      const hash =
        crypto
          .createHmac(
            "sha512",
            PAYSTACK_SECRET_KEY
          )
          .update(req.body)
          .digest("hex");

      if (hash !== signature) {

        console.log(
          "Invalid Paystack signature."
        );

        return res.sendStatus(401);
      }

      const event =
        JSON.parse(req.body.toString());

      console.log(
        "PAYSTACK WEBHOOK:",
        JSON.stringify(event)
      );

      if (event.event !== "charge.success") {
        return res.sendStatus(200);
      }

      const data = event.data || {};

      const reference =
        data.reference || "";

      const amountKobo =
        Number(data.amount || 0);

      const amountPaid =
        amountKobo / 100;

      const metadata =
        data.metadata || {};

      // --------------------------------------------------------
      // ONLINE PAYMENT
      // --------------------------------------------------------

      const uid =
        metadata.uid || null;

      const paymentType =
        metadata.type || null;

      if (
        uid &&
        paymentType === "wallet_funding"
      ) {

        await processWalletFunding({
          uid,
          reference,
          amountPaid,
          paymentMethod: "online_payment",
          paystackData: data
        });

        return res.sendStatus(200);
      }

      // --------------------------------------------------------
      // VIRTUAL ACCOUNT
      // --------------------------------------------------------

      const customerCode =
        data.customer &&
        data.customer.customer_code
          ? data.customer.customer_code
          : null;

      if (customerCode) {

        const usersSnapshot =
          await db
            .collection("users")
            .where(
              "paystackCustomerCode",
              "==",
              customerCode
            )
            .limit(1)
            .get();

        if (!usersSnapshot.empty) {

          const userDoc =
            usersSnapshot.docs[0];

          await processWalletFunding({
            uid: userDoc.id,
            reference,
            amountPaid,
            paymentMethod: "bank_transfer",
            paystackData: data
          });
        }
      }

      return res.sendStatus(200);

    } catch (error) {

      console.error(
        "Webhook error:",
        error
      );

      return res.sendStatus(500);
    }
  }
);

// ============================================================
// NORMAL JSON BODY
// ============================================================

app.use(express.json());

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

async function authenticateFirebase(
  req,
  res,
  next
) {

  try {

    const authHeader =
      req.headers.authorization || "";

    if (
      !authHeader.startsWith("Bearer ")
    ) {

      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const token =
      authHeader.substring(7);

    const decodedToken =
      await admin
        .auth()
        .verifyIdToken(token);

    req.user = decodedToken;

    next();

  } catch (error) {

    console.error(
      "Firebase authentication error:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

// ============================================================
// HELPERS
// ============================================================

function roundMoney(value) {

  return Math.round(
    Number(value) * 100
  ) / 100;
}

// ------------------------------------------------------------
// NORMALIZE DEPOSIT AMOUNT
// ------------------------------------------------------------

function normalizeDepositAmount(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  let amount;

  if (typeof value === "number") {

    amount = value;

  } else if (typeof value === "string") {

    amount =
      Number(
        value
          .replace(/,/g, "")
          .replace(/₦/g, "")
          .trim()
      );

  } else {

    return null;
  }

  if (!Number.isFinite(amount)) {
    return null;
  }

  amount =
    roundMoney(amount);

  return amount;
}

// ------------------------------------------------------------
// GET USER REF
// ------------------------------------------------------------

function getUserRef(uid) {

  return db.collection("users").doc(uid);
}

// ============================================================
// PROCESS WALLET FUNDING
// ============================================================

async function processWalletFunding({
  uid,
  reference,
  amountPaid,
  paymentMethod,
  paystackData
}) {

  if (!uid) {
    throw new Error("Missing user ID.");
  }

  if (!reference) {
    throw new Error("Missing payment reference.");
  }

  const amount =
    normalizeDepositAmount(amountPaid);

  if (!amount || amount <= 0) {

    throw new Error(
      "Invalid payment amount."
    );
  }

  const transactionRef =
    db
      .collection("walletTransactions")
      .doc(reference);

  const userRef =
    getUserRef(uid);

  await db.runTransaction(
    async (transaction) => {

      const existingTransaction =
        await transaction.get(
          transactionRef
        );

      // ------------------------------------------------------
      // IDEMPOTENCY
      // ------------------------------------------------------

      if (existingTransaction.exists) {

        console.log(
          "Payment already processed:",
          reference
        );

        return;
      }

      const userSnapshot =
        await transaction.get(userRef);

      if (!userSnapshot.exists) {

        throw new Error(
          "User account not found."
        );
      }

      const userData =
        userSnapshot.data() || {};

      const currentBalance =
        normalizeDepositAmount(
          userData.walletBalance || 0
        ) || 0;

      const fee =
        DEPOSIT_FEE;

      const walletCredit =
        roundMoney(
          Math.max(
            0,
            amount - fee
          )
        );

      const newBalance =
        roundMoney(
          currentBalance +
          walletCredit
        );

      // ------------------------------------------------------
      // UPDATE USER
      // ------------------------------------------------------

      transaction.set(
        userRef,
        {
          walletBalance: newBalance,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        },
        {
          merge: true
        }
      );

      // ------------------------------------------------------
      // WALLET HISTORY
      // ------------------------------------------------------

      const historyRef =
        db
          .collection("walletHistory")
          .doc();

      transaction.set(
        historyRef,
        {
          uid,
          type: "wallet_funding",
          amount: amount,
          fee: fee,
          creditedAmount: walletCredit,
          previousBalance: currentBalance,
          newBalance,
          reference,
          paymentMethod,
          status: "success",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        }
      );

      // ------------------------------------------------------
      // WALLET TRANSACTION
      // ------------------------------------------------------

      transaction.set(
        transactionRef,
        {
          uid,
          reference,
          amount,
          fee,
          creditedAmount: walletCredit,
          paymentMethod,
          status: "success",
          paystackStatus:
            paystackData?.status || "success",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        }
      );

      // ------------------------------------------------------
      // GENERAL TRANSACTION
      // ------------------------------------------------------

      const generalTransactionRef =
        db
          .collection("transactions")
          .doc();

      transaction.set(
        generalTransactionRef,
        {
          uid,
          type: "wallet_funding",
          amount,
          fee,
          creditedAmount: walletCredit,
          reference,
          paymentMethod,
          status: "success",
          createdAt:
            admin.firestore.FieldValue.serverTimestamp()
        }
      );

      console.log(
        "Wallet funded successfully:",
        {
          uid,
          amount,
          fee,
          walletCredit,
          newBalance,
          reference
        }
      );
    }
  );

  return true;
}

// ============================================================
// ROOT
// ============================================================

app.get("/", (req, res) => {

  res.json({
    success: true,
    app: APP_NAME,
    message:
      "ISMAIL DEEN DATA backend is running.",
    time: new Date().toISOString()
  });
});

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {

  res.json({
    success: true,
    status: "healthy",
    app: APP_NAME
  });
});

// ============================================================
// WALLET BALANCE
// ============================================================

app.get(
  "/api/wallet/balance/:uid",
  authenticateFirebase,
  async (req, res) => {

    try {

      const uid =
        req.params.uid;

      if (req.user.uid !== uid) {

        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      const userSnapshot =
        await getUserRef(uid).get();

      if (!userSnapshot.exists) {

        return res.json({
          success: true,
          balance: 0
        });
      }

      const data =
        userSnapshot.data() || {};

      const balance =
        Number(
          data.walletBalance || 0
        );

      return res.json({
        success: true,
        balance: roundMoney(balance)
      });

    } catch (error) {

      console.error(
        "Wallet balance error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to load wallet balance."
      });
    }
  }
);

// ============================================================
// WALLET DETAILS
// ============================================================

app.get(
  "/api/wallet/details/:uid",
  authenticateFirebase,
  async (req, res) => {

    try {

      const uid =
        req.params.uid;

      if (req.user.uid !== uid) {

        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      const snapshot =
        await getUserRef(uid).get();

      if (!snapshot.exists) {

        return res.json({
          success: true,
          balance: 0,
          depositFee: DEPOSIT_FEE,
          minimumDeposit: MIN_DEPOSIT
        });
      }

      const data =
        snapshot.data() || {};

      return res.json({
        success: true,
        balance:
          Number(
            data.walletBalance || 0
          ),
        depositFee: DEPOSIT_FEE,
        minimumDeposit: MIN_DEPOSIT,
        virtualAccount:
          data.virtualAccount || null
      });

    } catch (error) {

      console.error(
        "Wallet details error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to load wallet details."
      });
    }
  }
);

// ============================================================
// WALLET HISTORY
// ============================================================

app.get(
  "/api/wallet/history/:uid",
  authenticateFirebase,
  async (req, res) => {

    try {

      const uid =
        req.params.uid;

      if (req.user.uid !== uid) {

        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      const snapshot =
        await db
          .collection("walletHistory")
          .where("uid", "==", uid)
          .limit(100)
          .get();

      const history =
        snapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...doc.data()
          })
        );

      history.sort(
        (a, b) => {

          const aTime =
            a.createdAt?.toMillis?.() || 0;

          const bTime =
            b.createdAt?.toMillis?.() || 0;

          return bTime - aTime;
        }
      );

      return res.json({
        success: true,
        history
      });

    } catch (error) {

      console.error(
        "Wallet history error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to load wallet history."
      });
    }
  }
);

// ============================================================
// PAYSTACK CUSTOMER
// ============================================================

async function getOrCreatePaystackCustomer(
  uid
) {

  const userRef =
    getUserRef(uid);

  const snapshot =
    await userRef.get();

  if (!snapshot.exists) {

    throw new Error(
      "User account not found."
    );
  }

  const userData =
    snapshot.data() || {};

  if (
    userData.paystackCustomerCode
  ) {

    return {
      customerCode:
        userData.paystackCustomerCode,
      customerData:
        userData.paystackCustomer || null
    };
  }

  const email =
    userData.email ||
    reqSafeEmail(uid);

  if (!email) {

    throw new Error(
      "User email is required for Paystack."
    );
  }

  const firstName =
    userData.firstName ||
    userData.name ||
    "ISMAIL";

  const lastName =
    userData.lastName ||
    "USER";

  const response =
    await axios.post(
      `${PAYSTACK_BASE_URL}/customer`,
      {
        email,
        first_name: firstName,
        last_name: lastName
      },
      {
        headers: {
          Authorization:
            `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type":
            "application/json"
        },
        timeout: 30000
      }
    );

  const customer =
    response.data?.data;

  if (!customer?.customer_code) {

    throw new Error(
      "Paystack customer creation failed."
    );
  }

  await userRef.set(
    {
      paystackCustomerCode:
        customer.customer_code,
      paystackCustomer:
        customer,
      updatedAt:
        admin.firestore.FieldValue.serverTimestamp()
    },
    {
      merge: true
    }
  );

  return {
    customerCode:
      customer.customer_code,
    customerData:
      customer
  };
}

// ============================================================
// SAFE EMAIL
// ============================================================

function reqSafeEmail(uid) {

  return `${uid}@ismaildeendata.local`;
}

// ============================================================
// CREATE VIRTUAL ACCOUNT
// ============================================================

app.post(
  "/api/wallet/virtual-account",
  authenticateFirebase,
  async (req, res) => {

    try {

      if (!PAYSTACK_SECRET_KEY) {

        return res.status(500).json({
          success: false,
          message:
            "Paystack secret key is not configured."
        });
      }

      const uid =
        req.user.uid;

      const existingSnapshot =
        await getUserRef(uid).get();

      const existingData =
        existingSnapshot.exists
          ? existingSnapshot.data() || {}
          : {};

      if (
        existingData.virtualAccount
      ) {

        return res.json({
          success: true,
          available: true,
          virtualAccount:
            existingData.virtualAccount
        });
      }

      const customer =
        await getOrCreatePaystackCustomer(
          uid
        );

      const response =
        await axios.post(
          `${PAYSTACK_BASE_URL}/dedicated_account`,
          {
            customer:
              customer.customerCode,
            preferred_bank:
              process.env.PAYSTACK_DVA_BANK ||
              "wema-bank"
          },
          {
            headers: {
              Authorization:
                `Bearer ${PAYSTACK_SECRET_KEY}`,
              "Content-Type":
                "application/json"
            },
            timeout: 30000
          }
        );

      const data =
        response.data?.data;

      if (
        !data ||
        !data.account_number
      ) {

        return res.json({
          success: false,
          available: false,
          dvaUnavailable: true,
          virtualAccount: null,
          message:
            "Dedicated NUBAN is not available for this business. Please use Online Payment."
        });
      }

      const virtualAccount = {
        bankName:
          data.bank?.name ||
          data.bank_name ||
          "Unavailable",

        accountName:
          data.account_name ||
          "Unavailable",

        accountNumber:
          data.account_number ||
          "Unavailable",

        bankCode:
          data.bank?.slug ||
          data.bank?.code ||
          null,

        customerCode:
          customer.customerCode
      };

      await getUserRef(uid).set(
        {
          virtualAccount,
          paystackCustomerCode:
            customer.customerCode,
          updatedAt:
            admin.firestore.FieldValue.serverTimestamp()
        },
        {
          merge: true
        }
      );

      return res.json({
        success: true,
        available: true,
        virtualAccount
      });

    } catch (error) {

      const paystackMessage =
        error.response?.data?.message ||
        error.message;

      console.error(
        "Virtual account error:",
        paystackMessage
      );

      return res.json({
        success: false,
        available: false,
        dvaUnavailable: true,
        virtualAccount: null,
        message:
          "Dedicated NUBAN is not available for this business. Please use Online Payment."
      });
    }
  }
);

// ============================================================
// GET VIRTUAL ACCOUNT
// ============================================================

app.get(
  "/api/wallet/virtual-account/:uid",
  authenticateFirebase,
  async (req, res) => {

    try {

      const uid =
        req.params.uid;

      if (req.user.uid !== uid) {

        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      const snapshot =
        await getUserRef(uid).get();

      if (!snapshot.exists) {

        return res.json({
          success: false,
          available: false,
          virtualAccount: null,
          message:
            "Virtual account not created yet."
        });
      }

      const data =
        snapshot.data() || {};

      if (!data.virtualAccount) {

        return res.json({
          success: false,
          available: false,
          virtualAccount: null,
          message:
            "Virtual account is not available. Please use Online Payment."
        });
      }

      return res.json({
        success: true,
        available: true,
        virtualAccount:
          data.virtualAccount
      });

    } catch (error) {

      console.error(
        "Get virtual account error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load virtual account."
      });
    }
  }
);

// ============================================================
// ONLINE PAYMENT INITIALIZE
// ============================================================

app.post(
  "/api/wallet/online-payment/initialize",
  authenticateFirebase,
  async (req, res) => {

    try {

      if (!PAYSTACK_SECRET_KEY) {

        return res.status(500).json({
          success: false,
          message:
            "Paystack secret key is not configured."
        });
      }

      const uid =
        req.user.uid;

      // ------------------------------------------------------
      // ACCEPT NUMBER OR STRING
      // ------------------------------------------------------

      const amount =
        normalizeDepositAmount(
          req.body.amount
        );

      console.log(
        "ONLINE PAYMENT REQUEST:",
        {
          uid,
          originalAmount:
            req.body.amount,
          normalizedAmount:
            amount
        }
      );

      // ------------------------------------------------------
      // VALIDATE
      // ------------------------------------------------------

      if (amount === null) {

        return res.status(400).json({
          success: false,
          message:
            "Please enter a valid deposit amount."
        });
      }

      if (amount < MIN_DEPOSIT) {

        return res.status(400).json({
          success: false,
          message:
            `Minimum deposit is ₦${MIN_DEPOSIT}`
        });
      }

      // ------------------------------------------------------
      // NO MAXIMUM HERE
      // ------------------------------------------------------
      // User can deposit ₦100, ₦1,000,
      // ₦10,000, ₦100,000 or more.
      //
      // Actual maximum may still depend on Paystack/account
      // transaction limits.

      const amountKobo =
        Math.round(
          amount * 100
        );

      const reference =
        `ISMAIL-${uid.substring(0, 8)}-${Date.now()}`;

      const email =
        req.user.email ||
        `${uid}@ismaildeendata.local`;

      const payload = {

        email,

        amount:
          amountKobo,

        reference,

        currency:
          "NGN",

        metadata: {

          uid,

          type:
            "wallet_funding",

          app:
            APP_NAME,

          depositAmount:
            amount,

          depositFee:
            DEPOSIT_FEE,

          walletCredit:
            roundMoney(
              amount - DEPOSIT_FEE
            )
        }
      };

      if (PAYSTACK_CALLBACK_URL) {

        payload.callback_url =
          PAYSTACK_CALLBACK_URL;
      }

      console.log(
        "PAYSTACK INITIALIZE PAYLOAD:",
        JSON.stringify(payload)
      );

      const response =
        await axios.post(
          `${PAYSTACK_BASE_URL}/transaction/initialize`,
          payload,
          {
            headers: {
              Authorization:
                `Bearer ${PAYSTACK_SECRET_KEY}`,
              "Content-Type":
                "application/json"
            },
            timeout: 30000
          }
        );

      const data =
        response.data?.data;

      if (
        !response.data?.status ||
        !data?.authorization_url
      ) {

        console.error(
          "Paystack initialize failed:",
          response.data
        );

        return res.status(400).json({
          success: false,
          message:
            response.data?.message ||
            "Unable to initialize payment."
        });
      }

      return res.json({

        success: true,

        reference:
          data.reference ||
          reference,

        authorizationUrl:
          data.authorization_url,

        accessCode:
          data.access_code || null,

        amount,

        fee:
          DEPOSIT_FEE,

        walletCredit:
          roundMoney(
            amount - DEPOSIT_FEE
          )
      });

    } catch (error) {

      console.error(
        "ONLINE PAYMENT INITIALIZE ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(
        error.response?.status || 500
      ).json({
        success: false,
        message:
          error.response?.data?.message ||
          "Server error while initializing payment."
      });
    }
  }
);

// ============================================================
// VERIFY ONLINE PAYMENT
// ============================================================

app.get(
  "/api/wallet/online-payment/verify/:reference",
  authenticateFirebase,
  async (req, res) => {

    try {

      if (!PAYSTACK_SECRET_KEY) {

        return res.status(500).json({
          success: false,
          message:
            "Paystack secret key is not configured."
        });
      }

      const reference =
        req.params.reference;

      if (!reference) {

        return res.status(400).json({
          success: false,
          message:
            "Payment reference is required."
        });
      }

      const response =
        await axios.get(
          `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
          {
            headers: {
              Authorization:
                `Bearer ${PAYSTACK_SECRET_KEY}`
            },
            timeout: 30000
          }
        );

      const data =
        response.data?.data;

      if (
        !response.data?.status ||
        !data
      ) {

        return res.status(400).json({
          success: false,
          processed: false,
          message:
            response.data?.message ||
            "Unable to verify payment."
        });
      }

      const status =
        String(
          data.status || ""
        ).toLowerCase();

      const amount =
        Number(data.amount || 0) / 100;

      // ------------------------------------------------------
      // PAYMENT NOT SUCCESSFUL
      // ------------------------------------------------------

      if (status !== "success") {

        return res.json({
          success: false,
          processed: false,
          paymentStatus: status,
          reference,
          message:
            `Payment status: ${status}`
        });
      }

      // ------------------------------------------------------
      // CHECK USER
      // ------------------------------------------------------

      const metadata =
        data.metadata || {};

      const metadataUid =
        metadata.uid;

      if (
        metadataUid &&
        metadataUid !== req.user.uid
      ) {

        return res.status(403).json({
          success: false,
          processed: false,
          message:
            "Payment does not belong to this account."
        });
      }

      // ------------------------------------------------------
      // PROCESS WALLET
      // ------------------------------------------------------

      await processWalletFunding({
        uid: req.user.uid,
        reference,
        amountPaid: amount,
        paymentMethod:
          "online_payment",
        paystackData: data
      });

      // ------------------------------------------------------
      // GET NEW BALANCE
      // ------------------------------------------------------

      const userSnapshot =
        await getUserRef(
          req.user.uid
        ).get();

      const userData =
        userSnapshot.data() || {};

      const balance =
        Number(
          userData.walletBalance || 0
        );

      return res.json({

        success: true,

        processed: true,

        reference,

        paymentStatus:
          "success",

        amount,

        fee:
          DEPOSIT_FEE,

        walletCredit:
          roundMoney(
            amount - DEPOSIT_FEE
          ),

        balance:
          roundMoney(balance),

        message:
          "Payment successful and wallet funded."
      });

    } catch (error) {

      console.error(
        "ONLINE PAYMENT VERIFY ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(
        error.response?.status || 500
      ).json({
        success: false,
        processed: false,
        message:
          error.response?.data?.message ||
          "Unable to verify payment."
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB WALLET BALANCE
// ============================================================

app.get(
  "/api/cheapdatahub/wallet-balance",
  authenticateFirebase,
  async (req, res) => {

    try {

      if (!CHEAPDATAHUB_API_KEY) {

        return res.status(500).json({
          success: false,
          message:
            "CheapDataHub API key is not configured."
        });
      }

      const response =
        await axios.get(
          `${CHEAPDATAHUB_BASE_URL}/resellers/wallet`,
          {
            headers: {
              Authorization:
                `Bearer ${CHEAPDATAHUB_API_KEY}`,
              Accept:
                "application/json"
            },
            timeout: 30000
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.error(
        "CheapDataHub wallet error:",
        error.response?.data ||
        error.message
      );

      return res.status(
        error.response?.status || 500
      ).json({
        success: false,
        message:
          error.response?.data?.message ||
          "Unable to check CheapDataHub wallet."
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB BUY DATA
// ============================================================

app.post(
  "/api/cheapdatahub/buy-data",
  authenticateFirebase,
  async (req, res) => {

    try {

      if (!CHEAPDATAHUB_API_KEY) {

        return res.status(500).json({
          success: false,
          message:
            "CheapDataHub API key is not configured."
        });
      }

      const {
        bundle_id,
        phone_number
      } = req.body;

      if (!bundle_id) {

        return res.status(400).json({
          success: false,
          message:
            "bundle_id is required."
        });
      }

      if (!phone_number) {

        return res.status(400).json({
          success: false,
          message:
            "phone_number is required."
        });
      }

      const response =
        await axios.post(
          `${CHEAPDATAHUB_BASE_URL}/resellers/data/purchase/`,
          {
            bundle_id,
            phone_number
          },
          {
            headers: {
              Authorization:
                `Bearer ${CHEAPDATAHUB_API_KEY}`,
              "Content-Type":
                "application/json",
              Accept:
                "application/json"
            },
            timeout: 60000
          }
        );

      return res.json(
        response.data
      );

    } catch (error) {

      console.error(
        "CheapDataHub purchase error:",
        error.response?.data ||
        error.message
      );

      return res.status(
        error.response?.status || 500
      ).json({
        success: false,
        message:
          error.response?.data?.message ||
          "CheapDataHub data purchase failed."
      });
    }
  }
);

// ============================================================
// PROFILE
// ============================================================

app.get(
  "/api/profile/:uid",
  authenticateFirebase,
  async (req, res) => {

    try {

      const uid =
        req.params.uid;

      if (req.user.uid !== uid) {

        return res.status(403).json({
          success: false,
          message: "Access denied."
        });
      }

      const snapshot =
        await getUserRef(uid).get();

      if (!snapshot.exists) {

        return res.json({
          success: true,
          profile: {
            uid
          }
        });
      }

      const data =
        snapshot.data() || {};

      return res.json({
        success: true,
        profile: {
          uid,
          name:
            data.name || "",
          email:
            data.email ||
            req.user.email ||
            "",
          phone:
            data.phone || "",
          walletBalance:
            Number(
              data.walletBalance || 0
            )
        }
      });

    } catch (error) {

      console.error(
        "Profile error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load profile."
      });
    }
  }
);

// ============================================================
// TRANSACTION STATUS
// ============================================================

app.get(
  "/api/vtpass/transaction/:requestId",
  authenticateFirebase,
  async (req, res) => {

    return res.json({
      success: false,
      message:
        "Transaction status endpoint is currently unavailable."
    });
  }
);

// ============================================================
// 404 HANDLER
// ============================================================

app.use(
  (req, res) => {

    return res.status(404).json({

      success: false,

      message:
        "Endpoint not found.",

      path:
        req.originalUrl,

      method:
        req.method
    });
  }
);

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {

    console.error(
      "GLOBAL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Internal server error."
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
      `${APP_NAME} backend running on port ${PORT}`
    );

    console.log(
      `Minimum deposit: ₦${MIN_DEPOSIT}`
    );

    console.log(
      `Deposit fee: ₦${DEPOSIT_FEE}`
    );

    console.log(
      "Maximum deposit: No application-level maximum"
    );
  }
);
