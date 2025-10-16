const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-core');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache del token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Autenticación liviana con Playwright
 */
async function getValidToken(username, password) {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('✅ Usando token desde cache');
        return cachedToken;
    }
    
    console.log('🔄 Autenticación rápida con Playwright...');
    
    let browser;
    try {
        // Usar Chromium del sistema o descargar versión mínima
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        
        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        });
        
        const page = await context.newPage();
        
        // Navegar directamente al endpoint de login de API (si existe)
        console.log('🔐 Intentando login directo...');
        
        // PRIMERO: Intentar endpoint directo (más rápido)
        try {
            const directToken = await tryDirectLogin(username, password);
            if (directToken) {
                cachedToken = directToken;
                tokenExpiry = Date.now() + (3600 * 1000 * 0.9);
                console.log('✅ Token obtenido por método directo');
                return directToken;
            }
        } catch (directError) {
            console.log('⚠️ Método directo falló, usando navegador...');
        }
        
        // SEGUNDO: Usar navegador como fallback
        await page.goto('https://pymes.andreani.com/', { 
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });
        
        // Buscar formulario de login rápidamente
        const loginUrl = await findLoginUrl(page);
        if (loginUrl) {
            await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            
            // Intentar llenar formulario rápidamente
            await page.fill('input[type="email"], input[name="email"], #email', username, { timeout: 5000 });
            await page.fill('input[type="password"], input[name="password"], #password', password, { timeout: 5000 });
            await page.click('button[type="submit"], input[type="submit"]', { timeout: 5000 });
            
            // Esperar navegación breve
            await page.waitForTimeout(3000);
            
            // Extraer token de cookies
            const cookies = await context.cookies();
            const authCookie = cookies.find(cookie => 
                cookie.name.includes('token') || 
                cookie.name.includes('auth') ||
                cookie.name.includes('session')
            );
            
            if (authCookie) {
                cachedToken = authCookie.value;
                tokenExpiry = Date.now() + (3600 * 1000 * 0.9);
                console.log('✅ Token obtenido de cookies');
                return authCookie.value;
            }
        }
        
        throw new Error('No se pudo autenticar');
        
    } catch (error) {
        console.error('❌ Error en autenticación:', error.message);
        throw new Error('AUTH_FAILED: ' + error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Intentar login directo a API
 */
async function tryDirectLogin(username, password) {
    try {
        // Intentar diferentes endpoints posibles
        const endpoints = [
            'https://pymes-api.andreani.com/api/v1/Acceso/login',
            'https://api.andreani.com/login',
            'https://pymes.andreani.com/api/auth/login'
        ];
        
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                    timeout: 5000
                });
                
                if (response.ok) {
                    const data = await response.json();
                    return data.access_token || data.token;
                }
            } catch (e) {
                // Continuar con siguiente endpoint
                continue;
            }
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Encontrar URL de login
 */
async function findLoginUrl(page) {
    try {
        // Buscar enlaces de login
        const loginLinks = await page.$$eval('a', links => 
            links
                .filter(link => 
                    link.textContent.toLowerCase().includes('login') ||
                    link.textContent.toLowerCase().includes('iniciar') ||
                    link.href.includes('login')
                )
                .map(link => link.href)
        );
        
        return loginLinks[0] || 'https://pymes.andreani.com/#/login';
    } catch (error) {
        return 'https://pymes.andreani.com/#/login';
    }
}

/**
 * API pública para cotizaciones (SIN AUTENTICACIÓN)
 */
async function cotizarConApiPublica(params) {
    console.log('📤 Cotización rápida con API pública...');
    
    const apiUrl = 'https://cotizador-api.andreani.com/api/v1/Cotizar';
    
    const requestData = {
        usuarioId: null,
        tipoDeEnvioId: params.tipoDeEnvioId,
        codigoPostalOrigen: params.codigoPostalOrigen || '8000',
        codigoPostalDestino: params.codigoPostalDestino,
        bultos: params.bultos.map(bulto => ({
            itemId: generateGuid(),
            altoCm: bulto.altoCm.toString(),
            anchoCm: bulto.anchoCm.toString(),
            largoCm: bulto.largoCm.toString(),
            peso: (bulto.peso / 1000).toString(),
            unidad: 'kg',
            valorDeclarado: bulto.valorDeclarado.toString()
        }))
    };
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'xapikey': 'TEST_XqPMiwXzTRKHH0mF3gmtPtQt3LNGIuqCTdgaUHINMdmlaFid0x9MzlYTKXPxluYQ',
                'Origin': 'https://pymes.andreani.com',
                'Referer': 'https://pymes.andreani.com/cotizador'
            },
            body: JSON.stringify(requestData),
            timeout: 10000
        });
        
        const responseText = await response.text();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }
        
        const result = JSON.parse(responseText);
        console.log('✅ Tarifas obtenidas:', result.length || 0);
        
        return result;
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        throw error;
    }
}

/**
 * Crear envío con token
 */
async function crearEnvio(envio, token) {
    console.log('📤 Creando envío...');
    
    const response = await fetch('https://pymes-api.andreani.com/api/v1/Envios', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(envio),
        timeout: 15000
    });
    
    const responseText = await response.text();
    console.log('📥 Respuesta (Status:', response.status, ')');
    
    if (!response.ok) {
        if (response.status === 401) {
            cachedToken = null;
            tokenExpiry = null;
            throw new Error('TOKEN_EXPIRED');
        }
        throw new Error(`HTTP ${response.status}: ${responseText}`);
    }
    
    return JSON.parse(responseText);
}

// ============================================
// ENDPOINTS (MISMOS)
// ============================================

app.post('/cotizar', async (req, res) => {
    try {
        const { params } = req.body;
        
        console.log('📍 /cotizar - API pública');
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'PARAMS_REQUIRED'
            });
        }
        
        const result = await cotizarConApiPublica(params);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/crear-envio', async (req, res) => {
    try {
        const { envio, username, password, token } = req.body;
        
        console.log('📦 /crear-envio');
        
        if (!envio) {
            return res.status(400).json({
                success: false,
                error: 'ENVIO_DATA_REQUIRED'
            });
        }
        
        let accessToken = token;
        
        if (!accessToken) {
            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'AUTH_REQUIRED'
                });
            }
            
            accessToken = await getValidToken(username, password);
        }
        
        const result = await crearEnvio(envio, accessToken);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Error al crear envío:', error.message);
        
        if (error.message === 'TOKEN_EXPIRED') {
            return res.status(401).json({
                success: false,
                error: 'TOKEN_EXPIRED'
            });
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('🔐 /login para:', username);
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'CREDENTIALS_REQUIRED'
            });
        }
        
        const token = await getValidToken(username, password);
        
        res.json({
            success: true,
            access_token: token,
            expires_in: Math.floor((tokenExpiry - Date.now()) / 1000)
        });
        
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({
            success: false,
            error: 'LOGIN_FAILED'
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        token_cached: cachedToken !== null,
        memory: process.memoryUsage(),
        version: '8.0.0 - Liviano'
    });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '8.0.0 - Versión Liviana',
        performance: 'Optimizado para deploy rápido',
        endpoints: {
            cotizar: 'POST /cotizar (API pública - rápido)',
            crear_envio: 'POST /crear-envio',
            login: 'POST /login', 
            health: 'GET /health'
        }
    });
});

function generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║  
║   ⚡ VERSIÓN LIVIANA - RÁPIDO         ║
║   🎯 Cotizaciones: API pública        ║
║   🤖 Envíos: Playwright mínimo        ║
╚═══════════════════════════════════════╝
    `);
});