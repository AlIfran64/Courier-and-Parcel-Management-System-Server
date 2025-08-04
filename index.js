require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const nodemailer = require("nodemailer");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
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

// Firebase Admin SDK
const serviceAccount = require("./goquick-firebase-adminsdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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

    // Custom Middleware
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }

      // Verify token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    };

    // Verify User
    const verifyCustomer = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "customer") {
        return res
          .status(403)
          .send({ message: "Only users can access this route" });
      }
      next();
    };

    // Verify Member
    const verifyDeliveryAgent = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (!user || user.role !== "deliveryAgent") {
        return res
          .status(403)
          .send({ message: "Only members can access this route" });
      }
      next();
    };

    // Verify admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };

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
    app.patch(
      "/users/role/:email",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const updateData = req.body;

        const result = await usersCollection.updateOne(
          { email: email },
          { $set: updateData }
        );

        res.send(result);
      }
    );

    // GET all users
    app.get("/users", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Error fetching users" });
      }
    });

    // GET: Get user role by email ===
    app.get("/users/:email/role", verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.params.email;
        const decodedEmail = req.decoded?.email;

        if (!email || email.toLowerCase() !== decodedEmail?.toLowerCase()) {
          return res.status(403).send({ message: "Unauthorized access" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ role: user.role });
      } catch (error) {
        return res.status(500).send({ message: "Failed to get role" });
      }
    });

    // --------------------------------------

    // Delivery agents api-------------------

    // POST: Apply as a delivery agent ==
    app.post("/deliveryAgents", verifyFirebaseToken, async (req, res) => {
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
    app.delete(
      "/deliveryAgents/:id",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await deliveryAgentsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    // GET pending delivery agent requests
    app.get(
      "/deliveryAgents",
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const deliveryAgents = await deliveryAgentsCollection
            .find({})
            .toArray();
          res.send(deliveryAgents);
        } catch (error) {
          res.status(500).send({ message: "Error fetching delivery agents" });
        }
      }
    );

    // --------------------------------------

    // Parcels Api----------------------------

    // Post: Book Parcel ==
    app.post(
      "/parcels",
      verifyFirebaseToken,
      verifyCustomer,
      async (req, res) => {
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
      }
    );

    // Get: Get bookings by email ==
    app.get("/parcels", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const query = email ? { email } : {};
      const result = await parcelsCollection.find(query).toArray();
      res.send(result);
    });

    // Patch: Update booking status + assignTo + deliveryAgent etc.
    app.patch(
      "/parcels/:id",
      verifyFirebaseToken,
      verifyDeliveryAgent,
      async (req, res) => {
        const id = req.params.id;
        const updateData = req.body;

        try {
          const result = await parcelsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
          );

          if (result.modifiedCount > 0) {
            io.emit("status-updated");

            //If status is Delivered or Failed, do follow-up actions
            if (
              updateData.status === "Delivered" ||
              updateData.status === "Failed"
            ) {
              const parcel = await parcelsCollection.findOne({
                _id: new ObjectId(id),
              });

              //1. Update agent availability
              const agentEmail = parcel?.deliveryAgent?.email;
              if (agentEmail) {
                await usersCollection.updateOne(
                  { email: agentEmail },
                  { $set: { availability: "available" } }
                );
              }

              //2. Send status update email
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
                subject: `Parcel Status Update: ${updateData.status}`,
                html: `
            <h3>Hello ${parcel.name},</h3>
            <p>Your parcel status has been updated to <strong>${updateData.status}</strong>.</p>
            <ul>
              <li><strong>Pickup Address:</strong> ${parcel.pickupAddress}</li>
              <li><strong>Delivery Address:</strong> ${parcel.deliveryAddress}</li>
            </ul>
            <br />
            <p>Thank you for using GoQuick!</p>
          `,
              };

              await transporter.sendMail(mailOptions);
              console.log("Status email sent to", parcel.email);
            }
          }

          res.send(result);
        } catch (err) {
          console.error("Error in PATCH /parcels/:id:", err);
          res.status(500).send({ message: "Internal server error" });
        }
      }
    );

    // Get: Assigned parcels to a delivery agent
    app.get(
      "/parcels/assigned",
      verifyFirebaseToken,
      verifyDeliveryAgent,
      async (req, res) => {
        const email = req.query.email;

        const query = {
          "deliveryAgent.email": email,
          status: { $nin: ["Delivered", "Failed"] },
        };

        try {
          const assignedParcels = await parcelsCollection.find(query).toArray();
          res.send(assignedParcels);
        } catch (error) {
          console.error("Failed to fetch assigned parcels:", error);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

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
