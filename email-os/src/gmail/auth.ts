/**
 * Gmail OAuth2 Authentication
 */

import { google } from 'googleapis';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import type { OAuth2Client, Credentials } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

function loadEnv(): Record<string, string> {
    const envPath = join(ROOT, '.env');
    if (!existsSync(envPath)) {
        console.error('❌ No .env file found. Copy .env.example to .env and fill in your credentials.');
        process.exit(1);
    }

    const env: Record<string, string> = {};
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...valueParts] = trimmed.split('=');
        env[key.trim()] = valueParts.join('=').trim();
    }
    return env;
}

function createOAuth2Client(env: Record<string, string>): OAuth2Client {
    const clientId = env.GMAIL_CLIENT_ID;
    const clientSecret = env.GMAIL_CLIENT_SECRET;
    const redirectUri = env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback';

    if (!clientId || !clientSecret || clientId === 'your-client-id.apps.googleusercontent.com') {
        console.error('❌ Missing Gmail credentials in .env');
        process.exit(1);
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function loadSavedToken(env: Record<string, string>): Credentials | null {
    if (env.GMAIL_REFRESH_TOKEN) {
        return { refresh_token: env.GMAIL_REFRESH_TOKEN };
    }

    const tokenDir = join(ROOT, '.tokens');
    const tokenFile = join(tokenDir, 'gmail.json');
    if (existsSync(tokenFile)) {
        try { return JSON.parse(readFileSync(tokenFile, 'utf8')); }
        catch { return null; }
    }
    return null;
}

function saveToken(token: Credentials): void {
    const tokenDir = join(ROOT, '.tokens');
    if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
    const tokenFile = join(tokenDir, 'gmail.json');
    writeFileSync(tokenFile, JSON.stringify(token, null, 2));
    console.log('✅ Token saved to .tokens/gmail.json');
}

async function runAuthFlow(oauth2Client: OAuth2Client): Promise<Credentials> {
    const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
    const scopes: string[] = config.gmail.scopes;

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });

    console.log('🔐 Opening browser for Gmail authorization...\n');

    try { execSync(`open "${authUrl}"`); }
    catch { console.log(`📎 Open this URL in your browser:\n   ${authUrl}\n`); }

    return new Promise<Credentials>((resolve, reject) => {
        const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url || '', 'http://localhost:3000');

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

                    server.close();
                    resolve(tokens);
                } catch (err) {
                    res.end(`Error: ${(err as Error).message}`);
                    reject(err);
                }
            }
        });

        server.listen(3000, () => {
            console.log('⏳ Waiting for authorization (http://localhost:3000)...');
        });

        setTimeout(() => {
            server.close();
            reject(new Error('Auth timeout — try again'));
        }, 300000);
    });
}

async function getAuthClient(): Promise<OAuth2Client> {
    const env = loadEnv();
    const oauth2Client = createOAuth2Client(env);

    const savedToken = loadSavedToken(env);
    if (savedToken) {
        oauth2Client.setCredentials(savedToken);
        console.log('🔑 Using saved Gmail credentials');
        return oauth2Client;
    }

    await runAuthFlow(oauth2Client);
    return oauth2Client;
}

export { getAuthClient, loadEnv, createOAuth2Client };

// Run directly: tsx src/gmail/auth.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    getAuthClient()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌', (err as Error).message);
            process.exit(1);
        });
}
