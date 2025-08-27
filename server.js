// server.js
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(bodyParser.json());

// Serve static files (for HTML, CSS, JS)
app.use(express.static(path.join(__dirname, "public")));

// SQLite database connection (local file)
const db = new sqlite3.Database("./payments.db", (err) => {
  if (err) return console.error("SQLite DB connection failed:", err.message);
  console.log("SQLite DB connected successfully!");
});

// Create deposits table if it doesn't exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      phone_number TEXT,
      amount REAL,
      status TEXT DEFAULT 'pending',
      transaction_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("Deposits table ready!");
});

// Flutterwave secret key
const FLW_SECRET_KEY = "FLWSECK_TEST-xxxxxxxxxxxxxxxxxxxxx"; // replace with real secret

// ✅ Serve deposit.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "deposit.html"));
});

// ✅ Deposit API
app.post("/deposit", (req, res) => {
  const { user_id, amount, phone_number } = req.body;

  // Insert pending deposit
  db.run(
    `INSERT INTO deposits (user_id, phone_number, amount) VALUES (?, ?, ?)`,
    [user_id, phone_number, amount],
    function (err) {
      if (err) return res.status(500).send(err);

      const deposit_id = this.lastID;

      (async () => {
        try {
          // Call Flutterwave API
          const response = await axios.post(
            "https://api.flutterwave.com/v3/charges?type=mobile_money_rwanda",
            {
              tx_ref: "tx_" + Date.now(),
              amount: amount,
              currency: "RWF",
              payment_type: "mobilemoneyrwanda",
              order_id: deposit_id,
              redirect_url: "https://yourdomain.com/webhook",
              customer: {
                email: "user@mail.com",
                phonenumber: phone_number,
                name: "Deposit User"
              }
            },
            {
              headers: {
                Authorization: `Bearer ${FLW_SECRET_KEY}`,
                "Content-Type": "application/json"
              }
            }
          );

          res.json(response.data);
        } catch (error) {
          console.error(error.response?.data || error.message);
          res.status(500).json({ error: "Flutterwave request failed" });
        }
      })();
    }
  );
});

// ✅ Webhook to confirm deposit
app.post("/webhook", (req, res) => {
  const data = req.body.data;

  if (!data) return res.status(400).send("Invalid webhook");

  const tx_status = data.status;
  const tx_id = data.id;
  const order_id = data.order_id;

  if (tx_status === "successful") {
    db.run(
      `UPDATE deposits SET status='successful', transaction_id=? WHERE id=?`,
      [tx_id, order_id],
      (err) => {
        if (err) console.error(err);
      }
    );
  } else {
    db.run(
      `UPDATE deposits SET status='failed' WHERE id=?`,
      [order_id],
      (err) => {
        if (err) console.error(err);
      }
    );
  }

  res.status(200).send("OK");
});

// Start server
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});
