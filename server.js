require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "ISMAIL DEEN DATA Backend is running"
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

app.get("/api/payment/test", (req, res) => {
    res.json({
        success: true,
        message: "Payment backend is connected"
    });
});

// Initialize Paystack Test Payment
app.post("/api/payment/initialize", async (req, res) => {
    try {
        const { email, amount } = req.body;

        if (!email || !amount) {
            return res.status(400).json({
                success: false,
                message: "Email and amount are required"
            });
        }

        const amountInKobo = Math.round(Number(amount) * 100);

        if (!Number.isFinite(amountInKobo) || amountInKobo < 10000) {
            return res.status(400).json({
                success: false,
                message: "Minimum payment is ₦100"
            });
        }

        const response = await axios.post(
            "https://api.paystack.co/transaction/initialize",
            {
                email: email,
                amount: amountInKobo,
                currency: "NGN"
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return res.json({
            success: true,
            data: response.data.data
        });

    } catch (error) {
        console.error(
            "Paystack error:",
            error.response?.data || error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to initialize payment"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        `ISMAIL DEEN DATA server running on port ${PORT}`
    );
});
