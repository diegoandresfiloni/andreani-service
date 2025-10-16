const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Configuración para Puppeteer en Render
const getPuppeteerOptions = () => {
  const options = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--single-process',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  };

  // Usar Chrome del sistema si está configurado PUPPETEER_EXECUTABLE_PATH
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    options.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    console.log('🔧 Usando Chrome en:', options.executablePath);
  } else {
    console.log('✅ Usando Chromium incluido con Puppeteer');
  }

  return options;
};

console.log('🔍 Configuración de Puppeteer:');
console.log('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD:', process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD);
console.log('PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH || 'no configurado');

let cachedToken = null;
let tokenExpiry = null;

/**
 * Autenticación con Puppeteer - Versión mejorada
 */
async function getValidToken(username, password) {
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('✅ Usando token desde cache');
        return cachedToken;
    }
    
    console.log('🔄 Iniciando autenticación con Puppeteer...');
    
    let browser;
    try {
        console.log('🚀 Lanzando navegador...');
        const options = getPuppeteerOptions();
        
        browser = await puppeteer.launch(options);
        console.log('✅ Navegador lanzado exitosamente');

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
        
        console.log('📄 Navegando a Andreani...');
        
        try {
            await page.goto('https://pymes.andreani.com/#/login', { 
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            console.log('✅ Página cargada exitosamente');
        } catch (navigationError) {
            console.log('⚠️ Error en navegación, reintentando con domcontentloaded...');
            await page.goto('https://pymes.andreani.com/#/login', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        }
        
        console.log('🔍 Buscando formulario de login...');
        await page.waitForTimeout(3000);
        
        // Intentar diferentes selectores para campos del formulario
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[placeholder*="email" i]',
            'input[placeholder*="correo" i]'
        ];
        
        const passwordSelectors = [
            'input[type="password"]',
            'input[name="password"]', 
            'input[placeholder*="contraseña" i]',
            'input[placeholder*="password" i]'
        ];
        
        let emailField = null;
        let passwordField = null;
        
        for (const selector of emailSelectors) {
            emailField = await page.$(selector);
            if (emailField) {
                console.log('✅ Campo email encontrado:', selector);
                break;
            }
        }
        
        for (const selector of passwordSelectors) {
            passwordField = await page.$(selector);
            if (passwordField) {
                console.log('✅ Campo password encontrado:', selector);
                break;
            }
        }
        
        if (!emailField || !passwordField) {
            console.log('❌ Formulario de login no encontrado');
            try {
                await page.screenshot({ path: '/tmp/login-page.png' });
                console.log('📸 Screenshot guardado en /tmp/login-page.png');
            } catch (e) {
                console.log('⚠️ No se pudo guardar screenshot');
            }
            throw new Error('Formulario de login no encontrado');
        }
        
        console.log('✏️ Rellenando credenciales...');
        await emailField.type(username, { delay: 100 });
        await passwordField.type(password, { delay: 100 });
        
        console.log('🔘 Buscando botón de login...');
        const buttonSelectors = [
            'button[type="submit"]',
            'input[type="submit"]',
            'button:contains("Ingresar")',
            'button:contains("Login")',
            'button:contains("Iniciar")',
            '.btn-primary',
            '.btn-login'
        ];
        
        let loginButton = null;
        for (const selector of buttonSelectors) {
            try {
                loginButton = await page.$(selector);
                if (loginButton) {
                    console.log('✅ Botón encontrado:', selector);
                    break;
                }
            } catch (e) {
                // Continuar con siguiente selector
            }
        }
        
        if (!loginButton) {
            const buttons = await page.$x('//button[contains(., "Ingresar") or contains(., "Login") or contains(., "Iniciar")]');
            if (buttons.length > 0) {
                loginButton = buttons[0];
                console.log('✅ Botón encontrado via XPath');
            }
        }
        
        if (loginButton) {
            console.log('🖱️ Haciendo clic en botón...');
            await loginButton.click();
        } else {
            console.log('✏️ Presionando Enter...');
            await passwordField.press('Enter');
        }
        
        console.log('⏳ Esperando respuesta...');
        await page.waitForTimeout(5000);
        
        const currentUrl = page.url();
        console.log('🌐 URL actual:', currentUrl);
        
        if (!currentUrl.includes('login') && currentUrl !== 'https://pymes.andreani.com/#/login') {
            console.log('✅ Login aparentemente exitoso');
            
            const token = await page.evaluate(() => {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.includes('token') || key.includes('auth') || key.includes('access'))) {
                        return localStorage.getItem(key);
                    }
                }
                return null;
            });
            
            if (token) {
                cachedToken = token;
                tokenExpiry = Date.now() + (3600 * 1000 * 0.9);
                console.log('✅ Token obtenido del localStorage');
                return token;
            }
            
            cachedToken = 'authenticated_' + Date.now();
            tokenExpiry = Date.now() + (3600 * 1000 * 0.9);
            console.log('✅ Login exitoso (token simulado)');
            return cachedToken;
            
        } else {
            const errorElement = await page.$('.error, .alert-danger, .text-danger');
            if (errorElement) {
                const errorText = await page.evaluate(el => el.textContent, errorElement);
                throw new Error('Error en login: ' + errorText);
            }
            throw new Error('Login fallido - sigue en página de login');
        }
        
    } catch (error) {
        console.error('❌ Error en autenticación:', error.message);
        throw new Error('LOGIN_FAILED: ' + error.message);
    } finally {
        if (browser) {
            await browser.close();
            console.log('📚 Navegador cerrado');
        }
    }
}

/**
 * API pública para cotizaciones
 */
async function cotizarConApiPublica(params) {
    console.log('🔤 Cotizando con API pública...');
    
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
    console.log('📦 Creando envío...');
    
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

// ============================================
// ENDPOINTS
// ============================================

app.post('/cotizar', async (req, res) => {
    try {
        const { params } = req.body;
        
        console.log('📍 Request recibido en /cotizar');
        
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
        
        console.log('📦 Request recibido en /crear-envio');
        console.log('👤 Username:', username ? '✅' : '❌');
        console.log('🔑 Password:', password ? '✅' : '❌');
        console.log('🎫 Token:', token ? '✅' : '❌');
        
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
                    message: 'Se necesitan credenciales o token'
                });
            }
            
            console.log('🔄 No hay token, intentando login con Puppeteer...');
            accessToken = await getValidToken(username, password);
        }
        
        console.log('✅ Token obtenido, creando envío...');
        const result = await crearEnvio(envio, accessToken);
        
        res.json({
            success: true,
            data: result,
            message: 'Envío creado exitosamente'
        });
        
    } catch (error) {
        console.error('❌ Error al crear envío:', error.message);
        
        if (error.message.includes('LOGIN_FAILED')) {
            return res.status(401).json({
                success: false,
                error: 'LOGIN_FAILED',
                message: 'Error de autenticación: ' + error.message
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

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('🔐 Request de login para:', username);
        
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
            error: 'LOGIN_FAILED',
            message: error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Andreani API - Render',
        puppeteer: 'configurado',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '8.1.0 - Puppeteer',
        endpoints: {
            health: 'GET /health',
            cotizar: 'POST /cotizar (API pública - sin login)',
            crear_envio: 'POST /crear-envio (requiere credenciales)',
            login: 'POST /login (obtener token manual)'
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

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Rechazo sin manejar at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Excepción no capturada:', error);
    process.exit(1);
});

app.listen(PORT, () => {
    console.log(`
🚀 Andreani Service RUNNING en Render
🔡 Puerto: ${PORT}
✅ Puppeteer configurado
🌐 Health: /health
    `);
    console.log('📋 Endpoints disponibles:');
    console.log('   GET  /health      - Estado del servicio');
    console.log('   POST /cotizar     - Obtener tarifas (API pública)');
    console.log('   POST /crear-envio - Crear envío (requiere credenciales)');
    console.log('   POST /login       - Obtener token manual');
});