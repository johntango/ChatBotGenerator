(function () {
    const mode = 'dark';
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
    const domain = 'https://super-duper-journey-g7q947467w93vr45-3000.app.github.dev';
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
    title.innerText = 'Agent 23';
    container.appendChild(title);

    const systemDiv = document.createElement('div');
    systemDiv.innerText = 'you are a rat';
    container.appendChild(systemDiv);

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

    const initialMessages = JSON.parse('["Hey There"]');
    initialMessages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.innerText = message;
        messageDiv.style.flex = '1 1 calc(33.33% - 10px)';
        messageDiv.style.boxSizing = 'border-box';
        messageDiv.style.border = '1px solid green';
        messageDiv.style.borderRadius = '5px';
        messageDiv.style.padding = '10px';
        messageDiv.style.textAlign = 'center';
        messageDiv.style.backgroundColor = mode === "dark" ? "#555" : "#fff";
        initialDiv.appendChild(messageDiv);
    });

    const promptInput = document.createElement('input');
    promptInput.placeholder = 'go now ';
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
    document.body.appendChild(container);
})();