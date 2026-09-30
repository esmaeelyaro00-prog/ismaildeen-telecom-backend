// ============================================================
// ISMAIL DEEN DATA - FULL TELECOM BACKEND
// Firebase + Paystack + CheapDataHub
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const admin = require("firebase-admin");

// ============================================================
// APP CONFIG
// ============================================================

const app = express();

const PORT = Number(process.env.PORT || 3000);

const APP_NAME =
  process.env.APP_NAME || "ISMAIL DEEN DATA";

const PAYSTACK_BASE_URL =
  "https://api.paystack.co";

const CHEAPDATAHUB_BASE_URL =
  "https://www.cheapdatahub.ng/api/v1";

const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY || "";

const CHEAPDATAHUB_API_KEY =
  process.env.CHEAPDATAHUB_API_KEY || "";

const PAYSTACK_DVA_BANK =
  process.env.PAYSTACK_DVA_BANK || "wema-bank";

// Your app deposit charge
const DEPOSIT_FEE = 30;

// Minimum deposit
const MIN_DEPOSIT = 100;

// Optional Paystack callback
const PAYSTACK_CALLBACK_URL =
  process.env.PAYSTACK_CALLBACK_URL || "";

// ============================================================
// CORS
// ============================================================

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-paystack-signature",
    ],
  })
);

// ============================================================
// BASIC HELPERS
// ============================================================

function cleanString(value) {
  return String(value || "").trim();
}

function money(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number * 100) / 100;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requestId(prefix = "TX") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`;
}

function paystackHeaders() {
  return {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

function cheapDataHubHeaders() {
  return {
    Authorization: `Bearer ${CHEAPDATAHUB_API_KEY}`,
    "Content-Type": "application/json",
  };
}

function getErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Unknown error"
  );
}

// ============================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================

try {
  if (!admin.apps.length) {
    let serviceAccount = null;

    // --------------------------------------------------------
    // Option 1: Render Secret File
    // --------------------------------------------------------

    const serviceAccountPath =
      "/etc/secrets/firebase-service-account.json";

    try {
      serviceAccount = require(serviceAccountPath);

      console.log(
        "Firebase service account loaded from Render Secret File"
      );
    } catch (fileError) {
      console.log(
        "Render Firebase Secret File not found, checking environment..."
      );
    }

    // --------------------------------------------------------
    // Option 2: FIREBASE_SERVICE_ACCOUNT_JSON
    // --------------------------------------------------------

    if (!serviceAccount && process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        serviceAccount = JSON.parse(
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        );

        console.log(
          "Firebase service account loaded from environment"
        );
      } catch (jsonError) {
        console.error(
          "Invalid FIREBASE_SERVICE_ACCOUNT_JSON"
        );
      }
    }

    // --------------------------------------------------------
    // Initialize Firebase
    // --------------------------------------------------------

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      throw new Error(
        "Firebase service account not found"
      );
    }
  }

  console.log(
    "Firebase Admin initialized successfully"
  );
} catch (error) {
  console.error(
    "Firebase initialization error:",
    error.message
  );

  process.exit(1);
}

const db = admin.firestore();

// ============================================================
// FIREBASE AUTH MIDDLEWARE
// ============================================================

async function requireFirebaseAuth(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const idToken =
      authorization.substring("Bearer ".length).trim();

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing",
      });
    }

    const decodedToken =
      await admin.auth().verifyIdToken(idToken);

    req.user = decodedToken;

    next();
  } catch (error) {
    console.error(
      "Firebase authentication error:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
}

// ============================================================
// UID OWNERSHIP
// ============================================================

function requireOwnUid(req, res, next) {
  const requestedUid =
    cleanString(req.params.uid);

  if (!requestedUid) {
    return res.status(400).json({
      success: false,
      message: "UID is required",
    });
  }

  if (requestedUid !== req.user.uid) {
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }

  next();
}

// ============================================================
// USER HELPERS
// ============================================================

async function getUser(uid) {
  const snap = await db
    .collection("users")
    .doc(uid)
    .get();

  if (!snap.exists) {
    return null;
  }

  return {
    id: snap.id,
    ...snap.data(),
  };
}

async function ensureUserDocument(uid, data = {}) {
  const ref = db
    .collection("users")
    .doc(uid);

  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      uid,
      walletBalance: 0,
      email: data.email || "",
      createdAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    return await getUser(uid);
  }

  return {
    id: snap.id,
    ...snap.data(),
  };
}

// ============================================================
// PAYSTACK CUSTOMER
// ============================================================

async function getOrCreatePaystackCustomer(uid) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured"
    );
  }

  const user = await getUser(uid);

  if (!user) {
    throw new Error("User not found");
  }

  // Existing customer code
  if (user.paystackCustomerCode) {
    return {
      customerCode: user.paystackCustomerCode,
      customer: {
        customer_code: user.paystackCustomerCode,
        email: user.email || "",
      },
    };
  }

  const email = cleanString(
    user.email || ""
  ).toLowerCase();

  if (!isValidEmail(email)) {
    throw new Error(
      "A valid email address is required"
    );
  }

  const firstName =
    cleanString(
      user.firstName ||
      user.firstname ||
      user.name ||
      "ISMAIL"
    );

  const lastName =
    cleanString(
      user.lastName ||
      user.lastname ||
      "DEEN"
    );

  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/customer`,
    {
      email,
      first_name: firstName,
      last_name: lastName,
    },
    {
      headers: paystackHeaders(),
      timeout: 30000,
    }
  );

  if (!response.data?.status) {
    throw new Error(
      response.data?.message ||
      "Unable to create Paystack customer"
    );
  }

  const customer =
    response.data.data;

  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        paystackCustomerCode:
          customer.customer_code,
        paystackCustomerId:
          customer.id,
        updatedAt:
          admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return {
    customerCode:
      customer.customer_code,
    customer,
  };
}

// ============================================================
// VIRTUAL ACCOUNT NORMALIZER
// ============================================================

function normalizeVirtualAccount(data) {
  if (!data) {
    return null;
  }

  const accountNumber =
    cleanString(
      data.account_number ||
      data.accountNumber ||
      data.nuban
    );

  const accountName =
    cleanString(
      data.account_name ||
      data.accountName ||
      data.name
    );

  const bankName =
    cleanString(
      data.bank?.name ||
      data.bank_name ||
      data.bankName
    );

  const bankCode =
    cleanString(
      data.bank?.slug ||
      data.bank?.code ||
      data.bank_code ||
      data.bankCode
    );

  if (!accountNumber) {
    return null;
  }

  return {
    accountNumber,
    accountName,
    bankName,
    bankCode,
    active: true,
    provider: "paystack",
    updatedAt:
      admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ============================================================
// PROCESS WALLET FUNDING
// ============================================================

async function processWalletFunding({
  uid,
  reference,
  grossAmount,
  payment,
  method,
}) {
  const cleanUid = cleanString(uid);
  const cleanReference =
    cleanString(reference);

  const amount = money(grossAmount);

  if (!cleanUid) {
    throw new Error(
      "Wallet funding UID is missing"
    );
  }

  if (!cleanReference) {
    throw new Error(
      "Payment reference is missing"
    );
  }

  if (amount < MIN_DEPOSIT) {
    throw new Error(
      `Minimum deposit is ₦${MIN_DEPOSIT}`
    );
  }

  const userRef = db
    .collection("users")
    .doc(cleanUid);

  const fundingRef = db
    .collection("walletTransactions")
    .doc(`wallet-${cleanReference}`);

  const historyRef = db
    .collection("walletHistory")
    .doc(`wallet-${cleanReference}`);

  const result =
    await db.runTransaction(async (transaction) => {
      // ------------------------------------------------------
      // Check duplicate
      // ------------------------------------------------------

      const existing =
        await transaction.get(fundingRef);

      if (
        existing.exists &&
        existing.data()?.status === "completed"
      ) {
        return {
          duplicate: true,
          ...existing.data(),
        };
      }

      // ------------------------------------------------------
      // Get user
      // ------------------------------------------------------

      const userSnap =
        await transaction.get(userRef);

      if (!userSnap.exists) {
        throw new Error(
          "User account not found"
        );
      }

      const userData =
        userSnap.data() || {};

      const balanceBefore =
        money(userData.walletBalance || 0);

      // ------------------------------------------------------
      // APP FEE
      // ------------------------------------------------------

      const fee =
        DEPOSIT_FEE;

      const creditedAmount =
        Math.max(
          0,
          money(amount - fee)
        );

      const balanceAfter =
        money(
          balanceBefore +
          creditedAmount
        );

      const now =
        admin.firestore.FieldValue.serverTimestamp();

      // ------------------------------------------------------
      // UPDATE USER WALLET
      // ------------------------------------------------------

      transaction.set(
        userRef,
        {
          walletBalance:
            balanceAfter,

          updatedAt: now,
        },
        {
          merge: true,
        }
      );

      // ------------------------------------------------------
      // WALLET TRANSACTION
      // ------------------------------------------------------

      transaction.set(
        fundingRef,
        {
          uid: cleanUid,

          type: "wallet_funding",

          status: "completed",

          fundingMethod: method,

          reference: cleanReference,

          grossAmount: amount,

          fee,

          creditedAmount,

          balanceBefore,

          balanceAfter,

          currency: "NGN",

          channel:
            payment?.channel || "",

          paymentStatus:
            payment?.status || "success",

          paystackTransactionId:
            payment?.id || null,

          customerEmail:
            payment?.customer?.email || null,

          paymentData:
            payment || {},

          createdAt: now,

          completedAt: now,
        }
      );

      // ------------------------------------------------------
      // WALLET HISTORY
      // ------------------------------------------------------

      transaction.set(
        historyRef,
        {
          uid: cleanUid,

          type: "wallet_funding",

          status: "completed",

          fundingMethod: method,

          reference: cleanReference,

          amount: creditedAmount,

          grossAmount: amount,

          fee,

          balanceBefore,

          balanceAfter,

          description:
            method === "online_payment"
              ? "Wallet funded via online payment"
              : "Wallet funded via bank transfer",

          createdAt: now,
        }
      );

      return {
        duplicate: false,

        uid: cleanUid,

        reference: cleanReference,

        grossAmount: amount,

        fee,

        creditedAmount,

        balanceBefore,

        balanceAfter,

        method,
      };
    });

  return result;
}

// ============================================================
// PROCESS ONLINE PAYSTACK PAYMENT
// ============================================================

async function processOnlineWalletPayment(
  payment
) {
  const metadata =
    payment?.metadata || {};

  const uid =
    cleanString(metadata.uid);

  const reference =
    cleanString(
      payment?.reference
    );

  const status =
    cleanString(
      payment?.status
    ).toLowerCase();

  if (!uid) {
    throw new Error(
      "Online payment UID missing"
    );
  }

  if (!reference) {
    throw new Error(
      "Online payment reference missing"
    );
  }

  if (status !== "success") {
    throw new Error(
      `Payment status is ${status || "unknown"}`
    );
  }

  const amount =
    money(
      Number(payment.amount || 0) / 100
    );

  return await processWalletFunding({
    uid,

    reference,

    grossAmount: amount,

    payment,

    method: "online_payment",
  });
}

// ============================================================
// PROCESS DVA PAYMENT
// ============================================================

async function processVirtualAccountPayment(
  payment
) {
  const reference =
    cleanString(
      payment?.reference
    );

  const amount =
    money(
      Number(payment?.amount || 0) / 100
    );

  const receiverAccount =
    cleanString(
      payment?.receiver?.account_number ||
      payment?.receiver?.accountNumber ||
      payment?.account_number
    );

  if (!receiverAccount) {
    throw new Error(
      "Virtual account number not found in Paystack payment"
    );
  }

  // ----------------------------------------------------------
  // Find user by virtual account
  // ----------------------------------------------------------

  const query =
    await db
      .collection("users")
      .where(
        "virtualAccount.accountNumber",
        "==",
        receiverAccount
      )
      .limit(1)
      .get();

  if (query.empty) {
    throw new Error(
      `No user found for virtual account ${receiverAccount}`
    );
  }

  const userDoc =
    query.docs[0];

  const uid =
    userDoc.id;

  return await processWalletFunding({
    uid,

    reference,

    grossAmount: amount,

    payment,

    method: "bank_transfer",
  });
}

// ============================================================
// CREATE / GET VIRTUAL ACCOUNT
// ============================================================

app.post(
  "/api/wallet/virtual-account",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const uid =
        req.user.uid;

      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          success: false,
          available: false,
          message:
            "PAYSTACK_SECRET_KEY is not configured",
        });
      }

      const user =
        await ensureUserDocument(
          uid,
          {
            email:
              req.user.email || "",
          }
        );

      // ------------------------------------------------------
      // Existing virtual account
      // ------------------------------------------------------

      if (
        user.virtualAccount?.accountNumber
      ) {
        return res.json({
          success: true,

          available: true,

          virtualAccount:
            user.virtualAccount,

          message:
            "Virtual account already exists",
        });
      }

      // ------------------------------------------------------
      // Get / create customer
      // ------------------------------------------------------

      const {
        customerCode,
      } =
        await getOrCreatePaystackCustomer(
          uid
        );

      // ------------------------------------------------------
      // Create DVA
      // ------------------------------------------------------

      try {
        const response =
          await axios.post(
            `${PAYSTACK_BASE_URL}/dedicated_account`,
            {
              customer:
                customerCode,

              preferred_bank:
                PAYSTACK_DVA_BANK,
            },
            {
              headers:
                paystackHeaders(),

              timeout: 30000,
            }
          );

        if (!response.data?.status) {
          throw new Error(
            response.data?.message ||
            "Unable to create virtual account"
          );
        }

        const virtualAccount =
          normalizeVirtualAccount(
            response.data.data
          );

        // ----------------------------------------------------
        // DVA returned but account number missing
        // ----------------------------------------------------

        if (!virtualAccount) {
          return res.status(200).json({
            success: false,

            available: false,

            pending: true,

            dvaUnavailable: false,

            virtualAccount: null,

            message:
              "Virtual account is still being created. Please try again shortly.",
          });
        }

        // ----------------------------------------------------
        // Save account
        // ----------------------------------------------------

        await db
          .collection("users")
          .doc(uid)
          .set(
            {
              virtualAccount,

              paystackCustomerCode:
                customerCode,

              updatedAt:
                admin.firestore.FieldValue.serverTimestamp(),
            },
            {
              merge: true,
            }
          );

        return res.json({
          success: true,

          available: true,

          virtualAccount,

          message:
            "Virtual account created successfully",
        });
      } catch (error) {
        const providerMessage =
          getErrorMessage(error);

        console.error(
          "Paystack DVA error:",
          providerMessage
        );

        // ----------------------------------------------------
        // DVA unavailable for business
        // ----------------------------------------------------

        const unavailable =
          /dedicated\s*nuban.*not\s*available/i.test(
            providerMessage
          ) ||
          /dedicated.*not\s*available/i.test(
            providerMessage
          );

        if (unavailable) {
          return res.status(200).json({
            success: false,

            available: false,

            pending: false,

            dvaUnavailable: true,

            virtualAccount: null,

            message:
              "Dedicated NUBAN is not available for this business. Please use Online Payment.",
          });
        }

        return res.status(400).json({
          success: false,

          available: false,

          virtualAccount: null,

          message:
            providerMessage,
        });
      }
    } catch (error) {
      console.error(
        "Virtual account endpoint error:",
        error
      );

      return res.status(500).json({
        success: false,

        available: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// GET VIRTUAL ACCOUNT
// ============================================================

app.get(
  "/api/wallet/virtual-account/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const uid =
        req.params.uid;

      const user =
        await getUser(uid);

      if (!user) {
        return res.status(404).json({
          success: false,

          available: false,

          message:
            "User not found",
        });
      }

      if (
        user.virtualAccount?.accountNumber
      ) {
        return res.json({
          success: true,

          available: true,

          virtualAccount:
            user.virtualAccount,
        });
      }

      return res.json({
        success: false,

        available: false,

        virtualAccount: null,

        message:
          "Dedicated NUBAN is not available. Please use Online Payment.",
      });
    } catch (error) {
      console.error(
        "Get virtual account error:",
        error
      );

      return res.status(500).json({
        success: false,

        available: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// ONLINE PAYMENT INITIALIZE
// ============================================================

app.post(
  "/api/wallet/online-payment/initialize",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          success: false,

          message:
            "PAYSTACK_SECRET_KEY is not configured",
        });
      }

      const uid =
        req.user.uid;

      const amount =
        money(
          req.body?.amount
        );

      // ------------------------------------------------------
      // Validate amount
      // ------------------------------------------------------

      if (amount < MIN_DEPOSIT) {
        return res.status(400).json({
          success: false,

          message:
            `Minimum deposit is ₦${MIN_DEPOSIT}`,
        });
      }

      const user =
        await ensureUserDocument(
          uid,
          {
            email:
              req.user.email || "",
          }
        );

      const email =
        cleanString(
          user.email ||
          req.user.email ||
          ""
        ).toLowerCase();

      if (!isValidEmail(email)) {
        return res.status(400).json({
          success: false,

          message:
            "A valid email address is required for online payment",
        });
      }

      // ------------------------------------------------------
      // Reference
      // ------------------------------------------------------

      const reference =
        requestId(
          "WALLET"
        );

      // ------------------------------------------------------
      // Paystack initialize
      // ------------------------------------------------------

      const payload = {
        email,

        amount:
          Math.round(
            amount * 100
          ),

        currency: "NGN",

        reference,

        metadata: {
          uid,

          app:
            APP_NAME,

          type:
            "wallet_funding",

          fundingMethod:
            "online_payment",
        },
      };

      if (PAYSTACK_CALLBACK_URL) {
        payload.callback_url =
          PAYSTACK_CALLBACK_URL;
      }

      const response =
        await axios.post(
          `${PAYSTACK_BASE_URL}/transaction/initialize`,
          payload,
          {
            headers:
              paystackHeaders(),

            timeout: 30000,
          }
        );

      if (!response.data?.status) {
        return res.status(400).json({
          success: false,

          message:
            response.data?.message ||
            "Unable to initialize payment",
        });
      }

      const payment =
        response.data.data;

      return res.json({
        success: true,

        reference:
          payment.reference,

        authorizationUrl:
          payment.authorization_url,

        accessCode:
          payment.access_code,

        amount,

        fee:
          DEPOSIT_FEE,

        expectedWalletCredit:
          money(
            amount - DEPOSIT_FEE
          ),

        message:
          "Online payment initialized successfully",
      });
    } catch (error) {
      console.error(
        "Online payment initialize error:",
        error?.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// VERIFY ONLINE PAYMENT
// ============================================================

app.get(
  "/api/wallet/online-payment/verify/:reference",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).json({
          success: false,

          message:
            "PAYSTACK_SECRET_KEY is not configured",
        });
      }

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

      const response =
        await axios.get(
          `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(
            reference
          )}`,
          {
            headers:
              paystackHeaders(),

            timeout: 30000,
          }
        );

      if (!response.data?.status) {
        return res.status(400).json({
          success: false,

          message:
            response.data?.message ||
            "Unable to verify payment",
        });
      }

      const payment =
        response.data.data;

      const status =
        cleanString(
          payment?.status
        ).toLowerCase();

      // ------------------------------------------------------
      // Not successful yet
      // ------------------------------------------------------

      if (status !== "success") {
        return res.json({
          success: false,

          processed: false,

          status,

          reference,

          message:
            `Payment status: ${status || "unknown"}`,
        });
      }

      // ------------------------------------------------------
      // Verify metadata UID
      // ------------------------------------------------------

      const paymentUid =
        cleanString(
          payment?.metadata?.uid
        );

      if (
        !paymentUid ||
        paymentUid !== req.user.uid
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Payment does not belong to this user",
        });
      }

      // ------------------------------------------------------
      // Process wallet funding
      // ------------------------------------------------------

      const result =
        await processOnlineWalletPayment(
          payment
        );

      return res.json({
        success: true,

        processed: true,

        result,

        message:
          result.duplicate
            ? "Payment was already credited"
            : "Wallet funded successfully",
      });
    } catch (error) {
      console.error(
        "Online payment verification error:",
        error?.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// PAYSTACK WEBHOOK
// IMPORTANT: RAW BODY MUST BE USED
// ============================================================

app.post(
  "/api/payment/webhook",
  express.raw({
    type: "application/json",
  }),
  async (req, res) => {
    try {
      if (!PAYSTACK_SECRET_KEY) {
        return res.status(500).send(
          "PAYSTACK_SECRET_KEY not configured"
        );
      }

      const signature =
        req.headers[
          "x-paystack-signature"
        ];

      if (!signature) {
        return res.status(401).send(
          "Missing signature"
        );
      }

      const rawBody =
        req.body;

      const hash =
        crypto
          .createHmac(
            "sha512",
            PAYSTACK_SECRET_KEY
          )
          .update(rawBody)
          .digest("hex");

      if (
        hash.toLowerCase() !==
        String(signature).toLowerCase()
      ) {
        console.error(
          "Invalid Paystack webhook signature"
        );

        return res.status(401).send(
          "Invalid signature"
        );
      }

      const event =
        JSON.parse(
          rawBody.toString("utf8")
        );

      console.log(
        "PAYSTACK WEBHOOK:",
        event.event
      );

      // ------------------------------------------------------
      // CHARGE SUCCESS
      // ------------------------------------------------------

      if (
        event.event ===
        "charge.success"
      ) {
        const payment =
          event.data || {};

        const metadata =
          payment.metadata || {};

        const channel =
          cleanString(
            payment.channel
          ).toLowerCase();

        const receiverAccount =
          cleanString(
            payment?.receiver?.account_number ||
            payment?.receiver?.accountNumber ||
            payment?.account_number
          );

        // ----------------------------------------------------
        // ONLINE PAYMENT
        // ----------------------------------------------------

        const uid =
          cleanString(
            metadata.uid
          );

        const type =
          cleanString(
            metadata.type
          );

        if (
          uid &&
          type ===
            "wallet_funding"
        ) {
          try {
            const result =
              await processOnlineWalletPayment(
                payment
              );

            console.log(
              "ONLINE WALLET PAYMENT PROCESSED:",
              result
            );

            return res.json({
              success: true,

              processed: true,

              result,
            });
          } catch (error) {
            console.error(
              "Online webhook processing error:",
              error.message
            );

            return res.status(500).json({
              success: false,

              message:
                error.message,
            });
          }
        }

        // ----------------------------------------------------
        // DEDICATED VIRTUAL ACCOUNT
        // ----------------------------------------------------

        const isDVA =
          channel ===
            "dedicated_nuban" ||
          !!receiverAccount;

        if (isDVA) {
          try {
            const result =
              await processVirtualAccountPayment(
                payment
              );

            console.log(
              "DVA WALLET PAYMENT PROCESSED:",
              result
            );

            return res.json({
              success: true,

              processed: true,

              result,
            });
          } catch (error) {
            console.error(
              "DVA webhook processing error:",
              error.message
            );

            return res.status(500).json({
              success: false,

              message:
                error.message,
            });
          }
        }
      }

      // ------------------------------------------------------
      // Return OK for other Paystack events
      // ------------------------------------------------------

      return res.json({
        success: true,

        received: true,
      });
    } catch (error) {
      console.error(
        "Paystack webhook error:",
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
// NORMAL JSON BODY
// IMPORTANT: AFTER WEBHOOK
// ============================================================

app.use(
  express.json({
    limit: "1mb",
  })
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
      const uid =
        req.params.uid;

      const user =
        await getUser(uid);

      if (!user) {
        return res.status(404).json({
          success: false,

          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        uid,

        balance:
          money(
            user.walletBalance || 0
          ),

        walletBalance:
          money(
            user.walletBalance || 0
          ),

        currency: "NGN",
      });
    } catch (error) {
      console.error(
        "Wallet balance error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// WALLET DETAILS
// ============================================================

app.get(
  "/api/wallet/details/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const uid =
        req.params.uid;

      const user =
        await getUser(uid);

      if (!user) {
        return res.status(404).json({
          success: false,

          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        uid,

        walletBalance:
          money(
            user.walletBalance || 0
          ),

        virtualAccount:
          user.virtualAccount ||
          null,

        paystackCustomerCode:
          user.paystackCustomerCode ||
          null,

        currency: "NGN",
      });
    } catch (error) {
      console.error(
        "Wallet details error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// WALLET HISTORY
// ============================================================

app.get(
  "/api/wallet/history/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const uid =
        req.params.uid;

      const snapshot =
        await db
          .collection("walletHistory")
          .where(
            "uid",
            "==",
            uid
          )
          .orderBy(
            "createdAt",
            "desc"
          )
          .limit(50)
          .get();

      const history =
        snapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...doc.data(),
          })
        );

      return res.json({
        success: true,

        history,
      });
    } catch (error) {
      console.error(
        "Wallet history error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB WALLET BALANCE
// ============================================================

app.get(
  "/api/cheapdatahub/wallet-balance",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      if (!CHEAPDATAHUB_API_KEY) {
        return res.status(500).json({
          success: false,

          message:
            "CHEAPDATAHUB_API_KEY is not configured",
        });
      }

      const response =
        await axios.get(
          `${CHEAPDATAHUB_BASE_URL}/resellers/wallet/balance`,
          {
            headers:
              cheapDataHubHeaders(),

            timeout: 30000,
          }
        );

      return res.json({
        success:
          response.data?.status !== false,

        data:
          response.data,
      });
    } catch (error) {
      console.error(
        "CheapDataHub wallet error:",
        error?.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// CHEAPDATAHUB BUY DATA
// ============================================================

app.post(
  "/api/cheapdatahub/buy-data",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      if (!CHEAPDATAHUB_API_KEY) {
        return res.status(500).json({
          success: false,

          message:
            "CHEAPDATAHUB_API_KEY is not configured",
        });
      }

      const uid =
        req.user.uid;

      const bundleId =
        cleanString(
          req.body?.bundle_id
        );

      const phoneNumber =
        cleanString(
          req.body?.phone_number
        );

      const amount =
        money(
          req.body?.amount
        );

      if (!bundleId) {
        return res.status(400).json({
          success: false,

          message:
            "bundle_id is required",
        });
      }

      if (
        !/^\d{11}$/.test(
          phoneNumber
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid phone number",
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid data plan amount",
        });
      }

      const userRef =
        db
          .collection("users")
          .doc(uid);

      // ------------------------------------------------------
      // Deduct wallet first
      // ------------------------------------------------------

      const transactionResult =
        await db.runTransaction(
          async (transaction) => {
            const userSnap =
              await transaction.get(
                userRef
              );

            if (!userSnap.exists) {
              throw new Error(
                "User not found"
              );
            }

            const userData =
              userSnap.data();

            const currentBalance =
              money(
                userData.walletBalance ||
                  0
              );

            if (
              currentBalance <
              amount
            ) {
              throw new Error(
                "Insufficient wallet balance"
              );
            }

            const newBalance =
              money(
                currentBalance -
                  amount
              );

            transaction.update(
              userRef,
              {
                walletBalance:
                  newBalance,

                updatedAt:
                  admin.firestore.FieldValue.serverTimestamp(),
              }
            );

            return {
              balanceBefore:
                currentBalance,

              balanceAfter:
                newBalance,
            };
          }
        );

      const reference =
        requestId(
          "DATA"
        );

      // ------------------------------------------------------
      // Call CheapDataHub
      // ------------------------------------------------------

      let providerResponse;

      try {
        const response =
          await axios.post(
            `${CHEAPDATAHUB_BASE_URL}/resellers/data/purchase/`,
            {
              bundle_id:
                bundleId,

              phone_number:
                phoneNumber,
            },
            {
              headers:
                cheapDataHubHeaders(),

              timeout: 60000,
            }
          );

        providerResponse =
          response.data;
      } catch (providerError) {
        // ----------------------------------------------------
        // Refund wallet
        // ----------------------------------------------------

        await db
          .collection("users")
          .doc(uid)
          .update({
            walletBalance:
              admin.firestore.FieldValue.increment(
                amount
              ),

            updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          });

        throw providerError;
      }

      // ------------------------------------------------------
      // Provider success detection
      // ------------------------------------------------------

      const providerStatus =
        String(
          providerResponse?.status ??
          providerResponse?.success ??
          ""
        ).toLowerCase();

      const providerSuccess =
        providerStatus === "true" ||
        providerStatus === "success" ||
        providerResponse?.success === true ||
        providerResponse?.status === true;

      if (!providerSuccess) {
        // ----------------------------------------------------
        // REFUND
        // ----------------------------------------------------

        await db
          .collection("users")
          .doc(uid)
          .update({
            walletBalance:
              admin.firestore.FieldValue.increment(
                amount
              ),

            updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
          });

        return res.status(400).json({
          success: false,

          message:
            providerResponse?.message ||
            "CheapDataHub rejected the purchase",

          providerResponse,
        });
      }

      // ------------------------------------------------------
      // Save transaction
      // ------------------------------------------------------

      await db
        .collection("transactions")
        .doc(reference)
        .set({
          uid,

          type:
            "data_purchase",

          status:
            "completed",

          reference,

          bundleId,

          phoneNumber,

          amount,

          provider:
            "cheapdatahub",

          providerReference:
            providerResponse?.reference ||
            providerResponse?.data?.reference ||
            null,

          providerResponse,

          balanceBefore:
            transactionResult.balanceBefore,

          balanceAfter:
            transactionResult.balanceAfter,

          createdAt:
            admin.firestore.FieldValue.serverTimestamp(),
        });

      return res.json({
        success: true,

        reference,

        message:
          providerResponse?.message ||
          "Data purchase successful",

        providerResponse,
      });
    } catch (error) {
      console.error(
        "CheapDataHub data purchase error:",
        error?.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// TRANSACTION STATUS
// ============================================================

app.get(
  "/api/vtpass/transaction/:requestId",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const requestIdValue =
        cleanString(
          req.params.requestId
        );

      const snap =
        await db
          .collection("transactions")
          .doc(requestIdValue)
          .get();

      if (!snap.exists) {
        return res.status(404).json({
          success: false,

          message:
            "Transaction not found",
        });
      }

      const transaction =
        snap.data();

      if (
        transaction.uid !==
        req.user.uid
      ) {
        return res.status(403).json({
          success: false,

          message:
            "Access denied",
        });
      }

      return res.json({
        success: true,

        transaction: {
          id: snap.id,
          ...transaction,
        },
      });
    } catch (error) {
      console.error(
        "Transaction status error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// GET USER PROFILE
// ============================================================

app.get(
  "/api/profile/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {
      const uid =
        req.params.uid;

      const user =
        await getUser(uid);

      if (!user) {
        return res.status(404).json({
          success: false,

          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        profile: {
          uid,

          email:
            user.email ||
            req.user.email ||
            "",

          name:
            user.name ||
            "",

          phone:
            user.phone ||
            "",

          walletBalance:
            money(
              user.walletBalance || 0
            ),
        },
      });
    } catch (error) {
      console.error(
        "Profile error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// ROOT
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

      version:
        "2.0.0",

      services: {
        firebase:
          "active",

        paystack:
          PAYSTACK_SECRET_KEY
            ? "configured"
            : "missing",

        cheapDataHub:
          CHEAPDATAHUB_API_KEY
            ? "configured"
            : "missing",

        walletFunding:
          "online_payment + virtual_account",

        depositFee:
          DEPOSIT_FEE,

        minimumDeposit:
          MIN_DEPOSIT,
      },
    });
  }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      success: true,

      status:
        "healthy",

      app:
        APP_NAME,

      time:
        new Date().toISOString(),
    });
  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,

      message:
        "Endpoint not found",

      path:
        req.originalUrl,
    });
  }
);

// ============================================================
// GLOBAL ERROR HANDLER
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

app.listen(
  PORT,
  () => {
    console.log(
      "============================================"
    );

    console.log(
      "ISMAIL DEEN DATA SERVER RUNNING"
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      `APP: ${APP_NAME}`
    );

    console.log(
      `WALLET FUNDING: ONLINE PAYMENT + PAYSTACK DVA`
    );

    console.log(
      `CUSTOMER DEPOSIT CHARGE: ₦${DEPOSIT_FEE}`
    );

    console.log(
      `MINIMUM DEPOSIT: ₦${MIN_DEPOSIT}`
    );

    console.log(
      `PAYSTACK: ${
        PAYSTACK_SECRET_KEY
          ? "CONFIGURED"
          : "MISSING"
      }`
    );

    console.log(
      `CHEAPDATAHUB: ${
        CHEAPDATAHUB_API_KEY
          ? "CONFIGURED"
          : "MISSING"
      }`
    );

    console.log(
      "============================================"
    );
  }
);
