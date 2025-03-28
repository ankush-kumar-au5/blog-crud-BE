const express = require('express');
const session = require('express-session');
const mongodb = require('mongodb');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const MongoStore = require('connect-mongo');

const PORT = process.env.PORT || 5000;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'mongodb+srv://tradehere77:lNUD3RD6q6NhxtQJ@cluster0.jhuxfl9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const app = express();
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    store: MongoStore.create({
      mongoUrl: DATABASE_URL,
      collectionName: 'sessions',
    }),
    secret: 'alkdjfalks weqryqwery',
    secure: true,
    httpOnly: true,
    sameSite: "None",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 60 * 1000 }, // Session expires after 30 minutes (30 min * 60 sec * 1000 ms)
  })
);

const client = new MongoClient(DATABASE_URL, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const shutdown = async (signal) => {
  await client.close();
  process.exit(0);
};

// Handle various termination signals
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

// MongoDB connection and collection initialization
let users, posts;

async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');
    const db = client.db('mydb');
    users = db.collection('users');
    posts = db.collection('posts');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

connectToDatabase();

// Helper function to handle MongoDB operations
const handleMongoError = (err, res) => {
  if (err) {
    return res
      .status(500)
      .json({ success: false, message: 'Database operation failed.' });
  }
};

// Login route
app.post('/api/login', async (req, res) => {
  try {
    const result = await users.findOne(req.body);
    if (result) {
      const { name, _id } = result;
      req.session.user = { userName: name, userId: _id };
      return res.json({ message: 'Login successful', success: true });
    }
    res.status(401).json({ message: 'Invalid credentials', success: false });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Signup route
app.post('/api/signup', async (req, res) => {
  const { email } = req.body;
  try {
    const userExists = await users.findOne({ email });
    if (userExists) {
      return res
        .status(409)
        .json({ message: 'User already exists', success: false });
    }
    await users.insertOne(req.body);
    res
      .status(201)
      .json({ message: 'User created successfully', success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Check if user is logged in
app.get('/api/user/isLoggedIn', (req, res) => {
  res.json({ success: !!req.session.user });
});

// Authentication Middleware
app.use((req, res, next) => {
  if (req?.session?.user) {
    return next();
  }
  res
    .status(401)
    .json({
      success: false,
      message: 'User not authenticated or session expired',
    });
});

// Logout route
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logout successful', success: true });
});

// Get all posts route
app.get('/api/post', async (req, res) => {
  try {
    const data = await posts.find().toArray();
    res.json({ posts: data, user: req.session.user });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Add post route
app.post('/api/post', async (req, res) => {
  const { text } = req.body;
  const data = { user: req.session.user, text, comments: [], likes: [] };
  try {
    await posts.insertOne(data);
    res.status(201).json({ message: 'Post added successfully', success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Delete post route
app.delete('/api/delete/post', async (req, res) => {
  const id = new mongodb.ObjectID(req.body.id); // post id
  try {
    await posts.deleteOne({ _id: id });
    res.status(201).json({ success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Update post route
app.patch('/api/update/post', async (req, res) => {
  const id = new mongodb.ObjectID(req.body.id); // post id
  const { text } = req.body;
  try {
    await posts.updateOne({ _id: id }, { $set: { text } });
    res.status(201).json({ success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Like post route
app.post('/api/post/like', async (req, res) => {
  const { postId, isLiked } = req.body.data;
  const _id = new mongodb.ObjectID(postId);
  try {
    if (isLiked)
      await posts.updateOne(
        { _id },
        { $addToSet: { likes: req.session.user } }
      );
    else await posts.updateOne({ _id }, { $pull: { likes: req.session.user } });

    res.status(201).json({ success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Add comment route
app.post('/api/add/comment', async (req, res) => {
  const id = new mongodb.ObjectID(req.body.id); // post id
  const data = { comment: req.body.comment, ...req.session.user };
  try {
    await posts.updateOne({ _id: id }, { $push: { comments: data } });
    res.status(201).json({ success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

app.patch('/api/update/comment', async (req, res) => {
  const { postId, userId, oldComment, newComment } = req.body;
  try {
    const result = await posts.updateOne(
      {
        _id: new ObjectId(postId),
        'comments.userId': userId,
        'comments.comment': oldComment,
      },
      { $set: { 'comments.$.comment': newComment } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found or already updated',
      });
    }

    res.json({ success: true, message: 'Comment updated successfully' });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Delete comment route
app.delete('/api/delete/comment', async (req, res) => {
  const { comment, userId, postId } = req.body;
  const _id = new ObjectId(postId);
  try {
    await posts.updateOne(
      { _id },
      { $pull: { comments: { comment, userId } } }
    );
    res.json({ success: true });
  } catch (err) {
    handleMongoError(err, res);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
