import express from 'express';
import path from 'path';
import fs, { read } from 'fs';
import OpenAI from 'openai';
import cors from 'cors';

const app = express();
const PORT = 3000;
// Middleware to serve static files and parse request bodies
app.use(express.static("public"));
app.use(express.json());

// CORS configuration
app.use(cors({
    origin: '*', // Allow all origins. Replace with specific domains for security in production.
    methods: ['GET', 'POST', 'OPTIONS'], // Allow specific HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allow headers used in your requests
}));

// Handle preflight requests
app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); // Allow specific methods
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); // Allow specific headers
    res.sendStatus(200); // Respond with HTTP 200 for preflight
});
let openai = new OpenAI(process.env.OPENAI_API_KEY);
// OpenAI API key


// State dictionary to track focus
let focus = {
    assistant_id: "",
    assistant_name: "",
    dir_path: "",
    news_path: "",
    thread_id: "",
    message: "",
    run_id: "",
    run_status: "",
    vector_store_id: "",
    embed_type: "openai"
};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html')); 
});


// 1. Get Assistant by Name and Check File Search
app.post('/get_assistant', async (req, res) => {
    const { name } = req.body;

    try {
        // get assistant id
        const assistants = await openai.beta.assistants.list({
            order: "desc",
            limit: 10,
        })

        // Find assistant by name
        const assistant = assistants.data.find(a => a.name === name);

        if (!assistant) {
            return res.status(404).json({ message: "Assistant not found", focus });
        }

        if (!assistant.file_search_enabled) {
            return res.status(400).json({ message: "File Search is not enabled for this assistant", focus });
        }

        // Update focus state
        focus.assistant_id = assistant.id;
        focus.assistant_name = assistant.name;
        focus.vector_store_id = assistant.vector_db_id;

        res.json({
            message: `Assistant '${assistant.name}' retrieved successfully`,
            focus
        });
    } catch (error) {
        res.status(500).json({ message: error.message, focus });
    }
});

// 2. Create a Thread
app.post('/create_thread', async (req, res) => {
    const { focus } = req.body;

    try {
            // get a new thread to operate on
        let threadResponse = await openai.beta.threads.create()
        // Update focus state
        focus.thread_id = threadResponse.id;

        res.json({
            message: `Thread created successfully with ID: ${threadResponse.id}`,
            focus
        });
    } catch (error) {
        res.status(500).json({ message: error.message, focus });
    }
});

// 3. Add Messages to the Thread and Run it
app.post('/run_thread', async (req, res) => {
    const { focus, system_message, user_prompt } = req.body;
    let agentResponse = []
    // add messages and run the thread
    try {
        let thread_id = focus.thread_id;
        let message = await openai.beta.threads.messages.create(thread_id,
            {
                role: "user",
                content: user_prompt,
            })

        let run = await openai.beta.threads.runs.createAndPoll(
            thread_id,
            { 
                assistant_id: focus.assistant_id,
                instructions: "Please address the user as Jane Doe. The user has a premium account."
            }
        );
        focus.run_id = run.id;
        // Update focus state
        if (run.status === 'completed') {
            const messages = await openai.beta.threads.messages.list(
              run.thread_id
            );
     
            for (const message of messages.data.reverse()) {
              console.log(`${message.role} > ${message.content[0].text.value}`);
              agentResponse.push(message.content[0].text.value)
            }
        } else {
            console.log(run.status);
        }

        res.json({
            message: "Messages added and thread run successfully"+JSON.stringify(agentResponse),
            focus
        });
    } catch (error) {
        res.status(500).json({ message: error.message, focus });
    }
});

// 6. Get Current Focus State (Optional Endpoint for Debugging)
app.get('/get_focus', (req, res) => {
    res.json({
        message: "Current focus state retrieved successfully",
        focus
    });
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
// This server exposes a set of endpoints to interact with the OpenAI API and manage the conversation flow with the assistant.