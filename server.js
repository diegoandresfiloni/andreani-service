const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache del token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Autenticación con Puppeteer (simula navegador real)
 */
async function getValidToken(username, password) {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('✅ Usando token desde cache');
        return cachedToken;
    }
    
    console.log('🔄 Iniciando autenticación con Puppeteer...');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Navegar al portal de Andreani
        await page.goto('https://onboarding.andreani.com/', { 
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        console.log('🔐 Llenando formulario de login...');
        
        // Esperar y llenar el formulario
        await page.waitForSelector('#signInName', { timeout: 10000 });
        await page.type('#signInName', username);
        await page.type('#password', password);
        
        // Hacer clic en el botón de login
        await page.click('#next');
        
        // Esperar a que la redirección termine
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        
        // Obtener el token de las cookies o localStorage
        const tokens = await page.evaluate(() => {
            // Intentar obtener token de diferentes lugares
            const localStorageToken = localStorage.getItem('andreani_token');
            const sessionStorageToken = sessionStorage.getItem('access_token');
            
            return {
                localStorage: localStorageToken,
                sessionStorage: sessionStorageToken,
                cookies: document.cookie
            };
        });
        
        console.log('🔍 Tokens encontrados:', tokens);
        
        // Extraer token de donde sea que esté
        let accessToken = tokens.localStorage || tokens.sessionStorage;
        
        if (!accessToken) {
            // Si no encontramos token, intentar obtenerlo de la API directamente
            accessToken = await extractTokenFromAPI(page);
        }
        
        if (!accessToken) {
            throw new Error('No se pudo obtener el token de acceso después del login');
        }
        
        cachedToken = accessToken;
        tokenExpiry = Date.now() + (3600 * 1000 * 0.9); // 1 hora
        
        console.log('✅ Token obtenido exitosamente');
        return accessToken;
        
    } catch (error) {
        console.error('❌ Error en autenticación Puppeteer:', error.message);
        throw new Error('PUPPETEER_LOGIN_FAILED: ' + error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * Intentar extraer token de llamadas API
 */
async function extractTokenFromAPI(page) {
    try {
        // Escuchar todas las respuestas de red
        const responses = [];
        page.on('response', response => {
            if (response.url().includes('andreani') && 
                (response.headers()['authorization'] || response.headers()['set-cookie'])) {
                responses.push({
                    url: response.url(),
                    headers: response.headers(),
                    status: response.status()
                });
            }
        });
        
        // Esperar un momento para capturar respuestas
        await page.waitForTimeout(3000);
        
        console.log('📡 Respuestas de API capturadas:', responses.length);
        
        // Buscar token en headers
        for (const response of responses) {
            if (response.headers.authorization) {
                const token = response.headers.authorization.replace('Bearer ', '');
                if (token) return token;
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error extrayendo token de API:', error);
        return null;
    }
}

/**
 * ALTERNATIVA: Usar API key pública para cotizaciones (NO requiere login)
 */
async function cotizarConApiPublica(params) {
    console.log('📤 Usando API pública para cotización...');
    
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
            body: JSON.stringify(requestData)
        });
        
        const responseText = await response.text();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }
        
        const result = JSON.parse(responseText);
        console.log('✅ Tarifas obtenidas (API pública):', result.length || 0);
        
        return result;
        
    } catch (error) {
        console.error('❌ Error en cotización API pública:', error.message);
        throw error;
    }
}

/**
 * Para crear envíos necesitamos token real - usar Puppeteer
 */
async function crearEnvio(envio, token) {
    console.log('📤 Creando envío en Andreani API...');
    
    const response = await fetch('https://pymes-api.andreani.com/api/v1/Envios', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(envio)
    });
    
    const responseText = await response.text();
    console.log('📥 Respuesta crear envío (Status:', response.status, ')');
    
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
// ENDPOINTS ACTUALIZADOS
// ============================================

app.post('/cotizar', async (req, res) => {
    try {
        const { params, username, password, token } = req.body;
        
        console.log('📍 Request recibido en /cotizar');
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'PARAMS_REQUIRED'
            });
        }
        
        // PARA COTIZACIONES: Usar siempre API pública (no requiere login)
        console.log('🎯 Usando API pública para cotización...');
        const result = await cotizarConApiPublica(params);
        
        res.json({
            success: true,
            data: result,
            message: 'Cotización obtenida con API pública'
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
        
        console.log('📦 Request recibido en /crear-envio');
        
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
                    error: 'AUTH_REQUIRED',
                    message: 'Para crear envíos se necesitan credenciales'
                });
            }
            
            // PARA CREAR ENVÍOS: Usar Puppeteer para autenticación real
            accessToken = await getValidToken(username, password);
        }
        
        const result = await crearEnvio(envio, accessToken);
        
        res.json({
            success: true,
            data: result,
            message: 'Envío creado exitosamente'
        });
        
    } catch (error) {
        console.error('❌ Error al crear envío:', error.message);
        
        if (error.message.includes('PUPPETEER_LOGIN_FAILED')) {
            return res.status(401).json({
                success: false,
                error: 'LOGIN_FAILED',
                message: 'Credenciales inválidas o problema de autenticación'
            });
        }
        
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

// ... (los otros endpoints se mantienen igual)

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
║   ✅ API Pública + Puppeteer Auth     ║
║   🎯 Cotizaciones sin login           ║
╚═══════════════════════════════════════╝
    `);
});