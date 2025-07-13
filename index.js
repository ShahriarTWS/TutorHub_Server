const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');
// const stripe = Stripe(process.env.STRIPE_SECRET_KEY);



// Load environment variables from .env file
dotenv.config();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);




const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());




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
        await client.connect();

        // ======================================================
        const db = client.db('tutorDB');
        const usersCollection = db.collection('usersCollection');
        const tutorsCollection = db.collection('tutorsCollection');
        const adminCollection = db.collection('adminCollection');
        const sessionsCollection = db.collection('sessions');
        const materialsCollection = db.collection('materials');
        const paymentsCollection = db.collection('payments');


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
                    createdAt: new Date()
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

        app.get('/tutors/all', async (req, res) => {
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
        app.get('/tutors/pending', async (req, res) => {
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
        app.get('/tutors', async (req, res) => {
            const status = req.query.status;
            if (!status) return res.status(400).json({ error: 'Status is required' });

            const result = await tutorsCollection.find({ status }).toArray();
            res.send(result);
        });


        // PATCH tutor status
        // app.patch('/tutors/:id', async (req, res) => {
        //     const id = req.params.id;
        //     const { status } = req.body;

        //     const result = await tutorsCollection.updateOne(
        //         { _id: new ObjectId(id) },
        //         { $set: { status } }
        //     );

        //     res.send(result);
        // });


        //------------------------------------------------------

        // Example Express PATCH route for tutor update

        app.patch('/tutors/:id', async (req, res) => {
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

        app.get('/users/role/:email', async (req, res) => {
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

        app.get('/admin/users', async (req, res) => {
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
        app.patch('/admin/users/:id/role', async (req, res) => {
            const { id } = req.params;
            const { role } = req.body;

            try {
                const user = await usersCollection.findOne({ _id: new ObjectId(id) });
                if (!user) return res.status(404).json({ message: 'User not found' });

                const email = user.email;

                // Remove from both role collections first
                await adminCollection.deleteOne({ email });
                await tutorsCollection.deleteOne({ email });

                if (role === 'admin') {
                    await adminCollection.insertOne({ email });
                } else if (role === 'tutor') {
                    await tutorsCollection.insertOne({
                        name: user.name,
                        email: user.email,
                        photo: user.photoURL || '',
                        status: 'approved',
                        createdAt: new Date()
                    });
                }

                // Optionally update user's main role (used in fallback)
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

        app.post('/sessions', async (req, res) => {
            try {
                const session = req.body;
                const result = await sessionsCollection.insertOne({
                    ...session,
                    status: 'pending',
                    createdAt: new Date(),
                });
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error('Failed to add session:', error);
                res.status(500).send({ error: 'Failed to add session' });
            }
        });

        //---------------------------------------------------------
        app.get('/admin/sessions', async (req, res) => {
            try {
                const sessions = await sessionsCollection.find().toArray();
                res.send(sessions);
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch sessions' });
            }
        });

        //-------------------------------------------------------

        app.patch('/admin/sessions/:id', async (req, res) => {
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

        // Example backend GET /sessions route snippet
        // Optional: Make /sessions only return approved if no tutorEmail
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
        app.get('/sessions/:id', async (req, res) => {
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


        // ======================================================

        // ========================================
        // 📁 Upload Materials


        // POST /materials - Upload resource file or link
        // POST /materials
        // app.post('/materials/:sessionId', async (req, res) => {
        //     const { sessionId } = req.params;
        //     const { type, value } = req.body;

        //     if (!sessionId || !type || !value) {
        //         return res.status(400).json({ error: 'Session ID, type, and value are required' });
        //     }

        //     const material = {
        //         sessionId: new ObjectId(sessionId),
        //         type, // 'link' or 'file'
        //         value, // actual URL string or file URL
        //         uploadedAt: new Date()
        //     };

        //     try {
        //         const result = await materialsCollection.insertOne(material);
        //         res.send({ insertedId: result.insertedId });
        //     } catch (error) {
        //         console.error('❌ Error uploading material:', error);
        //         res.status(500).send({ error: 'Failed to upload material' });
        //     }
        // });


        // GET /materials/:sessionId - Fetch uploaded materials for a session
        app.post('/materials/:sessionId', async (req, res) => {
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
                uploadedAt: new Date(),
            };

            const result = await materialsCollection.insertOne(newMaterial);
            res.send({ insertedId: result.insertedId });
        });

        //--------------------------------------------------------
        app.get('/materials/session/:sessionId/student/:email', async (req, res) => {
            const { sessionId, email } = req.params;

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

        app.get('/materials/tutor/:email', async (req, res) => {
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
        app.patch('/materials/:id', async (req, res) => {
            const { id } = req.params;
            const { title, description, resourceLink, fileURL } = req.body;

            const updateDoc = {
                ...(title && { title }),
                ...(description && { description }),
                ...(resourceLink && { resourceLink }),
                ...(fileURL && { fileURL }),
                updatedAt: new Date()
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

        app.delete('/materials/:id', async (req, res) => {
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
        app.get('/materials', async (req, res) => {
            try {
                const materials = await materialsCollection.find().toArray();
                res.send(materials);
            } catch (error) {
                console.error('❌ Failed to fetch materials:', error);
                res.status(500).send({ error: 'Failed to fetch materials' });
            }
        });

        // ======================================================
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

            if (!email || !amount || !transactionId || !date) {
                return res.status(400).json({ error: 'Missing required payment fields' });
            }

            try {
                const paymentRecord = {
                    email,
                    amount,
                    transactionId,
                    sessionId: sessionId ? new ObjectId(sessionId) : null,
                    date: new Date(date),
                };

                const result = await paymentsCollection.insertOne(paymentRecord);
                res.send({ success: true, insertedId: result.insertedId });
            } catch (error) {
                console.error('❌ Error storing payment:', error);
                res.status(500).json({ error: 'Failed to store payment' });
            }
        });

        // Get all payments by user email
        app.get('/payments/user/:email', async (req, res) => {
            const { email } = req.params;

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
                    createdAt: new Date(),
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
                            updatedAt: new Date()
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



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



// Sample route
app.get('/', (req, res) => {
    res.send('Parcel Server is running');
});

// Start the server
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});