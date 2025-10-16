const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Configuración específica para Render
const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--single-process'
  ],
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'
};

console.log('🔧 Configuración Puppeteer:', {
  executablePath: puppeteerOptions.executablePath,
  headless: puppeteerOptions.headless
});

let cachedToken = null;
let tokenExpiry = null;

/**
 * Autenticación con Puppeteer optimizada para Render
 */
async function getValidToken(username, password) {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('✅ Usando token desde cache');
        return cachedToken;
    }
    
    console.log('🔄 Iniciando autenticación con Puppeteer en Render...');
    
    let browser;
    try {
        console.log('🚀 Lanzando Chrome...');
        browser = await puppeteer.launch(puppeteerOptions);
        console.log('✅ Chrome lanzado exitosamente');

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        // Navegar directamente al login de Andreani PyMés
        console.log('🔐 Navegando a Andreani...');
        await page.goto('https://pymes.andreani.com/#/login', { 
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        console.log('📝 Llenando formulario...');
        
        // Esperar y llenar el formulario de login
        await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
        await page.type('input[type="email"], input[name="email"]', username);
        await page.type('input[type="password"], input[name="password"]', password);
        
        // Hacer clic en el botón de login
        await page.click('button[type="submit"], input[type="submit"]');
        
        // Esperar navegación
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        
        // Verificar si el login fue exitoso
        const currentUrl = page.url();
        console.log('🌐 URL después del login:', currentUrl);
        
        if (currentUrl.includes('dashboard') || !currentUrl.includes('login')) {
            console.log('✅ Login exitoso');
            
            // Obtener token de localStorage
            const token = await page.evaluate(() => {
                return localStorage.getItem('auth_token') || 
                       localStorage.getItem('access_token') ||
                       sessionStorage.getItem('auth_token') ||
                       sessionStorage.getItem('access_token');
            });
            
            if (token) {
                cachedToken = token;
                tokenExpiry = Date.now() + (3600 * 1000 * 0.9);
                console.log('✅ Token obtenido del storage');
                return token;
            }
            
            // Si no hay token en storage, usar cookies
            const cookies = await page.cookies();
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
            
            // Como fallback, devolver un indicador de éxito
            cachedToken = 'authenticated_' + Date.now();
            tokenExpiry = Date.now() + (3600 * 1000 * 0.9);
            console.log('✅ Login exitoso (sin token específico)');
            return cachedToken;
            
        } else {
            throw new Error('No se pudo verificar el login exitoso');
        }
        
    } catch (error) {
        console.error('❌ Error en autenticación:', error.message);
        throw new Error('LOGIN_FAILED: ' + error.message);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔚 Navegador cerrado');
        }
    }
}

/**
 * API pública para cotizaciones
 */
async function cotizarConApiPublica(params) {
    console.log('📤 Cotizando con API pública...');
    
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
        const response = await fetch('https://cotizador-api.andreani.com/api/v1/Cotizar', {
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
        console.log('✅ Tarifas obtenidas:', result.length || 0);
        return result;
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        throw error;
    }
}

/**
 * Crear envío
 */
async function crearEnvio(envio, token) {
    console.log('📤 Creando envío...');
    
    // Si el token es nuestro token de fallback, no usar Bearer
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    
    if (!token.startsWith('authenticated_')) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const response = await fetch('https://pymes-api.andreani.com/api/v1/Envios', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(envio)
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

// ENDPOINTS (mantener igual que antes)
app.post('/cotizar', async (req, res) => {
    try {
        const { params } = req.body;
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'PARAMS_REQUIRED'
            });
        }
        
        const result = await cotizarConApiPublica(params);
        res.json({ success: true, data: result });
        
    } catch (error) {
        console.error('❌ Error en cotización:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/crear-envio', async (req, res) => {
    try {
        const { envio, username, password, token } = req.body;
        
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
        res.json({ success: true, data: result });
        
    } catch (error) {
        console.error('❌ Error al crear envío:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
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
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Andreani API - Render',
        puppeteer: 'configured',
        timestamp: new Date().toISOString()
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
🚀 Andreani Service RUNNING on Render
📡 Port: ${PORT}
✅ Puppeteer configured for production
🌐 Health: https://your-app.onrender.com/health
    `);
});