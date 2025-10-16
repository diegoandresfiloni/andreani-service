const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Cache del token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Nuevo sistema de autenticación OAuth2 con Andreani B2C
 */
async function getValidToken(username, password) {
    // Si hay token en cache y no expiró, usarlo
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
        console.log('✅ Usando token desde cache');
        return cachedToken;
    }
    
    console.log('🔄 Obteniendo nuevo token con OAuth2...');
    
    try {
        // Paso 1: Obtener el código de autorización
        const authCode = await getAuthorizationCode(username, password);
        
        // Paso 2: Cambiar el código por el token de acceso
        const tokenData = await exchangeCodeForToken(authCode);
        
        cachedToken = tokenData.access_token;
        const expiresIn = tokenData.expires_in || 3600;
        tokenExpiry = Date.now() + (expiresIn * 1000 * 0.9); // 90% del tiempo
        
        console.log('✅ Token obtenido exitosamente');
        return cachedToken;
        
    } catch (error) {
        console.error('❌ Error en autenticación OAuth2:', error.message);
        throw new Error('OAUTH2_LOGIN_FAILED: ' + error.message);
    }
}

/**
 * Paso 1: Obtener código de autorización mediante el flujo de login
 */
async function getAuthorizationCode(username, password) {
    console.log('🔐 Iniciando flujo OAuth2...');
    
    // Simular el flujo de login web
    const loginData = new URLSearchParams();
    loginData.append('Email', username);
    loginData.append('Contraseña', password);
    
    const response = await fetch('https://onboarding.andreani.com/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: loginData,
        redirect: 'manual' // No seguir redirecciones automáticamente
    });
    
    if (response.status === 302) {
        const location = response.headers.get('location');
        if (location && location.includes('code=')) {
            const codeMatch = location.match(/code=([^&]+)/);
            if (codeMatch) {
                return codeMatch[1];
            }
        }
    }
    
    throw new Error('No se pudo obtener el código de autorización');
}

/**
 * Paso 2: Cambiar código por token de acceso
 */
async function exchangeCodeForToken(authorizationCode) {
    console.log('🔄 Cambiando código por token...');
    
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', '8a428062-b113-4fb6-b496-8ddb1003b566');
    tokenParams.append('grant_type', 'authorization_code');
    tokenParams.append('code', authorizationCode);
    tokenParams.append('redirect_uri', 'https://onboarding.andreani.com/');
    tokenParams.append('scope', 'openid profile offline_access');
    
    const response = await fetch('https://andreanib2c.b2clogin.com/andreanib2c.onmicrosoft.com/b2c_1a_susi_gcp_acom_v2/oauth2/v2.0/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: tokenParams
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
}

/**
 * ALTERNATIVA: Usar autenticación directa con la API (si todavía funciona)
 */
async function getTokenDirect(username, password) {
    console.log('🔐 Intentando autenticación directa...');
    
    try {
        // Intentar con el endpoint tradicional primero
        const response = await fetch('https://pymes-api.andreani.com/api/v1/Acceso/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Token obtenido por método directo');
            return data.access_token;
        }
        
        // Si falla, probar con OAuth2
        console.log('⚠️ Método directo falló, intentando OAuth2...');
        return await getValidToken(username, password);
        
    } catch (error) {
        console.error('❌ Error en autenticación directa:', error.message);
        throw error;
    }
}

/**
 * Cotiza envío usando la API privada
 */
async function cotizarEnvioPrivado(params, token) {
    const apiUrl = 'https://cotizador-api.andreani.com/api/v1/Cotizar';
    
    let codigoPostalOrigen = params.codigoPostalOrigen || '8000';
    
    const requestData = {
        usuarioId: null,
        tipoDeEnvioId: params.tipoDeEnvioId,
        codigoPostalOrigen: codigoPostalOrigen,
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
    
    console.log('📤 Cotizando con API REST pública...');
    
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
        
        console.log('📥 Respuesta (Status:', response.status, ')');
        
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
 * Crea un envío en Andreani
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
    console.log('📥 Respuesta de Andreani (Status:', response.status, ')');
    
    if (!response.ok) {
        if (response.status === 401) {
            cachedToken = null;
            tokenExpiry = null;
            throw new Error('TOKEN_EXPIRED');
        }
        
        throw new Error(`HTTP ${response.status}: ${responseText}`);
    }
    
    let result;
    try {
        result = JSON.parse(responseText);
    } catch {
        result = { message: 'Envío creado' };
    }
    
    console.log('✅ Envío creado exitosamente');
    return result;
}

/**
 * Genera un GUID
 */
function generateGuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================
// ENDPOINTS (MISMOS QUE ANTES)
// ============================================

app.post('/cotizar', async (req, res) => {
    try {
        const { params, username, password, token } = req.body;
        
        console.log('📍 Request recibido en /cotizar');
        console.log('Username:', username ? '✅' : '❌');
        console.log('Password:', password ? '✅' : '❌');
        console.log('Token manual:', token ? '✅' : '❌');
        
        if (!params) {
            return res.status(400).json({ 
                success: false,
                error: 'PARAMS_REQUIRED',
                message: 'Parámetros de cotización requeridos' 
            });
        }
        
        let accessToken = token;
        
        if (!accessToken) {
            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'AUTH_REQUIRED',
                    message: 'Se requiere token o credenciales'
                });
            }
            
            try {
                // Usar el método directo primero, que fallará al OAuth2 si es necesario
                accessToken = await getTokenDirect(username, password);
            } catch (error) {
                console.error('❌ Error de autenticación:', error.message);
                return res.status(401).json({
                    success: false,
                    error: 'LOGIN_FAILED',
                    message: 'Credenciales inválidas o sistema de login cambiado'
                });
            }
        }
        
        console.log('✅ Cotizando con token válido...');
        const result = await cotizarEnvioPrivado(params, accessToken);
        
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
        
        console.log('📦 Request recibido en /crear-envio');
        
        if (!envio) {
            return res.status(400).json({
                success: false,
                error: 'ENVIO_DATA_REQUIRED',
                message: 'Se requieren datos del envío'
            });
        }
        
        let accessToken = token;
        
        if (!accessToken) {
            if (!username || !password) {
                return res.status(400).json({
                    success: false,
                    error: 'AUTH_REQUIRED',
                    message: 'Se requiere token o credenciales'
                });
            }
            
            accessToken = await getTokenDirect(username, password);
        }
        
        const result = await crearEnvio(envio, accessToken);
        
        res.json({
            success: true,
            data: result,
            message: 'Envío pendiente creado en Andreani'
        });
        
    } catch (error) {
        console.error('❌ Error al crear envío:', error.message);
        
        if (error.message === 'TOKEN_EXPIRED') {
            return res.status(401).json({
                success: false,
                error: 'TOKEN_EXPIRED',
                message: 'Token expirado'
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
        
        console.log('🔐 Login request para:', username);
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'CREDENTIALS_REQUIRED',
                message: 'Se requieren usuario y contraseña'
            });
        }
        
        const token = await getTokenDirect(username, password);
        
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
        uptime: Math.floor(process.uptime()),
        token_cached: cachedToken !== null,
        token_valid: cachedToken && tokenExpiry && Date.now() < tokenExpiry,
        auth_system: 'OAuth2 B2C + Método Directo'
    });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Andreani Service API',
        version: '6.0.0 - Sistema OAuth2 B2C',
        endpoints: {
            health: 'GET /health',
            cotizar: 'POST /cotizar',
            crear_envio: 'POST /crear-envio',
            login: 'POST /login'
        },
        auth_system: 'Soporte para nuevo login OAuth2 de Andreani'
    });
});

app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🚀 Andreani Service RUNNING         ║
║   📡 Port: ${PORT}                       ║
║   ✅ Sistema OAuth2 B2C               ║
║   🔐 Nuevo flujo de autenticación     ║
╚═══════════════════════════════════════╝
    `);
});