const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');
const admin = require("firebase-admin");
const cookieParser = require('cookie-parser');



// Load environment variables from .env file
dotenv.config();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);




const app = express();
const port = process.env.PORT || 3000;


const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});



// Middleware
// app.use(cors());
app.use(cors({
    origin: 'http://localhost:5173', //https://tutorhub-pro.web.app
    credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// === Bangladesh Time Helper ===
const getBDTime = () => {
    const now = new Date();
    return new Date(now.getTime() + 6 * 60 * 60 * 1000); // Add 6 hours
};



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zkmnmze.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        // ======================================================
        const db = client.db('tutorDB');
        const usersCollection = db.collection('usersCollection');
        const tutorsCollection = db.collection('tutorsCollection');
        const adminCollection = db.collection('adminCollection');
        const sessionsCollection = db.collection('sessions');
        const materialsCollection = db.collection('materials');
        const paymentsCollection = db.collection('payments');
        const notesCollection = db.collection('notesCollection');



        //custom middlewares
        const verifyFBToken = async (req, res, next) => {
            let token;

            if (req.cookies?.token) {
                token = req.cookies.token;
            }

            else if (req.headers?.authorization?.startsWith('Bearer ')) {
                token = req.headers.authorization.split(' ')[1];
            }

            if (!token) {
                return res.status(401).send({ message: 'unauthorized access' });
            }

            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();
            } catch (error) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
        }


        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded?.email;

            const user = await adminCollection.findOne({ email });
            console.log(user);

            next();
        };

        const verifyTutor = async (req, res, next) => {
            try {
                const userEmail = req.decoded.email;
                const tutor = await tutorsCollection.findOne({ email: userEmail });

                if (!tutor || tutor.status !== 'approved') {
                    return res.status(403).json({ message: 'Forbidden: Not an approved tutor' });
                }

                next();
            } catch (error) {
                console.error('verifyTutor error:', error);
                res.status(500).json({ message: 'Server error in verifyTutor' });
            }
        };



        const verifyStudent = async (req, res, next) => {
            const email = req.decoded?.email;

            try {
                const user = await usersCollection.findOne({ email });

                if (!user || user.role !== "student") {
                    return res.status(403).send({ message: "Forbidden: Student only" });
                }

                next();
            } catch (error) {
                console.error("Error in verifyStudent middleware:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        };


        // ================== LOGIN =====================
        app.post('/login', async (req, res) => {
            const { token } = req.body;

            if (!token) {
                return res.status(400).send({ message: 'Token is required' });
            }

            try {
                const decoded = await admin.auth().verifyIdToken(token);

                // Set HTTP-only cookie
                res.cookie('token', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production', // set to true in production
                    sameSite: 'Lax',
                    maxAge: 1000 * 60 * 60 * 24 * 30,
                });

                res.send({ message: 'Login successful' });
            } catch (error) {
                console.error('Login error:', error);
                res.status(401).send({ message: 'Unauthorized' });
            }
        });

        // ================== LOGOUT =====================
        app.post('/logout', (req, res) => {
            res.clearCookie('token');
            res.send({ message: 'Logged out successfully' });
        });






        // ======================================================
        // user collection
        app.post("/users", async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const options = { upsert: true };
            const updateDoc = {
                $setOnInsert: {
                    uid: user.uid,
                    name: user.name,
                    email: user.email,
                    photoURL: user.photoURL,
                    role: "student",
                    createdAt: getBDTime()
                }
            };

            try {
                const result = await usersCollection.updateOne(query, updateDoc, options);
                console.log("✅ User Sync Result:", result);
                res.send({
                    success: result.upsertedCount > 0,
                    message: result.upsertedCount > 0 ? "New user inserted" : "User already existed",
                    result,
                });
            } catch (error) {
                console.error("❌ User sync failed:", error);
                res.status(500).send("User sync failed");
            }
        });


        // ======================================================

        // POST /tutors - add new tutor application
        app.post('/tutors', async (req, res) => {
            try {
                const tutorData = req.body;

                // Basic validation (you can extend)
                if (!tutorData.email || !tutorData.name) {
                    return res.status(400).json({ error: 'Name and email are required' });
                }

                // Insert tutor data into DB
                const result = await tutorsCollection.insertOne(tutorData);

                if (result.insertedId) {
                    res.status(200).json({ insertedId: result.insertedId });
                } else {
                    res.status(500).json({ error: 'Failed to add tutor' });
                }
            } catch (err) {
                console.error('Error inserting tutor:', err);
                res.status(500).json({ error: 'Server error' });
            }
        });

        //-------------------------------------------------------

        app.get('/tutors/all', verifyFBToken, verifyAdmin, async (req, res) => {
            const { status, search } = req.query;
            const filter = {};
            if (status) filter.status = status;
            if (search) filter.name = { $regex: search, $options: 'i' };

            try {
                const tutors = await tutorsCollection.find(filter).toArray();
                res.status(200).json(tutors);
            } catch (error) {
                console.error('Error fetching tutors:', error);
                res.status(500).json({ error: 'Server error' });
            }
        });

        //-------------------------------------------------------
        app.get('/tutors/pending', verifyFBToken, verifyAdmin, async (req, res) => {
            console.log(req.decoded);
            try {
                const pendingTutors = await tutorsCollection.find({ status: 'pending' }).toArray();
                res.status(200).json(pendingTutors);
            } catch (error) {
                console.error('Error fetching pending tutors:', error);
                res.status(500).json({ message: 'Server error' });
            }
        });


        app.get('/tutors/email/:email', async (req, res) => {
            const email = req.params.email;
            const tutor = await tutorsCollection.findOne({ email });
            res.send(tutor || {});
        });

        //-------------------------------------------------------
        app.delete('/tutors/:id', async (req, res) => {
            const id = req.params.id;
            const result = await tutorsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });
        //-------------------------------------------------------

        // GET pending tutors
        app.get('/tutors', verifyFBToken, verifyAdmin, async (req, res) => {
            const status = req.query.status;
            if (!status) return res.status(400).json({ error: 'Status is required' });

            const result = await tutorsCollection.find({ status }).toArray();
            res.send(result);
        });


        //------------------------------------------------------

        // Example Express PATCH route for tutor update

        app.patch('/tutors/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const { status, feedback } = req.body;
            const updateDoc = {};
            if (status) updateDoc.status = status;
            if (status === 'cancelled' && feedback) updateDoc.feedback = feedback;

            const result = await tutorsCollection.updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: updateDoc }
            );

            res.send(result);
        });



        // ======================================================

        app.get('/users/role/:email', verifyFBToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;

            try {
                // 1. Check Admin
                const isAdmin = await adminCollection.findOne({ email });
                if (isAdmin) {
                    return res.json({ role: 'admin' });
                }

                // 2. Check Tutor
                const isTutor = await tutorsCollection.findOne({ email, status: 'approved' });
                if (isTutor) {
                    return res.json({ role: 'tutor' });
                }

                // 3. Default Student
                return res.json({ role: 'student' });
            } catch (error) {
                console.error('Error checking role:', error);
                return res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ======================================================

        // ======================================================

        app.get('/admin/users', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { search = '', page = 1, limit = 10 } = req.query;
                const pageNum = parseInt(page);
                const limitNum = parseInt(limit);

                // Search filter
                const searchFilter = {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { email: { $regex: search, $options: 'i' } },
                    ],
                };

                // Total count
                const total = await usersCollection.countDocuments(searchFilter);

                // Users with pagination
                const users = await usersCollection
                    .find(searchFilter)
                    .skip((pageNum - 1) * limitNum)
                    .limit(limitNum)
                    .toArray();

                // Fetch approved tutors and all admins
                const [approvedTutors, admins] = await Promise.all([
                    tutorsCollection.find({ status: 'approved' }, { projection: { email: 1 } }).toArray(),
                    adminCollection.find({}, { projection: { email: 1 } }).toArray()
                ]);

                const tutorEmailsSet = new Set(approvedTutors.map(t => t.email));
                const adminEmailsSet = new Set(admins.map(a => a.email));

                // Assign correct role
                const usersWithRole = users.map(user => {
                    const email = user.email;
                    if (adminEmailsSet.has(email)) {
                        return { ...user, role: 'admin' };
                    } else if (tutorEmailsSet.has(email)) {
                        return { ...user, role: 'tutor' };
                    } else {
                        return { ...user, role: user.role || 'student' };
                    }
                });

                res.json({ users: usersWithRole, total });
            } catch (error) {
                console.error('Error fetching users:', error);
                res.status(500).json({ error: 'Server error' });
            }
        });


        // ======================================================
        // ✅ ADDED THIS PATCH ROUTE TO UPDATE USER ROLE
        app.patch('/admin/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            try {
                const user = await usersCollection.findOne({ _id: new ObjectId(id) });
                if (!user) return res.status(404).json({ message: 'User not found' });

                const email = user.email;

                // Step 1: Remove only from adminCollection if not admin anymore
                if (role !== 'admin') {
                    await adminCollection.deleteOne({ email });
                }

                // Step 2: Add to adminCollection if role is admin
                if (role === 'admin') {
                    const isAlreadyAdmin = await adminCollection.findOne({ email });
                    if (!isAlreadyAdmin) {
                        await adminCollection.insertOne({ email });
                    }
                }

                // Step 3: Update tutorsCollection
                if (role === 'tutor') {
                    const existingTutor = await tutorsCollection.findOne({ email });

                    if (!existingTutor) {
                        // Create new tutor with info from user
                        await tutorsCollection.insertOne({
                            name: user.name,
                            email: user.email,
                            photo: user.photoURL || '',
                            status: 'approved',
                            createdAt: getBDTime()
                        });
                    } else {
                        // Ensure status is approved if already exists
                        await tutorsCollection.updateOne(
                            { email },
                            {
                                $set: {
                                    status: 'approved'
                                }
                            }
                        );
                    }
                } else {
                    // If role is not tutor anymore, just update status if needed
                    await tutorsCollection.updateOne(
                        { email },
                        { $set: { status: 'removed' } }
                    );
                }

                // Step 4: Update usersCollection role field (optional fallback)
                await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );

                res.json({ success: true, message: `Role updated to ${role}` });
            } catch (error) {
                console.error('❌ Failed to update role:', error);
                res.status(500).json({ success: false, message: 'Internal server error' });
            }
        });



        // ======================================================

        app.post('/sessions', verifyFBToken, verifyTutor, async (req, res) => {
            try {
                const session = req.body;
                const result = await sessionsCollection.insertOne({
                    ...session,
                    status: 'pending',
                    createdAt: getBDTime(),
                });
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error('Failed to add session:', error);
                res.status(500).send({ error: 'Failed to add session' });
            }
        });

        //---------------------------------------------------------
        app.get('/admin/sessions', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const sessions = await sessionsCollection.find().toArray();
                res.send(sessions);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch sessions' });
            }
        });

        //-------------------------------------------------------

        app.patch('/admin/sessions/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            const updates = req.body;

            try {
                const result = await sessionsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updates }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to update session' });
            }
        });

        //------------------------------------------------------

        // Make /sessions only return approved if no tutorEmail
        app.get('/sessions', async (req, res) => {
            const { tutorEmail } = req.query;

            let filter = {};
            if (tutorEmail) {
                filter = { tutorEmail }; // Remove status filter here
            } else {
                filter = { status: 'approved' };
            }

            try {
                const sessions = await sessionsCollection.find(filter).toArray();
                res.json(sessions);
            } catch (err) {
                console.error(err);
                res.status(500).json({ error: 'Failed to fetch sessions' });
            }
        });



        //-------------------------------------------------------

        // GET /sessions/:id - fetch single session by ID
        app.get('/sessions/:id', verifyFBToken, verifyAdmin || verifyTutor, async (req, res) => {
            const { id } = req.params;
            try {
                const session = await sessionsCollection.findOne({ _id: new ObjectId(id) });
                if (!session) {
                    return res.status(404).send({ error: 'Session not found' });
                }
                res.send(session);
            } catch (error) {
                console.error(error);
                res.status(500).send({ error: 'Server error' });
            }
        });

        //-------------------------------------------------------

        app.delete('/sessions/:id', verifyFBToken, verifyTutor, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await sessionsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                console.error('Failed to delete session:', error);
                res.status(500).send({ error: 'Failed to delete session' });
            }
        });


        // ======================================================



        // GET /materials/:sessionId - Fetch uploaded materials for a session
        app.post('/materials/:sessionId', verifyFBToken, verifyAdmin || verifyTutor, async (req, res) => {
            const { sessionId } = req.params;
            const { title, description, uploadedBy, resourceLink, fileURL } = req.body;

            if (!resourceLink && !fileURL) {
                return res.status(400).json({ error: 'Either a link or file URL is required.' });
            }

            const newMaterial = {
                sessionId: new ObjectId(sessionId),
                title,
                description,
                resourceLink: resourceLink || '',
                fileURL: fileURL || '',
                uploadedBy,
                uploadedAt: getBDTime(),
            };

            const result = await materialsCollection.insertOne(newMaterial);
            res.send({ insertedId: result.insertedId });
        });

        //--------------------------------------------------------
        app.get('/materials/session/:sessionId/student/:email', verifyFBToken, async (req, res) => {
            const { sessionId, email } = req.params;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            try {
                const payment = await paymentsCollection.findOne({
                    email,
                    sessionId: new ObjectId(sessionId)
                });

                if (!payment) {
                    return res.status(403).json({ error: 'Access denied. Payment not found for this session.' });
                }

                const materials = await materialsCollection.find({ sessionId: new ObjectId(sessionId) }).toArray();

                res.json(materials);
            } catch (error) {
                console.error('Error fetching materials with payment check:', error);
                res.status(500).json({ error: 'Server error' });
            }
        });



        //--------------------------------------------------------

        // ✅ GET /tutors/:email/approved-sessions
        app.get('/tutors/:email/approved-sessions', async (req, res) => {
            const { email } = req.params;
            try {
                const sessions = await sessionsCollection
                    .find({ tutorEmail: email, status: 'approved' })
                    .toArray();
                res.send(sessions);
            } catch (error) {
                console.error('Error fetching approved sessions:', error);
                res.status(500).send({ error: 'Failed to fetch approved sessions' });
            }
        });


        // ======================================================

        app.get('/materials/tutor/:email', verifyFBToken || verifyAdmin, async (req, res) => {
            const { email } = req.params;

            try {
                const materials = await materialsCollection.find({ uploadedBy: email }).toArray();
                res.send(materials);
            } catch (error) {
                console.error('❌ Failed to fetch materials:', error);
                res.status(500).send({ error: 'Failed to fetch materials' });
            }
        });

        //------------------------------------------------------
        app.patch('/materials/:id', verifyFBToken, verifyAdmin || verifyTutor, async (req, res) => {
            const { id } = req.params;
            const { title, description, resourceLink, fileURL } = req.body;

            const updateDoc = {
                ...(title && { title }),
                ...(description && { description }),
                ...(resourceLink && { resourceLink }),
                ...(fileURL && { fileURL }),
                updatedAt: getBDTime()
            };

            try {
                const result = await materialsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateDoc }
                );
                res.send(result);
            } catch (error) {
                console.error('❌ Failed to update material:', error);
                res.status(500).send({ error: 'Failed to update material' });
            }
        });

        //--------------------------------------------------------

        app.delete('/materials/:id', verifyFBToken, verifyAdmin || verifyTutor, async (req, res) => {
            const { id } = req.params;

            try {
                const result = await materialsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                console.error('❌ Failed to delete material:', error);
                res.status(500).send({ error: 'Failed to delete material' });
            }
        });

        //-------------------------------------------------------
        // ✅ GET all materials (for admin)
        app.get('/materials', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const materials = await materialsCollection.find().toArray();
                res.send(materials);
            } catch (error) {
                console.error('❌ Failed to fetch materials:', error);
                res.status(500).send({ error: 'Failed to fetch materials' });
            }
        });

        // ==============================================
        // ✅ STRIPE PAYMENT ROUTES
        // ==============================================

        // Create Payment Intent
        // POST /payments/create-payment-intent
        app.post('/payments/create-payment-intent', async (req, res) => {
            const { amount } = req.body;

            if (!amount || amount < 1) {
                return res.status(400).send({ error: 'Invalid amount' });
            }

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: Math.round(amount * 100), // ✅ Convert to poisha
                    currency: 'bdt', // ✅ Use 'bdt' for Bangladeshi Taka
                    payment_method_types: ['card'],
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                console.error('❌ Error creating payment intent:', error);
                res.status(500).send({ error: 'Failed to create payment intent' });
            }
        });


        // Store Payment Info After Successful Payment
        app.post('/payments/store-payment', async (req, res) => {
            const { email, amount, transactionId, date, sessionId } = req.body;

            if (
                !email ||
                amount === undefined || amount === null ||
                !transactionId ||
                !date
            ) {
                return res.status(400).json({ error: 'Missing required payment fields' });
            }

            try {
                const paymentRecord = {
                    email,
                    amount,
                    transactionId,
                    sessionId: sessionId ? new ObjectId(sessionId) : null,
                    date: getBDTime(date),
                };

                const result = await paymentsCollection.insertOne(paymentRecord);
                res.send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                console.error('❌ Error storing payment:', error);
                res.status(500).json({ error: 'Failed to store payment' });
            }
        });


        // Get all payments by user email
        app.get('/payments/user/:email', verifyFBToken, async (req, res) => {
            const { email } = req.params;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            try {
                const payments = await paymentsCollection.find({ email }).toArray();
                res.send(payments);
            } catch (error) {
                console.error('❌ Error fetching payments:', error);
                res.status(500).send({ error: 'Failed to fetch payment history' });
            }
        });


        // ======================================================

        app.post('/feedbacks', async (req, res) => {
            const { sessionId, studentEmail, rating, feedback } = req.body;

            if (!sessionId || !studentEmail || !rating) {
                return res.status(400).json({ error: 'sessionId, studentEmail, and rating are required' });
            }

            const db = client.db('tutorDB');
            const feedbackCollection = db.collection('feedbacks');

            try {
                // Check if feedback already exists for this student and session (optional)
                const existing = await feedbackCollection.findOne({ sessionId: new ObjectId(sessionId), studentEmail });
                if (existing) {
                    return res.status(400).json({ error: 'You have already submitted feedback for this session.' });
                }

                const newFeedback = {
                    sessionId: new ObjectId(sessionId),
                    studentEmail,
                    rating,
                    feedback: feedback || '',
                    createdAt: getBDTime(),
                };

                const result = await feedbackCollection.insertOne(newFeedback);
                res.json({ success: true, insertedId: result.insertedId });
            } catch (error) {
                console.error('Error submitting feedback:', error);
                res.status(500).json({ error: 'Failed to submit feedback' });
            }
        });

        //-------------------------------------------------------
        // GET /feedbacks/user/:email
        app.get('/feedbacks/user/:email', async (req, res) => {
            const { email } = req.params;

            try {
                const db = client.db('tutorDB');
                const feedbackCollection = db.collection('feedbacks');

                const feedbacks = await feedbackCollection
                    .find({ studentEmail: email })
                    .toArray();

                res.json(feedbacks);
            } catch (error) {
                console.error('Error fetching user feedbacks:', error);
                res.status(500).json({ error: 'Failed to fetch feedbacks' });
            }
        });
        //-------------------------------------------------------
        // ✅ Get all feedbacks for a session
        app.get('/feedbacks/session/:sessionId', async (req, res) => {
            const { sessionId } = req.params;
            const db = client.db('tutorDB');
            const feedbackCollection = db.collection('feedbacks');

            try {
                const feedbacks = await feedbackCollection
                    .find({ sessionId: new ObjectId(sessionId) })
                    .toArray();

                res.json(feedbacks);
            } catch (error) {
                console.error('Error fetching session feedbacks:', error);
                res.status(500).json({ error: 'Failed to fetch feedbacks' });
            }
        });

        //-------------------------------------------------------
        app.patch('/feedbacks/:id', async (req, res) => {
            const { id } = req.params;
            const { rating, feedback } = req.body;

            if (!rating) return res.status(400).json({ error: 'Rating is required' });

            try {
                const db = client.db('tutorDB');
                const feedbackCollection = db.collection('feedbacks');

                const result = await feedbackCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            rating,
                            feedback: feedback || '',
                            updatedAt: getBDTime()
                        }
                    }
                );

                res.json({ success: result.modifiedCount > 0 });
            } catch (error) {
                console.error('Error updating feedback:', error);
                res.status(500).json({ error: 'Failed to update feedback' });
            }
        });


        // ======================================================

        // Create a new note
        app.post('/notes', verifyFBToken, async (req, res) => {
            try {
                const { title, content, studentEmail } = req.body;
                if (studentEmail !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
                if (!title || !content || !studentEmail) {
                    return res.status(400).json({ error: 'Title, content, and studentEmail are required' });
                }

                const newNote = {
                    title,
                    content,
                    studentEmail,
                    createdAt: getBDTime(),
                    updatedAt: getBDTime(),
                };

                const result = await notesCollection.insertOne(newNote);
                res.status(201).json({ insertedId: result.insertedId });
            } catch (error) {
                console.error('Failed to create note:', error);
                res.status(500).json({ error: 'Failed to create note' });
            }
        });

        // Get all notes for a student
        app.get('/notes/:studentEmail', verifyFBToken, async (req, res) => {
            try {
                const { studentEmail } = req.params;
                if (studentEmail !== req.decoded.email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
                const notes = await notesCollection.find({ studentEmail }).toArray();
                res.json(notes);
            } catch (error) {
                console.error('Failed to fetch notes:', error);
                res.status(500).json({ error: 'Failed to fetch notes' });
            }
        });

        // Get a single note by ID
        app.get('/notes/note/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const note = await notesCollection.findOne({ _id: new ObjectId(id) });
                if (!note) {
                    return res.status(404).json({ error: 'Note not found' });
                }
                res.json(note);
            } catch (error) {
                console.error('Failed to fetch note:', error);
                res.status(500).json({ error: 'Failed to fetch note' });
            }
        });

        // Update a note by ID
        // 🛡️ Update a note by ID — Secured
        app.patch('/notes/:id', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;
                const { title, content } = req.body;
                const email = req.decoded.email;

                // Fetch the note first
                const note = await notesCollection.findOne({ _id: new ObjectId(id) });

                if (!note) {
                    return res.status(404).json({ error: 'Note not found' });
                }

                // Check ownership
                if (note.studentEmail !== email) {
                    return res.status(403).json({ error: 'Forbidden: You can only edit your own notes' });
                }

                if (!title && !content) {
                    return res.status(400).json({ error: 'At least one field (title or content) is required to update' });
                }

                const updateDoc = {
                    updatedAt: getBDTime(),
                    ...(title && { title }),
                    ...(content && { content }),
                };

                const result = await notesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateDoc }
                );

                res.json({ success: result.modifiedCount > 0 });
            } catch (error) {
                console.error('Failed to update note:', error);
                res.status(500).json({ error: 'Failed to update note' });
            }
        });


        // Delete a note by ID
        // 🛡️ Delete a note by ID — Secured
        app.delete('/notes/:id', verifyFBToken, async (req, res) => {
            try {
                const { id } = req.params;
                const email = req.decoded.email;

                // Fetch the note first
                const note = await notesCollection.findOne({ _id: new ObjectId(id) });

                if (!note) {
                    return res.status(404).json({ error: 'Note not found' });
                }

                // Check ownership
                if (note.studentEmail !== email) {
                    return res.status(403).json({ error: 'Forbidden: You can only delete your own notes' });
                }

                const result = await notesCollection.deleteOne({ _id: new ObjectId(id) });

                res.json({ success: result.deletedCount > 0 });
            } catch (error) {
                console.error('Failed to delete note:', error);
                res.status(500).json({ error: 'Failed to delete note' });
            }
        });


        // ======================================================



        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



// Sample route
app.get('/', (req, res) => {
    res.send('TutorHub Server is running');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});