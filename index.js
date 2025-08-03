require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { Server } = require("socket.io");
const fetch = require("node-fetch");

// Helper function to get lat/lng from address
async function getCoordinates(address) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      address
    )}`
  );
  const data = await res.json();
  if (data && data.length > 0) {
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
    };
  }
  return null;
}

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

    // Delivery agents collection
    const deliveryAgentsCollection = client
      .db("goQuickDb")
      .collection("deliveryAgents");

    // ----------------------------------------

    // Use app.listen and get the server
    const server = app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });

    // Attach socket.io to the server
    const io = new Server(server, {
      cors: {
        origin: "*", // adjust if needed
      },
    });

    // Socket.io logic
    io.on("connection", (socket) => {
      console.log("A user connected:", socket.id);

      socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
      });
    });

    // Example: emit to frontend
    app.post("/update-status", (req, res) => {
      io.emit("status-updated"); // 🔄 Notify frontend
      res.send({ message: "Status updated and clients notified" });
    });

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

    // PATCH user role and add availability
    app.patch("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const updateData = req.body;

      const result = await usersCollection.updateOne(
        { email: email },
        { $set: updateData }
      );

      res.send(result);
    });

    // GET all users
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Error fetching users" });
      }
    });

    // --------------------------------------

    // Delivery agents api-------------------

    // POST: Apply as a delivery agent
    app.post("/deliveryAgents", async (req, res) => {
      try {
        const agentData = req.body;

        // Check if user already applied
        const exists = await deliveryAgentsCollection.findOne({
          email: agentData.email,
        });
        if (exists) {
          return res.status(400).json({ message: "You have already applied." });
        }

        // Save new agent application
        const result = await deliveryAgentsCollection.insertOne({
          ...agentData,
          appliedAt: new Date(),
        });

        res.status(201).json({
          message: "Application submitted successfully.",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error applying delivery agent:", error);
        res.status(500).json({ message: "Internal Server Error" });
      }
    });

    // DELETE delivery agent request
    app.delete("/deliveryAgents/:id", async (req, res) => {
      const id = req.params.id;
      const result = await deliveryAgentsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // GET pending delivery agent requests
    app.get("/deliveryAgents", async (req, res) => {
      try {
        const deliveryAgents = await deliveryAgentsCollection
          .find({})
          .toArray();
        res.send(deliveryAgents);
      } catch (error) {
        res.status(500).send({ message: "Error fetching delivery agents" });
      }
    });

    // --------------------------------------

    // Parcels Api----------------------------

    // Post: Book Parcel
    app.post("/parcels", async (req, res) => {
      try {
        const { pickupAddress, deliveryAddress } = req.body;

        const pickupCoords = await getCoordinates(pickupAddress + ", Dhaka");

        const deliveryCoords = await getCoordinates(
          deliveryAddress + ", Dhaka"
        );

        if (!pickupCoords || !deliveryCoords) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid addresses" });
        }

        const parcel = {
          ...req.body,
          status: "Pending",
          createdAt: new Date(),
          _id: new ObjectId(),

          pickup: pickupCoords,
          delivery: deliveryCoords,
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
          subject: "Parcel Booking Confirmation",
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

    // Get: Get bookings by email
    app.get("/parcels", async (req, res) => {
      const email = req.query.email;
      const query = email ? { email } : {};
      const result = await parcelsCollection.find(query).toArray();
      res.send(result);
    });

    // Patch: Update booking status + assignTo + deliveryAgent etc.
    app.patch("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const result = await parcelsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.modifiedCount > 0) {
        io.emit("status-updated");
      }

      res.send(result);
    });

    // ---------------------------------------

    // Example route to test DB connection
    app.get("/", async (req, res) => {
      res.send("Server is up and MongoDB is connected!");
    });

    // Start the server after DB connection
    // app.listen(port, () => {
    //   console.log(`Server is running at http://localhost:${port}`);
    // });
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}

run();
