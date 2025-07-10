const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


// Load environment variables from .env file
dotenv.config();




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
        app.patch('/tutors/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            const result = await tutorsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );

            res.send(result);
        });


        //------------------------------------------------------

        // Example Express PATCH route for tutor update

        app.patch('/tutors/:id', async (req, res) => {
            const { id } = req.params;
            const { status, feedback } = req.body;

            const updateDoc = { status };
            if (status === 'cancelled' && feedback) {
                updateDoc.feedback = feedback;
            }

            const result = await tutorsCollection.updateOne(
                { _id: ObjectId(id) },
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
        app.get('/sessions', async (req, res) => {
            const { tutorEmail } = req.query;
            const filter = tutorEmail ? { tutorEmail } : {};
            const sessions = await sessionsCollection.find(filter).toArray();
            res.json(sessions);
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