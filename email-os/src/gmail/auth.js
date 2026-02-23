/**
 * Gmail OAuth2 Authentication
 * 
 * Handles the OAuth2 flow for Gmail API access:
 * 1. Reads credentials from .env
 * 2. Opens browser for user consent
 * 3. Saves refresh token for future use
 * 
 * Usage: node src/gmail/auth.js
 */

import { google } from 'googleapis';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

// Load env
function loadEnv() {
    const envPath = join(ROOT, '.env');
    if (!existsSync(envPath)) {
        console.error('❌ No .env file found. Copy .env.example to .env and fill in your credentials.');
        console.error('   cp .env.example .env');
        process.exit(1);
    }

    const env = {};
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        env[key.trim()] = valueParts.join('=').trim();
    }
    return env;
}

/**
 * Create OAuth2 client from env credentials
 */
function createOAuth2Client(env) {
    const clientId = env.GMAIL_CLIENT_ID;
    const clientSecret = env.GMAIL_CLIENT_SECRET;
    const redirectUri = env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

    if (!clientId || !clientSecret || clientId === 'your-client-id.apps.googleusercontent.com') {
        console.error('❌ Missing Gmail credentials in .env');
        console.error('   1. Go to https://console.cloud.google.com/apis/credentials');
        console.error('   2. Create OAuth 2.0 Client ID (Desktop App)');
        console.error('   3. Fill GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env');
        process.exit(1);
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Load saved token if available
 */
function loadSavedToken(env) {
    // Check .env for pre-filled refresh token
    if (env.GMAIL_REFRESH_TOKEN) {
        return { refresh_token: env.GMAIL_REFRESH_TOKEN };
    }

    // Check token file
    const tokenDir = join(ROOT, '.tokens');
    const tokenFile = join(tokenDir, 'gmail.json');
    if (existsSync(tokenFile)) {
        try {
            return JSON.parse(readFileSync(tokenFile, 'utf8'));
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Save token to file
 */
function saveToken(token) {
    const tokenDir = join(ROOT, '.tokens');
    if (!existsSync(tokenDir)) {
        mkdirSync(tokenDir, { recursive: true });
    }
    const tokenFile = join(tokenDir, 'gmail.json');
    writeFileSync(tokenFile, JSON.stringify(token, null, 2));
    console.log('✅ Token saved to .tokens/gmail.json');
}

/**
 * Run the interactive OAuth2 flow
 */
async function runAuthFlow(oauth2Client) {
    const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
    const scopes = config.gmail.scopes;

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });

    console.log('🔐 Opening browser for Gmail authorization...\n');

    // Try to open browser
    try {
        execSync(`open "${authUrl}"`);
    } catch {
        console.log('📎 Open this URL in your browser:');
        console.log(`   ${authUrl}\n`);
    }

    // Start local server to catch the callback
    return new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
            const url = new URL(req.url, 'http://localhost:3000');

            if (url.pathname === '/oauth2callback') {
                const code = url.searchParams.get('code');

                if (!code) {
                    res.end('Error: No authorization code received');
                    reject(new Error('No auth code'));
                    return;
                }

                try {
                    const { tokens } = await oauth2Client.getToken(code);
                    oauth2Client.setCredentials(tokens);
                    saveToken(tokens);

                    res.end('✅ Email OS authenticated successfully! You can close this tab.');
                    console.log('\n✅ Gmail authenticated successfully!');
                    console.log('   Run `npm run sync` to start processing your inbox.\n');

                    server.close();
                    resolve(tokens);
                } catch (err) {
                    res.end(`Error: ${err.message}`);
                    reject(err);
                }
            }
        });

        server.listen(3000, () => {
            console.log('⏳ Waiting for authorization (http://localhost:3000)...');
        });

        // 5-minute timeout
        setTimeout(() => {
            server.close();
            reject(new Error('Auth timeout — try again'));
        }, 300000);
    });
}

/**
 * Get authenticated OAuth2 client
 * Returns immediately if token exists, otherwise runs interactive flow
 */
async function getAuthClient() {
    const env = loadEnv();
    const oauth2Client = createOAuth2Client(env);

    const savedToken = loadSavedToken(env);
    if (savedToken) {
        oauth2Client.setCredentials(savedToken);
        console.log('🔑 Using saved Gmail credentials');
        return oauth2Client;
    }

    // Need fresh auth
    await runAuthFlow(oauth2Client);
    return oauth2Client;
}

export { getAuthClient, loadEnv, createOAuth2Client };

// Run directly: node src/gmail/auth.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    getAuthClient()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌', err.message);
            process.exit(1);
        });
}
