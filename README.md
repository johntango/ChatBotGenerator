# ChatBotGenerator

This allows a user to design an Assistant with RAG VectorDB attached that will answer specific questions
The Generator creates Javascript script so that the Agent can be deployed in any web page
The "heavy lifting" of sending messages to OpenAI API is handled by openAIServer.js
Here we demo the script in popupAgent.js which is included into Test.html.
Since the Agent does not "know" the openAIServer we need to arrange CORS in Express.

Running in Codespace openAIServer's port 3000 needs to be made public
