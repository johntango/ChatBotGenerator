import express from 'express';
import path from 'path';
import fs, { read } from 'fs';
import OpenAI from 'openai';
// Initialize the OpenAI API client

// Initialize the app
const app = express();
const PORT = 3000;

// Middleware to serve static files and parse request bodies
app.use(express.static("public"));
app.use(express.json());

// Retrieve the OpenAI API key from environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI(OPENAI_API_KEY);

if (!OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY is not set in the environment.");
    process.exit(1);
}
let focus = { assistant_id: "", assistant_name: "", dir_path: "",news_path:"", thread_id: "", message: "", run_id: "", run_status: "", vector_store_id:"" ,embed_type: "openai"}
// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html')); 
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

// Create or Get Assistant
app.post('/create_or_get_assistant', async (req, res) => {
    const { name, instructions } = req.body;

    if (!name || !instructions) {
        return res.status(400).json({ message: "Assistant name and instructions are required." });
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
// create a new thead 
app.post('/create_thread', async (req, res) => {
    const { assistant_id } = req.body;
    focus.assistant_id = assistant_id;

    if (!assistant_id) {
        return res.status(400).json({ message: "Assistant ID is required." });
    }

    try {
        // Create a new thread for the Assistant

        const response = await fetch(`https://api.openai.com/v2/assistants/${assistant_id}/threads`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                title: "New Conversation Thread", // Optional: Specify a title for the thread
            }),
        });

        

        const thread = await response.json();
        focus.thread_id = thread.id;
        res.status(200).json({
            message: "New thread created successfully.",
            focus
        });
    } catch (error) {
        console.error("Failed to create a new thread:", error);
        res.status(500).json({
            message: "An error occurred while creating a new thread.",
            error: error.message || error,
        });
    }
});

// Handle agent generation
app.post("/generate-agent", (req, res) => {
    const { focus, title, systemMessage, initialMessage, promptPlaceholder, mode } = req.body;
    const agentCode = `
(function() {
    const mode = '${mode}';
    const focus = ${JSON.stringify(focus)};
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
    title.innerText = '${title.replace(/'/g, "\\'")}';
    container.appendChild(title);

    const systemDiv = document.createElement('div');
    systemDiv.innerText = '${systemMessage.replace(/'/g, "\\'")}';
    container.appendChild(systemDiv);
    
   // Create a div for initial messages where they may be several
    const initialDiv = document.createElement('div');
    initialDiv.style.display = 'flex'; // Use flexbox for horizontal layout
    initialDiv.style.flexWrap = 'wrap'; // Allow wrapping to the next row if needed
    initialDiv.style.gap = '10px'; // Add spacing between columns
    initialDiv.style.border = '1px solid green';
    initialDiv.style.borderRadius = '5px';
    initialDiv.style.padding = '10px';
    initialDiv.style.marginTop = '10px';
    initialDiv.style.backgroundColor = mode === "dark" ? "#444" : "#f9f9f9";

    // Append the initialDiv to the container
    container.appendChild(initialDiv);

    // Add the initial messages with individual styling
    const initialMessages = JSON.parse('${JSON.stringify(initialMessage)}');
    initialMessages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.innerText = message;
        messageDiv.style.flex = '1 1 calc(33.33% - 10px)'; // 3 columns layout with equal width
        messageDiv.style.boxSizing = 'border-box'; // Ensure padding and border are included in width
        messageDiv.style.border = '1px solid green'; // Green border for each message
        messageDiv.style.borderRadius = '5px'; // Rounded corners
        messageDiv.style.padding = '10px'; // Padding for content
        messageDiv.style.textAlign = 'center'; // Center text alignment
        messageDiv.style.backgroundColor = mode === "dark" ? "#555" : "#fff"; // Different background for dark mode
        initialDiv.appendChild(messageDiv);
    });


    const promptInput = document.createElement('input');
    promptInput.placeholder = '${promptPlaceholder.replace(/'/g, "\\'")}';
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

    sendButton.addEventListener('click', async function() {
        const userPrompt = promptInput.value;
        const systemMessage = systemDiv.innerText;
        const assistant_id = '${focus.assistant_id}';
        const thread_id = '${focus.thread_id}';
        // create thread if not exist
        if (!thread_id) {
            try {
                const threadResponse = await fetch("https://api.openai.com/v1/threads", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer ${process.env.OPENAI_API_KEY}",
                        "OpenAI-Beta": "assistants=v2",
                    },
                    body: "", // Empty body as specified in the curl command
                });


            if (!threadResponse.ok) {
                const errorData = await threadResponse.json();
                console.error("Failed to create a new thread:", errorData);
                return;
            }

                const threadData = await threadResponse.json();
                focus.thread_id = threadData.id;
            } catch (error) {
                console.error("Failed to create a new thread:", error);
                return;
            }
        }
        // add message to the thread
        const response = await fetch("https://api.openai.com/v1/threads/${focus.thread_id}/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer ${process.env.OPENAI_API_KEY}", // Replace with your actual API key
                "OpenAI-Beta": "assistants=v2",
            },
            body: JSON.stringify({
                role: "user",
                content: userPrompt,
            }),
        });



        // run thread with message
        try {
        const runResponse = await fetch("https://api.openai.com/v1/threads/${focus.thread_id}/runs", {
            method: "POST",
            headers: {
                "Authorization": "Bearer ${process.env.OPENAI_API_KEY}",
                "Content-Type": "application/json",
                "OpenAI-Beta": "assistants=v2",
            },
            body: JSON.stringify({
                assistant_id: ${assistant_id}
            }),
        });
        if (!runResponse.ok) {
            const errorData = await response.json();
            return res.status(response.status).json({
                message: "Failed to run.",
            });
        }

            if (!response.ok) {
            const errorData = await response.json();
            console.error("Failed to add message to thread:", errorData);
            return;
            }

            const data = await response.json();
            responseDiv.innerText = data.choices[0].text.trim();
        } catch (error) {
            console.error("Failed to add message to thread:", error);
        }
        const data = await response.json();
        responseDiv.innerText = data.choices[0].text.trim();
    });

    document.body.appendChild(container);
})();
    `;

    res.setHeader("Content-Disposition", "attachment; filename=popupAgent.js");
    res.type("application/javascript").send(agentCode);
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
