const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 8159;
const SSLCommerzPayment = require("sslcommerz-lts");

app.use(cors({
  origin: "*",
  credentials: true  // or specify Netlify domain: "https://your-site.netlify.app"
}));
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ng1qfb3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("server is running");
});

async function run() {
  try {
    await client.connect();

    const db = client.db("BookBarn");
    const bookCollection = db.collection("Books");
    const reviewCollection = db.collection("Reviews");
    const cartCollection = db.collection("Cart");
    const userCollection = db.collection("User");
    const contactCollection = db.collection("ContactMessages");
    const billingCollection = db.collection("Billings");

    // Health check
    app.get("/health", async (req, res) => {
      try {
        await client.db("admin").command({ ping: 1 });
        const bookCount = await bookCollection.countDocuments();
        res.json({
          status: "healthy",
          mongodb: "connected",
          bookCount,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({
          status: "unhealthy",
          mongodb: "disconnected",
          error: error.message
        });
      }
    });

    // Contact messages
    app.get("/contact", async (req, res) => {
      try {
        const messages = await contactCollection.find().sort({ createdAt: -1 }).toArray();
        res.send(messages);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch contact messages" });
      }
    });

    app.post("/contact", async (req, res) => {
      const { name, email, message } = req.body;
      if (!name || !email || !message) return res.status(400).send({ message: "All fields are required." });
      try {
        const result = await contactCollection.insertOne({
          name, email, message, createdAt: new Date()
        });
        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        res.status(500).send({ success: false, message: "Server error." });
      }
    });

    // Books
    app.get("/books", async (req, res) => {
      try {
        const sellerEmail = req.query.sellerEmail;
        const query = sellerEmail ? { sellerEmail } : {};
        const result = await bookCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/books/category/:category", async (req, res) => {
      try {
        const category = req.params.category;
        const result = await bookCollection.find({ category }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.post("/books", async (req, res) => {
      try {
        const book = req.body;
        const requiredFields = ["title","author","course","condition","image","price","quantity","location","bookDescription"];
        for (const field of requiredFields) {
          if (!book[field]) return res.status(400).send({ message: `Missing required field: ${field}` });
        }

        book.price = Number(book.price);
        book.quantity = Number(book.quantity);
        book.orderCount = Number(book.orderCount || 0);

        const result = await bookCollection.insertOne(book);
        res.status(201).send({ message: "Book added successfully", insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.delete("/books/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const result = await bookCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) res.send({ message: "Book deleted successfully" });
        else res.status(404).send({ message: "Book not found" });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // Reviews
    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewCollection.find().toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.post("/reviews", async (req, res) => {
      try {
        const reviewData = req.body;
        const requiredFields = ["bookId","title","email","name","message","rating","created_at"];
        for (const field of requiredFields) if (!reviewData[field]) return res.status(400).send({ message: `Missing required field: ${field}` });

        const existingReview = await reviewCollection.findOne({ bookId: reviewData.bookId, email: reviewData.email });
        if (existingReview) return res.status(400).send({ message: "You have already reviewed this book" });

        if (reviewData.rating < 1 || reviewData.rating > 5) return res.status(400).send({ message: "Rating must be between 1 and 5" });

        const result = await reviewCollection.insertOne(reviewData);
        res.status(201).send({ message: "Review added successfully", insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // Cart
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email is required" });
      try {
        const items = await cartCollection.find({ email }).toArray();
        res.send(items);
      } catch (error) {
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/carts", async (req, res) => {
      try {
        const { email, _id: bookId, count = 1, ...bookData } = req.body;
        if (!email || !bookId) return res.status(400).send({ message: "Email and book ID are required" });

        const existingCartItem = await cartCollection.findOne({ email, bookId });
        if (existingCartItem) {
          const result = await cartCollection.updateOne({ email, bookId }, { $set: { count } });
          return res.send(result);
        } else {
          const newCartItem = { email, bookId, count, ...bookData };
          const result = await cartCollection.insertOne(newCartItem);
          return res.send(result);
        }
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.put("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const { count } = req.body;
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email is required" });
      if (!count || count < 1) return res.status(400).send({ message: "Count must be positive" });

      try {
        const result = await cartCollection.updateOne({ _id: new ObjectId(id), email }, { $set: { count } });
        if (result.matchedCount === 0) return res.status(404).send({ message: "Cart item not found" });
        return res.send({ success: true, updatedCount: count });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email is required" });

      try {
        const result = await cartCollection.deleteOne({ _id: new ObjectId(id), email });
        if (result.deletedCount === 1) res.send({ message: "Deleted successfully" });
        else res.status(404).send({ message: "Cart item not found" });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // Users
    app.post("/users", async (req, res) => {
      try {
        const newUser = req.body;
        if (!newUser?.email || !newUser?.name) return res.status(400).send({ message: "Name and email are required" });

        const existing = await userCollection.findOne({ email: newUser.email });
        if (existing) return res.status(200).send({ message: "User already exists" });

        const userData = { ...newUser, role: newUser.role || "user", created_at: new Date().toISOString() };
        const result = await userCollection.insertOne(userData);
        res.send({ message: "User created successfully", insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: "Failed to save user", error: error.message });
      }
    });

    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      if (!role || (role !== "admin" && role !== "seller" && role !== "user")) return res.status(400).send({ message: "Invalid role provided" });

      try {
        const result = await userCollection.updateOne({ email }, { $set: { role } });
        if (result.matchedCount === 0) return res.status(404).send({ message: "User not found" });
        res.send({ message: "User role updated successfully" });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const result = await userCollection.findOne({ email });
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch user" });
      }
    });

    app.get("/users", async (req, res) => {
      try {
        const result = await userCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    // Billing
    app.get("/billings", async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ message: "Email query param is required" });

      try {
        const billings = await billingCollection.find({ email }).sort({ purchasedAt: -1 }).toArray();
        res.send(billings);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch billing records" });
      }
    });

    // Payment
    app.post("/initiate-payment", async (req, res) => {
      try {
        const { email, items } = req.body;
        if (!email || !items || !Array.isArray(items)) return res.status(400).send({ message: "Invalid payment data" });

        const totalAmount = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
        const tran_id = "TID" + Date.now();

        const data = {
          total_amount: totalAmount,
          currency: "BDT",
          tran_id,
          success_url: `http://localhost:8159/payment-success?tran_id=${tran_id}&email=${email}`,
          fail_url: "http://localhost:3000/payment-fail",
          cancel_url: "http://localhost:3000/payment-cancel",
          ipn_url: "http://localhost:8159/ipn",
          shipping_method: "Courier",
          product_name: "Books",
          product_category: "Education",
          product_profile: "general",
          cus_name: email,
          cus_email: email,
          cus_add1: "Dhaka",
          cus_phone: "01700000000",
          ship_name: email,
          ship_add1: "Dhaka",
          ship_city: "Dhaka",
          ship_postcode: "1200",
          ship_country: "Bangladesh",
        };

        const sslcz = new SSLCommerzPayment(process.env.SSLCZ_STORE_ID, process.env.SSLCZ_STORE_PASS, false);
        const apiResponse = await sslcz.init(data);
        if (!apiResponse.GatewayPageURL) return res.status(500).send({ message: "Payment gateway URL not found" });

        res.send({ GatewayPageURL: apiResponse.GatewayPageURL });
      } catch (error) {
        res.status(500).send({ message: "Internal server error", error: error.message });
      }
    });

    app.post("/payment-success", async (req, res) => {
      const { tran_id, email } = req.query;
      if (!tran_id || !email) return res.status(400).send({ message: "Missing tran_id or email in query params" });

      try {
        const cartItems = await cartCollection.find({ email }).toArray();
        if (!cartItems || cartItems.length === 0) return res.status(400).send({ message: "No items in cart" });

        // Safely update quantity and orderCount
        await Promise.all(cartItems.map(async item => {
          const book = await bookCollection.findOne({ _id: new ObjectId(item.bookId) });
          if (!book) return;

          await bookCollection.updateOne(
            { _id: new ObjectId(item.bookId) },
            {
              $set: {
                quantity: Number(book.quantity) - item.count,
                orderCount: Number(book.orderCount || 0) + item.count
              }
            }
          );
        }));

        const billingData = {
          email,
          transactionId: tran_id,
          items: cartItems.map(item => ({
            bookId: item.bookId,
            title: item.title,
            author: item.author,
            price: item.price,
            quantity: item.count,
            image: item.image
          })),
          purchasedAt: new Date()
        };

        await billingCollection.insertOne(billingData);
        await cartCollection.deleteMany({ email });

        res.redirect("http://localhost:5173/dashboard/delivery-status");
      } catch (error) {
        console.error("Payment success processing failed:", error);
        res.status(500).send({ message: "Payment success processing failed" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. Connected to MongoDB!");

    // app.listen(port, () => {
    //   console.log(`BookBarn backend running on port ${port}`);
    // });

  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

run().catch(console.dir);
module.exports = app;
