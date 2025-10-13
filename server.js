/**
 * Microservicio Node.js para Andreani PyMés
 * Maneja login OAuth2 + WebSocket SignalR
 * OPTIMIZADO PARA RAILWAY
 */

const express = require('express');
const { HubConnectionBuilder, HttpTransportType } = require('@microsoft/signalr');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache de tokens
let tokenCache = {
    access_token: null,
    expires_at: null
};

/**
 * Login con Puppeteer (navegador headless)
 */
async function loginAndreani(username, password) {
    console.log('🔐 Iniciando login con Puppeteer...');
    
    let browser = null;
    
    try {
        // Configurar Chromium para Railway
        const executablePath = await chromium.executablePath();
        
        console.log('📍 Chromium path:', executablePath);
        
        // Lanzar browser
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
        });
        
        console.log('✅ Browser iniciado correctamente');
        
        const page = await browser.newPage();
        
        // Interceptar requests para capturar el token
        let accessToken = null;
        
        page.on('request', request => {
            const url = request.url();
            if (url.includes('access_token=')) {
                const match = url.match(/access_token=([^&]+)/);
                if (match) {
                    accessToken = match[1];
                    console.log('🎯 Token capturado en request');
                }
            }
        });
        
        page.on('response', async response => {
            const url = response.url();
            if (url.includes('token') || url.includes('authorize')) {
                try {
                    const headers = response.headers();
                    if (headers['authorization']) {
                        const authHeader = headers['authorization'];
                        if (authHeader.startsWith('Bearer ')) {
                            accessToken = authHeader.substring(7);
                            console.log('🎯 Token capturado en response header');
                        }
                    }
                } catch (e) {
                    // Ignorar errores
                }
            }
        });
        
        // Ir a la página de login
        console.log('📄 Navegando a página de login...');
        await page.goto('https://onboarding.andreani.com/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        console.log('✅ Página cargada, buscando formulario de login...');
        
        // Esperar y completar formulario
        await page.waitForSelector('input[type="email"], input[name="signInName"]', { timeout: 30000 });
        await page.type('input[type="email"], input[name="signInName"]', username, { delay: 100 });
        
        await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 10000 });
        await page.type('input[type="password"], input[name="password"]', password, { delay: 100 });
        
        console.log('✏️ Credenciales ingresadas, haciendo clic en login...');
        
        // Click en botón de login
        await page.click('button[type="submit"], button#next');
        
        // Esperar redirección
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        
        console.log('✅ Login exitoso, esperando token...');
        
        // Esperar un poco más para asegurar que el token se capture
        await page.waitForTimeout(3000);
        
        // Si no capturamos el token en las requests, intentar obtenerlo del localStorage
        if (!accessToken) {
            console.log('🔍 Buscando token en localStorage...');
            accessToken = await page.evaluate(() => {
                // Buscar en localStorage
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    const value = localStorage.getItem(key);
                    if (value && value.includes('eyJ')) {
                        try {
                            const parsed = JSON.parse(value);
                            if (parsed.access_token || parsed.accessToken) {
                                return parsed.access_token || parsed.accessToken;
                            }
                        } catch (e) {
                            if (value.startsWith('eyJ')) {
                                return value;
                            }
                        }
                    }
                }
                
                // Buscar en cookies
                const cookies = document.cookie.split(';');
                for (let cookie of cookies) {
                    const [name, value] = cookie.trim().split('=');
                    if (value && value.startsWith('eyJ')) {
                        return value;
                    }
                }
                
                return null;
            });
        }
        
        await browser.close();
        browser = null;
        
        if (!accessToken) {
            throw new Error('No se pudo obtener el access token');
        }
        
        console.log('🎉 Token obtenido exitosamente');
        
        // Guardar en cache (válido por 1.5 horas)
        tokenCache.access_token = accessToken;
        tokenCache.expires_at = Date.now() + (90 * 60 * 1000); // 90 minutos
        
        return accessToken;
        
    } catch (error) {
        console.error('❌ Error en loginAndreani:', error.message);
        if (browser) {
            await browser.close();
        }
        throw error;
    }
}

/**
 * Obtiene token (desde cache o haciendo login)
 */
async function getAccessToken(username, password) {
    // Si hay token válido en cache, usarlo
    if (tokenCache.access_token && tokenCache.expires_at > Date.now()) {
        console.log('✅ Usando token desde cache');
        return tokenCache.access_token;
    }
    
    // Token expirado o no existe, hacer login
    console.log('🔄 Token expirado, renovando...');
    return await loginAndreani(username, password);
}

/**
 * Cotiza envío usando SignalR
 */
async function cotizarEnvio(accessToken, params) {
    const hubUrl = `https://pymes-api.andreani.com/hubCotizacion?access_token=${accessToken}`;
    
    const connection = new HubConnectionBuilder()
        .withUrl(hubUrl, {
            skipNegotiation: true,
            transport: HttpTransportType.WebSockets
        })
        .build();
    
    try {
        await connection.start();
        console.log('🔌 Conectado al WebSocket');
        console.log('📦 Parámetros recibidos:', JSON.stringify(params, null, 2));
        
        // Preparar objeto de cotización con todos los datos
        const cotizacionData = {
            usuarioId: params.usuarioId || '',
            tipoDeEnvioId: params.tipoDeEnvioId,
            sucursalOrigen: params.sucursalOrigen,
            codigoPostalDestino: params.codigoPostalDestino,
            bultos: params.bultos
        };
        
        // Agregar datos del destinatario si están presentes
        if (params.destinatario) {
            cotizacionData.destinatario = params.destinatario;
            console.log('👤 Datos del destinatario incluidos:', params.destinatario);
        }
        
        console.log('📤 Enviando a Andreani:', JSON.stringify(cotizacionData, null, 2));
        
        // Invocar método de cotización
        const result = await connection.invoke('Cotizar', cotizacionData);
        
        console.log('📥 Respuesta de Andreani:', JSON.stringify(result, null, 2));
        
        await connection.stop();
        
        return result;
        
    } catch (error) {
        console.error('❌ Error en WebSocket:', error);
        await connection.stop();
        throw error;
    }
}

// ============================================
// ENDPOINTS
// ============================================

/**
 * POST /login
 * Hace login y retorna el access token
 */
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username y password requeridos' });
        }
        
        const token = await getAccessToken(username, password);
        
        res.json({
            success: true,
            access_token: token,
            expires_in: 7200
        });
        
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /cotizar
 * Cotiza un envío
 */
app.post('/cotizar', async (req, res) => {
    try {
        const { username, password, params } = req.body;
        
        console.log('🔍 Request recibido en /cotizar');
        console.log('Username:', username);
        console.log('Params:', JSON.stringify(params, null, 2));
        
        if (!username || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Credenciales requeridas' 
            });
        }
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'Parámetros de cotización requeridos' 
            });
        }
        
        // Obtener token
        const token = await getAccessToken(username, password);
        
        // Cotizar
        const result = await cotizarEnvio(token, params);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.stack
        });
    }
});

/**
 * GET /health
 * Verifica que el servicio esté funcionando
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        token_cached: !!tokenCache.access_token,
        token_expires_in: tokenCache.expires_at ? Math.floor((tokenCache.expires_at - Date.now()) / 1000) : 0
    });
});

/**
 * POST /refresh-token
 * Fuerza renovación del token
 */
app.post('/refresh-token', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Limpiar cache
        tokenCache.access_token = null;
        tokenCache.expires_at = null;
        
        const token = await getAccessToken(username, password);
        
        res.json({
            success: true,
            access_token: token
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '1.0.0',
        endpoints: {
            health: 'GET /health',
            login: 'POST /login',
            cotizar: 'POST /cotizar',
            refresh: 'POST /refresh-token'
        },
        status: 'running',
        chrome_path: process.env.CHROME_PATH || 'chrome-aws-lambda'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║
║   🔗 Ready to receive requests        ║
╚═══════════════════════════════════════╝
    `);
});