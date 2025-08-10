// Handle talking with the ai
const net = require('net');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Buffer } = require('buffer');

// Load environment variables
dotenv.config({ quiet: true });

const PORT = process.env.PORT || 9000;
const API_KEY = process.env.API_KEY || 'changeme';
const LOG_FILE = process.env.LOG_FILE || 'server.log';


/**
 * Logger class for writing logs to a file
 */
class Logger {
	/**
	 * Log a message to the log file
	 * @param {string} message
	 */
	static log(message) {
		const timestamp = new Date().toISOString();
		fs.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`, err => {
			if (err) console.error('Failed to log:', err);
		});
	}
	/**
	 * Log an error to the log file
	 * @param {string} message
	 */
	static error(message) {
		this.log('ERROR: ' + message);
	}
}


/**
 * Messenger class: Handles callbacks for incoming data
 */
class Messenger {
	/**
	 * Create a Messenger instance
	 */
	constructor() {
		this.callbacks = [];
	}
	/**
	 * Register a callback for incoming messages
	 * @param {function} callback
	 */
	onMessage(callback) {
		this.callbacks.push(callback);
	}
	/**
	 * Call all registered callbacks with the message
	 * @param {object} message
	 * @param {net.Socket} socket
	 */
	handleMessage(message, socket) {
		this.callbacks.forEach(cb => {
			try {
				cb(message, socket);
			} catch (err) {
				Logger.error('Callback threw: ' + err);
			}
		});
	}
}


/**
 * MessageHandler: Handles sending messages (including images)
 */
class MessageHandler {
	/**
	 * Send a JSON message to the client
	 * @param {net.Socket} socket
	 * @param {string} text
	 * @param {string|null} imagePath
	 */
	static send(socket, text, imagePath = null) {
		let imageData = null;
		if (imagePath) {
			try {
				const ext = path.extname(imagePath).toLowerCase();
				// Only support images that exist, because magic isn't real
				if (fs.existsSync(imagePath)) {
					const imgBuffer = fs.readFileSync(imagePath);
					imageData = imgBuffer.toString('base64');
				} else {
					Logger.error(`Image not found: ${imagePath}`);
				}
			} catch (err) {
				Logger.error('Failed to read image: ' + err);
			}
		}
		const payload = {
			text,
			image: imageData,
			timestamp: new Date().toISOString()
		};
		try {
			socket.write(JSON.stringify(payload) + '\n');
			Logger.log('Sent message to client.');
		} catch (err) {
			Logger.error('Failed to send message: ' + err);
		}
	}
}


/**
 * TCPServer class for handling TCP connections and messaging
 */
class TCPServer {
	/**
	 * @param {number} port - The port to listen on
	 * @param {string} apiKey - The API key for authentication
	 */
	constructor(port, apiKey) {
		this.port = port;
		this.apiKey = apiKey;
		this.messenger = new Messenger();
		this.server = net.createServer();
		this.clientSocket = null;
		this.setupServer();
	}

	/**
	 * Set up the TCP server and event handlers
	 */
	setupServer() {
		this.server.on('connection', socket => {
			Logger.log('Client connected.');
			if (this.clientSocket) {
				Logger.log('Rejecting extra client. One is enough.');
				socket.end('Only one client allowed. Try again later.\n');
				return;
			}
			this.clientSocket = socket;
			socket.setEncoding('utf8');
			let buffer = '';
			socket.on('data', data => {
				buffer += data;
				let boundary;
				while ((boundary = buffer.indexOf('\n')) !== -1) {
					const messageStr = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 1);
					this.handleIncoming(messageStr, socket);
				}
			});
			socket.on('close', () => {
				Logger.log('Client disconnected.');
				this.clientSocket = null;
			});
			socket.on('error', err => {
				Logger.error('Socket error: ' + err);
			});
		});
		this.server.on('error', err => {
			Logger.error('Server error: ' + err);
		});
	}

	/**
	 * Start the TCP server
	 */
	start() {
		this.server.listen(this.port, () => {
			Logger.log(`TCP server started on port ${this.port}.`);
		});
	}

	/**
	 * Handle incoming messages, verify API key, and pass to Messenger
	 * @param {string} messageStr - The raw message string
	 * @param {net.Socket} socket - The client socket
	 */
	handleIncoming(messageStr, socket) {
		let message;
		try {
			message = JSON.parse(messageStr);
		} catch (err) {
			Logger.error('Failed to parse JSON: ' + err);
			return;
		}
		if (!message.api_key || message.api_key !== this.apiKey) {
			Logger.log('Rejected message with invalid API key.');
			socket.write(JSON.stringify({ error: 'Invalid API key.' }) + '\n');
			return;
		}

		// Remove api_key before passing to callbacks
		delete message.api_key;

		Logger.log('Passing message to Messenger: ' + JSON.stringify(message));
		this.messenger.handleMessage(message, socket);
	}

	/**
	 * Utility to send a message to the client
	 * @param {string} text
	 * @param {string|null} imagePath
	 */
	sendMessage(text, imagePath = null) {
		if (this.clientSocket) {
			MessageHandler.send(this.clientSocket, text, imagePath);
		} else {
			Logger.log('No client to send message to.');
		}
	}
}


// Create server instance
const server = new TCPServer(PORT, API_KEY);

// Example message for after server connected
server.server.on('connection', () => {
	Logger.log('Client connection established, sending example message.');
	// Send an example message to the client after connection
	// You can change the image path to a valid image file
	const exampleText = 'Hello from the server!';
	const exampleImagePath = path.join(__dirname, 'example.png');
	server.sendMessage(exampleText, exampleImagePath);
});

// Start the server
server.start();