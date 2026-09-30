// ============================================================
// ISMAIL DEEN DATA
// FRESH SERVER.JS
//
// WALLET FUNDING:
// Paystack Dedicated Virtual Account (DVA)
//
// CUSTOMER DEPOSIT CHARGE:
// ₦30 fixed
//
// EXAMPLE:
// User sends ₦1,000
// App charge = ₦30
// Wallet receives = ₦970
//
// NEVER PUT PAYSTACK SECRET KEY OR CHEAPDATAHUB API KEY
// INSIDE THE ANDROID APP.
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

const PORT = Number(process.env.PORT || 3000);

const APP_NAME =
  process.env.APP_NAME || "ISMAIL DEEN DATA";

const PAYSTACK_BASE_URL =
  process.env.PAYSTACK_BASE_URL ||
  "https://api.paystack.co";

const CHEAPDATAHUB_BASE_URL =
  process.env.CHEAPDATAHUB_BASE_URL ||
  "https://www.cheapdatahub.ng/api/v1";

const PAYSTACK_SECRET_KEY =
  process.env.PAYSTACK_SECRET_KEY || "";

const CHEAPDATAHUB_API_KEY =
  process.env.CHEAPDATAHUB_API_KEY || "";

const PAYSTACK_DVA_BANK =
  process.env.PAYSTACK_DVA_BANK ||
  "wema-bank";

// CUSTOMER CHARGE
const DEPOSIT_FEE = 30;

// Minimum amount customer can deposit
const MIN_DEPOSIT =
  Number(process.env.MIN_DEPOSIT || 100);

// ============================================================
// CORS
// ============================================================

app.use(
  cors({
    origin: true,
    credentials: false,
  })
);

// ============================================================
// FIREBASE ADMIN
// ============================================================

 function initializeFirebase() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
  }

  else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );
  }

  else {
    const serviceAccountPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      "/etc/secrets/firebase-service-account.json";

    serviceAccount =
      require(serviceAccountPath);
  }

  return admin.initializeApp({
    credential:
      admin.credential.cert(serviceAccount),
  });
 }

try {
  initializeFirebase();

  console.log(
    "Firebase Admin initialized successfully"
  );
}

catch (error) {
  console.error(
    "Firebase initialization error:",
    error.message
  );
}

const db = () =>
  admin.firestore();

// ============================================================
// HELPERS
// ============================================================

function cleanString(value) {
  return String(value ?? "").trim();
}

function cleanPhone(value) {
  return cleanString(value).replace(/\D/g, "");
}

function isValidPhone(phone) {
  return /^0\d{10}$/.test(phone);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function money(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.round(number * 100) / 100;
}

function requestId(prefix = "IDD") {
  return (
    prefix +
    "-" +
    Date.now() +
    "-" +
    crypto
      .randomBytes(5)
      .toString("hex")
  );
}

function errorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    "Unknown server error"
  );
}

// ============================================================
// PAYSTACK HEADERS
// ============================================================

function paystackHeaders() {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is missing"
    );
  }

  return {
    Authorization:
      `Bearer ${PAYSTACK_SECRET_KEY}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json",
  };
}

// ============================================================
// CHEAPDATAHUB HEADERS
// ============================================================

function cheapDataHubHeaders() {
  if (!CHEAPDATAHUB_API_KEY) {
    throw new Error(
      "CHEAPDATAHUB_API_KEY is missing"
    );
  }

  return {
    Authorization:
      `Bearer ${CHEAPDATAHUB_API_KEY}`,

    "Content-Type":
      "application/json",

    Accept:
      "application/json",
  };
}

// ============================================================
// FIREBASE AUTHENTICATION
// ============================================================

async function requireFirebaseAuth(
  req,
  res,
  next
) {
  try {
    const header =
      cleanString(
        req.headers.authorization
      );

    if (
      !header.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required",
      });
    }

    const token =
      header.substring(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message:
          "Firebase ID token is missing",
      });
    }

    const decoded =
      await admin
        .auth()
        .verifyIdToken(token);

    req.user = decoded;

    next();
  }

  catch (error) {
    console.error(
      "Firebase authentication error:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired authentication token",
    });
  }
}

// ============================================================
// ONLY ALLOW USER TO ACCESS HIS OWN UID
// ============================================================

function requireOwnUid(
  req,
  res,
  next
) {
  const uid =
    cleanString(req.params.uid);

  if (
    !uid ||
    uid !== req.user.uid
  ) {
    return res.status(403).json({
      success: false,
      message:
        "You can only access your own account",
    });
  }

  next();
}

// ============================================================
// USER
// ============================================================

async function getUser(uid) {
  const snap =
    await db()
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

// ============================================================
// CREATE PAYSTACK CUSTOMER
// ============================================================

async function createPaystackCustomer({
  uid,
  email,
  firstName,
  lastName,
  phone,
}) {
  const response =
    await axios.post(
      `${PAYSTACK_BASE_URL}/customer`,
      {
        email,
        first_name:
          firstName || undefined,
        last_name:
          lastName || undefined,
        phone:
          phone || undefined,

        metadata: {
          uid,
          app:
            APP_NAME,
        },
      },
      {
        headers:
          paystackHeaders(),

        timeout:
          30000,
      }
    );

  if (
    !response.data?.status
  ) {
    throw new Error(
      response.data?.message ||
      "Paystack customer creation failed"
    );
  }

  return response.data.data;
}

// ============================================================
// CREATE DEDICATED VIRTUAL ACCOUNT
// ============================================================

async function createDedicatedVirtualAccount({
  customerCode,
  firstName,
  lastName,
  phone,
}) {
  const response =
    await axios.post(
      `${PAYSTACK_BASE_URL}/dedicated_account`,
      {
        customer:
          customerCode,

        preferred_bank:
          PAYSTACK_DVA_BANK,

        first_name:
          firstName || undefined,

        last_name:
          lastName || undefined,

        phone:
          phone || undefined,
      },
      {
        headers:
          paystackHeaders(),

        timeout:
          30000,
      }
    );

  if (
    !response.data?.status
  ) {
    throw new Error(
      response.data?.message ||
      "Dedicated virtual account creation failed"
    );
  }

  return response.data.data;
}

// ============================================================
// NORMALIZE VIRTUAL ACCOUNT
// ============================================================

function normalizeVirtualAccount(
  account
) {
  return {
    id:
      account?.id || null,

    accountNumber:
      account?.account_number ||
      "",

    accountName:
      account?.account_name ||
      "",

    bankName:
      account?.bank?.name ||
      account?.bank_name ||
      "",

    bankSlug:
      account?.bank?.slug ||
      account?.bank_slug ||
      "",

    currency:
      account?.currency ||
      "NGN",

    active:
      account?.active !== false,
  };
}

// ============================================================
// CREATE VIRTUAL ACCOUNT
// ============================================================

app.post(
  "/api/wallet/virtual-account",
  requireFirebaseAuth,
  async (req, res) => {
    try {
      const uid =
        req.user.uid;

      const userRef =
        db()
          .collection("users")
          .doc(uid);

      const userSnap =
        await userRef.get();

      const userData =
        userSnap.exists
          ? userSnap.data()
          : {};

      // ------------------------------------------------------
      // ALREADY HAS ACCOUNT
      // ------------------------------------------------------

      if (
        userData.virtualAccount
          ?.accountNumber
      ) {
        return res.json({
          success: true,

          existing: true,

          virtualAccount:
            userData.virtualAccount,
        });
      }

      // ------------------------------------------------------
      // CUSTOMER DETAILS
      // ------------------------------------------------------

      const email =
        cleanString(
          req.body?.email ||
          userData.email ||
          req.user.email
        ).toLowerCase();

      const firstName =
        cleanString(
          req.body?.firstName ||
          userData.firstName ||
          userData.name ||
          "Customer"
        );

      const lastName =
        cleanString(
          req.body?.lastName ||
          userData.lastName ||
          ""
        );

      const phone =
        cleanPhone(
          req.body?.phone ||
          userData.phone ||
          ""
        );

      if (
        !isValidEmail(email)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid email is required",
        });
      }

      if (
        !isValidPhone(phone)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid 11-digit Nigerian phone number is required",
        });
      }

      // ------------------------------------------------------
      // PAYSTACK CUSTOMER
      // ------------------------------------------------------

      let customerCode =
        userData.paystackCustomerCode ||
        "";

      if (!customerCode) {
        const customer =
          await createPaystackCustomer({
            uid,
            email,
            firstName,
            lastName,
            phone,
          });

        customerCode =
          customer?.customer_code ||
          "";

        if (!customerCode) {
          throw new Error(
            "Paystack customer code was not returned"
          );
        }

        await userRef.set(
          {
            email,
            firstName,
            lastName,
            phone,

            paystackCustomerCode:
              customerCode,

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          },
          {
            merge: true,
          }
        );
      }

      // ------------------------------------------------------
      // DEDICATED ACCOUNT
      // ------------------------------------------------------

      const account =
        await createDedicatedVirtualAccount({
          customerCode,
          firstName,
          lastName,
          phone,
        });

      const virtualAccount =
        normalizeVirtualAccount(
          account
        );

      if (
        !virtualAccount.accountNumber
      ) {
        return res.status(202).json({
          success: true,
          pending: true,
          message:
            "Virtual account is still being created. Please try again shortly.",
        });
      }

      // ------------------------------------------------------
      // SAVE ACCOUNT
      // ------------------------------------------------------

      await userRef.set(
        {
          email,
          firstName,
          lastName,
          phone,

          paystackCustomerCode:
            customerCode,

          virtualAccount,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return res.json({
        success: true,
        existing: false,
        virtualAccount,
      });
    }

    catch (error) {
      console.error(
        "Virtual account error:",
        error?.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
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
      const user =
        await getUser(
          req.params.uid
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        virtualAccount:
          user.virtualAccount ||
          null,
      });
    }

    catch (error) {
      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
      });
    }
  }
);

// ============================================================
// PAYSTACK WEBHOOK SIGNATURE
// ============================================================

function verifyPaystackSignature(
  rawBody,
  signature
) {
  if (
    !signature ||
    !PAYSTACK_SECRET_KEY
  ) {
    return false;
  }

  const expected =
    crypto
      .createHmac(
        "sha512",
        PAYSTACK_SECRET_KEY
      )
      .update(rawBody)
      .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  }

  catch {
    return false;
  }
}

// ============================================================
// FIND USER BY DEDICATED ACCOUNT
// ============================================================

async function findUserByVirtualAccount(
  accountNumber
) {
  const snapshot =
    await db()
      .collection("users")
      .where(
        "virtualAccount.accountNumber",
        "==",
        accountNumber
      )
      .limit(1)
      .get();

  if (
    snapshot.empty
  ) {
    return null;
  }

  const doc =
    snapshot.docs[0];

  return {
    id: doc.id,
    ref: doc.ref,
    data: doc.data(),
  };
}

// ============================================================
// PROCESS DVA PAYMENT
//
// ₦1,000 received
// ₦30 app charge
// ₦970 wallet credit
// ============================================================

async function processVirtualAccountPayment(
  payment
) {
  const reference =
    cleanString(
      payment?.reference
    );

  const grossAmount =
    money(
      Number(payment?.amount || 0) /
      100
    );

  const receiverAccount =
    cleanString(
      payment
        ?.authorization
        ?.receiver_bank_account_number ||
      payment
        ?.receiver_bank_account_number
    );

  if (!reference) {
    throw new Error(
      "Paystack reference is missing"
    );
  }

  if (
    payment?.status &&
    payment.status !== "success"
  ) {
    return {
      credited: false,
      reason:
        "Payment was not successful",
    };
  }

  if (
    grossAmount <= 0
  ) {
    throw new Error(
      "Invalid payment amount"
    );
  }

  if (!receiverAccount) {
    throw new Error(
      "Receiver virtual account number was not found"
    );
  }

  if (
    grossAmount < MIN_DEPOSIT
  ) {
    return {
      credited: false,

      reason:
        `Minimum deposit is ₦${MIN_DEPOSIT}`,
    };
  }

  // ----------------------------------------------------------
  // FIND ACCOUNT OWNER
  // ----------------------------------------------------------

  const user =
    await findUserByVirtualAccount(
      receiverAccount
    );

  if (!user) {
    throw new Error(
      `No user found for account ${receiverAccount}`
    );
  }

  const uid =
    user.id;

  const userRef =
    user.ref;

  // ----------------------------------------------------------
  // ₦30 APP CHARGE
  // ----------------------------------------------------------

  const fee =
    DEPOSIT_FEE;

  const creditAmount =
    money(
      grossAmount - fee
    );

  if (
    creditAmount <= 0
  ) {
    return {
      credited: false,

      reason:
        "Amount is too small after ₦30 charge",
    };
  }

  // ----------------------------------------------------------
  // FIRESTORE TRANSACTION
  // ----------------------------------------------------------

  const transactionRef =
    db()
      .collection("walletTransactions")
      .doc(`dva-${reference}`);

  const historyRef =
    db()
      .collection("walletHistory")
      .doc(`dva-${reference}`);

  let result;

  await db().runTransaction(
    async (transaction) => {

      const oldTransaction =
        await transaction.get(
          transactionRef
        );

      // Prevent duplicate credit
      if (
        oldTransaction.exists &&
        oldTransaction.data()
          ?.status === "completed"
      ) {
        result = {
          credited: false,
          duplicate: true,
          message:
            "Payment already credited",
        };

        return;
      }

      const userSnapshot =
        await transaction.get(
          userRef
        );

      if (
        !userSnapshot.exists
      ) {
        throw new Error(
          "User document not found"
        );
      }

      const data =
        userSnapshot.data() || {};

      const balanceBefore =
        money(
          data.walletBalance || 0
        );

      const balanceAfter =
        money(
          balanceBefore +
          creditAmount
        );

      // ------------------------------------------------------
      // UPDATE WALLET
      // ------------------------------------------------------

      transaction.set(
        userRef,
        {
          walletBalance:
            balanceAfter,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      // ------------------------------------------------------
      // SAVE WALLET TRANSACTION
      // ------------------------------------------------------

      transaction.set(
        transactionRef,
        {
          uid,

          type:
            "wallet_funding",

          status:
            "completed",

          fundingMethod:
            "dedicated_virtual_account",

          reference,

          paystackTransactionId:
            payment?.id ||
            null,

          grossAmount,

          fee,

          creditedAmount:
            creditAmount,

          currency:
            payment?.currency ||
            "NGN",

          channel:
            payment
              ?.authorization
              ?.channel ||
            payment?.channel ||
            "dedicated_nuban",

          receiverAccount,

          receiverBank:
            payment
              ?.authorization
              ?.receiver_bank ||
            null,

          senderName:
            payment
              ?.authorization
              ?.sender_name ||
            null,

          senderBank:
            payment
              ?.authorization
              ?.sender_bank ||
            null,

          senderAccount:
            payment
              ?.authorization
              ?.sender_account_number ||
            null,

          balanceBefore,

          balanceAfter,

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          completedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      // ------------------------------------------------------
      // WALLET HISTORY
      // ------------------------------------------------------

      transaction.set(
        historyRef,
        {
          uid,

          type:
            "credit",

          amount:
            creditAmount,

          grossAmount,

          fee,

          balanceBefore,

          balanceAfter,

          method:
            "dedicated_virtual_account",

          reference,

          description:
            `Wallet funding ₦${grossAmount.toFixed(
              2
            )} - ₦${fee.toFixed(
              2
            )} charge`,

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      result = {
        credited: true,
        duplicate: false,
        uid,
        grossAmount,
        fee,
        creditedAmount:
          creditAmount,
        balanceBefore,
        balanceAfter,
        reference,
      };
    }
  );

  return result;
}

// ============================================================
// PAYSTACK WEBHOOK
//
// IMPORTANT:
// express.raw MUST COME BEFORE express.json()
// ============================================================

app.use(
  "/api/payment/webhook",
  express.raw({
    type:
      "application/json",
  })
);

app.post(
  "/api/payment/webhook",
  async (req, res) => {
    try {
      const rawBody =
        req.body;

      const signature =
        req.headers[
          "x-paystack-signature"
        ];

      if (
        !Buffer.isBuffer(
          rawBody
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid webhook body",
        });
      }

      // ------------------------------------------------------
      // VERIFY PAYSTACK
      // ------------------------------------------------------

      const valid =
        verifyPaystackSignature(
          rawBody,
          signature
        );

      if (!valid) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid Paystack signature",
        });
      }

      const event =
        JSON.parse(
          rawBody.toString(
            "utf8"
          )
        );

      console.log(
        "PAYSTACK EVENT:",
        event?.event
      );

      // ------------------------------------------------------
      // SUCCESS PAYMENT
      // ------------------------------------------------------

      if (
        event?.event ===
        "charge.success"
      ) {
        const payment =
          event.data || {};

        const channel =
          payment
            ?.authorization
            ?.channel ||
          payment?.channel ||
          "";

        const isDVA =
          channel ===
            "dedicated_nuban" ||
          !!payment
            ?.authorization
            ?.receiver_bank_account_number;

        if (isDVA) {
          const result =
            await processVirtualAccountPayment(
              payment
            );

          console.log(
            "DVA RESULT:",
            result
          );

          return res.json({
            success: true,
            processed: true,
            result,
          });
        }
      }

      return res.json({
        success: true,
        processed: false,
        message:
          "Webhook received",
      });
    }

    catch (error) {
      console.error(
        "WEBHOOK ERROR:",
        error?.response?.data ||
        error.message
      );

      // 500 tells Paystack processing failed
      // and it can retry the webhook.
      return res.status(500).json({
        success: false,
        message:
          "Webhook processing failed",
      });
    }
  }
);

// ============================================================
// JSON BODY
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
      const user =
        await getUser(
          req.params.uid
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        balance:
          money(
            user.walletBalance ||
            0
          ),

        currency:
          "NGN",
      });
    }

    catch (error) {
      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
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
      const user =
        await getUser(
          req.params.uid
        );

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            "User not found",
        });
      }

      return res.json({
        success: true,

        walletBalance:
          money(
            user.walletBalance ||
            0
          ),

        virtualAccount:
          user.virtualAccount ||
          null,
      });
    }

    catch (error) {
      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
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
      let limit =
        Number(
          req.query.limit || 50
        );

      limit =
        Math.min(
          Math.max(
            limit,
            1
          ),
          100
        );

      const snapshot =
        await db()
          .collection(
            "walletHistory"
          )
          .where(
            "uid",
            "==",
            req.params.uid
          )
          .orderBy(
            "createdAt",
            "desc"
          )
          .limit(limit)
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
    }

    catch (error) {
      console.error(
        "Wallet history error:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
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
      const response =
        await axios.get(
          `${CHEAPDATAHUB_BASE_URL}/resellers/wallet/balance/`,
          {
            headers:
              cheapDataHubHeaders(),

            timeout:
              30000,
          }
        );

      return res.json(
        response.data
      );
    }

    catch (error) {
      console.error(
        "CheapDataHub wallet error:",
        error?.response?.data ||
        error.message
      );

      return res.status(
        error?.response?.status ||
        500
      ).json({
        success: false,
        message:
          errorMessage(error),
      });
    }
  }
);

// ============================================================
// REFUND WALLET
// ============================================================

async function refundWallet(
  uid,
  amount,
  reference,
  reason
) {
  const userRef =
    db()
      .collection("users")
      .doc(uid);

  const refundRef =
    db()
      .collection("walletHistory")
      .doc(
        `refund-${reference}`
      );

  await db().runTransaction(
    async (transaction) => {

      const existing =
        await transaction.get(
          refundRef
        );

      if (
        existing.exists
      ) {
        return;
      }

      const userSnap =
        await transaction.get(
          userRef
        );

      if (
        !userSnap.exists
      ) {
        throw new Error(
          "User not found during refund"
        );
      }

      const data =
        userSnap.data() || {};

      const before =
        money(
          data.walletBalance ||
          0
        );

      const after =
        money(
          before + amount
        );

      transaction.update(
        userRef,
        {
          walletBalance:
            after,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );

      transaction.set(
        refundRef,
        {
          uid,

          type:
            "credit",

          amount,

          grossAmount:
            amount,

          fee: 0,

          balanceBefore:
            before,

          balanceAfter:
            after,

          method:
            "refund",

          reference,

          description:
            `Refund: ${reason}`,

          createdAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        }
      );
    }
  );
}

// ============================================================
// CHEAPDATAHUB BUY DATA
// ============================================================

app.post(
  "/api/cheapdatahub/buy-data",
  requireFirebaseAuth,
  async (req, res) => {

    const uid =
      req.user.uid;

    try {

      const bundleId =
        Number(
          req.body?.bundle_id
        );

      const phoneNumber =
        cleanPhone(
          req.body?.phone_number
        );

      const amount =
        money(
          req.body?.amount
        );

      const network =
        cleanString(
          req.body?.network
        ).toLowerCase();

      // ------------------------------------------------------
      // VALIDATION
      // ------------------------------------------------------

      if (
        !Number.isInteger(
          bundleId
        ) ||
        bundleId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid bundle_id",
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
            "Invalid Nigerian phone number",
        });
      }

      if (
        amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid amount",
        });
      }

      const id =
        requestId("DATA");

      const userRef =
        db()
          .collection("users")
          .doc(uid);

      const transactionRef =
        db()
          .collection("transactions")
          .doc(id);

      // ------------------------------------------------------
      // REMOVE MONEY FROM WALLET
      // ------------------------------------------------------

      await db().runTransaction(
        async (transaction) => {

          const userSnap =
            await transaction.get(
              userRef
            );

          if (
            !userSnap.exists
          ) {
            throw new Error(
              "USER_NOT_FOUND"
            );
          }

          const userData =
            userSnap.data() ||
            {};

          const balance =
            money(
              userData.walletBalance ||
              0
            );

          if (
            balance < amount
          ) {
            throw new Error(
              "INSUFFICIENT_WALLET"
            );
          }

          transaction.update(
            userRef,
            {
              walletBalance:
                money(
                  balance -
                  amount
                ),

              updatedAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            }
          );

          transaction.set(
            transactionRef,
            {
              uid,

              requestId:
                id,

              type:
                "data",

              provider:
                "cheapdatahub",

              network,

              bundleId,

              phoneNumber,

              amount,

              status:
                "processing",

              createdAt:
                admin.firestore
                  .FieldValue
                  .serverTimestamp(),
            }
          );
        }
      );

      // ------------------------------------------------------
      // SEND TO CHEAPDATAHUB
      // ------------------------------------------------------

      let providerResponse;

      try {

        providerResponse =
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

              timeout:
                45000,

              validateStatus:
                () => true,
            }
          );

      }

      catch (error) {

        await transactionRef.set(
          {
            status:
              "processing",

            providerMessage:
              error.message,

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        return res.status(202).json({
          success: false,

          processing: true,

          requestId: id,

          message:
            "Purchase is being processed. Check transaction status.",
        });
      }

      const providerData =
        providerResponse.data;

      const providerStatus =
        String(
          providerData?.status ??
          ""
        ).toLowerCase();

      const successful =
        providerStatus === "true" ||
        providerStatus === "success" ||
        providerStatus === "successful" ||
        providerData?.success === true;

      // ------------------------------------------------------
      // SUCCESS
      // ------------------------------------------------------

      if (successful) {

        await transactionRef.set(
          {
            status:
              "completed",

            providerResponse:
              providerData,

            providerReference:
              providerData?.reference ||
              providerData?.data?.reference ||
              null,

            completedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        const currentUser =
          await getUser(uid);

        const balanceAfter =
          money(
            currentUser
              ?.walletBalance ||
            0
          );

        await db()
          .collection(
            "walletHistory"
          )
          .add({
            uid,

            type:
              "debit",

            amount:
              -amount,

            grossAmount:
              amount,

            fee: 0,

            balanceAfter,

            method:
              "cheapdatahub",

            reference:
              providerData?.reference ||
              id,

            description:
              `Data purchase ${network} ${bundleId}`,

            createdAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          });

        return res.json({
          success: true,

          requestId: id,

          reference:
            providerData?.reference ||
            id,

          status:
            "completed",

          message:
            providerData?.message ||
            "Data purchase successful",
        });
      }

      // ------------------------------------------------------
      // PROVIDER FAILURE
      // ------------------------------------------------------

      const statusCode =
        Number(
          providerResponse.status ||
          500
        );

      if (
        statusCode >= 400 &&
        statusCode !== 500
      ) {

        await refundWallet(
          uid,
          amount,
          id,
          providerData?.message ||
            "CheapDataHub rejected transaction"
        );

        await transactionRef.set(
          {
            status:
              "failed",

            providerResponse:
              providerData,

            updatedAt:
              admin.firestore
                .FieldValue
                .serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        return res.status(400).json({
          success: false,

          requestId: id,

          status:
            "failed",

          message:
            providerData?.message ||
            "Data purchase failed",
        });
      }

      // ------------------------------------------------------
      // UNKNOWN / PROCESSING
      // ------------------------------------------------------

      await transactionRef.set(
        {
          status:
            "processing",

          providerResponse:
            providerData,

          updatedAt:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      return res.status(202).json({
        success: false,

        processing: true,

        requestId: id,

        message:
          providerData?.message ||
          "Purchase is being processed",
      });
    }

    catch (error) {

      if (
        error.message ===
        "INSUFFICIENT_WALLET"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Insufficient wallet balance",
        });
      }

      if (
        error.message ===
        "USER_NOT_FOUND"
      ) {
        return res.status(404).json({
          success: false,
          message:
            "User not found",
        });
      }

      console.error(
        "BUY DATA ERROR:",
        error?.response?.data ||
        error.message
      );

      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
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

      const id =
        cleanString(
          req.params.requestId
        );

      const snap =
        await db()
          .collection(
            "transactions"
          )
          .doc(id)
          .get();

      if (
        !snap.exists
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Transaction not found",
        });
      }

      const data =
        snap.data();

      if (
        data.uid !==
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
          id:
            snap.id,

          ...data,
        },
      });
    }

    catch (error) {

      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
      });
    }
  }
);

// ============================================================
// USER PROFILE
// ============================================================

app.get(
  "/api/user/profile/:uid",
  requireFirebaseAuth,
  requireOwnUid,
  async (req, res) => {
    try {

      const user =
        await getUser(
          req.params.uid
        );

      if (!user) {
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

          email:
            user.email || "",

          firstName:
            user.firstName || "",

          lastName:
            user.lastName || "",

          phone:
            user.phone || "",

          walletBalance:
            money(
              user.walletBalance ||
              0
            ),

          virtualAccount:
            user.virtualAccount ||
            null,
        },
      });
    }

    catch (error) {

      return res.status(500).json({
        success: false,
        message:
          errorMessage(error),
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

      walletFunding:
        "Paystack Dedicated Virtual Account",

      depositCharge:
        "₦30",

      minimumDeposit:
        `₦${MIN_DEPOSIT}`,
    });
  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      success: true,

      status:
        "ok",

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
        "Route not found",

      path:
        req.originalUrl,
    });
  }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {

    console.error(
      "UNHANDLED ERROR:",
      error
    );

    res.status(500).json({
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
      "================================================"
    );

    console.log(
      `${APP_NAME} SERVER RUNNING`
    );

    console.log(
      `PORT: ${PORT}`
    );

    console.log(
      "WALLET FUNDING: PAYSTACK DVA"
    );

    console.log(
      `CUSTOMER DEPOSIT CHARGE: ₦${DEPOSIT_FEE}`
    );

    console.log(
      `MINIMUM DEPOSIT: ₦${MIN_DEPOSIT}`
    );

    console.log(
      "================================================"
    );
  }
);
