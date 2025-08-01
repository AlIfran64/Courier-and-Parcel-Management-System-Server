require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI from .env
const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.lds4lih.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log("Connected to MongoDB! Server running on port:", port);

    // DB Collections--------------------------

    // Users Collection
    const usersCollection = client.db("goQuickDb").collection("users");

    // Parcels Collection
    const parcelsCollection = client.db("goQuickDb").collection("parcels");

    // ----------------------------------------

    // Users Api------------------------------------

    // POST route to add a new user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };

      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.status(409).send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // --------------------------------------

    // Parcels Api----------------------------

    // Post: Book Parcel
    app.post("/parcels", async (req, res) => {
      try {
        const parcel = {
          ...req.body,
          status: "pending",
          createdAt: new Date(),
          _id: new ObjectId(),
        };

        const result = await parcelsCollection.insertOne(parcel);

        // Send confirmation email
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        const mailOptions = {
          from: `"GoQuick" <${process.env.EMAIL_USER}>`,
          to: parcel.email,
          subject: "🎉 Parcel Booking Confirmation",
          html: `
        <h2>Thank you, ${parcel.name}!</h2>
        <p>Your parcel has been booked successfully with the following details:</p>
        <ul>
          <li><strong>Pickup:</strong> ${parcel.pickupAddress}</li>
          <li><strong>Delivery:</strong> ${parcel.deliveryAddress}</li>
          <li><strong>Size:</strong> ${parcel.parcelSize}</li>
          <li><strong>Payment:</strong> ${parcel.paymentType}</li>
        </ul>
        <p>Status: <strong>Pending</strong></p>
        <br />
        <p>We’ll notify you once it’s out for delivery.</p>
      `,
        };

        await transporter.sendMail(mailOptions);

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error("Error booking parcel:", error);
        res.status(500).send({ success: false, message: "Booking failed" });
      }
    });

    // ---------------------------------------

    // Example route to test DB connection
    app.get("/", async (req, res) => {
      res.send("Server is up and MongoDB is connected!");
    });

    // Start the server after DB connection
    app.listen(port, () => {
      console.log(`Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}

run();
