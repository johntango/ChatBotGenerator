import express from 'express';
import path from 'path';
import fs, { read } from 'fs';
import OpenAI from 'openai';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const CODESPACE_NAME = process.env.CODESPACE_NAME; // The Codespaces name provided by GitHub

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
    res.sendFile(path.join(__dirname, '/public/index.html')); 
});

// Create or Get Assistant
app.post('/create_or_get_assistant', async (req, res) => {
    const { name, assistantMessage } = req.body;
    let instructions = assistantMessage;

    if (!name || !assistantMessage) {
        return res.status(400).json({ message: "Assistant name and system Message are required." });
    }

    try {
        const response = await openai.beta.assistants.list({ order: "desc", limit: 20 });

        // Find existing assistant by name
        let assistant = response.data.find(a => a.name && a.name.toLowerCase() === name.toLowerCase());
        if (assistant) {
            focus.assistant_id = assistant.id;
            focus.assistant_name = assistant.name;
            if(assistant.tool_resources.file_search.vector_store_ids.length > 0){
                focus.vector_store_id = assistant.tool_resources.file_search.vector_store_ids[0];
            }
            return res.status(200).json({ message:  `Got Assistant id:${focus.assistant_id} successfully. Using VectorDB ${focus.vector_store_id}`, focus });
        }

        // Create a new assistant
        assistant = await openai.beta.assistants.create({
            name,
            instructions,
            model: "gpt-4-1106-preview",
        });

        focus.assistant_id = assistant.id;
        focus.assistant_name = name;

        res.status(200).json({ message: `Assistant id:${focus.assistant_id} created successfully.`,  focus });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Assistant creation failed.", error });
    }
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

//
// Upload Files to VectorDB
app.post('/upload_files', async (req, res) => {
    
    const dirname = req.body.dir_path;
    const embed_type = req.body.embed_type;


    if (!dirname) {
        return res.status(400).json({ message: "Specify a directory path for the files to be uploaded from", focus });
    }

    let files = [];
    try {
        // Get list of files from directory
        fs.readdirSync(dirname).forEach(file => {
            files.push(`${dirname}/${file}`);
        });

        if (files.length < 1) {
            return res.status(400).json({ message: 'No files were found in the specified directory.', focus });
        }

        const fileStreams = files.map((path) => fs.createReadStream(path));
        let message = "";

        if (embed_type === "openai") {
            // Create a vector store
            const vectorStore = await openai.beta.vectorStores.create({
                name: "MyVectorStore",
            });
            focus.vector_store_id = vectorStore.id;

            // Upload files to the vector store
            const response = await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, {
                files: fileStreams,
            });

            // Attach vector store to the Assistant
            await openai.beta.assistants.update(focus.assistant_id, {
                tool_resources: {
                    file_search: { vector_store_ids: [vectorStore.id] },
                },
            });

            message = `Files uploaded to VectorDB with ID: ${vectorStore.id} and attached to Assistant with ID: ${focus.assistant_id}.`;
        } else {
            // Handle other embedding methods if needed
            message = "Local embedding functionality not implemented.";
        }

        res.status(200).json({ message, focus });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Upload action failed', error, focus });
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
// Create or Get Assistant
app.post('/create_or_get_assistant', async (req, res) => {
    let { name, assistantMessage } = req.body;
    let instructions = assistantMessage;

    if (!name || !assistantMessage) {
        return res.status(400).json({ message: "Assistant name and assistantMessage are required." });
    };
    try {
        const response = await openai.beta.assistants.list({ order: "desc", limit: 20 });

        // Find existing assistant by name
        let assistant = response.data.find(a => a.name && a.name.toLowerCase() === name.toLowerCase());
        if (assistant) {
            focus.assistant_id = assistant.id;
            focus.assistant_name = assistant.name;
            if(assistant.tool_resources.file_search.vector_store_ids.length > 0){
                focus.vector_store_id = assistant.tool_resources.file_search.vector_store_ids[0];
            }
            return res.status(200).json({ message:  `Got Assistant id:${focus.assistant_id} successfully. Using VectorDB ${focus.vector_store_id}`, focus });
        }

        // Create a new assistant
        assistant = await openai.beta.assistants.create({
            name,
            instructions,
            model: "gpt-4-1106-preview",
        });

        focus.assistant_id = assistant.id;
        focus.assistant_name = name;

        res.status(200).json({ message: `Assistant id:${focus.assistant_id} created successfully.`,  focus });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Assistant creation failed.", error });
    }
});
app.post('/attach_vectordb_to_assistant', async (req, res) => {
    const { assistant_id, vectordb_id } = req.body;

    if (!assistant_id || !vectordb_id) {
        return res.status(400).json({ message: "Both assistant_id and vectordb_id are required." });
    }

    try {
        // Update the assistant to include the vector store
        const response = await openai.beta.assistants.update(assistant_id, {
            tools: [{"type": "file_search"}],
            tool_resources: {
                file_search: {
                    vector_store_ids: [vectordb_id],
                },
            },
        });
        console.log(JSON.stringify(response));


        res.status(200).json({
            message: `Successfully attached VectorDB (${vectordb_id}) to Assistant (${assistant_id}).`,
            focus: focus,
        });
    } catch (error) {
        console.error("Failed to attach VectorDB to Assistant:", error);
        res.status(500).json({
            message: "Failed to attach VectorDB to Assistant.",
            error: error.message || error,
        });
    }
});
// Handle agent generation
app.post("/generate_agent", (req, res) => {
    const { title, systemMessage, testMessages, prompt, mode } = req.body;
    const agentCode = `
(function () {
    const mode = 'dark';
    // let focus = ${JSON.stringify(focus)};
    let focus = {
        "assistant_id": "asst_6d0Ow7DV8qmvNXqvkLKjhBi6",
        "assistant_name": "ax2",
        "dir_path": "",
        "news_path": "",
        "thread_id": "",
        "message": "",
        "run_id": "",
        "run_status": "",
        "vector_store_id": "vs_Sp1SnNSu2EocNhnBNt1ns1Dk",
        "embed_type": "openai"
    };
       // when running on codespaces port 3000 there is no need for adding :3000 also there do not end with / 
    
    const domain = 'https://${CODESPACE_NAME}-${PORT}.app.github.dev';
    let messages = [];
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.right = '20px';
    container.style.width = '300px';
    container.style.border = '1px solid #ddd';
    container.style.padding = '10px';
    container.style.backgroundColor = mode === "dark" ? "#333" : "#fff";
    container.style.color = mode === "dark" ? "#fff" : "#000";

    const title = document.createElement('h3');
    title.innerText = ${title};
    container.appendChild(title);

    const systemDiv = document.createElement('div');
    systemDiv.innerText = ${systemMessage};

    const initialDiv = document.createElement('div');
    initialDiv.style.display = 'flex';
    initialDiv.style.flexWrap = 'wrap';
    initialDiv.style.gap = '10px';
    initialDiv.style.border = '1px solid green';
    initialDiv.style.borderRadius = '5px';
    initialDiv.style.padding = '10px';
    initialDiv.style.marginTop = '10px';
    initialDiv.style.backgroundColor = mode === "dark" ? "#444" : "#f9f9f9";
    container.appendChild(initialDiv);
    const initialMessages = ${(testMessages)};
    initialMessages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.innerText = message;
        messageDiv.style.flex = '1 1 calc(33.33% - 10px)';
        messageDiv.style.boxSizing = 'border-box';
        messageDiv.style.border = '1px solid green';
        messageDiv.style.borderRadius = '5px';
        messageDiv.style.padding = '10px';
        messageDiv.style.textAlign = 'center';
        messageDiv.style.backgroundColor = ${mode} === "dark" ? "#555" : "#fff";
        initialDiv.appendChild(messageDiv);
    });

    const promptInput = document.createElement('input');
    promptInput.value = ${prompt};
    container.appendChild(promptInput);

    const sendButton = document.createElement('button');
    sendButton.innerHTML = '&#8594;';
    container.appendChild(sendButton);

    const responseDiv = document.createElement('div');
    responseDiv.style.height = '200px';
    responseDiv.style.overflowY = 'auto';
    responseDiv.style.border = '1px solid #ddd';
    responseDiv.style.padding = '10px';
    container.appendChild(responseDiv);

    sendButton.addEventListener('click', async function () {
        const userPrompt = promptInput.value;
        const systemMessage = systemDiv.innerText;

        // Create a thread if it does not exist
        if (focus.thread_id === "") {
            try {
                const threadResponse = await fetch(domain+'/create_thread', {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ focus}),
                });

                let threadData = await threadResponse.json();
                if (!threadResponse.ok) {
                    console.error("Failed to create a new thread:", threadData.message);
                    return;
                }
                focus = threadData.focus;
            } catch (error) {
                console.error("Failed to create a new thread:", error);
                return;
            }
        }

        // Add message to the thread
        try {
            const addMessageResponse = await fetch(domain+'/run_thread', {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    focus: focus,
                    system_message: systemMessage,
                    user_prompt: userPrompt
                }),
            });

            const addMessageData = await addMessageResponse.json();
            if (!addMessageResponse.ok) {
                console.error("Failed to add message to thread:", addMessageData.message);
                return;
            }

            focus.message = JSON.stringify(addMessageData.message);
            // add to the responseDiv
            responseDiv.innerHTML = addMessageData.message;
            
        } catch (error) {
            console.error("Failed to add message to thread:", error);
            return;
        }
    });
    const popupDiv = document.getElementById('popup');

    // Append the container to the div if it exists, otherwise to the body
    if (popupDiv) {
        popupDiv.appendChild(container);
    } else {
        document.body.appendChild(container); // Fallback if no "popup" div exists
    }
})();
    `;

    res.setHeader("Content-Disposition", "attachment; filename=popupAgent.js");
    res.type("application/javascript").send(agentCode);
});
// 6. Get Current Focus State (Optional Endpoint for Debugging)
app.post('/get_focus', (req, res) => {
    res.json({
        message: "Current focus state retrieved successfully",
        focus
    });
});

// Start the Express server
app.listen(PORT, () => {
    if (CODESPACE_NAME) {
        const globalURL = `https://${CODESPACE_NAME}-${PORT}.app.github.dev`;
        console.log(`Server running at ${globalURL}`);
    } else {
        console.log(`Server running at http://localhost:${PORT}`);
    }
});
// This server exposes a set of endpoints to interact with the OpenAI API and manage the conversation flow with the assistant.